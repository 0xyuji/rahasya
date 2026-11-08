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

/**
 * Header our own pages send with every cookie-authenticated request (see src/app/app-fetch.ts).
 * `import()`, <script>, <img> and navigations can't set it, and another site can't send it
 * without a CORS preflight we never allow. So a cookie route only answers the page's own fetch():
 * not a compromised library's `import("/api/keys", { with: { type: "json" } })` (audit T-02),
 * and not a cross-site form or link (CSRF).
 */
export const APP_REQUEST_HEADER = "x-app-request";

export function fromOurPage(req: Request): boolean {
  const dest = req.headers.get("sec-fetch-dest");
  if (dest && dest !== "empty") return false; // a module/script/document load, not fetch()
  return req.headers.get(APP_REQUEST_HEADER) === "1" && sameOrigin(req);
}

export async function withUser(req: Request, fn: (uid: string) => Promise<Response>): Promise<Response> {
  try {
    if (!fromOurPage(req)) return json(403, { message: "Cross-site request refused." });
    const uid = await sessionUser(req);
    if (!uid) return json(401, { message: "Sign in with your wallet first." });
    return await fn(uid);
  } catch (e) {
    if (e instanceof KeyError) return json(e.status, { message: e.message, code: e.code });
    const status = (e as { status?: number }).status;
    return json(status && status >= 400 && status < 500 ? status : 500, { message: (e as Error).message?.slice(0, 300) ?? "Server error" });
  }
}
