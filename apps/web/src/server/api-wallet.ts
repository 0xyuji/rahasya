import "server-only";
import { VeniceClient, type RecordStore, type TopUpAction } from "@pay/rail/browser";
import { createPublicClient, erc20Abi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";
import { baseTransport } from "./rpc.ts";
import { open, seal } from "./crypto.ts";
import { kv } from "./kv.ts";

/**
 * One server-held "API wallet" per user. It only ever holds Venice credit:
 * USDC that lands on it is topped up via x402 right away, and Venice credit
 * can't be withdrawn. Its key is AES-GCM encrypted at rest, bound to the user id.
 */
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
export const MIN_TOPUP_USD = 5;
const MAX_TOPUP_USD = 200;

type Stored = { address: string; sealed: string; createdAt: number };

export async function apiWalletAddress(uid: string): Promise<string> {
  return (await getOrCreate(uid)).address;
}

/** The user's API wallet, or null if they never opened one (no side effects). */
export async function existingApiWallet(uid: string): Promise<PrivateKeyAccount | null> {
  const rec = await kv().get<Stored>(`aw:${uid}`);
  return rec ? privateKeyToAccount((await open(rec.sealed, `aw:${uid}`)) as Hex) : null;
}

async function getOrCreate(uid: string): Promise<Stored> {
  const existing = await kv().get<Stored>(`aw:${uid}`);
  if (existing) return existing;
  const pk = generatePrivateKey();
  const rec: Stored = { address: privateKeyToAccount(pk).address, sealed: await seal(pk, `aw:${uid}`), createdAt: Date.now() };
  // NX: two concurrent first requests can't create two wallets.
  const created = await kv().set(`aw:${uid}`, rec, { nx: true });
  return created ? rec : (await kv().get<Stored>(`aw:${uid}`))!;
}

export async function apiWalletAccount(uid: string): Promise<PrivateKeyAccount> {
  const rec = await getOrCreate(uid);
  return privateKeyToAccount((await open(rec.sealed, `aw:${uid}`)) as Hex);
}

/** x402 top-up records in Redis, so a retried top-up re-sends the same signed authorization. */
const topupStore: RecordStore<TopUpAction> = {
  get: async (id) => (await kv().get<TopUpAction>(`topup:${id}`)) ?? undefined,
  put: async (r) => (await kv().set(`topup:${r.id}`, r, { ex: 7 * 24 * 3600 }), r),
};

export function veniceForApiWallet(account: PrivateKeyAccount): VeniceClient {
  return new VeniceClient({ account, topups: topupStore, maxTopUpUsd: MAX_TOPUP_USD });
}

const baseClient = () => createPublicClient({ chain: base, transport: baseTransport() });

export async function idleUsdc(address: string): Promise<number> {
  const bal = await baseClient().readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as Hex] });
  return Number(bal) / 1e6;
}

/**
 * Turn idle USDC on the API wallet into Venice credit (x402).
 *
 * Each sweep has a sequence number. While the current sweep's authorization
 * hasn't settled, every call re-sends it (same id, same signature). Once it
 * succeeded, the next deposit gets the next number, so repeat purchases of
 * the same amount are never mistaken for an old, finished top-up. A short
 * lock keeps two concurrent sweeps from signing two authorizations at once.
 */
export async function sweepToCredit(uid: string): Promise<{ toppedUpUsd: number }> {
  const account = await apiWalletAccount(uid);
  const usdc = Math.floor((await idleUsdc(account.address)) * 100) / 100;
  if (usdc < MIN_TOPUP_USD) return { toppedUpUsd: 0 };

  const lock = `sweeplock:${uid}`;
  if (!(await kv().set(lock, Date.now(), { nx: true, ex: 90 }))) {
    throw Object.assign(new Error("A top-up for this wallet is already in progress. Try again in a minute."), { status: 409 });
  }
  try {
    const seqKey = `sweepseq:${uid}`;
    let seq = Number((await kv().get<number>(seqKey)) ?? 0);
    const current = await topupStore.get(sweepId(account.address, seq));
    if (current?.state === "SUCCESS") {
      seq += 1; // that one is done; this USDC is a new deposit
      await kv().set(seqKey, seq);
    }
    const venice = veniceForApiWallet(account);
    const pending = await topupStore.get(sweepId(account.address, seq));
    // A pending authorization is re-sent with its own amount; otherwise sign for what's there now.
    const amount = pending ? pending.amountUsd : Math.min(usdc, MAX_TOPUP_USD);
    const done = await venice.topUp(sweepId(account.address, seq), amount);
    await kv().set(seqKey, seq + 1);
    return { toppedUpUsd: done.amountUsd };
  } finally {
    await kv().del(lock);
  }
}

const sweepId = (address: string, seq: number) => `sweep_${address.toLowerCase()}_${seq}`;
