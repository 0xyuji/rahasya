import "server-only";
import { kv } from "./kv.ts";

/**
 * Fixed one-minute window per client IP and bucket. Vercel and Cloudflare set
 * these headers from the real connection; clients can't override them there.
 * Without Redis (local dev with no keys) nothing is limited.
 */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function overLimit(req: Request, bucket: string, perMinute: number): Promise<boolean> {
  const key = `rlip:${bucket}:${clientIp(req)}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const n = await kv().incr(key);
    await kv().expire(key, 120);
    return n > perMinute;
  } catch {
    return false;
  }
}
