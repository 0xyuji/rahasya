import "server-only";
import { fallback, http, type Transport } from "viem";

/**
 * RPC endpoints for server-side reads. Free public endpoints rate-limit shared
 * cloud IPs (mainnet.base.org answers Cloudflare Workers with 429), so each chain
 * gets a fallback list: the configured URL first, then public endpoints that
 * answer from Workers. Login verification trusts these (audit K10).
 */
const BASE_RPCS = ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"];
const NEAR_RPCS = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"];

const withEnv = (env: string | undefined, list: string[]) => [...new Set([...(env ? [env] : []), ...list])];

export function baseTransport(): Transport {
  return fallback(withEnv(process.env.BASE_RPC_URL, BASE_RPCS).map((url) => http(url, { timeout: 8_000, retryCount: 0 })));
}

/** POST a NEAR JSON-RPC body, trying each endpoint until one answers 2xx with JSON. */
export async function nearRpc<T>(body: unknown): Promise<T> {
  let last: unknown;
  for (const url of withEnv(process.env.NEAR_RPC_URL, NEAR_RPCS)) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
      if (res.ok) return (await res.json()) as T;
      last = new Error(`NEAR RPC ${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("NEAR RPC unavailable");
}
