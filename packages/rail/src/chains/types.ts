import type { Chain, ResolvedAsset } from "../assets.ts";

/**
 * A deposit transaction that has been SIGNED but not necessarily broadcast.
 * It is persisted before broadcast; rebroadcasting the same signed bytes is
 * always safe (same nonce / same signature), which is what makes deposits
 * idempotent across crashes and retries.
 */
export interface PreparedDeposit {
  chain: Chain;
  from: string;
  to: string;
  assetId: string;
  amount: string; // smallest units
  txHash: string;
  raw: string; // serialized signed tx (hex for EVM, base64 wire for Solana)
  /** EVM nonce used. */
  nonce?: number;
  /** Solana: tx can never land after this block height. */
  lastValidBlockHeight?: string;
}

/**
 * - confirmed: landed successfully
 * - failed:    landed but reverted / errored (funds did not move, gas may be spent)
 * - pending:   not landed yet but still can
 * - dropped:   provably can never land (e.g. blockhash expired) -> safe to re-sign
 * - conflict:  the slot it needed was taken by some other tx -> needs a human
 */
export type DepositCheck = "confirmed" | "failed" | "pending" | "dropped" | "conflict";

export interface Depositor {
  readonly chain: Chain;
  readonly address: string;
  balance(asset: ResolvedAsset): Promise<bigint>;
  /** Build + sign a transfer of `amount` of `asset` to `to`. Does not broadcast. */
  prepare(asset: ResolvedAsset, to: string, amount: bigint): Promise<PreparedDeposit>;
  /** Broadcast; idempotent, swallows "already known" style errors. */
  broadcast(p: PreparedDeposit): Promise<void>;
  check(p: PreparedDeposit): Promise<DepositCheck>;
}
