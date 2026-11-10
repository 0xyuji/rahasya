"use client";

import { appFetch } from "../app/app-fetch";
import { useWallet } from "../wallet/wallet-context";
import { confirmSweep, inferenceUsdc } from "./flow";

export interface ResolvedTarget {
  kind: "inference" | "api";
  /** Base address that receives the USDC, or null if not available yet (locked). */
  address: string | null;
  label: string;
  /** Custom "USDC -> credit" step. Undefined = the browser signs the x402 top-up itself. */
  topUp?: (id: string, usd: number) => Promise<void>;
}

/** API wallet: the server signs the x402 top-up for the USDC that landed on it. */
export async function sweepApiWallet(): Promise<number> {
  const r = await appFetch("/api/account/sweep", { method: "POST" });
  const j = (await r.json().catch(() => ({}))) as { toppedUpUsd?: number; message?: string };
  if (!r.ok) throw new Error(j.message ?? `Top-up failed (${r.status})`);
  return j.toppedUpUsd ?? 0;
}

export function useCreditTarget(): ResolvedTarget {
  const w = useWallet();
  if (w.creditTarget.kind === "api") {
    const { address } = w.creditTarget;
    return {
      kind: "api",
      address,
      label: "your API wallet",
      topUp: async () => confirmSweep(await sweepApiWallet(), () => inferenceUsdc(address)),
    };
  }
  return { kind: "inference", address: w.inference?.address ?? null, label: "your inference wallet" };
}
