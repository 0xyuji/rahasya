import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { LocalAccount } from "viem";
import { silentLogger, type Logger } from "../log.ts";
import type { RecordStore } from "../store.ts";
import { HttpError, RailError, withRetry } from "../util.ts";
import { createSiwxHeader } from "./siwx.ts";

const BASE_NETWORK = "eip155:8453";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** Venice's x402 receiving address on Base (seen on every top-up so far). Payments to anything else are refused. */
export const VENICE_PAY_TO = "0x2670b922ef37c7df47158725c0cc407b5382293f";
/**
 * After `validBefore`, an EIP-3009 authorization can't settle once a block with a
 * later timestamp exists. Wait this much longer before signing a replacement, so
 * a late settlement of the old one can't land next to the new one.
 */
export const SETTLE_MARGIN_SEC = 120;

export interface VeniceBalance {
  canConsume: boolean;
  balanceUsd: number;
  minimumTopUpUsd?: number;
  suggestedTopUpUsd?: number;
  diemBalanceUsd?: number;
}

export type TopUpState = "SIGNED" | "SUCCESS" | "FAILED";

/** Persisted so a crashed/retried top-up re-sends the SAME signed authorization (EIP-3009 nonce = no double charge). */
export interface TopUpAction {
  id: string;
  kind: "venice_topup";
  createdAt: string;
  updatedAt: string;
  state: TopUpState;
  amountUsd: number;
  payTo: string;
  /** Headers carrying the signed payment; resent verbatim on retry. */
  paymentHeaders: Record<string, string>;
  /** Unix seconds after which the authorization can never settle. */
  validBefore: number;
  response?: unknown;
  error?: { code: string; message: string };
}

/**
 * What a sweep should do with the wallet's idle USDC, given the top-up saved under
 * the current sequence number (audit V2-03). Re-sending the saved authorization is
 * right while it can still be honoured. But if it's for more than the wallet now
 * holds (a lagging balance read signed it, or the funds moved), re-sending or
 * re-signing the same amount would fail forever: wait until it can no longer
 * settle, then start a new sequence number for the real balance.
 */
export type SweepPlan = { kind: "resend"; amountUsd: number } | { kind: "fresh"; amountUsd: number } | { kind: "wait" };

export function planSweep(pending: TopUpAction | undefined, balanceUsd: number, maxUsd: number, nowSec = Math.floor(Date.now() / 1000)): SweepPlan {
  const fresh = Math.min(balanceUsd, maxUsd);
  if (!pending || pending.state === "SUCCESS") return { kind: "fresh", amountUsd: fresh };
  if (pending.amountUsd <= balanceUsd + 0.005) return { kind: "resend", amountUsd: pending.amountUsd };
  if (nowSec > pending.validBefore + SETTLE_MARGIN_SEC) return { kind: "fresh", amountUsd: fresh };
  return { kind: "wait" };
}

export class VeniceInsufficientBalance extends RailError {
  constructor(body: string) {
    super("VENICE_402", "Venice balance too low for this request", { body: body.slice(0, 300) });
  }
}

export interface VeniceClientOptions {
  account: LocalAccount;
  baseUrl?: string;
  topups: RecordStore<TopUpAction>;
  /** Refuse to sign any single top-up above this (USD). */
  maxTopUpUsd: number;
  isKilled?: () => boolean;
  log?: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Expected x402 payTo (default VENICE_PAY_TO). */
  payTo?: string;
}

export class VeniceClient {
  readonly address: string;
  private readonly o: VeniceClientOptions;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly log: Logger;
  /** Last value seen in X-Balance-Remaining. */
  lastBalanceUsd?: number;

  constructor(opts: VeniceClientOptions) {
    this.o = opts;
    this.address = opts.account.address;
    this.base = (opts.baseUrl ?? "https://api.venice.ai/api/v1").replace(/\/$/, "");
    // Bound: browsers throw "Illegal invocation" if window.fetch is called as a method of another object.
    this.f = opts.fetch ?? ((input, init) => fetch(input, init));
    this.log = (opts.log ?? silentLogger).child("venice");
  }

  // ---------- wallet-only routes ----------

