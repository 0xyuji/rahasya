import "server-only";
import { Redis } from "@upstash/redis";

/**
 * The few Redis operations the server uses. Upstash over REST (fetch only),
 * so this runs on Vercel and Cloudflare Workers alike. Tests pass a fake.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  /** Atomic get + delete (single-use tokens). */
  getdel<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incrbyfloat(key: string, by: number): Promise<number | string>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  sadd(key: string, member: string): Promise<number>;
  srem(key: string, member: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  mget<T>(...keys: string[]): Promise<Array<T | null>>;
}

let client: KV | undefined;

export function kv(): KV {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set");
  client = new Redis({ url, token }) as unknown as KV;
  return client;
}

export function setKvForTests(fake: KV) {
  client = fake;
}
