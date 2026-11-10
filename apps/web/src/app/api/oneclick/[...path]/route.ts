/**
 * Thin, stateless proxy to NEAR Intents 1Click. It exists only to attach the
 * partner API key (server-side secret), our app fee and referral tag.
 * It holds no funds, stores nothing, and only allows the four routes the site
 * uses, with quotes restricted to "deliver USDC on Base to the caller's own
 * address" so it can't be used as an open relay.
 *
 * Uses only fetch/Request/Response so it runs on Vercel and Cloudflare Workers.
 */
import { brand } from "../../../../brand";
import { overLimit } from "../../../../server/ratelimit";

const UPSTREAM = process.env.ONECLICK_BASE_URL ?? "https://1click.chaindefuser.com";
// Tags our volume in NEAR Intents' stats; pays nothing by itself.
const REFERRAL = brand.repo;
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

const ALLOWED: Record<string, "GET" | "POST"> = {
  "v0/tokens": "GET",
  "v0/quote": "POST",
  "v0/status": "GET",
  "v0/deposit/submit": "POST",
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (process.env.ONECLICK_API_KEY) h["X-API-Key"] = process.env.ONECLICK_API_KEY;
  return h;
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

type Ctx = { params: Promise<{ path: string[] }> };

/** Per-IP, per-minute caps so our partner key can't be used as a free quote API. Quotes are the expensive call. */
const LIMITS: Record<string, number> = { "v0/quote": 20, "v0/tokens": 30, "v0/status": 120, "v0/deposit/submit": 20 };
const limited = (req: Request, path: string) => overLimit(req, `1c:${path}`, LIMITS[path] ?? 30);

export async function GET(req: Request, ctx: Ctx) {
  const path = (await ctx.params).path.join("/");
  if (ALLOWED[path] !== "GET") return json(404, { message: "not allowed" });
  if (await limited(req, path)) return json(429, { message: "Too many requests. Wait a minute and try again." });
  const qs = new URL(req.url).search;
  const res = await fetch(`${UPSTREAM}/${path}${qs}`, { headers: headers(), signal: AbortSignal.timeout(20_000) });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": "application/json", "cache-control": path === "v0/tokens" ? "public, max-age=60" : "no-store" },
  });
}

const QUOTE_FIELDS = ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline", "depositMode", "quoteWaitingTimeMs", "confidentiality", "sessionId"];

export async function POST(req: Request, ctx: Ctx) {
  const path = (await ctx.params).path.join("/");
  if (ALLOWED[path] !== "POST") return json(404, { message: "not allowed" });
  if (await limited(req, path)) return json(429, { message: "Too many requests. Wait a minute and try again." });
  const text = await readCapped(req, 4_000);
  if (text === null) return json(413, { message: "body too large" });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { message: "invalid json" });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { message: "body must be a JSON object" });

  if (path === "v0/quote") {
    if (body.destinationAsset !== BASE_USDC || body.recipientType !== "DESTINATION_CHAIN" || body.depositType !== "ORIGIN_CHAIN") {
      return json(400, { message: "this proxy only quotes deposits that deliver USDC on Base" });
    }
    // Only known fields go upstream, so no spelling of a fee or referral key can get through.
    body = Object.fromEntries(QUOTE_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]));
    // Fees and attribution are ours to set, never the caller's.
    body.referral = REFERRAL;
    const bps = Math.floor(Number(process.env.ONECLICK_APP_FEE_BPS ?? 0));
    if (bps > 0 && process.env.ONECLICK_FEE_RECIPIENT) {
      body.appFees = [{ recipient: process.env.ONECLICK_FEE_RECIPIENT, fee: Math.min(bps, 100) }];
    }
  }

  const res = await fetch(`${UPSTREAM}/${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** Read at most `max` bytes of the body, stopping early instead of buffering an oversized one. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) all.set(c, (o += c.byteLength) - c.byteLength);
  return new TextDecoder().decode(all);
}
