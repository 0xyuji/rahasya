"use client";

import {
  RailError,
  randomActionId,
  sleep,
  type ExecutionStatus,
  type QuoteRequest,
  type QuoteResponse,
  type TokenResponse,
} from "@pay/rail/browser";
import type { LocalAccount } from "viem";
import { LocalStore } from "./local-store";
import { MAX_CREDIT_USD, MIN_CREDIT_USD, inferenceUsdc, oneclick, topups as idleTopups, veniceFor } from "./flow";

/**
 * "Send from anywhere": deposit any 1Click-supported token from any source
 * (another wallet, an exchange, a shielded Zcash wallet…). FLEX_INPUT so
 * whatever arrives above the minimum is converted — exchange withdrawals
 * that arrive slightly short are not refunded hours later.
 */
const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const SLIPPAGE_BPS = 100;
const DEADLINE_MS = 3 * 3600_000; // BTC/ZEC confirmations can take a while

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

/** Light format check so typos are caught before a quote; 1Click does the real validation. */
export function refundAddressProblem(bc: string, addr: string): string | null {
  const a = addr.trim();
  if (!a) return "Enter an address you control on this chain; refunds go there.";
  const evm = ["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "bera", "monad", "scroll", "xlayer", "abs", "plasma", "hood", "adi"];
  if (evm.includes(bc) && !/^0x[0-9a-fA-F]{40}$/.test(a)) return "That doesn't look like an EVM address (0x… 40 hex characters).";
  if (bc === "sol" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return "That doesn't look like a Solana address.";
  if (bc === "btc" && !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a)) return "That doesn't look like a Bitcoin address.";
  if (bc === "zec" && !/^t1[a-zA-Z0-9]{33}$/.test(a)) return "Use a transparent Zcash address (t1…) for refunds.";
  if (bc === "near" && !/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a)) return "That doesn't look like a NEAR account.";
  return null;
}

export type AnywhereState = "AWAITING_DEPOSIT" | "INCOMPLETE" | "RECEIVED" | "SWAPPED" | "TOPPING_UP" | "DONE" | "IDLE" | "REFUNDED" | "FAILED" | "EXPIRED" | "CANCELLED";
export const ANYWHERE_FINAL: ReadonlySet<AnywhereState> = new Set(["DONE", "IDLE", "REFUNDED", "FAILED", "EXPIRED", "CANCELLED"]);

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

export const anywhereActions = new LocalStore<AnywhereAction>("anywhere");

function move(a: AnywhereAction, state: AnywhereState, patch: Partial<AnywhereAction> = {}): AnywhereAction {
  return anywhereActions.put({ ...a, ...patch, state, history: [...a.history, { at: new Date().toISOString(), state }] });
}

/** 1Click says "Amount is too low for bridge, try at least 8300": surface that as a usable minimum. */
export function parseMinimum(message: string, token: Pick<TokenResponse, "decimals" | "price" | "symbol">): string | null {
  const m = /try at least (\d+)/i.exec(message);
  if (!m) return null;
  const units = Number(m[1]) / 10 ** token.decimals;
  return `The minimum for ${token.symbol} here is ${units} ${token.symbol} (≈ $${(units * token.price).toFixed(2)}).`;
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
  // Code decides: the quote must deliver to OUR inference wallet and refund to THEIR address.
  const echo = quote.quoteRequest;
  const bad = (["originAsset", "destinationAsset", "recipient", "refundTo", "swapType"] as const).filter(
    (k) => String(echo?.[k]).toLowerCase() !== String(req[k]).toLowerCase(),
  );
  if (!quote.quote.depositAddress) bad.push("depositAddress" as never);
  if (bad.length) throw new RailError("QUOTE_MISMATCH", `1Click quote doesn't match the request (${bad.join(", ")}). Not showing it.`);

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
      for (let i = 0; i < 30 && (await inferenceUsdc(a.inferenceAddress)) < BigInt(Math.round(usd * 1e6)); i++) await sleep(2_000);
      try {
        if (deps.topUp) await deps.topUp(`topup_${a.id}`, usd);
        else await veniceFor(deps.inference!).topUp(`topup_${a.id}`, usd);
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
    if (a.state === "AWAITING_DEPOSIT" && Date.now() > Date.parse(a.quote.quote.deadline ?? a.quoteRequest.deadline)) {
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

/** Turn USDC already sitting on the inference wallet into credit (≥ $5, rounded down to cents). */
export async function creditIdleUsdc(inference: LocalAccount): Promise<number> {
  const bal = await inferenceUsdc(inference.address);
  const usd = Math.floor(Number(bal) / 1e4) / 100;
  if (usd < MIN_CREDIT_USD) throw new RailError("TOO_SMALL", `You have $${usd.toFixed(2)} of idle USDC; Venice's minimum top-up is $${MIN_CREDIT_USD}.`);
  // Sequence per wallet (same scheme as the server's API-wallet sweep): a pending
  // authorization is re-sent; once one succeeded, new idle USDC gets a new id, so a
  // repeat of the same balance is never mistaken for an old, finished top-up.
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
  const done = await venice.topUp(idFor(seq), pending ? pending.amountUsd : Math.min(usd, MAX_CREDIT_USD));
  write(seq + 1);
  return done.amountUsd;
}
