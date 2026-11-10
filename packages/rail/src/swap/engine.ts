import { CHAIN_LABEL, resolveAsset, type Chain, type ResolvedAsset, type SymbolName } from "../assets.ts";
import type { Depositor, PreparedDeposit } from "../chains/types.ts";
import { silentLogger, type Logger } from "../log.ts";
import type { OneClickClient } from "../oneclick/client.ts";
import {
  TERMINAL_STATUSES,
  type ExecutionStatus,
  type QuoteRequest,
  type QuoteResponse,
  type SwapDetails,
} from "../oneclick/types.ts";
import type { JsonStore } from "../store.ts";
import { RailError, sleep, toUnits } from "../util.ts";
import { defineMachine } from "../machine.ts";
import { checkMaxInput, validateQuote } from "../oneclick/validate.ts";

export { validateQuote };

/**
 * Swap lifecycle. Every transition is persisted BEFORE the side effect it
 * leads to, so `execute(id)` can be called again after any crash and will
 * continue from exactly where it stopped without re-sending funds.
 *
 *   QUOTED ─► DEPOSIT_SIGNED ─► DEPOSIT_SENT ─► DEPOSIT_CONFIRMED ─► PROCESSING ─► SUCCESS
 *     │             ▲                │                                     ├──► REFUNDED
 *     ▼             └── (dropped) ───┘                                     └──► FAILED
 *   EXPIRED / CANCELLED                     conflict ─► NEEDS_REVIEW
 */
export type SwapState =
  | "QUOTED"
  | "DEPOSIT_SIGNED"
  | "DEPOSIT_SENT"
  | "DEPOSIT_CONFIRMED"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "NEEDS_REVIEW";

export const SWAP_MACHINE = defineMachine<SwapState>("swap", {
  QUOTED: ["DEPOSIT_SIGNED", "EXPIRED", "CANCELLED"],
  DEPOSIT_SIGNED: ["DEPOSIT_SENT"],
  DEPOSIT_SENT: ["DEPOSIT_CONFIRMED", "DEPOSIT_SIGNED", "FAILED", "EXPIRED", "NEEDS_REVIEW"],
  DEPOSIT_CONFIRMED: ["PROCESSING", "SUCCESS", "REFUNDED", "FAILED"],
  PROCESSING: ["SUCCESS", "REFUNDED", "FAILED"],
  SUCCESS: [],
  REFUNDED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
  NEEDS_REVIEW: [],
});

export const FINAL_STATES: ReadonlySet<SwapState> = SWAP_MACHINE.final;

export interface AssetRef {
  chain: Chain;
  symbol: SymbolName;
}

export interface SwapIntent {
  from: AssetRef;
  to: AssetRef;
  /** EXACT_INPUT: `amount` is what we send. EXACT_OUTPUT: `amount` is what must arrive. */
  mode: "EXACT_INPUT" | "EXACT_OUTPUT";
  /** Human decimal string in units of `from` (EXACT_INPUT) or `to` (EXACT_OUTPUT). */
  amount: string;
  recipient: string;
}

export interface SwapAction {
  id: string;
  kind: "swap";
  createdAt: string;
  updatedAt: string;
  state: SwapState;
  intent: SwapIntent;
  origin: ResolvedAsset;
  dest: ResolvedAsset;
  refundTo: string;
  quoteRequest: QuoteRequest;
  quote?: QuoteResponse;
  deposit?: PreparedDeposit;
  depositAttempts: number;
  oneclickStatus?: ExecutionStatus;
  swapDetails?: SwapDetails;
  error?: { code: string; message: string };
  history: Array<{ at: string; state: SwapState; note?: string }>;
}

export interface SwapEvent {
  action: SwapAction;
  /** Short human sentence, safe to show to an end user. */
  message: string;
}

export interface SwapEngineOptions {
  oneclick: OneClickClient;
  depositors: Partial<Record<Chain, Depositor>>;
  store: JsonStore<SwapAction>;
  slippageBps: number;
  maxSwapUsd: number;
  appFees?: Array<{ recipient: string; fee: number }>;
  isKilled?: () => boolean;
  log?: Logger;
  /** Tunables (shortened in tests). */
  timing?: Partial<typeof DEFAULT_TIMING>;
}

const DEFAULT_TIMING = {
  /** Quote lifetime we request from 1Click. */
  quoteDeadlineMs: 30 * 60_000,
  /** Refuse to deposit into a quote with less than this left. */
  minQuoteRemainingMs: 5 * 60_000,
  depositPollMs: 2_000,
  depositTimeoutMs: 3 * 60_000,
  statusPollMs: 3_000,
  statusPollMaxMs: 10_000,
  /** After this, execute() returns with the action still PROCESSING; call again to resume. */
  statusTimeoutMs: 20 * 60_000,
  maxDepositAttempts: 3,
};

