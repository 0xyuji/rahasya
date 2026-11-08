/**
 * Thin, stateless proxy to NEAR Intents 1Click. It exists only to attach the
 * partner API key (server-side secret) and an optional integrator fee.
 * It holds no funds, stores nothing, and only allows the four routes the site
 * uses, with quotes restricted to "deliver USDC on Base to the caller's own
 * address" so it can't be used as an open relay.
 *
 * Uses only fetch/Request/Response so it runs on Vercel and Cloudflare Workers.
 */
import { kv } from "../../../../server/kv";

const UPSTREAM = process.env.ONECLICK_BASE_URL ?? "https://1click.chaindefuser.com";
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

async function limited(req: Request, path: string): Promise<boolean> {
  // Vercel and Cloudflare set these from the real connection; the client can't override them there.
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `rl1c:${path}:${ip}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const n = await kv().incr(key);
    await kv().expire(key, 120);
    return n > (LIMITS[path] ?? 30);
  } catch {
    return false; // no Redis configured (local dev without keys): don't block deposits
  }
}

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

export async function POST(req: Request, ctx: Ctx) {
  const path = (await ctx.params).path.join("/");
  if (ALLOWED[path] !== "POST") return json(404, { message: "not allowed" });
  if (await limited(req, path)) return json(429, { message: "Too many requests. Wait a minute and try again." });
  const text = await req.text();
  if (text.length > 4_000) return json(413, { message: "body too large" });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { message: "invalid json" });
  }

  if (path === "v0/quote") {
    if (body.destinationAsset !== BASE_USDC || body.recipientType !== "DESTINATION_CHAIN" || body.depositType !== "ORIGIN_CHAIN") {
      return json(400, { message: "this proxy only quotes deposits that deliver USDC on Base" });
    }
    // Fees are ours to set, never the caller's.
    delete body.appFees;
    const bps = Number(process.env.ONECLICK_APP_FEE_BPS ?? 0);
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
