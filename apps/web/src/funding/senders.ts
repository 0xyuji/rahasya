"use client";

import type { ResolvedAsset } from "@pay/rail/browser";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import { getAccount, getBalance, getTransactionCount, getTransactionReceipt, readContract, sendTransaction, switchChain, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { erc20Abi, type Hex } from "viem";
import { base } from "viem/chains";
import { wagmiAdapter } from "../wallet/appkit";
import { DepositBroadcastError, DepositNotSentError } from "./machines";

/** Sends a deposit from the user's own wallet and returns the tx hash/signature. */
export type DepositSender = (asset: ResolvedAsset, to: string, amount: bigint, from?: string) => Promise<string>;

export const evmSender: DepositSender = async (asset, to, amount, from) => {
  const config = wagmiAdapter.wagmiConfig;
  const account = (from ?? getAccount(config).address) as Hex; // wagmi refuses, before any prompt, if another account is active
  if (getAccount(config).chainId !== base.id) {
    await switchChain(config, { chainId: base.id }).catch((e: unknown) => {
      throw new DepositNotSentError(`Couldn't switch your wallet to Base. Nothing was sent. ${(e as Error)?.message ?? ""}`.trim());
    });
  }
  const have = await (asset.native
    ? getBalance(config, { address: account, chainId: base.id }).then((b) => b.value)
    : readContract(config, { chainId: base.id, address: asset.contractAddress as Hex, abi: erc20Abi, functionName: "balanceOf", args: [account] })
  ).catch(() => undefined);
  if (have !== undefined && have < amount) throw new DepositNotSentError(`Not enough ${asset.symbol} in your wallet for this deposit.`);
  const pending = () => getTransactionCount(config, { address: account, chainId: base.id, blockTag: "pending" }).catch(() => undefined);
  const nonceBefore = await pending();
  const hash = await (asset.native
    ? sendTransaction(config, { account, chainId: base.id, to: to as Hex, value: amount })
    : writeContract(config, {
        account,
        chainId: base.id,
        address: asset.contractAddress as Hex,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as Hex, amount],
      })
  ).catch(async (e: unknown) => {
    // viem can retry a failed send as a second wallet request and report only that one's error,
    // so a "declined" can hide a first transaction that went out. The nonce doesn't lie.
    const nonceAfter = await pending();
    if (nonceBefore !== undefined && nonceAfter !== undefined && nonceAfter > nonceBefore) throw new Error("Your wallet may have sent this transaction before it reported an error.");
    throw e;
  });
  // Don't hand back until it's mined: the deposit isn't real before that.
  let replaced: string | undefined; // "Cancel" or "Speed up" in the wallet swaps the transaction under us
  const receipt = await waitForTransactionReceipt(config, { hash, chainId: base.id, timeout: 10 * 60_000, onReplaced: (r) => void (replaced = r.reason) }).catch(async (e: unknown) => {
    // wagmi throws on a revert too, and a revert is the one failure that provably moved nothing.
    const seen = await getTransactionReceipt(config, { hash, chainId: base.id }).catch(() => undefined);
    if (seen?.status === "reverted") throw new DepositNotSentError("Deposit transaction reverted; no funds moved.");
    throw new DepositBroadcastError(hash, e);
  });
  if (replaced === "cancelled") throw new DepositNotSentError("You cancelled this transaction in your wallet. Nothing was sent.");
  if (replaced === "replaced") throw new DepositBroadcastError(receipt.transactionHash, new Error("The wallet replaced this transaction."));
  return receipt.transactionHash; // a sped-up transaction has a new hash
};

export interface SolanaWallet {
  signAndSendTransaction(tx: Transaction): Promise<string>;
}

export function solanaSender(wallet: SolanaWallet, connection: Connection, owner: string): DepositSender {
  return async (asset, to, amount, expected) => {
    if (expected && expected !== owner) throw new DepositNotSentError("Your wallet changed. Nothing was sent.");
    const from = new PublicKey(owner);
    const dest = new PublicKey(to);
    const tx = new Transaction();
    if (asset.native) {
      tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: dest, lamports: amount }));
    } else {
      const mint = new PublicKey(asset.contractAddress!);
      const fromAta = getAssociatedTokenAddressSync(mint, from);
      const toAta = getAssociatedTokenAddressSync(mint, dest, true);
      tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, dest, mint));
      tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, from, amount, asset.decimals));
    }
    const have = await (asset.native
      ? connection.getBalance(from).then(BigInt)
      : connection.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(asset.contractAddress!), from)).then((r) => BigInt(r.value.amount))
    ).catch(() => undefined);
    if (have !== undefined && have < amount) throw new DepositNotSentError(`Not enough ${asset.symbol} in your wallet for this deposit.`);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed").catch((e: unknown) => {
      throw new DepositNotSentError(`Couldn't reach Solana. Nothing was sent. ${(e as Error)?.message ?? ""}`.trim());
    });
    tx.recentBlockhash = blockhash;
    tx.feePayer = from;
    const sig = await wallet.signAndSendTransaction(tx);
    // This can throw on a flaky RPC even though the transaction landed.
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed").catch((e: unknown) => {
      throw new DepositBroadcastError(sig, e);
    });
    if (res.value.err) throw new DepositNotSentError("Deposit transaction failed on Solana; no funds moved.");
    return sig;
  };
}
