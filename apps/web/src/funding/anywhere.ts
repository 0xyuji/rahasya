"use client";

import {
  RailError,
  checkMaxInput,
  planSweep,
  randomActionId,
  sleep,
  type ExecutionStatus,
  type QuoteRequest,
  type QuoteResponse,
  type TokenResponse,
} from "@pay/rail/browser";
import type { LocalAccount } from "viem";
import { LocalStore } from "./local-store.ts";
import { MAX_CREDIT_USD, MIN_CREDIT_USD, inferenceUsdc, oneclick, topUpOnce, topups as idleTopups, veniceFor } from "./flow.ts";
import { ANYWHERE_FINAL, ANYWHERE_MACHINE, type AnywhereState } from "./machines.ts";

export { ANYWHERE_FINAL, type AnywhereState };

/**
 * "Send from anywhere": deposit any 1Click-supported token from any source
 * (another wallet, an exchange, a shielded Zcash wallet…). FLEX_INPUT so
 * whatever arrives above the minimum is converted — exchange withdrawals
 * that arrive slightly short are not refunded hours later.
 */
const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SLIPPAGE_BPS = 100;
const DEADLINE_MS = 3 * 3600_000; // BTC/ZEC confirmations can take a while
const EXPIRY_GRACE_MS = 60_000;

export const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain",
  avax: "Avalanche", gnosis: "Gnosis", bera: "Berachain", monad: "Monad", scroll: "Scroll", xlayer: "X Layer",
  abs: "Abstract", plasma: "Plasma", hood: "Robinhood Chain", adi: "ADI", btc: "Bitcoin", zec: "Zcash", sol: "Solana",
  doge: "Dogecoin", ltc: "Litecoin", bch: "Bitcoin Cash", dash: "Dash", xrp: "XRP Ledger", ton: "TON", tron: "Tron",
  sui: "Sui", aptos: "Aptos", cardano: "Cardano", stellar: "Stellar", starknet: "Starknet", aleo: "Aleo",
  movement: "Movement", hypercore: "Hypercore", fogo: "Fogo", miden: "Miden", qtc: "QTC", prl: "PRL",
};
export const chainName = (bc: string) => CHAIN_NAMES[bc] ?? bc.toUpperCase();

/** Tokens a user can send from anywhere (everything 1Click supports except the destination itself). */
export function sendableTokens(all: TokenResponse[]): TokenResponse[] {
  return all
    .filter((t) => t.assetId !== BASE_USDC_ASSET && t.price > 0)
    .sort((a, b) => chainName(a.blockchain).localeCompare(chainName(b.blockchain)) || a.symbol.localeCompare(b.symbol));
}

const EVM_CHAINS = ["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "bera", "monad", "scroll", "xlayer", "abs", "plasma", "hood", "adi", "hypercore"];
const NON_EVM_CHAINS = ["near", "btc", "zec", "sol", "doge", "ltc", "bch", "dash", "xrp", "ton", "tron", "sui", "aptos", "cardano", "stellar", "starknet", "aleo", "movement", "fogo"];
/** Only these get the connected EVM address prefilled as a refund address. */
export const isEvmChain = (bc: string) => EVM_CHAINS.includes(bc);
/** When an any-token deposit stops being valid: the earlier of what we asked for and what 1Click quoted. */
export const anywhereDeadline = (a: Pick<AnywhereAction, "quote" | "quoteRequest">) => Math.min(Date.parse(a.quote.quote.deadline ?? a.quoteRequest.deadline), Date.parse(a.quoteRequest.deadline));

/** Light format check so typos are caught before a quote; 1Click does the real validation. */
export function refundAddressProblem(bc: string, addr: string): string | null {
  const a = addr.trim();
  if (!a) return "Enter an address you control on this chain; refunds go there.";
  const evmShaped = /^0x[0-9a-fA-F]{40}$/.test(a);
  if (isEvmChain(bc) && !evmShaped) return "That doesn't look like an EVM address (0x… 40 hex characters).";
  // On these chains a 0x address can parse but belong to nobody the user controls, so a refund would be lost.
  if (evmShaped && NON_EVM_CHAINS.includes(bc)) return `That's an EVM address, which won't work for refunds on ${chainName(bc)}. Enter a ${chainName(bc)} address you control.`;
  if (bc === "sol" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "That doesn't look like a Solana address.";
  if (bc === "btc" && !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a)) return "That doesn't look like a Bitcoin address.";
  if (bc === "zec" && !/^t1[a-zA-Z0-9]{33}$/.test(a)) return "Use a transparent Zcash address (t1…) for refunds.";
  if (bc === "near" && !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a)) return "That doesn't look like a NEAR account.";
  return null;
}

