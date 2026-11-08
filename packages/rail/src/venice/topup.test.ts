import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { RecordStore } from "../store.ts";
import { VENICE_PAY_TO, VeniceClient, type TopUpAction } from "./client.ts";

/**
 * x402 top-up idempotency (audit F-03, F-10) and payTo pinning, against a fake
 * Venice. Nothing touches the network; signing is local EIP-3009.
 */
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function fakeVenice(opts: { payTo?: string } = {}) {
  const calls = { offers: 0, payments: [] as string[] };
  let next: Array<[number, string]> = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const sig = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    if (!sig) {
      calls.offers++;
      const required = {
        x402Version: 2,
        resource: { url: "https://api.venice.ai/api/v1/x402/top-up", description: "credit", mimeType: "application/json" },
        accepts: [
          {
            scheme: "exact",
            network: "eip155:8453",
            asset: USDC,
            amount: "5000000",
            payTo: opts.payTo ?? VENICE_PAY_TO,
            maxTimeoutSeconds: 300,
            extra: { name: "USD Coin", version: "2" },
          },
        ],
      };
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(required as never) } });
    }
    calls.payments.push(sig);
    const [status, body] = next.shift() ?? [200, '{"ok":true}'];
    return new Response(body, { status });
  }) as typeof fetch;
  return { f, calls, respond: (...r: Array<[number, string]>) => (next = r) };
}

function memStore(): RecordStore<TopUpAction> & { m: Map<string, TopUpAction> } {
  const m = new Map<string, TopUpAction>();
  return { m, get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : undefined), put: async (r) => (m.set(r.id, structuredClone(r)), r) };
}

const realNow = Date.now;
afterEach(() => (Date.now = realNow));
const at = (sec: number) => (Date.now = () => sec * 1000);

function client(fake: ReturnType<typeof fakeVenice>, store = memStore()) {
  const venice = new VeniceClient({ account: privateKeyToAccount(generatePrivateKey()), topups: store, maxTopUpUsd: 50, fetch: fake.f });
  return { venice, store };
}

test("F-03: an unsettled authorization is re-sent until validBefore + margin, never re-signed early", async () => {
  const fake = fakeVenice();
  const { venice, store } = client(fake);
  const t0 = Math.floor(realNow() / 1000);
  at(t0);
  fake.respond([503, "busy"]);
  await assert.rejects(venice.topUp("t1", 5));
  const first = store.m.get("t1")!;
  assert.equal(first.state, "SIGNED");
  assert.equal(fake.calls.offers, 1);

  // 10 s before expiry, and 60 s after it: still the same authorization (the old code re-signed here).
  for (const when of [first.validBefore - 10, first.validBefore + 60]) {
    at(when);
    fake.respond([503, "busy"]);
    await assert.rejects(venice.topUp("t1", 5));
    assert.equal(fake.calls.offers, 1, `no new signature at validBefore${when - first.validBefore >= 0 ? "+" : ""}${when - first.validBefore}`);
  }
  assert.equal(new Set(fake.calls.payments).size, 1, "every attempt carried the same signature");

  // Provably expired: now a replacement is signed.
  at(first.validBefore + 121);
  await venice.topUp("t1", 5);
  assert.equal(fake.calls.offers, 2);
  assert.equal(new Set(fake.calls.payments).size, 2);
  assert.equal(store.m.get("t1")!.state, "SUCCESS");
});

test("F-10: a rejected top-up is retried with the same authorization and can still succeed", async () => {
  const fake = fakeVenice();
  const { venice, store } = client(fake);
  fake.respond([400, "insufficient USDC balance"]);
  await assert.rejects(venice.topUp("t2", 5), /rejected/);
  assert.equal(store.m.get("t2")!.state, "FAILED");
  fake.respond([200, '{"ok":true}']); // the USDC arrived meanwhile
  const done = await venice.topUp("t2", 5);
  assert.equal(done.state, "SUCCESS");
  assert.equal(fake.calls.offers, 1);
  assert.equal(new Set(fake.calls.payments).size, 1);
});

test("a finished top-up is never paid again", async () => {
  const fake = fakeVenice();
  const { venice } = client(fake);
  await venice.topUp("t3", 5);
  await venice.topUp("t3", 5);
  assert.equal(fake.calls.payments.length, 1);
});

test("payTo is pinned: a 402 asking to pay anyone else is refused before signing", async () => {
  const fake = fakeVenice({ payTo: "0x000000000000000000000000000000000000dEaD" });
  const { venice, store } = client(fake);
  await assert.rejects(venice.topUp("t4", 5), /UNEXPECTED_PAY_TO|Refusing to sign/);
  assert.equal(store.m.size, 0);
  assert.equal(fake.calls.payments.length, 0);
});
