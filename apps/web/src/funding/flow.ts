"use client";

import {
  OneClickClient,
  RailError,
  TERMINAL_STATUSES,
  VeniceClient,
  randomActionId,
  resolveAsset,
  sleep,
  validateQuote,
  type Chain,
  type ExecutionStatus,
  type QuoteRequest,
  type QuoteResponse,
  type ResolvedAsset,
  type SymbolName,
  type TopUpAction,
} from "@pay/rail/browser";
import { createPublicClient, erc20Abi, http, type LocalAccount } from "viem";
import { base } from "viem/chains";
import type { Source } from "../wallet/wallet-context";
import { LocalStore } from "./local-store";
import type { DepositSender } from "./senders";

export const MIN_CREDIT_USD = 5; // Venice minimum top-up
export const MAX_CREDIT_USD = 50; // our cap: the inference wallet is for spending, not saving
const SLIPPAGE_BPS = 50; // EXACT_OUTPUT buffer; excess may not be refunded, so keep it small
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

/** What a connected wallet can pay with (origin chains we support end to end). */
export const PAY_OPTIONS: Record<Source["chain"], Array<{ chain: Chain; symbol: SymbolName }>> = {
  evm: [
    { chain: "base", symbol: "USDC" },
    { chain: "base", symbol: "ETH" },
  ],
  sol: [
    { chain: "sol", symbol: "SOL" },
    { chain: "sol", symbol: "USDC" },
  ],
  near: [],
};

export type CreditState =
  | "QUOTED"
  | "SENDING"
  | "SEND_UNCONFIRMED"
  | "DEPOSIT_SENT"
  | "SWAPPING"
  | "SWAPPED"
  | "TOPPING_UP"
  | "DONE"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED";

export const CREDIT_FINAL: ReadonlySet<CreditState> = new Set(["DONE", "REFUNDED", "FAILED", "EXPIRED"]);

export interface CreditAction {
  id: string;
  createdAt: string;
  state: CreditState;
  usd: number;
  source: Source;
  inferenceAddress: string;
  origin: ResolvedAsset;
  quoteRequest: QuoteRequest;
  quote: QuoteResponse;
  depositTx?: string;
  oneclickStatus?: ExecutionStatus;
  deliveredTx?: string;
  refunded?: string;
  error?: string;
  history: Array<{ at: string; state: CreditState }>;
}

export const oneclick = new OneClickClient({ baseUrl: "/api/oneclick" });
export const actions = new LocalStore<CreditAction>("credit");
const topups = new LocalStore<TopUpAction>("topup");
const baseClient = createPublicClient({ chain: base, transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL) });

export function veniceFor(account: LocalAccount) {
  return new VeniceClient({ account, topups, maxTopUpUsd: MAX_CREDIT_USD });
}

export async function inferenceUsdc(address: string): Promise<bigint> {
  return baseClient.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
}

/** Binding quote: exactly `usd` USDC to the user's own inference wallet; refunds to their own wallet. */
export async function quoteCredit(p: {
  usd: number;
  payWith: { chain: Chain; symbol: SymbolName };
  source: Source;
  inferenceAddress: string;
}): Promise<CreditAction> {
  if (!(p.usd >= MIN_CREDIT_USD && p.usd <= MAX_CREDIT_USD)) {
    throw new RailError("BAD_AMOUNT", `Choose between $${MIN_CREDIT_USD} and $${MAX_CREDIT_USD}.`);
  }
  const tokens = await oneclick.tokens();
  const origin = resolveAsset(tokens, p.payWith.chain, p.payWith.symbol);
  const dest = resolveAsset(tokens, "base", "USDC");
  const req: QuoteRequest = {
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: origin.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: dest.assetId,
    amount: String(Math.round(p.usd * 1e6)),
    refundTo: p.source.address,
    refundType: "ORIGIN_CHAIN",
    recipient: p.inferenceAddress,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    quoteWaitingTimeMs: 3_000,
  };
  const quote = await oneclick.quote(req);
  validateQuote(req, quote); // code decides: the quote must echo exactly what we asked for
  const now = new Date().toISOString();
  return actions.put({
    id: randomActionId("credit"),
    createdAt: now,
    state: "QUOTED",
    usd: p.usd,
    source: p.source,
    inferenceAddress: p.inferenceAddress,
    origin,
    quoteRequest: req,
    quote,
    history: [{ at: now, state: "QUOTED" }],
  });
}

function move(a: CreditAction, state: CreditState, patch: Partial<CreditAction> = {}): CreditAction {
  return actions.put({ ...a, ...patch, state, history: [...a.history, { at: new Date().toISOString(), state }] });
}

