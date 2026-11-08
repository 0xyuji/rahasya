/**
 * fetch() for our own cookie-authenticated API routes. Adds the header the server
 * requires (server/http.ts APP_REQUEST_HEADER), which only a page's own fetch() can send.
 */
export function appFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-app-request", "1");
  return fetch(path, { ...init, headers, credentials: "same-origin" });
}
