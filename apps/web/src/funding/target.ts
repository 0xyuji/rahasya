"use client";

import { appFetch } from "../app/app-fetch";
import { walletUid } from "../wallet/session";
import { useWallet } from "../wallet/wallet-context";
import { confirmSweep, inferenceUsdc } from "./flow";

export interface ResolvedTarget {
  kind: "inference" | "api";
  /** API wallet only: whose account it is. */
  uid?: string;
  /** Base address that receives the USDC, or null if not available yet (locked). */
  address: string | null;
  label: string;
  /** Custom "USDC -> credit" step. Undefined = the browser signs the x402 top-up itself. */
  topUp?: (id: string, usd: number) => Promise<void>;
}

/** API wallet: the server signs the x402 top-up for the USDC that landed on it. */
export async function sweepApiWallet(uid?: string): Promise<number> {
  const r = await appFetch("/api/account/sweep", { method: "POST", headers: uid ? { "x-wallet-uid": uid } : {} });
  const j = (await r.json().catch(() => ({}))) as { toppedUpUsd?: number; message?: string };
  if (!r.ok) throw new Error(j.message ?? `Top-up failed (${r.status})`);
  return j.toppedUpUsd ?? 0;
}

export function useCreditTarget(): ResolvedTarget {
  const w = useWallet();
  if (w.creditTarget.kind === "api") {
    const { address, uid } = w.creditTarget;
    return {
      kind: "api",
      uid,
      // Only while the wallet that opened this API account is still the connected one.
      address: w.source && walletUid(w.source) === uid ? address : null,
      label: "your API wallet",
      topUp: async (_id, usd) => confirmSweep(await sweepApiWallet(uid), () => inferenceUsdc(address), usd),
    };
  }
  return { kind: "inference", address: w.inference?.address ?? null, label: "your inference wallet" };
}
