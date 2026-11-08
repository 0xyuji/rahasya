import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getBase58Decoder } from "@solana/kit";
import { open, seal } from "./crypto.ts";
import { setKvForTests, type KV } from "./kv.ts";
import { KeyError, authorize, createKey, deleteKey, listKeys, recordSpend, updateKey } from "./keys.ts";
import { createChallenge, createSession, endSession, nep413Hash, sessionCookie, sessionUser, verifyLogin } from "./login.ts";
import { checkBody, reserve, resolveModel as resolveGatewayModel, veniceParams } from "./gateway.ts";
import { sweepToCredit } from "./api-wallet.ts";
import { VENICE_PAY_TO } from "@pay/rail/browser";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { parseSiweMessage } from "viem/siwe";

process.env.API_WALLET_ENC_KEY = Buffer.alloc(32, 7).toString("base64");

/** Minimal in-memory Redis with the operations the server uses (TTLs ignored). */
function fakeKv(): KV & { dump: Map<string, unknown> } {
  const m = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();
  return {
    dump: m,
    async get<T>(k: string) {
      return (m.has(k) ? structuredClone(m.get(k)) : null) as T | null;
    },
    async getdel<T>(k: string) {
      const v = (m.has(k) ? structuredClone(m.get(k)) : null) as T | null;
      m.delete(k);
      return v;
    },
    async set(k, v, o) {
      if (o?.nx && m.has(k)) return null;
      m.set(k, structuredClone(v));
      return "OK";
    },
    async del(...ks) {
      let n = 0;
      for (const k of ks) n += Number(m.delete(k) || sets.delete(k));
      return n;
    },
    async incrbyfloat(k, by) {
      const v = Number(m.get(k) ?? 0) + by;
      m.set(k, v);
      return v;
    },
    async incr(k) {
      const v = Number(m.get(k) ?? 0) + 1;
      m.set(k, v);
      return v;
    },
    async expire() {
      return 1;
    },
    async sadd(k, v) {
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(v);
      return 1;
    },
    async srem(k, v) {
      return Number(sets.get(k)?.delete(v) ?? false);
    },
    async smembers(k) {
      return [...(sets.get(k) ?? [])];
    },
    async mget<T>(...ks: string[]) {
      return ks.map((k) => (m.has(k) ? structuredClone(m.get(k)) : null)) as Array<T | null>;
    },
  };
}

let store: ReturnType<typeof fakeKv>;
beforeEach(() => {
  store = fakeKv();
  setKvForTests(store);
});

test("tokens are shown once and stored only as a hash", async () => {
  const { token, key } = await createKey("evm:0xabc", { name: "opencode" });
  assert.match(token, /^nsk_/);
  assert.ok(!JSON.stringify([...store.dump]).includes(token), "plaintext token must never be stored");
  assert.equal(key.prefix, token.slice(0, 10));
  assert.equal((await authorize(token, "large-v2")).id, key.id);
});

test("wrong, deleted and expired keys are refused", async () => {
  await assert.rejects(authorize("nsk_" + "x".repeat(40), null), (e: KeyError) => e.status === 401);
  const { token, key } = await createKey("evm:0xabc", { name: "a" });
  await deleteKey("evm:0xabc", key.id);
  await assert.rejects(authorize(token, null), (e: KeyError) => e.code === "invalid_key");
  const b = await createKey("evm:0xabc", { name: "b", expiresAt: Date.now() + 60_000 });
  const rec = (await store.get<{ expiresAt: number }>(`key:${b.key.id}`))!;
  await store.set(`key:${b.key.id}`, { ...rec, expiresAt: Date.now() - 1 });
  await assert.rejects(authorize(b.token, null), (e: KeyError) => e.code === "expired_key");
});

test("model allowlist is enforced", async () => {
  const { token } = await createKey("evm:0xabc", { name: "rp", models: ["venice-roleplay"] });
  await authorize(token, "venice-roleplay");
  await assert.rejects(authorize(token, "large-v2"), (e: KeyError) => e.code === "model_not_allowed");
  await assert.rejects(createKey("evm:0xabc", { name: "x", models: ["gpt-4o"] }), (e: KeyError) => e.code === "bad_model");
});