export interface AnywhereAction {
  id: string;
  kind: "anywhere";
  createdAt: string;
  state: AnywhereState;
  token: Pick<TokenResponse, "assetId" | "symbol" | "blockchain" | "decimals" | "price">;
  refundTo: string;
  inferenceAddress: string;
  quoteRequest: QuoteRequest;
  quote: QuoteResponse;
  oneclickStatus?: ExecutionStatus;
  /** USDC (6 dp) actually delivered to the inference wallet. */
  delivered?: string;
  creditedUsd?: number;
  error?: string;
  history: Array<{ at: string; state: AnywhereState }>;
}

export const anywhereActions = new LocalStore<AnywhereAction>("anywhere", (a) => !!(a.token && a.quote && a.quoteRequest && Array.isArray(a.history)));

function move(a: AnywhereAction, state: AnywhereState, patch: Partial<AnywhereAction> = {}): AnywhereAction {
  ANYWHERE_MACHINE.assert(a.state, state);
  return anywhereActions.put({ ...a, error: undefined, ...patch, state, history: [...a.history, { at: new Date().toISOString(), state }] });
}

/** 1Click says "Amount is too low for bridge, try at least 8300": surface that as a usable minimum. */
export function parseMinimum(message: string, token: Pick<TokenResponse, "decimals" | "price" | "symbol">): string | null {
  const m = /try at least (\d+)/i.exec(message);
  if (!m) return null;
  const units = Number(m[1]) / 10 ** token.decimals;
  return `The minimum for ${token.symbol} here is ${units} ${token.symbol} (≈ $${(units * token.price).toFixed(2)}).`;
}

/** Code decides: the quote must deliver to OUR inference wallet, refund to THEIR address, and not ask for more than the credit is worth. */
export function checkAnywhereQuote(req: QuoteRequest, quote: QuoteResponse, token: Pick<TokenResponse, "decimals" | "price" | "symbol">, usd: number): void {
  const echo = quote.quoteRequest;
  const bad: string[] = (["originAsset", "destinationAsset", "recipient", "refundTo", "swapType", "amount", "slippageTolerance", "depositType", "refundType", "recipientType"] as const).filter(
    (k) => String(echo?.[k]).toLowerCase() !== String(req[k]).toLowerCase(),
  );
  const q = quote.quote;
  if (!q.depositAddress) bad.push("depositAddress");
  const units = (v: string | undefined) => (/^\d+$/.test(v ?? "") ? BigInt(v!) : 0n); // missing, empty or negative counts as 0
  const amountIn = units(q.amountIn);
  const minAmountIn = units(q.minAmountIn);
  if (amountIn <= 0n || amountIn > BigInt(req.amount)) bad.push("amountIn");
  if (minAmountIn <= 0n || minAmountIn > amountIn) bad.push("minAmountIn");
  if (units(q.minAmountOut) < BigInt(Math.floor(usd * 0.9 * 1e6))) bad.push("minAmountOut"); // must deliver about what we show
  if (bad.length) throw new RailError("QUOTE_MISMATCH", `1Click quote doesn't match the request (${bad.join(", ")}). Not showing it.`);
  checkMaxInput({ decimals: token.decimals, priceUsd: token.price, symbol: token.symbol }, q.amountIn, usd);
}

