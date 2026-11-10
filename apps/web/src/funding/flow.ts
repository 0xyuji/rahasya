"use client";

import {
  OneClickClient,
  RailError,
  TERMINAL_STATUSES,
  VeniceClient,
  checkMaxInput,
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
import { LocalStore } from "./local-store.ts";
import { CREDIT_FINAL, CREDIT_MACHINE, DepositBroadcastError, type CreditState } from "./machines.ts";
import type { DepositSender } from "./senders";

export { CREDIT_FINAL, type CreditState };

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
export const topups = new LocalStore<TopUpAction>("topup");
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
  checkMaxInput(origin, quote.quote.amountIn, p.usd); // ...and must not ask for more than ~the credit is worth
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
  CREDIT_MACHINE.assert(a.state, state);
  // An error describes the state it happened in, so it doesn't carry over to the next one.
  return actions.put({ ...a, error: undefined, ...patch, state, history: [...a.history, { at: new Date().toISOString(), state }] });
}

export interface RunCreditDeps {
  send: DepositSender;
  inference: LocalAccount | null;
  onUpdate: (a: CreditAction) => void;
  /** Override how the delivered USDC becomes credit (API wallet: server-side x402 sweep). */
  topUp?: (id: string, usd: number) => Promise<void>;
  /** In SEND_UNCONFIRMED, how long to keep looking for the deposit before asking the user again (default: one check). */
  unconfirmedWatchMs?: number;
  /** How long 1Click may keep reporting no deposit before we ask the user what happened (default 5 min). */
  pendingDepositLimitMs?: number;
}

const runs = new Map<string, { done: Promise<CreditAction>; listeners: Set<(a: CreditAction) => void> }>();

/**
 * Drive one credit action to a final state. Resumable: call again after a
 * reload and it continues from the saved state. `send` is only ever called
 * from QUOTED (or after the user explicitly chooses "send again").
 * One run per action: a second call joins the first, so reopening the dialog
 * during a wallet prompt can't mistake that send for an interrupted one.
 */
export function runCredit(id: string, deps: RunCreditDeps): Promise<CreditAction> {
  const live = runs.get(id);
  if (live) {
    live.listeners.add(deps.onUpdate);
    return live.done;
  }
  const listeners = new Set([deps.onUpdate]);
  const done = driveCredit(id, deps, (a) => listeners.forEach((l) => l(a))).finally(() => runs.delete(id));
  runs.set(id, { done, listeners });
  return done;
}

async function driveCredit(id: string, deps: RunCreditDeps, onUpdate: (a: CreditAction) => void): Promise<CreditAction> {
  let a = actions.get(id);
  if (!a) throw new Error("unknown credit action");
  const emit = (next: CreditAction) => (onUpdate(next), next);
  const depositAddress = a.quote.quote.depositAddress!;

  while (!CREDIT_FINAL.has(a.state)) {
    switch (a.state) {
      case "QUOTED": {
        const left = Date.parse(a.quote.quote.deadline ?? a.quoteRequest.deadline) - Date.now();
        if (left < 5 * 60_000) {
          a = emit(move(a, "EXPIRED"));
          break;
        }
        // Re-check the saved quote right before money moves (it may have been resumed from storage).
        try {
          validateQuote(a.quoteRequest, a.quote);
          if (a.quoteRequest.recipient.toLowerCase() !== a.inferenceAddress.toLowerCase()) throw new Error("Saved quote's recipient isn't your wallet.");
          if (a.quote.quote.depositAddress !== depositAddress) throw new Error("Saved quote changed.");
          checkMaxInput(a.origin, a.quote.quote.amountIn, a.usd);
        } catch (e) {
          a = emit(move(a, "FAILED", { error: `Refusing to send: ${friendly(e)}` }));
          break;
        }
        a = emit(move(a, "SENDING"));
        try {
          const tx = await deps.send(a.origin, depositAddress, BigInt(a.quote.quote.amountIn));
          a = emit(move(a, "DEPOSIT_SENT", { depositTx: tx }));
          oneclick.submitDeposit({ txHash: tx, depositAddress }).catch(() => {});
        } catch (e) {
          if (e instanceof DepositBroadcastError) {
            // It's on the network; only confirming it failed. Sending again could pay twice, so track it.
            a = emit(move(a, "DEPOSIT_SENT", { depositTx: e.txHash }));
            oneclick.submitDeposit({ txHash: e.txHash, depositAddress }).catch(() => {});
            break;
          }
          // The wallet refused, or the deposit provably failed: nothing moved, back to the quote.
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
      case "SEND_UNCONFIRMED": {
        // Never sends. The UI asks: keep waiting, or send again (an extra deposit is refunded by 1Click).
        const until = Date.now() + (deps.unconfirmedWatchMs ?? 0);
        for (;;) {
          const st = await oneclick.status(depositAddress).catch(() => undefined);
          if (st && st.status !== "PENDING_DEPOSIT") {
            a = emit(move(a, "SWAPPING", { oneclickStatus: st.status }));
            break;
          }
          if (Date.now() >= until) return a;
          await sleep(5_000);
        }
        break;
      }
      case "DEPOSIT_SENT":
      case "SWAPPING": {
        let delay = 3_000;
        const watchingSince = Date.now();
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
            // Don't watch forever for a deposit that may never have landed; the user decides what's next.
            if (st.status === "PENDING_DEPOSIT" && Date.now() - watchingSince >= (deps.pendingDepositLimitMs ?? 5 * 60_000)) {
              return emit(move(a, "SEND_UNCONFIRMED"));
            }
          }
          await sleep(delay);
          delay = Math.min(delay * 1.4, 10_000);
        }
        break;
      }
      case "SWAPPED": {
        const need = BigInt(Math.round(a.usd * 1e6));
        // A failed balance read counts as "not yet": the top-up below is safe to try either way.
        for (let i = 0; i < 30 && (await inferenceUsdc(a.inferenceAddress).catch(() => 0n)) < need; i++) await sleep(2_000);
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

const toppingUp = new Map<string, Promise<void>>();

/** Share one in-progress top-up per id, so a second watcher of the same deposit doesn't race the first. */
export function topUpOnce(id: string, run: () => Promise<unknown>): Promise<void> {
  let p = toppingUp.get(id);
  if (!p) {
    p = run().then(() => {}).finally(() => toppingUp.delete(id));
    toppingUp.set(id, p);
  }
  return p;
}

/** User chose "send again" after an unconfirmed send. */
export function resend(id: string): CreditAction {
  const a = actions.get(id)!;
  return move(a, "QUOTED", { depositTx: undefined });
}

/**
 * The API wallet's sweep can return $0: either the USDC was already swept (by a
 * retry, or automatically on a 402), which is fine, or it's still sitting there
 * uncredited, which must not be reported as success.
 */
export async function confirmSweep(sweptUsd: number, idleUsdc: () => Promise<bigint>): Promise<void> {
  if (sweptUsd > 0) return;
  if ((await idleUsdc()) >= BigInt(MIN_CREDIT_USD * 1e6)) throw new Error("Your USDC arrived but hasn't been credited yet. Try again in a minute.");
}

export function friendly(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? String(e);
  if (/user rejected|denied|rejected the request|cancel/i.test(m)) return "You declined in your wallet. Nothing was sent.";
  if (/insufficient funds|insufficient balance/i.test(m)) return "Not enough balance (including network fees) in your wallet.";
  return m.length > 220 ? `${m.slice(0, 220)}…` : m;
}
