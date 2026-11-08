import "server-only";

/**
 * On Cloudflare Workers, work still running after the client hangs up can be cancelled
 * unless it's registered with ctx.waitUntil. OpenNext keeps the request's context on
 * this global; capture it at the start of the request (it's per request) and register
 * late writes (the spend settlement) with it. Elsewhere (Node, tests) it's a no-op.
 */
const CF_CONTEXT = Symbol.for("__cloudflare-context__");

export function keepAliveForRequest(): (p: Promise<unknown>) => void {
  const ctx = (globalThis as Record<symbol, { ctx?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[CF_CONTEXT]?.ctx;
  return (p) => {
    try {
      ctx?.waitUntil?.(p.catch(() => {}));
    } catch {
      // outside a request context
    }
  };
}
