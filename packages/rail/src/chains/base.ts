import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { ResolvedAsset } from "../assets.ts";
import { RailError } from "../util.ts";
import type { DepositCheck, Depositor, PreparedDeposit } from "./types.ts";

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const makeClient = (rpcUrl: string) => createPublicClient({ chain: base, transport: http(rpcUrl, { retryCount: 3 }) });

export class BaseDepositor implements Depositor {
  readonly chain = "base" as const;
  readonly account: PrivateKeyAccount;
  readonly client: ReturnType<typeof makeClient>;

  constructor(privateKey: Hex, rpcUrl: string) {
    this.account = privateKeyToAccount(privateKey);
    this.client = makeClient(rpcUrl);
  }

  get address(): string {
    return this.account.address;
  }

  async balance(asset: ResolvedAsset): Promise<bigint> {
    if (asset.native) return this.client.getBalance({ address: this.account.address });
    return this.client.readContract({
      address: asset.contractAddress as Hex,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.account.address],
    });
  }

  ethBalance(): Promise<bigint> {
    return this.client.getBalance({ address: this.account.address });
  }

  usdcBalance(): Promise<bigint> {
    return this.client.readContract({
      address: BASE_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [this.account.address],
    });
  }

  async prepare(asset: ResolvedAsset, to: string, amount: bigint): Promise<PreparedDeposit> {
    const recipient = to as Hex;
    const call = asset.native
      ? { to: recipient, value: amount }
      : {
          to: asset.contractAddress as Hex,
          value: 0n,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }),
        };

    const nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" });
    const req = await this.client.prepareTransactionRequest({
      account: this.account,
      chain: base,
      nonce,
      ...call,
    });

    // Gas pre-check: fail before signing rather than broadcasting something that can't pay for itself.
    const maxGasCost = (req.gas ?? 0n) * (req.maxFeePerGas ?? req.gasPrice ?? 0n);
    const eth = await this.ethBalance();
    const needEth = maxGasCost + (asset.native ? amount : 0n);
    if (eth < needEth) {
      throw new RailError("INSUFFICIENT_GAS", "not enough ETH on Base for amount + gas", {
        haveWei: eth.toString(),
        needWei: needEth.toString(),
      });
    }

    const raw = await this.account.signTransaction(req as Parameters<PrivateKeyAccount["signTransaction"]>[0]);
    return {
      chain: "base",
      from: this.account.address,
      to,
      assetId: asset.assetId,
      amount: amount.toString(),
      txHash: keccak256(raw),
      raw,
      nonce,
    };
  }

  async broadcast(p: PreparedDeposit): Promise<void> {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: p.raw as Hex });
    } catch (e) {
      const msg = String((e as Error).message ?? e).toLowerCase();
      // Rebroadcast of an already-seen or already-mined tx: fine, check() will tell us.
      if (msg.includes("already known") || msg.includes("nonce too low") || msg.includes("already imported")) return;
      throw e;
    }
  }

  async check(p: PreparedDeposit): Promise<DepositCheck> {
    const receipt = await this.client.getTransactionReceipt({ hash: p.txHash as Hex }).catch(() => null);
    if (receipt) return receipt.status === "success" ? "confirmed" : "failed";
    const mined = await this.client.getTransactionCount({ address: this.account.address, blockTag: "latest" });
    // Our nonce was consumed but not by our tx -> something else used this wallet.
    if (p.nonce !== undefined && mined > p.nonce) return "conflict";
    return "pending";
  }
}
