/** In-memory KV fake for tests (same as the one in server.test.ts). */
import type { KV } from "./kv.ts";

export function fakeKv(): KV & { dump: Map<string, unknown> } {
  const m = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  return {
    dump: m,
    async get<T>(k: string) {
      return (m.has(k) ? structuredClone(m.get(k)) : null) as T | null;
    },
    async getdel<T>(k: string) {
      const v = (m.has(k) ? structuredClone(m.get(k)) : null) as T | null;
      m.delete(k);
      return v;
    },
    async set(k, v, o) {
      if (o?.nx && m.has(k)) return null;
      m.set(k, structuredClone(v));
      return "OK";
    },
    async del(...ks) {
      let n = 0;
      for (const k of ks) n += Number(m.delete(k) || sets.delete(k));
      return n;
    },
    async incrbyfloat(k, by) {
      const v = Number(m.get(k) ?? 0) + by;
      m.set(k, v);
      return v;
    },
    async incr(k) {
      const v = Number(m.get(k) ?? 0) + 1;
      m.set(k, v);
      return v;
    },
    async expire() {
      return 1;
    },
    async sadd(k, v) {
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(v);
      return 1;
    },
    async srem(k, v) {
      return Number(sets.get(k)?.delete(v) ?? false);
    },
    async smembers(k) {
      return [...(sets.get(k) ?? [])];
    },
    async mget<T>(...ks: string[]) {
      return ks.map((k) => (m.has(k) ? structuredClone(m.get(k)) : null)) as Array<T | null>;
    },
  };
}
