import "server-only";
import { findModel } from "@pay/rail/browser";
import { b64url, randomBytes, sha256Hex } from "./crypto.ts";
import { kv } from "./kv.ts";

/**
 * Venice-style API keys: random `nsk_…` tokens, stored only as SHA-256 hashes,
 * each with a name, optional spend limits (per UTC day / total), an optional
 * model allowlist and expiry. Spend is metered per key from real usage.
 */
export interface KeyLimits {
  dailyUsd?: number;
  totalUsd?: number;
}

export interface KeyRecord {
  id: string;
  uid: string;
  name: string;
  /** First characters of the token, for display ("nsk_ab12…"). */
  prefix: string;
  hash: string;
  createdAt: number;
  expiresAt?: number;
  limits: KeyLimits;
  /** Model keys allowed; empty = all allowed models. */
  models: string[];
  lastUsedAt?: number;
}

export interface KeyView extends Omit<KeyRecord, "hash" | "uid"> {
  spentTodayUsd: number;
  spentTotalUsd: number;
}

export class KeyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MAX_KEYS = 20;
const RATE_PER_MIN = 60;
const today = () => new Date().toISOString().slice(0, 10);

export function validateInput(input: { name?: unknown; limits?: unknown; models?: unknown; expiresAt?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  const lim = (input.limits ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const limits: KeyLimits = { dailyUsd: num(lim.dailyUsd), totalUsd: num(lim.totalUsd) };
  for (const v of Object.values(limits)) {
    if (v !== undefined && !(Number.isFinite(v) && v > 0 && v <= 10_000)) throw new KeyError(400, "bad_limit", "Limits must be positive dollar amounts.");
  }
  const models = Array.isArray(input.models) ? input.models.filter((m): m is string => typeof m === "string") : [];
  const unknown = models.filter((m) => !findModel(m));
  if (unknown.length) throw new KeyError(400, "bad_model", `Unknown models: ${unknown.join(", ")}`);
  const expiresAt = num(input.expiresAt);
  if (expiresAt !== undefined && !(expiresAt > Date.now())) throw new KeyError(400, "bad_expiry", "Expiry must be in the future.");
  return { name: name || "Untitled key", limits, models, expiresAt };
}

export async function createKey(uid: string, input: Parameters<typeof validateInput>[0]): Promise<{ token: string; key: KeyView }> {
  const v = validateInput(input);
  // One create at a time per user, so concurrent requests can't race past the cap.
  const lock = `keylock:${uid}`;
  if (!(await kv().set(lock, 1, { nx: true, ex: 10 }))) throw new KeyError(409, "busy", "Another key is being created. Try again.");
  try {
    return await insertKey(uid, v);
  } finally {
    await kv().del(lock);
  }
}

async function insertKey(uid: string, v: ReturnType<typeof validateInput>): Promise<{ token: string; key: KeyView }> {
  if ((await kv().smembers(`ukeys:${uid}`)).length >= MAX_KEYS) throw new KeyError(400, "too_many", `At most ${MAX_KEYS} keys.`);
  const token = `nsk_${b64url(randomBytes(30))}`;
  const rec: KeyRecord = {
    id: b64url(randomBytes(9)),
    uid,
    name: v.name,
    prefix: token.slice(0, 10),
    hash: await sha256Hex(token),
    createdAt: Date.now(),
    expiresAt: v.expiresAt,
    limits: v.limits,
    models: v.models,
  };
  await kv().set(`key:${rec.id}`, rec);
  await kv().set(`keyhash:${rec.hash}`, rec.id);
  await kv().sadd(`ukeys:${uid}`, rec.id);
  return { token, key: view(rec, 0, 0) };
}

export async function listKeys(uid: string): Promise<KeyView[]> {
  const ids = await kv().smembers(`ukeys:${uid}`);
  if (!ids.length) return [];
  const recs = await kv().mget<KeyRecord>(...ids.map((id) => `key:${id}`));
  const spends = await kv().mget<number | string>(...ids.flatMap((id) => [`spend:${id}:${today()}`, `spend:${id}:total`, `lastused:${id}`]));
  return recs
    .map((r, i): KeyView | null =>
      r ? { ...view(r, Number(spends[3 * i] ?? 0), Number(spends[3 * i + 1] ?? 0)), lastUsedAt: Number(spends[3 * i + 2]) || undefined } : null,
    )
    .filter((k): k is KeyView => !!k)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateKey(uid: string, id: string, input: Parameters<typeof validateInput>[0]): Promise<void> {
  const rec = await own(uid, id);
  // Only re-validate the expiry if the caller is changing it (an expired key can still be renamed or re-limited).
  const changingExpiry = input.expiresAt !== undefined && input.expiresAt !== null;
  const v = validateInput({
    name: input.name ?? rec.name,
    limits: input.limits ?? rec.limits,
    models: input.models ?? rec.models,
    expiresAt: changingExpiry ? input.expiresAt : undefined,
  });
  const expiresAt = input.expiresAt === null ? undefined : changingExpiry ? v.expiresAt : rec.expiresAt;
  await kv().set(`key:${id}`, { ...rec, name: v.name, limits: v.limits, models: v.models, expiresAt } satisfies KeyRecord);
}

export async function deleteKey(uid: string, id: string): Promise<void> {
  const rec = await own(uid, id);
  await kv().del(`keyhash:${rec.hash}`, `key:${id}`, `lastused:${id}`);
  await kv().srem(`ukeys:${uid}`, id);
}

async function own(uid: string, id: string): Promise<KeyRecord> {
  const rec = await kv().get<KeyRecord>(`key:${id}`);
  if (!rec || rec.uid !== uid) throw new KeyError(404, "not_found", "Key not found.");
  return rec;
}

function view(r: KeyRecord, spentTodayUsd: number, spentTotalUsd: number): KeyView {
  const { hash: _h, uid: _u, ...rest } = r;
  return { ...rest, spentTodayUsd, spentTotalUsd };
}

/** Resolve a bearer token and enforce expiry, model allowlist, spend limits and rate. */
export async function authorize(token: string, modelKey: string | null): Promise<KeyRecord> {
  // null = "no model" (the models list); anything else must be one of our model keys.
  if (modelKey !== null && !findModel(modelKey)) throw new KeyError(400, "unknown_model", "Unknown model.");
  if (!/^nsk_[A-Za-z0-9_-]{30,60}$/.test(token)) throw new KeyError(401, "invalid_key", "Invalid API key.");
  const id = await kv().get<string>(`keyhash:${await sha256Hex(token)}`);
  const rec = id ? await kv().get<KeyRecord>(`key:${id}`) : null;
  if (!rec) throw new KeyError(401, "invalid_key", "Invalid or deleted API key.");
  if (rec.expiresAt && Date.now() > rec.expiresAt) throw new KeyError(401, "expired_key", "This API key has expired.");
  if (modelKey !== null && rec.models.length && !rec.models.includes(modelKey)) {
    throw new KeyError(403, "model_not_allowed", `This key isn't allowed to use ${modelKey}. Allowed: ${rec.models.join(", ")}`);
  }
  // Spend counters and the rate-limit counter in one round trip.
  const rl = `rl:${rec.id}:${Math.floor(Date.now() / 60_000)}`;
  const [[day, total], n] = await Promise.all([
    kv().mget<number | string>(`spend:${rec.id}:${today()}`, `spend:${rec.id}:total`),
    kv().incr(rl),
    kv().expire(rl, 120),
  ]);
  if (rec.limits.dailyUsd !== undefined && Number(day ?? 0) >= rec.limits.dailyUsd) {
    throw new KeyError(429, "daily_limit", `Daily limit of $${rec.limits.dailyUsd} reached for this key.`);
  }
  if (rec.limits.totalUsd !== undefined && Number(total ?? 0) >= rec.limits.totalUsd) {
    throw new KeyError(429, "total_limit", `Total limit of $${rec.limits.totalUsd} reached for this key.`);
  }
  // Fixed window; the key name carries the minute, so a missed expire can't stretch the window.
  if (n > RATE_PER_MIN) throw new KeyError(429, "rate_limited", `More than ${RATE_PER_MIN} requests per minute on this key.`);
  return rec;
}

/** Called after the body is parsed; the key itself is checked before reading the body. */
export function assertModelAllowed(rec: KeyRecord, modelKey: string): void {
  if (rec.models.length && !rec.models.includes(modelKey)) {
    throw new KeyError(403, "model_not_allowed", `This key isn't allowed to use ${modelKey}. Allowed: ${rec.models.join(", ")}`);
  }
}

/**
 * Add to a key's spend. Positive = charge; negative = correct a reservation
 * that turned out too high. Pass the `day` returned by the reservation so the
 * correction lands on the same UTC day, even after midnight. (Requests already
 * in flight when a limit is crossed can still overshoot it; the next one is refused.)
 */
export async function recordSpend(rec: KeyRecord, usd: number, day = today()): Promise<string> {
  if (!Number.isFinite(usd) || usd === 0) return day;
  const dayKey = `spend:${rec.id}:${day}`;
  // Independent writes: one round trip instead of four (each is ~ms on Vercel, but adds up from far away).
  await Promise.all([
    kv().incrbyfloat(dayKey, usd),
    kv().expire(dayKey, 3 * 24 * 3600),
    kv().incrbyfloat(`spend:${rec.id}:total`, usd),
    kv().set(`lastused:${rec.id}`, Date.now()),
  ]);
  return day;
}