export async function quoteAnywhere(p: {
  usd: number;
  token: TokenResponse;
  refundTo: string;
  inferenceAddress: string;
}): Promise<AnywhereAction> {
  if (!(p.usd >= MIN_CREDIT_USD && p.usd <= MAX_CREDIT_USD)) throw new RailError("BAD_AMOUNT", `Choose between $${MIN_CREDIT_USD} and $${MAX_CREDIT_USD}.`);
  const problem = refundAddressProblem(p.token.blockchain, p.refundTo);
  if (problem) throw new RailError("BAD_REFUND", problem);

  // Size the input so even the slippage-adjusted minimum still covers the credit asked for.
  const inputUnits = BigInt(Math.ceil((p.usd / p.token.price) * 1.03 * 10 ** p.token.decimals));
  const req: QuoteRequest = {
    dry: false,
    swapType: "FLEX_INPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: p.token.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: BASE_USDC_ASSET,
    amount: inputUnits.toString(),
    refundTo: p.refundTo.trim(),
    refundType: "ORIGIN_CHAIN",
    recipient: p.inferenceAddress,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + DEADLINE_MS).toISOString(),
    quoteWaitingTimeMs: 3_000,
  };
  let quote: QuoteResponse;
  try {
    quote = await oneclick.quote(req);
  } catch (e) {
    const body = (e as { body?: string }).body ?? "";
    let msg = body;
    try {
      msg = (JSON.parse(body) as { message?: string }).message ?? body;
    } catch {}
    throw new RailError("QUOTE_FAILED", parseMinimum(msg, p.token) ?? (msg || (e as Error).message));
  }
  checkAnywhereQuote(req, quote, p.token, p.usd);

  const now = new Date().toISOString();
  return anywhereActions.put({
    id: randomActionId("anywhere"),
    kind: "anywhere",
    createdAt: now,
    state: "AWAITING_DEPOSIT",
    token: { assetId: p.token.assetId, symbol: p.token.symbol, blockchain: p.token.blockchain, decimals: p.token.decimals, price: p.token.price },
    refundTo: req.refundTo,
    inferenceAddress: p.inferenceAddress,
    quoteRequest: req,
    quote,
    history: [{ at: now, state: "AWAITING_DEPOSIT" }],
  });
}

/**
 * Watch a deposit address until the swap settles, then credit what actually
 * arrived (rounded down to cents). Needs the unlocked inference wallet only
 * for the final top-up; without it the USDC simply waits on the inference
 * wallet ("IDLE") and can be credited later.
 */
export async function runAnywhere(
  id: string,
  deps: {
    inference: LocalAccount | null;
    onUpdate: (a: AnywhereAction) => void;
    signal?: AbortSignal;
    topUp?: (id: string, usd: number) => Promise<void>;
  },
): Promise<AnywhereAction> {
  let a = anywhereActions.get(id)!;
  const emit = (n: AnywhereAction) => (deps.onUpdate(n), n);
  const addr = a.quote.quote.depositAddress!;
  const memo = a.quote.quote.depositMemo;
  let delay = 4_000;

  while (!ANYWHERE_FINAL.has(a.state) && !deps.signal?.aborted) {
    if (a.state === "SWAPPED" || a.state === "TOPPING_UP") {
      if (!deps.inference && !deps.topUp) return emit(move(a, "IDLE"));
      // Credit what actually arrived (rounded down to cents), up to the cap; any excess stays as idle USDC.
      const usd = Math.min(Math.floor(Number(a.delivered ?? "0") / 1e4) / 100, MAX_CREDIT_USD);
      if (usd < MIN_CREDIT_USD) return emit(move(a, "IDLE", { error: `Only $${usd.toFixed(2)} arrived; Venice's minimum top-up is $${MIN_CREDIT_USD}. It's waiting as idle USDC.` }));
      a = emit(move(a, "TOPPING_UP"));
      for (let i = 0; i < 30 && (await inferenceUsdc(a.inferenceAddress).catch(() => 0n)) < BigInt(Math.round(usd * 1e6)); i++) await sleep(2_000);
      try {
        const topUpId = `topup_${a.id}`;
        await topUpOnce(topUpId, () => (deps.topUp ? deps.topUp(topUpId, usd) : veniceFor(deps.inference!).topUp(topUpId, usd)));
        return emit(move(a, "DONE", { creditedUsd: usd }));
      } catch (e) {
        return emit({ ...a, error: (e as Error).message });
      }
    }

    const st = await oneclick.status(addr, memo).catch(() => undefined);
    if (st && st.status !== a.oneclickStatus) {
      const s = st.status;
      if (s === "SUCCESS") a = emit(move(a, "SWAPPED", { oneclickStatus: s, delivered: st.swapDetails.amountOut }));
      else if (s === "REFUNDED") a = emit(move(a, "REFUNDED", { oneclickStatus: s }));
      else if (s === "FAILED") a = emit(move(a, "FAILED", { oneclickStatus: s, error: "1Click reported the swap as failed; funds are refunded to your refund address." }));
      else if (s === "INCOMPLETE_DEPOSIT") a = emit(move(a, "INCOMPLETE", { oneclickStatus: s }));
      else if (s === "KNOWN_DEPOSIT_TX" || s === "PROCESSING") a = emit(move(a, "RECEIVED", { oneclickStatus: s }));
      else a = emit({ ...a, oneclickStatus: s });
    }
    // Only a successful "still nothing here" read can expire it: a failed read says nothing about the deposit.
    if (a.state === "AWAITING_DEPOSIT" && st?.status === "PENDING_DEPOSIT" && Date.now() > anywhereDeadline(a) + EXPIRY_GRACE_MS) {
      return emit(move(a, "EXPIRED"));
    }
    if (ANYWHERE_FINAL.has(a.state) || a.state === "SWAPPED") continue;
    await sleep(delay);
    delay = Math.min(delay * 1.3, 15_000);
  }
  return a;
}