test("daily and total spend limits stop the key once reached", async () => {
  const { token, key } = await createKey("evm:0xabc", { name: "capped", limits: { dailyUsd: 1, totalUsd: 2 } });
  const rec = await authorize(token, null);
  await recordSpend(rec, 0.6);
  await authorize(token, null);
  await recordSpend(rec, 0.5);
  await assert.rejects(authorize(token, null), (e: KeyError) => e.code === "daily_limit");
  const [k] = await listKeys("evm:0xabc");
  assert.ok(Math.abs(k!.spentTodayUsd - 1.1) < 1e-9 && Math.abs(k!.spentTotalUsd - 1.1) < 1e-9);
  // Raising the daily limit lets it through again until the total cap.
  await updateKey("evm:0xabc", key.id, { limits: { dailyUsd: 10, totalUsd: 2 } });
  await authorize(token, null);
  await recordSpend(rec, 1);
  await assert.rejects(authorize(token, null), (e: KeyError) => e.code === "total_limit");
});

test("a user can't edit or delete someone else's key", async () => {
  const { key } = await createKey("evm:0xabc", { name: "mine" });
  await assert.rejects(deleteKey("sol:Someone", key.id), (e: KeyError) => e.status === 404);
  await assert.rejects(updateKey("sol:Someone", key.id, { name: "pwned" }), (e: KeyError) => e.status === 404);
});

test("API wallet keys are sealed per user (wrong user id can't decrypt)", async () => {
  const sealed = await seal("0xdeadbeef", "aw:evm:0xabc");
  assert.equal(await open(sealed, "aw:evm:0xabc"), "0xdeadbeef");
  await assert.rejects(open(sealed, "aw:evm:0xother"));
});

