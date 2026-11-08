import "server-only";
import { kv } from "./kv.ts";

/**
 * Fixed one-minute window per client network and bucket. In production (Cloudflare
 * Workers) the client address comes only from cf-connecting-ip, which Cloudflare sets
 * from the real connection. x-real-ip / x-forwarded-for are client-controlled
 * anywhere else, so they're only used in local development. Without Redis (local dev
 * with no keys) nothing is limited.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  if (process.env.NODE_ENV !== "production") {
    return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  }
  return "unknown"; // fail closed: all such requests share one bucket
}

/**
 * The bucket for an address: IPv4 as is; IPv6 by its /64, since one client normally
 * controls a whole /64 and could otherwise rotate addresses per request (audit V2-04).
 */
export function rateKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return full.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

export async function overLimit(req: Request, bucket: string, perMinute: number): Promise<boolean> {
  const key = `rlip:${bucket}:${rateKey(clientIp(req))}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const n = await kv().incr(key);
    await kv().expire(key, 120);
    return n > perMinute;
  } catch {
    return false;
  }
}
