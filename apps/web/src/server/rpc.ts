import "server-only";
import { createPublicClient, fallback, http, isAddressEqual, recoverMessageAddress, type Hex, type Transport } from "viem";
import { base } from "viem/chains";

/**
 * Server-side chain reads.
 *
 * Free public endpoints rate-limit shared cloud IPs (mainnet.base.org answers
 * Cloudflare Workers with 429), so there are several per chain. How much we trust
 * them depends on what's at stake:
 *  - balance reads (sweeps): any endpoint will do (fallback). A wrong answer can
 *    only make a top-up fail, never pay more than the wallet holds.
 *  - login checks: a lying endpoint would sign anyone in as anyone. So plain EVM
 *    signatures are checked locally with no RPC at all; smart-contract wallets and
 *    NEAR access keys need a configured RPC (BASE_RPC_URL / NEAR_RPC_URL, trusted
 *    alone) or, without one, the same answer from at least two independent public
 *    endpoints, with none disagreeing.
 */
const BASE_PUBLIC = ["https://base-rpc.publicnode.com", "https://base.drpc.org", "https://mainnet.base.org"];
const NEAR_PUBLIC = ["https://free.rpc.fastnear.com", "https://near.drpc.org", "https://rpc.mainnet.near.org"];
const TIMEOUT_MS = 8_000;

const withEnv = (env: string | undefined, list: string[]) => [...new Set([...(env ? [env] : []), ...list])];

/** For balance reads only (see above). */
export function baseTransport(): Transport {
  return fallback(withEnv(process.env.BASE_RPC_URL, BASE_PUBLIC).map((url) => http(url, { timeout: TIMEOUT_MS, retryCount: 0 })));
}

/** Endpoints to ask for a login decision, and how many must say yes. */
function quorum(env: string | undefined, publicList: string[]): { urls: string[]; need: number } {
  return env ? { urls: [env], need: 1 } : { urls: publicList, need: 2 };
}

/**
 * Ask every endpoint at once. Yes only if at least `need` answered yes and none
 * answered no. Endpoints that error or time out don't count either way.
 */
export async function agree(asks: Array<() => Promise<boolean>>, need: number): Promise<boolean> {
  const results = await Promise.allSettled(asks.map((ask) => ask()));
  const answers = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  return !answers.includes(false) && answers.filter(Boolean).length >= need;
}

/** EVM sign-in: local ECDSA recovery first; chain state only for smart-contract wallets. */
export async function verifyEvmSignature(address: string, message: string, signature: string): Promise<boolean> {
  try {
    if (isAddressEqual(await recoverMessageAddress({ message, signature: signature as Hex }), address as Hex)) return true;
  } catch {
    // not a plain ECDSA signature (e.g. ERC-6492 wrapped): try as a smart-contract wallet
  }
  const { urls, need } = quorum(process.env.BASE_RPC_URL, BASE_PUBLIC);
  return agree(
    urls.map((url) => () => {
      const client = createPublicClient({ chain: base, transport: http(url, { timeout: TIMEOUT_MS, retryCount: 0 }) });
      return client.verifyMessage({ address: address as Hex, message, signature: signature as Hex });
    }),
    need,
  );
}

/** One NEAR endpoint's answer to "is this a full-access key of that account?". Throws if it didn't answer. */
async function nearKeyAnswer(url: string, accountId: string, publicKey: string): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NEAR RPC ${res.status}`);
  const j = (await res.json()) as { result?: { permission?: unknown }; error?: { cause?: { name?: string } } };
  if (j.result) return j.result.permission === "FullAccess";
  // A definite "no such key / account" is an answer; anything else (rate limits, node errors) isn't.
  const cause = j.error?.cause?.name;
  if (cause === "UNKNOWN_ACCESS_KEY" || cause === "UNKNOWN_ACCOUNT") return false;
  throw new Error(`NEAR RPC error ${cause ?? "unknown"}`);
}

/** NEAR sign-in: the signing key must be a full-access key of the claimed account. */
export async function nearFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  const { urls, need } = quorum(process.env.NEAR_RPC_URL, NEAR_PUBLIC);
  return agree(
    urls.map((url) => () => nearKeyAnswer(url, accountId, publicKey)),
    need,
  );
}
