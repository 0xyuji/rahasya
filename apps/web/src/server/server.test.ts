import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getBase58Decoder } from "@solana/kit";
import { open, seal } from "./crypto.ts";
import { setKvForTests, type KV } from "./kv.ts";
import { KeyError, authorize, createKey, deleteKey, listKeys, recordSpend, updateKey } from "./keys.ts";
import { createChallenge, verifyLogin } from "./login.ts";

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