export class SwapEngine {
  private readonly o: SwapEngineOptions;
  private readonly t: typeof DEFAULT_TIMING;
  private readonly log: Logger;
  private readonly running = new Map<string, Promise<SwapAction>>();

  constructor(opts: SwapEngineOptions) {
    this.o = opts;
    this.t = { ...DEFAULT_TIMING, ...opts.timing };
    this.log = (opts.log ?? silentLogger).child("swap");
  }

  get(id: string): SwapAction | undefined {
    return this.o.store.get(id);
  }

  /**
   * Resolve assets, request a binding quote, validate it, persist it.
   * Idempotent: an existing action with this id is returned unchanged.
   * Nothing moves yet — this is what the confirm card shows.
   */
  async quote(id: string, intent: SwapIntent): Promise<SwapAction> {
    const existing = this.o.store.get(id);
    if (existing) return existing;

    const depositor = this.o.depositors[intent.from.chain];
    if (!depositor) {
      throw new RailError("NO_DEPOSITOR", `can't send from ${CHAIN_LABEL[intent.from.chain]} yet`);
    }
    const tokens = await this.o.oneclick.tokens();
    const origin = resolveAsset(tokens, intent.from.chain, intent.from.symbol);
    const dest = resolveAsset(tokens, intent.to.chain, intent.to.symbol);
    if (origin.assetId === dest.assetId) throw new RailError("SAME_ASSET", "origin and destination are the same asset");

    const amountDecimals = intent.mode === "EXACT_INPUT" ? origin.decimals : dest.decimals;
    const amount = toUnits(intent.amount, amountDecimals);
    if (amount <= 0n) throw new RailError("BAD_AMOUNT", "amount must be positive");

    const quoteRequest: QuoteRequest = {
      dry: false,
      swapType: intent.mode,
      slippageTolerance: this.o.slippageBps,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: dest.assetId,
      amount: amount.toString(),
      refundTo: depositor.address,
      refundType: "ORIGIN_CHAIN",
      recipient: intent.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + this.t.quoteDeadlineMs).toISOString(),
      quoteWaitingTimeMs: 3_000,
      ...(this.o.appFees?.length ? { appFees: this.o.appFees } : {}),
    };

    const quote = await this.o.oneclick.quote(quoteRequest);
    validateQuote(quoteRequest, quote);

    // The cap can't rest on the quote's own figure: price the input from the token list too.
    const listedUsd = (Number(BigInt(quote.quote.amountIn)) / 10 ** origin.decimals) * origin.priceUsd;
    const inUsd = Math.max(Number(quote.quote.amountInUsd), listedUsd);
    if (!(inUsd <= this.o.maxSwapUsd)) {
      throw new RailError("OVER_CAP", `swap is ~$${inUsd.toFixed(2)}, above the $${this.o.maxSwapUsd} cap`);
    }
    if (intent.mode === "EXACT_OUTPUT") checkMaxInput(origin, quote.quote.amountIn, Number(intent.amount) * dest.priceUsd);

