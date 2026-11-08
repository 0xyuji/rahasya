import "server-only";
import { KeyError } from "./keys.ts";
import { sessionUser } from "./login.ts";

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** Cookie-authenticated, state-changing routes must come from our own pages. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.method === "GET";
  return origin === new URL(req.url).origin;
}

export async function withUser(req: Request, fn: (uid: string) => Promise<Response>): Promise<Response> {
  try {
    if (!sameOrigin(req)) return json(403, { message: "Cross-site request refused." });
    const uid = await sessionUser(req);
    if (!uid) return json(401, { message: "Sign in with your wallet first." });
    return await fn(uid);
  } catch (e) {
    if (e instanceof KeyError) return json(e.status, { message: e.message, code: e.code });
    return json(500, { message: (e as Error).message?.slice(0, 300) ?? "Server error" });
  }
}
