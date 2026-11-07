import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Deterministic action id: the same logical request always maps to the same id,
 * so a retried message / double-tapped button can't create a second action.
 */
export function actionId(prefix: string, ...parts: Array<string | number | bigint>): string {
  const h = bytesToHex(sha256(new TextEncoder().encode(parts.map(String).join("|")))).slice(0, 16);
  return `${prefix}_${h}`;
}

export function randomActionId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Decimal string -> smallest units, exact (no float math). */
export function toUnits(amount: string, decimals: number): bigint {
  const s = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`invalid decimal amount: "${amount}"`);
  const [whole, frac = ""] = s.split(".") as [string, string?];
  if (frac.length > decimals) throw new Error(`amount ${amount} has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Smallest units -> decimal string, exact. */
export function fromUnits(units: bigint | string, decimals: number): string {
  const v = BigInt(units);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export class RailError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "RailError";
    this.code = code;
    this.details = details;
  }
}

/** Retry transient failures (network, 5xx, 429) with exponential backoff. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; isRetryable?: (e: unknown) => boolean } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const isRetryable = opts.isRetryable ?? defaultRetryable;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i === attempts - 1 || !isRetryable(e)) break;
      await sleep(baseMs * 2 ** i + Math.floor(Math.random() * 200));
    }
  }
  throw lastErr;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, url: string) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 500)}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

function defaultRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status >= 500;
  if (e instanceof RailError) return false;
  // fetch network errors surface as TypeError
  return e instanceof TypeError || (e as { name?: string })?.name === "TimeoutError";
}