    const now = new Date().toISOString();
    const action: SwapAction = {
      id,
      kind: "swap",
      createdAt: now,
      updatedAt: now,
      state: "QUOTED",
      intent,
      origin,
      dest,
      refundTo: depositor.address,
      quoteRequest,
      quote,
      depositAttempts: 0,
      history: [{ at: now, state: "QUOTED" }],
    };
    this.log.info("quoted", { id, amountIn: quote.quote.amountInFormatted, amountOut: quote.quote.amountOutFormatted });
    return this.o.store.put(action);
  }

  cancel(id: string): SwapAction {
    const a = this.mustGet(id);
    if (a.state !== "QUOTED") throw new RailError("NOT_CANCELLABLE", `swap is already ${a.state}`);
    return this.transition(a, "CANCELLED", "cancelled by user");
  }

  /**
   * Drive the action forward until it reaches a final state (or the status
   * poll times out, leaving it PROCESSING). Safe to call repeatedly and
   * concurrently: concurrent calls share one run.
   */
  execute(id: string, onEvent?: (e: SwapEvent) => void): Promise<SwapAction> {
    const inflight = this.running.get(id);
    if (inflight) return inflight;
    const run = this.run(id, onEvent ?? (() => {})).finally(() => this.running.delete(id));
    this.running.set(id, run);
    return run;
  }

  private async run(id: string, emit: (e: SwapEvent) => void): Promise<SwapAction> {
    let a = this.mustGet(id);
    // Always report the action's CURRENT state (helpers pass their fresh copy).
    const say = (message: string, act: SwapAction = a) => {
      this.log.info(message, { id, state: act.state });
      emit({ action: act, message });
    };

    try {
      while (!FINAL_STATES.has(a.state)) {
        switch (a.state) {
          case "QUOTED": {
            if (this.o.isKilled?.()) throw new RailError("KILLED", "kill switch is on; no funds will move");
            const remaining = Date.parse(a.quote!.quote.deadline ?? a.quoteRequest.deadline) - Date.now();
            if (remaining < this.t.minQuoteRemainingMs) {
              a = this.transition(a, "EXPIRED", "quote too close to its deadline; request a new one");
              say("Quote expired before it was confirmed. Ask again for a fresh quote.");
              break;
            }
            a = await this.signDeposit(a);
            say(`Signed deposit of ${a.quote!.quote.amountInFormatted} ${a.origin.symbol}.`);
            break;
          }
          case "DEPOSIT_SIGNED": {
            // A failed broadcast proves nothing (it may have landed on an earlier try, and a resend then
            // fails on its old blockhash). The chain decides, in DEPOSIT_SENT.
            await this.depositor(a)
              .broadcast(a.deposit!)
              .catch((e) => this.log.warn("broadcast failed; checking the chain", { id: a.id, err: String(e) }));
            a = this.transition(a, "DEPOSIT_SENT", a.deposit!.txHash);
            say(`Deposit sent on ${CHAIN_LABEL[a.origin.chain]}, waiting for confirmation…`);
            break;
          }
          case "DEPOSIT_SENT": {
            a = await this.awaitDeposit(a, say);
            if (a.state === "DEPOSIT_SENT") return a; // timed out waiting; resumable
            break;
          }
          case "DEPOSIT_CONFIRMED":
          case "PROCESSING": {
            a = await this.awaitSettlement(a, say);
            if (a.state === "PROCESSING") return a; // timed out polling; resumable
            break;
          }
        }
      }
    } catch (e) {
      const err = e instanceof RailError ? e : new RailError("UNEXPECTED", (e as Error).message ?? String(e));
      this.log.error("swap run error", { id, state: a.state, code: err.code, message: err.message });
      // Before any deposit is signed, failure is clean. After, leave state as-is so a retry resumes.
      if (a.state === "QUOTED") {
        a = this.o.store.update(id, (r) => ({ ...r, error: { code: err.code, message: err.message } }));
      }
      throw err;
    }
    return a;
  }

  private async signDeposit(a: SwapAction): Promise<SwapAction> {
    const d = this.depositor(a);
    const amount = BigInt(a.quote!.quote.amountIn);
    const have = await d.balance(a.origin);
    if (have < amount) {
      throw new RailError("INSUFFICIENT_BALANCE", `need ${a.quote!.quote.amountInFormatted} ${a.origin.symbol}`, {
        have: have.toString(),
        need: amount.toString(),
      });
    }
    const deposit = await d.prepare(a.origin, a.quote!.quote.depositAddress!, amount);
    return this.transition({ ...a, deposit, depositAttempts: a.depositAttempts + 1 }, "DEPOSIT_SIGNED", deposit.txHash);
  }

  private async awaitDeposit(a: SwapAction, say: (m: string, act: SwapAction) => void): Promise<SwapAction> {
    const d = this.depositor(a);
    const until = Date.now() + this.t.depositTimeoutMs;
    let rebroadcasts = 0;
    let droppedAnswers = 0;
    while (Date.now() < until) {
      const check = await d.check(a.deposit!);
      if (check === "confirmed") {
        // Best effort: speeds up 1Click pickup; it would find the deposit anyway.
        await this.o.oneclick
          .submitDeposit({ txHash: a.deposit!.txHash, depositAddress: a.quote!.quote.depositAddress! })
          .catch((e) => this.log.warn("submitDeposit failed (non-fatal)", { id: a.id, err: String(e) }));
        a = this.transition(a, "DEPOSIT_CONFIRMED", a.deposit!.txHash);
        say(`Deposit confirmed. Swap typically takes ~${a.quote!.quote.timeEstimate}s.`, a);
        return a;
      }
      if (check === "failed") {
        a = this.fail(a, "DEPOSIT_REVERTED", "deposit transaction failed on-chain; no swap happened");
        say("Deposit transaction failed on-chain. No funds were swapped.", a);
        return a;
      }
      if (check === "conflict") {
        a = this.transition(a, "NEEDS_REVIEW", "wallet nonce used by another transaction");
        say("Another transaction used this wallet at the same time. Paused for manual review; nothing was double-sent.", a);
        return a;
      }
      if (check === "dropped") {
        // One lagging RPC can claim this falsely, and signing again would pay twice: it takes two
        // answers in a row, and 1Click must also have seen nothing.
        if (++droppedAnswers < 2) {
          await sleep(this.t.depositPollMs);
          continue;
        }
        const st = await this.o.oneclick.status(a.quote!.quote.depositAddress!, a.quote!.quote.depositMemo).catch(() => undefined);
        if (!st) {
          await sleep(this.t.depositPollMs);
          continue;
        }
        if (st.status !== "PENDING_DEPOSIT") {
          a = this.transition(a, "DEPOSIT_CONFIRMED", a.deposit!.txHash);
          say("1Click sees the deposit, so it did land.", a);
          return a;
        }
        // Provably never landed: safe to sign a new one, if the quote still has time.
        if (a.depositAttempts >= this.t.maxDepositAttempts) {
          a = this.fail(a, "DEPOSIT_DROPPED", "deposit never landed after retries");
          say("Deposit didn't land after several tries. No funds moved.", a);
          return a;
        }
        const remaining = Date.parse(a.quote!.quote.deadline ?? a.quoteRequest.deadline) - Date.now();
        if (remaining < this.t.minQuoteRemainingMs) {
          a = this.transition(a, "EXPIRED", "deposit dropped and quote is near deadline");
          say("Deposit didn't land and the quote is about to expire. No funds moved; please re-quote.", a);
          return a;
        }
        say("Deposit didn't land (network dropped it). Re-signing — the old one can no longer execute.", a);
        return this.signDeposit(a);
      }
      droppedAnswers = 0;
      // pending: periodically rebroadcast the SAME signed tx (harmless if already seen)
      if (++rebroadcasts % 5 === 0) await d.broadcast(a.deposit!).catch(() => {});
      await sleep(this.t.depositPollMs);
    }
    say("Deposit still unconfirmed; will keep checking. Nothing will be sent twice.", a);
    return a;
  }

  private async awaitSettlement(a: SwapAction, say: (m: string, act: SwapAction) => void): Promise<SwapAction> {
    const until = Date.now() + this.t.statusTimeoutMs;
    let delay = this.t.statusPollMs;
    while (Date.now() < until) {
      const st = await this.o.oneclick.status(a.quote!.quote.depositAddress!, a.quote!.quote.depositMemo);
      if (st.status !== a.oneclickStatus) {
        a = this.o.store.update(a.id, (r) => ({ ...r, oneclickStatus: st.status, swapDetails: st.swapDetails }));
        if (!TERMINAL_STATUSES.has(st.status)) {
          if (a.state !== "PROCESSING") a = this.transition(a, "PROCESSING", st.status);
          say(statusMessage(st.status), a);
        }
      }
      if (st.status === "SUCCESS") {
        a = this.transition({ ...a, swapDetails: st.swapDetails }, "SUCCESS");
        const out = st.swapDetails.amountOutFormatted ?? a.quote!.quote.amountOutFormatted;
        say(`Done: received ${out} ${a.dest.symbol} on ${CHAIN_LABEL[a.dest.chain]}.`, a);
        return a;
      }
      if (st.status === "REFUNDED") {
        a = this.transition({ ...a, swapDetails: st.swapDetails }, "REFUNDED", st.swapDetails.refundReason);
        const amt = st.swapDetails.refundedAmountFormatted ?? "your deposit";
        say(`Swap couldn't complete; refunded ${amt} ${a.origin.symbol} to ${a.refundTo}.`, a);
        return a;
      }
      if (st.status === "FAILED") {
        a = this.fail({ ...a, swapDetails: st.swapDetails }, "ONECLICK_FAILED", "1Click reported FAILED");
        say("1Click reported the swap as failed. Funds should be refunded; keep the action id for support.", a);
        return a;
      }
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), this.t.statusPollMaxMs);
    }
    say("Still processing — taking longer than usual. I'll keep checking.", a);
    return a;
  }

  private depositor(a: SwapAction): Depositor {
    const d = this.o.depositors[a.origin.chain];
    if (!d) throw new RailError("NO_DEPOSITOR", `no depositor for ${a.origin.chain}`);
    return d;
  }

  private mustGet(id: string): SwapAction {
    const a = this.o.store.get(id);
    if (!a) throw new RailError("NOT_FOUND", `swap ${id} not found`);
    return a;
  }

  private transition(a: SwapAction, state: SwapState, note?: string): SwapAction {
    SWAP_MACHINE.assert(a.state, state);
    const at = new Date().toISOString();
    return this.o.store.put({ ...a, state, updatedAt: at, history: [...a.history, { at, state, note }] });
  }

  private fail(a: SwapAction, code: string, message: string): SwapAction {
    return this.transition({ ...a, error: { code, message } }, "FAILED", message);
  }
}

function statusMessage(s: ExecutionStatus): string {
  switch (s) {
    case "KNOWN_DEPOSIT_TX":
      return "1Click sees the deposit transaction.";
    case "PENDING_DEPOSIT":
      return "Waiting for 1Click to register the deposit…";
    case "INCOMPLETE_DEPOSIT":
      return "1Click received less than required; it will refund if not topped up before the deadline.";
    case "PROCESSING":
      return "Solver is executing the swap…";
    default:
      return `Status: ${s}`;
  }
}
