/**
 * Cache for the Intel collateral relay (src/app/api/tee/pccs). Keyed on the upstream
 * URL, so query variants of the same request share one entry, and bounded: oldest
 * entries go first and expired ones are dropped. Real traffic needs a handful
 * (audit V2-06). Per Worker isolate.
 */
export type Cached = { at: number; status: number; body: ArrayBuffer; headers: Record<string, string> };

const TTL_MS = 60 * 60_000;
const MAX_ENTRIES = 32;
const cache = new Map<string, Cached>();

export function cached(key: string): Cached | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= TTL_MS) return hit;
  if (hit) cache.delete(key);
  return undefined;
}

export function remember(key: string, v: Cached): void {
  cache.delete(key);
  cache.set(key, v);
  for (const [k, c] of cache) if (cache.size > MAX_ENTRIES || Date.now() - c.at > TTL_MS) cache.delete(k);
}

export const cacheSize = () => cache.size;