/**
 * Stop watching a deposit address the user abandoned. Only allowed before
 * anything arrived; if funds show up later anyway, 1Click still swaps or
 * refunds them by its own rules (we just stop showing it).
 */
export function cancelAnywhere(id: string): AnywhereAction | undefined {
  const a = anywhereActions.get(id);
  if (!a || a.state !== "AWAITING_DEPOSIT") return a;
  return move(a, "CANCELLED");
}

/** Stop retrying a top-up that isn't going to work. The USDC stays on the wallet, usable from the USDC on Base tab. */
export function dismissAnywhere(id: string): AnywhereAction {
  return move(anywhereActions.get(id)!, "IDLE", { error: "Stopped retrying. Your USDC is waiting on the wallet; use the USDC on Base tab to turn it into credit." });
}

/** Turn USDC already sitting on the inference wallet into credit (≥ $5, rounded down to cents). */
export async function creditIdleUsdc(inference: LocalAccount): Promise<number> {
  const bal = await inferenceUsdc(inference.address);
  const usd = Math.floor(Number(bal) / 1e4) / 100;
  if (usd < MIN_CREDIT_USD) throw new RailError("TOO_SMALL", `You have $${usd.toFixed(2)} of idle USDC; Venice's minimum top-up is $${MIN_CREDIT_USD}.`);
  // Sequence per wallet (same scheme as the server's API-wallet sweep): a pending
  // authorization is re-sent; once one succeeded, new idle USDC gets a new id, so a
  // repeat of the same balance is never mistaken for an old, finished top-up.
  // Storage key predates the rename; never change it (a reset sequence could reuse an old top-up id).
  const seqKey = `naisho:idle-seq:${inference.address.toLowerCase()}`;
  const read = () => {
    try {
      return Number(localStorage.getItem(seqKey) ?? "0") || 0;
    } catch {
      return 0;
    }
  };
  const write = (n: number) => {
    try {
      localStorage.setItem(seqKey, String(n));
    } catch {}
  };
  const idFor = (n: number) => `idle_${inference.address.toLowerCase()}_${n}`;
  let seq = read();
  const venice = veniceFor(inference);
  if ((await idleTopups.get(idFor(seq)))?.state === "SUCCESS") write(++seq);
  const pending = await idleTopups.get(idFor(seq));
  const plan = planSweep(pending, usd, MAX_CREDIT_USD);
  if (plan.kind === "wait") throw new RailError("TOPUP_PENDING", "An earlier top-up for a larger amount is still pending. Try again in a few minutes.");
  if (plan.kind === "fresh" && pending) write(++seq); // that one can never settle now
  const done = await venice.topUp(idFor(seq), plan.amountUsd);
  write(seq + 1);
  return done.amountUsd;
}
