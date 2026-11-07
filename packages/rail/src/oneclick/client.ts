import { HttpError, withRetry } from "../util.ts";
import type { QuoteRequest, QuoteResponse, StatusResponse, TokenResponse } from "./types.ts";

export interface OneClickClientOptions {
  baseUrl?: string;
  /** Partner API key from partners.near-intents.org (sent as X-API-Key). */
  apiKey?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Thin typed client over the 1Click REST API. No business logic lives here. */
export class OneClickClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private tokenCache?: { at: number; tokens: TokenResponse[] };

  constructor(opts: OneClickClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://1click.chaindefuser.com").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    // Bound: browsers throw "Illegal invocation" if window.fetch is called as a method of another object.
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Supported tokens, cached for 60s (prices move; ids don't). */
  async tokens(opts: { maxAgeMs?: number } = {}): Promise<TokenResponse[]> {
    const maxAge = opts.maxAgeMs ?? 60_000;
    if (this.tokenCache && Date.now() - this.tokenCache.at < maxAge) return this.tokenCache.tokens;
    const tokens = await withRetry(() => this.req<TokenResponse[]>("GET", "/v0/tokens"));
    this.tokenCache = { at: Date.now(), tokens };
    return tokens;
  }

  /**
   * Request a quote. With dry=false this mints a deposit address; that's fine
   * to do before user confirmation since nothing moves until we deposit.
   * Not retried automatically on non-network errors: a 400 means our request is wrong.
   */
  quote(req: QuoteRequest): Promise<QuoteResponse> {
    return withRetry(() => this.req<QuoteResponse>("POST", "/v0/quote", req), { attempts: 3 });
  }

  status(depositAddress: string, depositMemo?: string): Promise<StatusResponse> {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set("depositMemo", depositMemo);
    return withRetry(() => this.req<StatusResponse>("GET", `/v0/status?${q}`));
  }

  /** Optional: tells 1Click about our deposit tx so it picks it up faster. */
  submitDeposit(args: { txHash: string; depositAddress: string; memo?: string; nearSenderAccount?: string }) {
    return withRetry(() => this.req<StatusResponse>("POST", "/v0/deposit/submit", args));
  }

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.apiKey) headers["X-API-Key"] = this.apiKey;
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, url);
    return JSON.parse(text) as T;
  }
}