test("Solana sign-in: valid signature passes once; replay and wrong wallet fail", async () => {
  const u = ed25519.utils as unknown as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const sk = (u.randomSecretKey ?? u.randomPrivateKey)!();
  const address = getBase58Decoder().decode(ed25519.getPublicKey(sk));
  const chal = await createChallenge("https://example.test", "sol", address);
  const signature = Buffer.from(ed25519.sign(new TextEncoder().encode(chal.message), sk)).toString("base64");
  assert.equal(await verifyLogin({ challengeId: chal.id, chain: "sol", address, signature }), `sol:${address}`);
  await assert.rejects(verifyLogin({ challengeId: chal.id, chain: "sol", address, signature }), /expired/);

  const chal2 = await createChallenge("https://example.test", "sol", address);
  const other = getBase58Decoder().decode(ed25519.getPublicKey((u.randomSecretKey ?? u.randomPrivateKey)!()));
  await assert.rejects(verifyLogin({ challengeId: chal2.id, chain: "sol", address: other, signature }), /doesn't match/);
});

// ---------- 2026-11-08 audit regressions (audit-kit/03-known-issues.md) ----------

test("F-01: Object.prototype model names can't skip the allowlist", async () => {
  const { token } = await createKey("evm:0xabc", { name: "restricted", models: ["venice-roleplay"] });
  for (const m of ["constructor", "toString", "__proto__"]) {
    assert.equal(resolveGatewayModel(m), undefined, m);
    await assert.rejects(authorize(token, m), (e: KeyError) => e.status === 400 && e.code === "unknown_model");
  }
  await assert.rejects(createKey("evm:0xabc", { name: "x", models: ["constructor"] }), (e: KeyError) => e.code === "bad_model");
});

test("F-04: max_tokens is validated, and a reservation can never be negative", () => {
  for (const bad of [-1, 0, -10_000_000, 1.5, "-1", "100", 40_000]) assert.ok(checkBody({ max_tokens: bad }), `max_tokens ${String(bad)} must be refused`);
  assert.ok(checkBody({ max_completion_tokens: -5 }));
  assert.equal(checkBody({ max_tokens: 1 }), null);
  assert.equal(checkBody({ max_tokens: 32_768 }), null);
  assert.equal(checkBody({}), null);
  assert.ok(checkBody({ n: 4 }), "n > 1 would multiply unmetered output");
  const def = resolveGatewayModel("large-v2")!;
  for (const mt of [-10_000_000, Number.NaN, "abc", 0]) assert.ok(reserve(def, { messages: [], max_tokens: mt }, new Map()) >= 0);
});

test("F-05: only metered-safe venice_parameters are forwarded", () => {
  assert.deepEqual(veniceParams({ venice_parameters: { enable_web_search: "on", enable_web_scraping: true, disable_thinking: true, include_venice_system_prompt: true } }), {
    include_venice_system_prompt: false,
    disable_thinking: true,
  });
  assert.deepEqual(veniceParams({ venice_parameters: "nope" }), { include_venice_system_prompt: false });
});

test("F-09: a reservation's correction lands on the reservation's day, even after midnight", async () => {
  const { token, key } = await createKey("evm:0xabc", { name: "d", limits: { dailyUsd: 5 } });
  const rec = await authorize(token, null);
  const day = await recordSpend(rec, 1, "2026-11-08");
  await recordSpend(rec, -0.75, day); // corrected "after midnight"
  assert.ok(Math.abs(Number(await store.get(`spend:${key.id}:2026-11-08`)) - 0.25) < 1e-9);
  assert.equal(await store.get(`spend:${key.id}:2026-11-09`), null);
});

test("F-13: one sign-in proof submitted twice at once opens one session", async () => {
  const u = ed25519.utils as unknown as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const sk = (u.randomSecretKey ?? u.randomPrivateKey)!();
  const address = getBase58Decoder().decode(ed25519.getPublicKey(sk));
  const chal = await createChallenge("https://example.test", "sol", address);
  const signature = Buffer.from(ed25519.sign(new TextEncoder().encode(chal.message), sk)).toString("base64");
  const results = await Promise.allSettled([1, 2, 3].map(() => verifyLogin({ challengeId: chal.id, chain: "sol", address, signature })));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

test("F-13: concurrent key creation can't exceed the 20-key cap", async () => {
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => createKey("evm:0xcap", { name: `k${i}` })));
  assert.ok(results.some((r) => r.status === "fulfilled"));
  assert.ok((await store.smembers("ukeys:evm:0xcap")).length <= 20);
  for (let i = (await store.smembers("ukeys:evm:0xcap")).length; i < 20; i++) await createKey("evm:0xcap", { name: `fill${i}` });
  await assert.rejects(createKey("evm:0xcap", { name: "21st" }), (e: KeyError) => e.code === "too_many");
});

test("F-13: an expired key can still be renamed (expiry is only re-checked when changed)", async () => {
  const { key } = await createKey("evm:0xabc", { name: "old", expiresAt: Date.now() + 60_000 });
  const rec = (await store.get<{ expiresAt: number }>(`key:${key.id}`))!;
  await store.set(`key:${key.id}`, { ...rec, expiresAt: Date.now() - 1 });
  await updateKey("evm:0xabc", key.id, { name: "renamed" });
  const after = (await store.get<{ name: string; expiresAt: number }>(`key:${key.id}`))!;
  assert.equal(after.name, "renamed");
  assert.ok(after.expiresAt < Date.now(), "expiry kept, not silently cleared");
  await assert.rejects(updateKey("evm:0xabc", key.id, { expiresAt: Date.now() - 5 }), (e: KeyError) => e.code === "bad_expiry");
});

test("F-12: sign-in messages name our domain in the wallet-standard format", async () => {
  const evm = await createChallenge("https://naisho.example", "evm", "0x" + "ab".repeat(20));
  const parsed = parseSiweMessage(evm.message);
  assert.equal(parsed.domain, "naisho.example");
  assert.equal(parsed.uri, "https://naisho.example");
  assert.equal(parsed.chainId, 8453);
  assert.ok(parsed.expirationTime);
  const sol = await createChallenge("https://naisho.example", "sol", "So1anaAddress111");
  assert.match(sol.message, /^naisho\.example wants you to sign in with your Solana account:\nSo1anaAddress111\n/);
  const near = await createChallenge("https://naisho.example", "near", "alice.near");
  assert.equal(near.recipient, "naisho.example", "NEP-413 recipient is our host");
  await assert.rejects(createChallenge("https://naisho.example", "evm", "not-an-address"));
});

test("F-12: NEAR sign-in verifies against our host and requires a full-access key", async () => {
  const u = ed25519.utils as unknown as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const sk = (u.randomSecretKey ?? u.randomPrivateKey)!();
  const publicKey = `ed25519:${getBase58Decoder().decode(ed25519.getPublicKey(sk))}`;
  const realFetch = globalThis.fetch;
  let permission: unknown = "FullAccess";
  globalThis.fetch = (async () => Response.json({ jsonrpc: "2.0", id: 1, result: { permission } })) as typeof fetch;
  try {
    const sign = (c: Awaited<ReturnType<typeof createChallenge>>, recipient: string) =>
      Buffer.from(ed25519.sign(nep413Hash(c.message, Uint8Array.from(Buffer.from(c.nonce, "hex")), recipient), sk)).toString("base64");
    const c1 = await createChallenge("https://naisho.example", "near", "alice.near");
    assert.equal(await verifyLogin({ challengeId: c1.id, chain: "near", address: "alice.near", publicKey, signature: sign(c1, c1.recipient) }), "near:alice.near");
    const c2 = await createChallenge("https://naisho.example", "near", "alice.near");
    await assert.rejects(verifyLogin({ challengeId: c2.id, chain: "near", address: "alice.near", publicKey, signature: sign(c2, "evil.example") }), /Signature check failed/);
    permission = { FunctionCall: { receiver_id: "x.near", method_names: [] } };
    const c3 = await createChallenge("https://naisho.example", "near", "alice.near");
    await assert.rejects(verifyLogin({ challengeId: c3.id, chain: "near", address: "alice.near", publicKey, signature: sign(c3, c3.recipient) }), /Signature check failed/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("sessions: __Host- cookie over HTTPS; sign out everywhere ends every session", async () => {
  assert.match(sessionCookie("abc", true), /^__Host-sid=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.match(sessionCookie("abc", false), /^sid=abc;/);
  const a = await createSession("evm:0xabc");
  const b = await createSession("evm:0xabc");
  const req = (sid: string) => new Request("https://naisho.example/api/keys", { headers: { cookie: `__Host-sid=${sid}` } });
  assert.equal(await sessionUser(req(a)), "evm:0xabc");
  assert.equal(await sessionUser(new Request("https://naisho.example/", { headers: { cookie: `sid=${a}` } })), null, "plain sid isn't accepted over https");
  await endSession(req(a), true);
  assert.equal(await sessionUser(req(a)), null);
  assert.equal(await sessionUser(req(b)), null);
});

test("F-02: a second deposit of the same amount is credited again (sweep ids never repeat)", async () => {
  process.env.BASE_RPC_URL = "http://rpc.test";
  let usdc = 10_000_000n; // 10 USDC on the API wallet
  const payments: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("http://rpc.test")) {
      const body = JSON.parse(String(init?.body));
      const one = (r: { id: number }) => ({ jsonrpc: "2.0", id: r.id, result: "0x" + usdc.toString(16).padStart(64, "0") });
      return Response.json(Array.isArray(body) ? body.map(one) : one(body));
    }
    const sig = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    if (!sig) {
      const required = {
        x402Version: 2,
        resource: { url, description: "credit", mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "5000000", payTo: VENICE_PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }],
      };
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required as never) } });
    }
    payments.push(sig);
    usdc = 0n; // settled: the USDC left the wallet
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    assert.equal((await sweepToCredit("evm:0xsweep")).toppedUpUsd, 10);
    assert.equal((await sweepToCredit("evm:0xsweep")).toppedUpUsd, 0, "nothing left to sweep");
    usdc = 10_000_000n; // the user buys another $10 a day later
    assert.equal((await sweepToCredit("evm:0xsweep")).toppedUpUsd, 10);
    assert.equal(payments.length, 2, "both deposits were actually paid to Venice");
    assert.equal(new Set(payments).size, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});
