"use client";

import type { ResolvedAsset } from "@pay/rail/browser";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import { getAccount, sendTransaction, switchChain, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { erc20Abi, type Hex } from "viem";
import { base } from "viem/chains";
import { wagmiAdapter } from "../wallet/appkit";

/** Sends a deposit from the user's own wallet and returns the tx hash/signature. */
export type DepositSender = (asset: ResolvedAsset, to: string, amount: bigint) => Promise<string>;

export const evmSender: DepositSender = async (asset, to, amount) => {
  const config = wagmiAdapter.wagmiConfig;
  if (getAccount(config).chainId !== base.id) await switchChain(config, { chainId: base.id });
  const hash = asset.native
    ? await sendTransaction(config, { chainId: base.id, to: to as Hex, value: amount })
    : await writeContract(config, {
        chainId: base.id,
        address: asset.contractAddress as Hex,
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as Hex, amount],
      });
  // Don't hand back until it's mined: the deposit isn't real before that.
  const receipt = await waitForTransactionReceipt(config, { hash, chainId: base.id });
  if (receipt.status !== "success") throw new Error("Deposit transaction reverted; no funds moved.");
  return hash;
};

export interface SolanaWallet {
  signAndSendTransaction(tx: Transaction): Promise<string>;
}

export function solanaSender(wallet: SolanaWallet, connection: Connection, owner: string): DepositSender {
  return async (asset, to, amount) => {
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
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = from;
    const sig = await wallet.signAndSendTransaction(tx);
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error("Deposit transaction failed on Solana; no funds moved.");
    return sig;
  };
}