  /** Live response is wrapped: { success, data: { balanceUsd, canConsume, ... } }. */
  async balance(): Promise<VeniceBalance> {
    const r = await withRetry(() =>
      this.authed<{ data?: VeniceBalance } & Partial<VeniceBalance>>("GET", `/x402/balance/${this.address}`),
    );
    return (r.data ?? r) as VeniceBalance;
  }

  transactions(limit = 20): Promise<unknown> {
    return this.authed("GET", `/x402/transactions/${this.address}?limit=${limit}&offset=0`);
  }

  /** Public model catalog (no auth). */
  async models(type = "text"): Promise<Array<{ id: string; model_spec: Record<string, unknown> }>> {
    const url = `${this.base}/models?type=${encodeURIComponent(type)}`;
    const res = await this.f(url, { signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000) });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, url);
    return (JSON.parse(text) as { data: Array<{ id: string; model_spec: Record<string, unknown> }> }).data;
  }

  // ---------- paid routes ----------

  /** OpenAI-compatible chat completion. Throws VeniceInsufficientBalance on 402. */
  chat<T = ChatCompletion>(body: Record<string, unknown>): Promise<T> {
    return this.authed<T>("POST", "/chat/completions", body);
  }

  /** Streaming chat; returns the raw SSE Response (caller parses / decrypts). */
  async chatStream(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const url = `${this.base}/chat/completions`;
    const res = await this.f(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        ...extraHeaders,
        "SIGN-IN-WITH-X": await createSiwxHeader(this.o.account, url),
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 180_000),
    });
    if (res.status === 402) throw new VeniceInsufficientBalance(await res.text());
    if (!res.ok) throw new HttpError(res.status, await res.text(), url);
    return res;
  }

  /** Fresh SIWX headers for an arbitrary Venice URL (e.g. /tee/attestation). */
  async authHeaders(url: string): Promise<Record<string, string>> {
    return { "SIGN-IN-WITH-X": await createSiwxHeader(this.o.account, url) };
  }

  // ---------- top-up (x402) ----------

  /**
   * Add `amountUsd` of credit, paid in USDC from this wallet on Base via x402.
   * Idempotent per `id`: until the signed authorization has provably expired
   * (validBefore + a settlement margin), every call re-sends that same
   * authorization, even after a rejection (e.g. the USDC hadn't arrived yet).
   * Only then is a replacement signed. So at most one authorization per id can
   * ever settle.
   */
  async topUp(id: string, amountUsd: number): Promise<TopUpAction> {
    if (this.o.isKilled?.()) throw new RailError("KILLED", "kill switch is on; no top-up");
    if (!(amountUsd > 0 && amountUsd <= this.o.maxTopUpUsd)) {
      throw new RailError("OVER_CAP", `top-up $${amountUsd} outside (0, $${this.o.maxTopUpUsd}]`);
    }

    let action = await this.o.topups.get(id);
    if (action?.state === "SUCCESS") return action;

    const nowSec = Math.floor(Date.now() / 1000);
    if (!action || nowSec > action.validBefore + SETTLE_MARGIN_SEC) {
      action = await this.signTopUp(id, amountUsd);
    } else {
      this.log.info("re-sending persisted top-up authorization", { id, previous: action.state });
    }

    const url = `${this.base}/x402/top-up`;
    const res = await this.f(url, {
      method: "POST",
      headers: { ...action.paymentHeaders, accept: "application/json" },
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
    });
    const text = await res.text();
    const at = new Date().toISOString();

    if (res.ok) {
      this.log.info("top-up settled", { id, amountUsd });
      return await this.o.topups.put({ ...action, state: "SUCCESS", updatedAt: at, response: safeJson(text) });
    }
    if (res.status >= 500 || res.status === 429) {
      // Unknown outcome: keep SIGNED so the next call re-sends the same authorization.
      throw new HttpError(res.status, text, url);
    }
    // Rejected. Recorded as FAILED, but not final: the next call re-sends this same
    // authorization while it's valid, then signs a fresh one after it expires.
    const failed = await this.o.topups.put({
      ...action,
      state: "FAILED",
      updatedAt: at,
      error: { code: `VENICE_TOPUP_${res.status}`, message: text.slice(0, 500) },
    });
    throw new RailError(failed.error!.code, `Venice rejected top-up: ${text.slice(0, 300)}`);
  }

  private async signTopUp(id: string, amountUsd: number): Promise<TopUpAction> {
    const url = `${this.base}/x402/top-up`;
    // Step 1: unauthenticated POST -> 402 with PAYMENT-REQUIRED (the payment terms are the source of truth).
    const init = await this.f(url, { method: "POST", signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000) });
    const initText = await init.text();
    if (init.status !== 402) throw new HttpError(init.status, initText, url);

    const http = new x402HTTPClient(this.buildX402Client(amountUsd));
    const required = http.getPaymentRequiredResponse((n) => init.headers.get(n), safeJson(initText));
    const req = pickBaseUsdc(required);
    const payTo = (this.o.payTo ?? VENICE_PAY_TO).toLowerCase();
    if (req.payTo.toLowerCase() !== payTo) {
      throw new RailError("UNEXPECTED_PAY_TO", `Venice asked for payment to ${req.payTo}, not its known address ${payTo}. Refusing to sign.`);
    }

    const atomic = BigInt(Math.round(amountUsd * 1e6));
    if (atomic < BigInt(req.amount)) {
      throw new RailError("BELOW_MIN_TOPUP", `Venice minimum is ${Number(req.amount) / 1e6} USDC`, { required: req.amount });
    }
    // Venice lets the payer choose the amount (>= the advertised one), per its docs example.
    const chosen: PaymentRequired = { ...required, accepts: [{ ...req, amount: atomic.toString() }] };
    const payload: PaymentPayload = await http.createPaymentPayload(chosen);
    const headers = http.encodePaymentSignatureHeader(payload);

    const auth = (payload.payload as { authorization?: { validBefore?: string } }).authorization;
    const validBefore = Number(auth?.validBefore ?? Math.floor(Date.now() / 1000) + req.maxTimeoutSeconds);
    const now = new Date().toISOString();
    this.log.info("signed top-up authorization", { id, amountUsd, payTo: req.payTo, validBefore });
    // Persist BEFORE sending.
    return await this.o.topups.put({
      id,
      kind: "venice_topup",
      createdAt: now,
      updatedAt: now,
      state: "SIGNED",
      amountUsd,
      payTo: req.payTo,
      paymentHeaders: headers,
      validBefore,
    });
  }

  private buildX402Client(amountUsd: number): x402Client {
    return x402Client.fromConfig({
      schemes: [{ network: BASE_NETWORK, client: new ExactEvmScheme(this.o.account as never) }],
      // The SDK default caps payments at $1; allow up to our own (smaller-or-equal) cap.
      spendControls: { maxAmountPerPayment: `$${Math.min(amountUsd, this.o.maxTopUpUsd)}` },
    });
  }

  private async authed<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.base}${path.split("?")[0]}`;
    const fullUrl = `${this.base}${path}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      "SIGN-IN-WITH-X": await createSiwxHeader(this.o.account, url), // fresh, single-use
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await this.f(fullUrl, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 120_000),
    });
    const remaining = res.headers.get("x-balance-remaining");
    if (remaining !== null && !Number.isNaN(Number(remaining))) this.lastBalanceUsd = Number(remaining);
    const text = await res.text();
    if (res.status === 402) throw new VeniceInsufficientBalance(text);
    if (!res.ok) throw new HttpError(res.status, text, fullUrl);
    return JSON.parse(text) as T;
  }
}

function pickBaseUsdc(required: PaymentRequired): PaymentRequirements {
  const req = required.accepts.find(
    (a) => a.scheme === "exact" && a.network === BASE_NETWORK && a.asset.toLowerCase() === BASE_USDC,
  );
  if (!req) {
    throw new RailError("NO_BASE_OPTION", "Venice did not offer an exact USDC-on-Base payment option", {
      accepts: required.accepts.map((a) => `${a.scheme}/${a.network}/${a.asset}`),
    });
  }
  return req;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface ChatCompletion {
  id?: string;
  model?: string;
  choices: Array<{ message: { role: string; content: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
