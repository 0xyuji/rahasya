import { overLimit } from "../../../../../server/ratelimit";

/**
 * Relay for Intel's public attestation collateral (certificate revocation lists,
 * TCB info, QE identity), shaped like a PCCS so the in-browser verifier can use it.
 *
 * Why relay at all: so users' browsers never contact a third party when they open
 * Truly private mode (no IPs to Intel or anyone else). Why it's safe: everything
 * here is public and signed by Intel; the verifier checks those signatures against
 * Intel's root certificate built into the library, so this relay (or anyone
 * between it and Intel) can withhold data but can't forge it.
 *
 * Fetch-only (Vercel and Cloudflare Workers). No verification code runs here, and
 * no user data passes through: only the platform's FMSPC id, which is public.
 */
const INTEL_PCS = "https://api.trustedservices.intel.com";
const INTEL_ROOT_CA_CRL = "https://certificates.trustedservices.intel.com/IntelSGXRootCA.der";
const TTL_MS = 60 * 60_000;

type Route = { query: (q: URLSearchParams) => boolean; upstream: (q: URLSearchParams) => string; hexBody?: boolean; headers: string[] };

const ROUTES: Record<string, Route> = {
  "sgx/certification/v4/pckcrl": {
    query: (q) => keysAre(q, ["ca", "encoding"]) && ["processor", "platform"].includes(q.get("ca")!) && q.get("encoding") === "der",
    upstream: (q) => `${INTEL_PCS}/sgx/certification/v4/pckcrl?ca=${q.get("ca")}&encoding=der`,
    headers: ["SGX-PCK-CRL-Issuer-Chain"],
  },
  "tdx/certification/v4/tcb": {
    query: (q) => keysAre(q, ["fmspc"]) && /^[0-9a-fA-F]{12}$/.test(q.get("fmspc")!),
    upstream: (q) => `${INTEL_PCS}/tdx/certification/v4/tcb?fmspc=${q.get("fmspc")!.toUpperCase()}`,
    headers: ["TCB-Info-Issuer-Chain", "SGX-TCB-Info-Issuer-Chain"],
  },
  "tdx/certification/v4/qe/identity": {
    query: (q) => keysAre(q, ["update"]) && q.get("update") === "standard",
    upstream: () => `${INTEL_PCS}/tdx/certification/v4/qe/identity?update=standard`,
    headers: ["SGX-Enclave-Identity-Issuer-Chain"],
  },
  // PCCS serves the root CA CRL hex-encoded; Intel publishes it as DER.
  "sgx/certification/v4/rootcacrl": {
    query: (q) => keysAre(q, []),
    upstream: () => INTEL_ROOT_CA_CRL,
    hexBody: true,
    headers: [],
  },
};

function keysAre(q: URLSearchParams, keys: string[]): boolean {
  const got = [...q.keys()].sort();
  return got.length === keys.length && [...keys].sort().every((k, i) => got[i] === k);
}

type Cached = { at: number; status: number; body: ArrayBuffer; headers: Record<string, string> };
// Keyed on the upstream URL (so query variants of the same request share one entry), and
// bounded: oldest entries go first. Real traffic needs a handful (audit V2-06).
const cache = new Map<string, Cached>();
const MAX_ENTRIES = 32;
function remember(key: string, v: Cached) {
  cache.delete(key);
  cache.set(key, v);
  for (const [k, c] of cache) if (cache.size > MAX_ENTRIES || Date.now() - c.at > TTL_MS) cache.delete(k);
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  const route = Object.hasOwn(ROUTES, path) ? ROUTES[path]! : undefined;
  const q = new URL(req.url).searchParams;
  if (!route) return new Response("not found", { status: 404 });
  if (!route.query(q)) return new Response("bad query", { status: 400 });

  const key = route.upstream(q);
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    // Each verification needs 4 of these; cached requests above don't count.
    if (await overLimit(req, "pccs", 40)) return new Response("too many requests", { status: 429 });
    let res: Response;
    try {
      // "manual", not "error" (Cloudflare Workers don't support it): a redirect is then a non-OK response, refused below.
      res = await fetch(route.upstream(q), { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    } catch {
      return new Response("Intel's collateral service didn't answer", { status: 502 });
    }
    if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });
    const raw = await res.arrayBuffer();
    if (raw.byteLength > 512 * 1024) return new Response("upstream too large", { status: 502 });
    const headers: Record<string, string> = {};
    for (const h of route.headers) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    const body = route.hexBody ? new TextEncoder().encode(Array.from(new Uint8Array(raw), (b) => b.toString(16).padStart(2, "0")).join("")).buffer : raw;
    hit = { at: Date.now(), status: 200, body: body as ArrayBuffer, headers };
    remember(key, hit);
  }
  return new Response(hit.body, {
    status: hit.status,
    headers: { ...hit.headers, "content-type": "application/octet-stream", "cache-control": "public, max-age=3600, s-maxage=3600" },
  });
}