/**
 * Drive one credit action to a final state. Resumable: call again after a
 * reload and it continues from the saved state. `send` is only ever called
 * from QUOTED (or after the user explicitly chooses "send again").
 */
export async function runCredit(
  id: string,
  deps: {
    send: DepositSender;
    inference: LocalAccount | null;
    onUpdate: (a: CreditAction) => void;
    /** Override how the delivered USDC becomes credit (API wallet: server-side x402 sweep). */
    topUp?: (id: string, usd: number) => Promise<void>;
  },
): Promise<CreditAction> {
  let a = actions.get(id);
  if (!a) throw new Error("unknown credit action");
  const emit = (next: CreditAction) => (deps.onUpdate(next), next);
  const depositAddress = a.quote.quote.depositAddress!;

  while (!CREDIT_FINAL.has(a.state)) {
    switch (a.state) {
      case "QUOTED": {
        const left = Date.parse(a.quote.quote.deadline ?? a.quoteRequest.deadline) - Date.now();
        if (left < 5 * 60_000) {
          a = emit(move(a, "EXPIRED"));
          break;
        }
        a = emit(move(a, "SENDING"));
        try {
          const tx = await deps.send(a.origin, depositAddress, BigInt(a.quote.quote.amountIn));
          a = emit(move(a, "DEPOSIT_SENT", { depositTx: tx }));
          oneclick.submitDeposit({ txHash: tx, depositAddress }).catch(() => {});
        } catch (e) {
          // The wallet refused or failed before broadcasting: nothing moved, back to the quote.
          a = emit(move(a, "QUOTED", { error: friendly(e) }));
          return a;
        }
        break;
      }
      case "SENDING": {
        // Reloaded mid-send: we never got a hash back. Ask 1Click whether funds arrived.
        const st = await oneclick.status(depositAddress).catch(() => undefined);
        if (st && st.status !== "PENDING_DEPOSIT") a = emit(move(a, "SWAPPING", { oneclickStatus: st.status }));
        else a = emit(move(a, "SEND_UNCONFIRMED"));
        if (a.state === "SEND_UNCONFIRMED") return a;
        break;
      }
      case "SEND_UNCONFIRMED":
        return a; // UI asks: wait, or send again (an extra deposit is refunded by 1Click)
      case "DEPOSIT_SENT":
      case "SWAPPING": {
        let delay = 3_000;
        for (;;) {
          const st = await oneclick.status(depositAddress).catch(() => undefined);
          if (st) {
            if (st.status !== a.oneclickStatus) a = emit(move(a, "SWAPPING", { oneclickStatus: st.status }));
            if (TERMINAL_STATUSES.has(st.status)) {
              if (st.status === "SUCCESS") a = emit(move(a, "SWAPPED", { deliveredTx: st.swapDetails.destinationChainTxHashes[0]?.hash }));
              else if (st.status === "REFUNDED") a = emit(move(a, "REFUNDED", { refunded: st.swapDetails.refundedAmountFormatted }));
              else a = emit(move(a, "FAILED", { error: "1Click reported the swap as failed; funds are refunded to your wallet." }));
              break;
            }
          }
          await sleep(delay);
          delay = Math.min(delay * 1.4, 10_000);
        }
        break;
      }
      case "SWAPPED": {
        const need = BigInt(Math.round(a.usd * 1e6));
        for (let i = 0; i < 30 && (await inferenceUsdc(a.inferenceAddress)) < need; i++) await sleep(2_000);
        a = emit(move(a, "TOPPING_UP"));
        break;
      }
      case "TOPPING_UP": {
        try {
          if (deps.topUp) await deps.topUp(`topup_${a.id}`, a.usd);
          else await veniceFor(deps.inference!).topUp(`topup_${a.id}`, a.usd); // idempotent per id
          a = emit(move(a, "DONE"));
        } catch (e) {
          a = emit({ ...a, error: friendly(e) }); // stay TOPPING_UP: retrying re-sends the same authorization
          return a;
        }
        break;
      }
    }
  }
  return a;
}

/** User chose "send again" after an unconfirmed send. */
export function resend(id: string): CreditAction {
  const a = actions.get(id)!;
  return move(a, "QUOTED", { error: undefined });
}

export function friendly(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  if (/user rejected|denied|rejected the request|cancel/i.test(m)) return "You declined in your wallet. Nothing was sent.";
  if (/insufficient funds|insufficient balance/i.test(m)) return "Not enough balance (including network fees) in your wallet.";
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}
