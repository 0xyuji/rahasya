import {
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Base64EncodedWireTransaction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import type { ResolvedAsset } from "../assets.ts";
import { RailError } from "../util.ts";
import type { DepositCheck, Depositor, PreparedDeposit } from "./types.ts";

/** Keep this much SOL untouched: tx fees + rent-exempt minimum for the payer. */
export const SOL_RESERVE_LAMPORTS = 2_000_000n; // 0.002 SOL

export function decodeSolanaSecret(secret: string): Uint8Array {
  const s = secret.trim();
  const bytes = s.startsWith("[") ? Uint8Array.from(JSON.parse(s) as number[]) : new Uint8Array(getBase58Encoder().encode(s));
  if (bytes.length !== 64) throw new Error(`Solana secret key must be 64 bytes, got ${bytes.length}`);
  return bytes;
}

export class SolanaDepositor implements Depositor {
  readonly chain = "sol" as const;
  readonly rpc: ReturnType<typeof createSolanaRpc>;
  readonly signer: KeyPairSigner;
  private constructor(signer: KeyPairSigner, rpcUrl: string) {
    this.signer = signer;
    this.rpc = createSolanaRpc(rpcUrl);
  }

  static async create(secret: string, rpcUrl: string): Promise<SolanaDepositor> {
    const signer = await createKeyPairSignerFromBytes(decodeSolanaSecret(secret));
    return new SolanaDepositor(signer, rpcUrl);
  }

  get address(): string {
    return this.signer.address;
  }

  async balance(asset: ResolvedAsset): Promise<bigint> {
    if (asset.native) {
      const { value } = await this.rpc.getBalance(this.signer.address, { commitment: "confirmed" }).send();
      return BigInt(value);
    }
    const { value } = await this.rpc
      .getTokenAccountsByOwner(
        this.signer.address,
        { mint: address(asset.contractAddress!) },
        { encoding: "jsonParsed", commitment: "confirmed" },
      )
      .send();
    let total = 0n;
    for (const acc of value) {
      const info = (acc.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } }).parsed?.info;
      total += BigInt(info?.tokenAmount?.amount ?? "0");
    }
    return total;
  }

  async prepare(asset: ResolvedAsset, to: string, amount: bigint): Promise<PreparedDeposit> {
    if (!asset.native) {
      // SPL deposits need ATA handling; out of scope until it's tested end to end.
      throw new RailError("UNSUPPORTED_DEPOSIT", "SPL token deposits from Solana are not implemented yet (native SOL only)");
    }
    const have = await this.balance(asset);
    if (have < amount + SOL_RESERVE_LAMPORTS) {
      throw new RailError("INSUFFICIENT_BALANCE", "not enough SOL for amount + fee reserve", {
        haveLamports: have.toString(),
        needLamports: (amount + SOL_RESERVE_LAMPORTS).toString(),
      });
    }

    const { value: blockhash } = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(this.signer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({ source: this.signer, destination: address(to), amount: lamports(amount) }),
          m,
        ),
    );
    const signed = await signTransactionMessageWithSigners(message);
    return {
      chain: "sol",
      from: this.signer.address,
      to,
      assetId: asset.assetId,
      amount: amount.toString(),
      txHash: getSignatureFromTransaction(signed),
      raw: getBase64EncodedWireTransaction(signed),
      lastValidBlockHeight: blockhash.lastValidBlockHeight.toString(),
    };
  }

  async broadcast(p: PreparedDeposit): Promise<void> {
    try {
      await this.rpc
        .sendTransaction(p.raw as Base64EncodedWireTransaction, {
          encoding: "base64",
          preflightCommitment: "confirmed",
          maxRetries: 5n,
        })
        .send();
    } catch (e) {
      const msg = String((e as Error).message ?? e).toLowerCase();
      if (msg.includes("already been processed") || msg.includes("alreadyprocessed")) return;
      throw e;
    }
  }

  async check(p: PreparedDeposit): Promise<DepositCheck> {
    const { value } = await this.rpc
      .getSignatureStatuses([p.txHash as Signature], { searchTransactionHistory: true })
      .send();
    const st = value[0];
    if (st) {
      if (st.err) return "failed";
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return "confirmed";
      return "pending";
    }
    const height = await this.rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (p.lastValidBlockHeight && BigInt(height) > BigInt(p.lastValidBlockHeight)) return "dropped";
    return "pending";
  }
}
