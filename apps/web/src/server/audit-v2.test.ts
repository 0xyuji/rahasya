/**
 * Regression tests for the second audit (kit v2, report against af123f8), adapted from
 * the auditor's proofs so they assert the fixed behaviour. No network: fetch is stubbed.
 */
import { strict as assert } from "node:assert";
import { afterEach, beforeEach, test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { getBase58Decoder } from "@solana/kit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MODELS, VENICE_PAY_TO, planSweep, type TopUpAction } from "@pay/rail/browser";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import { setKvForTests } from "./kv.ts";
import { createKey } from "./keys.ts";
import { handleChat, meterStream, outputLimit, promptTokenBound, reserve } from "./gateway.ts";
import { cacheSize, remember } from "./pccs-cache.ts";
import { GET as pccsGet } from "../app/api/tee/pccs/[...path]/route.ts";
import { createChallenge, nep413Hash, verifyLogin } from "./login.ts";
import { sweepToCredit } from "./api-wallet.ts";
import { clientIp, overLimit, rateKey } from "./ratelimit.ts";
import { fromOurPage } from "./http.ts";
import { fakeKv } from "./fake-kv.test-helper.ts";

process.env.API_WALLET_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
const realFetch = globalThis.fetch;
const realNow = Date.now;
let store: ReturnType<typeof fakeKv>;
beforeEach(() => {
  store = fakeKv();
  setKvForTests(store);
  delete process.env.BASE_RPC_URL;
  delete process.env.NEAR_RPC_URL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const enc = new TextEncoder();
const urlOf = (input: RequestInfo | URL) => String(input instanceof Request ? input.url : input);

// ---------- V2-01: one output limit for the reservation and for Venice ----------

function stubVeniceChat(upstream: Array<Record<string, unknown>>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.includes("/models")) return Response.json({ data: [] });
    if (url.endsWith("/chat/completions")) {
      upstream.push(JSON.parse(String(init?.body)));
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(ctl) {
          if (i < 200) ctl.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"t${i++} "}}]}\n\n`));
          else {
            ctl.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":32768}}\n\ndata: [DONE]\n\n'));
            ctl.close();
          }
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}
const chat = (token: string, body: unknown) =>
  handleChat(new Request("http://localhost/api/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));

test("V2-01: max_tokens=1 + max_completion_tokens=32768: Venice gets one limit and the reservation covers it", async () => {
  const { token, key } = await createKey("evm:0xvictim", { name: "budget", limits: { totalUsd: 1 } });
  const upstream: Array<Record<string, unknown>> = [];
  stubVeniceChat(upstream);
  const messages = [{ role: "user", content: "write a very long story" }];
  const res = await chat(token, { model: "large-v2", stream: true, max_tokens: 1, max_completion_tokens: 32_768, messages });
  assert.equal(res.status, 200);
  assert.equal(upstream[0]!.max_tokens, upstream[0]!.max_completion_tokens, "both fields carry the same limit");
  const sent = upstream[0]!.max_tokens as number;

  const reader = res.body!.getReader();
  for (let n = 0; n < 20; n++) await reader.read();
  await reader.cancel(); // hang up before the usage chunk
  await new Promise((r) => setTimeout(r, 20));

  const charged = Number(store.dump.get(`spend:${key.id}:total`));
  const covering = reserve(MODELS["large-v2"]!, { max_tokens: sent, messages }, new Map());
  assert.equal(charged, covering, "the kept reservation is sized for exactly what Venice was allowed to generate");
});

test("V2-01: no limit from the client: Venice still gets the reserved limit (the model's max, capped)", async () => {
  const { token } = await createKey("evm:0xvictim", { name: "k" });
  const upstream: Array<Record<string, unknown>> = [];
  stubVeniceChat(upstream);
  const res = await chat(token, { model: "gemma-4-uncensored", stream: true, messages: [{ role: "user", content: "hi" }] });
  await res.body!.cancel();
  assert.equal(upstream[0]!.max_tokens, MODELS["gemma-4-uncensored"]!.maxOutputTokens);
  assert.equal(upstream[0]!.max_completion_tokens, MODELS["gemma-4-uncensored"]!.maxOutputTokens);
});

test("V2-01: outputLimit prefers max_completion_tokens and never exceeds the model's maximum", () => {
  const tee = MODELS["deepseek-abliterated-tee"]!;
  assert.equal(outputLimit(tee, { max_completion_tokens: 1 }), 1);
  assert.equal(outputLimit(tee, { max_tokens: 1, max_completion_tokens: 500 }), 500);
  assert.equal(outputLimit(MODELS["venice-roleplay"]!, { max_tokens: 30_000 }), 4_096);
  assert.equal(outputLimit(tee, {}), 32_768);
});

// ---------- V2-02: a lying RPC can't sign anyone in ----------

const TRUE32 = "0x" + "0".repeat(63) + "1";
const VICTIM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const GARBAGE_SIG = "0x" + "ab".repeat(65);
function stubRpc(handler: (url: string, body: { id: number; method: string }) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return handler(urlOf(input), body);
  }) as typeof fetch;
}

test("V2-02: a plain EVM signature is checked locally, with no RPC at all", async () => {
  stubRpc(() => {
    throw new Error("no RPC should be called");
  });
  const acct = privateKeyToAccount(generatePrivateKey());
  const c = await createChallenge("https://rahasya.chat", "evm", acct.address);
  const uid = await verifyLogin({ challengeId: c.id, chain: "evm", address: acct.address, signature: await acct.signMessage({ message: c.message }) });
  assert.equal(uid, `evm:${acct.address.toLowerCase()}`);
});

test("V2-02: one RPC lying 'valid' (others down) no longer signs in as the victim", async () => {
  stubRpc((url, b) => {
    if (url.includes("drpc")) return Response.json({ jsonrpc: "2.0", id: b.id, result: TRUE32 });
    return new Response("rate limited", { status: 429 });
  });
  const c = await createChallenge("https://rahasya.chat", "evm", VICTIM);
  await assert.rejects(verifyLogin({ challengeId: c.id, chain: "evm", address: VICTIM, signature: GARBAGE_SIG }), /Signature check failed/);
});

test("V2-02: smart-wallet check passes only when two endpoints agree and none disagrees", async () => {
  stubRpc((_u, b) => Response.json({ jsonrpc: "2.0", id: b.id, result: TRUE32 })); // all say valid
  const c1 = await createChallenge("https://rahasya.chat", "evm", VICTIM);
  assert.ok(await verifyLogin({ challengeId: c1.id, chain: "evm", address: VICTIM, signature: GARBAGE_SIG }));
  stubRpc((url, b) => Response.json({ jsonrpc: "2.0", id: b.id, result: url.includes("publicnode") ? "0x" + "0".repeat(64) : TRUE32 }));
  const c2 = await createChallenge("https://rahasya.chat", "evm", VICTIM);
  await assert.rejects(verifyLogin({ challengeId: c2.id, chain: "evm", address: VICTIM, signature: GARBAGE_SIG }), /Signature check failed/);
});

async function nearLogin() {
  const u = ed25519.utils as unknown as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const sk = (u.randomSecretKey ?? u.randomPrivateKey)!();
  const pub = `ed25519:${getBase58Decoder().decode(ed25519.getPublicKey(sk))}`;
  const c = await createChallenge("https://rahasya.chat", "near", "victim.near");
  const sig = ed25519.sign(nep413Hash(c.message, Uint8Array.from(Buffer.from(c.nonce, "hex")), c.recipient), sk);
  return verifyLogin({ challengeId: c.id, chain: "near", address: "victim.near", signature: Buffer.from(sig).toString("base64"), publicKey: pub });
}

test("V2-02: NEAR: one lying RPC isn't enough; two agreeing honest ones are; one 'unknown key' vetoes", async () => {
  const fullAccess = (b: { id: number }) => Response.json({ jsonrpc: "2.0", id: b.id, result: { permission: "FullAccess" } });
  stubRpc((url, b) => (url.includes("drpc") ? fullAccess(b) : new Response("busy", { status: 503 })));
  await assert.rejects(nearLogin(), /Signature check failed/);
  stubRpc((_u, b) => fullAccess(b));
  assert.equal(await nearLogin(), "near:victim.near");
  stubRpc((url, b) =>
    url.includes("fastnear") ? Response.json({ jsonrpc: "2.0", id: b.id, error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } }) : fullAccess(b),
  );
  await assert.rejects(nearLogin(), /Signature check failed/);
});

// ---------- V2-03: a stale balance read no longer wedges top-ups ----------

test("V2-03: after an over-large authorization expires, the next sweep credits the real balance", async () => {
  process.env.BASE_RPC_URL = "http://rpc.test";
  const usd = (n: number) => BigInt(Math.round(n * 1e6));
  let onChain = usd(20);
  let rpcSays = onChain;
  const settled: bigint[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.startsWith("http://rpc.test")) {
      const body = JSON.parse(String(init?.body));
      const one = (r: { id: number }) => ({ jsonrpc: "2.0", id: r.id, result: "0x" + rpcSays.toString(16).padStart(64, "0") });
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
    const v = BigInt(JSON.parse(Buffer.from(sig, "base64").toString("utf8")).payload.authorization.value);
    if (v > onChain) return Response.json({ error: "transfer amount exceeds balance" }, { status: 400 });
    onChain -= v;
    settled.push(v);
    return Response.json({ ok: true });
  }) as typeof fetch;

  assert.equal((await sweepToCredit("evm:0xwedge")).toppedUpUsd, 20);
  rpcSays = usd(20); // lagging RPC still shows the old balance
  await assert.rejects(sweepToCredit("evm:0xwedge"), /rejected/i);
  onChain = usd(10);
  rpcSays = onChain;
  assert.equal((await sweepToCredit("evm:0xwedge")).toppedUpUsd, 0, "waits while the $20 authorization could still settle");
  Date.now = () => realNow() + 3600_000;
  assert.equal((await sweepToCredit("evm:0xwedge")).toppedUpUsd, 10, "after it expired, the real $10 is credited");
  assert.deepEqual(settled, [usd(20), usd(10)]);
});

test("V2-03: planSweep: re-send while affordable, wait while a larger one is live, fresh after it expired", () => {
  const rec = (amountUsd: number, validBefore: number, state: TopUpAction["state"] = "FAILED") => ({ amountUsd, validBefore, state }) as TopUpAction;
  assert.deepEqual(planSweep(undefined, 12, 100), { kind: "fresh", amountUsd: 12 });
  assert.deepEqual(planSweep(rec(10, 1000), 12, 100, 900), { kind: "resend", amountUsd: 10 });
  assert.deepEqual(planSweep(rec(20, 1000), 10, 100, 1100), { kind: "wait" });
  assert.deepEqual(planSweep(rec(20, 1000), 10, 100, 1121), { kind: "fresh", amountUsd: 10 });
});

// ---------- V2-04: rate limits per /64 ----------

test("V2-04: one IPv6 /64 shares a bucket, so rotating addresses doesn't help", async () => {
  const req = (ip: string) => new Request("https://rahasya.chat/api/oneclick/v0/quote", { method: "POST", headers: { "cf-connecting-ip": ip } });
  let refused = 0;
  for (let i = 0; i < 100; i++) if (await overLimit(req(`2001:db8:1:2::${(i + 1).toString(16)}`), "1c:v0/quote", 20)) refused++;
  assert.equal(refused, 80);
  assert.equal(await overLimit(req("2001:db8:1:3::1"), "1c:v0/quote", 20), false, "another /64 is another client");
});

test("V2-04: rateKey normalizes IPv6 to its /64 and leaves IPv4 alone", () => {
  assert.equal(rateKey("2001:db8:1:2::1"), "2001:db8:1:2::/64");
  assert.equal(rateKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assert.equal(rateKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(rateKey("::1"), "0:0:0:0::/64");
  assert.equal(rateKey("203.0.113.7"), "203.0.113.7");
});

test("V2-04: in production, client-sent x-forwarded-for / x-real-ip are ignored", () => {
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    assert.equal(clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6" } })), "unknown");
    assert.equal(clientIp(new Request("http://x/", { headers: { "cf-connecting-ip": "1.2.3.4" } })), "1.2.3.4");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
});

// ---------- V2-05: running usage totals ----------

test("V2-05: running totals are reported as running; the final total settles", async () => {
  const seen: Array<{ tokens: number; final: boolean }> = [];
  const upstream = new ReadableStream<Uint8Array>({
    start(ctl) {
      for (let i = 1; i <= 50; i++) ctl.enqueue(enc.encode(`data: {"choices":[{"delta":{"content":"t"}}],"usage":{"prompt_tokens":10,"completion_tokens":${i}}}\n\n`));
      ctl.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":50}}\n\ndata: [DONE]\n\n'));
      ctl.close();
    },
  });
  await new Response(upstream.pipeThrough(meterStream(async (u, final) => void seen.push({ tokens: (u as { completion_tokens: number }).completion_tokens, final })))).text();
  assert.equal(seen.filter((s) => s.final).length, 1, "settles exactly once");
  assert.deepEqual(seen.at(-1), { tokens: 50, final: true });
  assert.ok(seen.slice(0, -1).every((s) => !s.final));
});

test("R-02: an early choices:[] usage chunk (prompt count only) is a running total, not final", async () => {
  const seen: Array<{ tokens: number; final: boolean }> = [];
  const upstream = new ReadableStream<Uint8Array>({
    start(ctl) {
      ctl.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":0}}\n\n'));
      ctl.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
      ctl.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":400}}\n\ndata: [DONE]\n\n'));
      ctl.close();
    },
  });
  await new Response(upstream.pipeThrough(meterStream(async (u, final) => void seen.push({ tokens: (u as { completion_tokens: number }).completion_tokens, final })))).text();
  assert.deepEqual(seen.at(-1), { tokens: 400, final: true }, "settles on the last usage at [DONE]");
  assert.equal(seen[0]!.final, false);
  assert.equal(seen.filter((x) => x.final).length, 1);
});

test("V2-05: usage on the finishing chunk (non-empty choices) counts as final", async () => {
  const seen: boolean[] = [];
  const upstream = new ReadableStream<Uint8Array>({
    start(ctl) {
      ctl.enqueue(enc.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n'));
    }, // never closes: the client hangs up after this
  });
  const reader = upstream.pipeThrough(meterStream(async (_u, final) => void seen.push(final))).getReader();
  await reader.read();
  await new Promise((r) => setTimeout(r, 5));
  await reader.cancel();
  assert.deepEqual(seen, [true]);
});

// ---------- R-01: the prompt half of the reservation is an upper bound ----------

test("R-01: a 30k-character Yi prompt reserves at least its UTF-8 byte count in prompt tokens", () => {
  const def = MODELS["large-v2"]!;
  const messages = [{ role: "user", content: "\uA000".repeat(30_000) }];
  const held = reserve(def, { max_tokens: 1, messages }, new Map());
  const promptTokens = Math.round((held * 1e6 - def.fallbackPrice.out) / def.fallbackPrice.in);
  assert.ok(promptTokens >= new TextEncoder().encode(JSON.stringify(messages)).length);
});

test("R-01: tool definitions and image parts count toward the prompt bound", () => {
  const text = [{ role: "user", content: "hi" }];
  const withImage = [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://x/a.png" } }] }];
  assert.ok(promptTokenBound({ messages: withImage }) >= 4_096);
  const tools = [{ type: "function", function: { name: "read_file", description: "x".repeat(5_000), parameters: {} } }];
  assert.ok(promptTokenBound({ messages: text, tools }) > promptTokenBound({ messages: text }) + 5_000);
});

// ---------- Info notes ----------

test("rateKey: IPv4-mapped IPv6 is bucketed as its IPv4 address", () => {
  assert.equal(rateKey("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(rateKey("::FFFF:1.2.3.4"), "1.2.3.4");
});

test("passthrough drops max_output_tokens so no alias competes with our limit", async () => {
  const { token } = await createKey("evm:0xvictim", { name: "k" });
  const upstream: Array<Record<string, unknown>> = [];
  stubVeniceChat(upstream);
  const res = await chat(token, { model: "gemma-4-uncensored", stream: true, max_tokens: 5, max_output_tokens: 999_999, messages: [{ role: "user", content: "hi" }] });
  await res.body!.cancel();
  assert.equal("max_output_tokens" in upstream[0]!, false);
  assert.equal(upstream[0]!.max_tokens, 5);
});

// ---------- V2-07: late spend writes are registered with waitUntil ----------

test("V2-07: the spend settlement is handed to the request's ctx.waitUntil", async () => {
  const { token } = await createKey("evm:0xvictim", { name: "k" });
  const upstream: Array<Record<string, unknown>> = [];
  stubVeniceChat(upstream);
  const registered: Promise<unknown>[] = [];
  const sym = Symbol.for("__cloudflare-context__");
  (globalThis as Record<symbol, unknown>)[sym] = { ctx: { waitUntil: (p: Promise<unknown>) => void registered.push(p) } };
  try {
    const res = await chat(token, { model: "gemma-4-uncensored", stream: true, max_tokens: 5, messages: [{ role: "user", content: "hi" }] });
    await res.text();
    assert.ok(registered.length >= 1, "the settle write was registered");
    await Promise.all(registered);
  } finally {
    delete (globalThis as Record<symbol, unknown>)[sym];
  }
});

// ---------- V2-06: the Intel collateral cache ----------

test("V2-06: fmspc case variants share one upstream fetch, and the cache is bounded", async () => {
  let upstreamCalls = 0;
  globalThis.fetch = (async () => {
    upstreamCalls++;
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as typeof fetch;
  const get = (fmspc: string) =>
    pccsGet(new Request(`http://localhost/api/tee/pccs/tdx/certification/v4/tcb?fmspc=${fmspc}`), { params: Promise.resolve({ path: ["tdx", "certification", "v4", "tcb"] }) });
  assert.equal((await get("00906ed50000")).status, 200);
  assert.equal((await get("00906ED50000")).status, 200);
  assert.equal(upstreamCalls, 1, "one cache entry for both spellings");
  for (let i = 0; i < 35; i++) remember(`test-entry-${i}`, { at: Date.now(), status: 200, body: new ArrayBuffer(0), headers: {} });
  assert.ok(cacheSize() <= 32, `cache holds ${cacheSize()}`);
});

// ---------- T-02: cookie routes only answer the page's own fetch() ----------

test("T-02: fromOurPage needs our header, our origin, and a fetch (not a module/script load)", () => {
  const r = (headers: Record<string, string>, method = "GET") => new Request("https://rahasya.chat/api/keys", { method, headers });
  assert.equal(fromOurPage(r({ "x-app-request": "1" })), true, "same-origin GET fetch from our page");
  assert.equal(fromOurPage(r({ "x-app-request": "1", "sec-fetch-dest": "empty", origin: "https://rahasya.chat" }, "POST")), true);
  assert.equal(fromOurPage(r({})), false, "no header: e.g. import('/api/keys', { with: { type: 'json' } })");
  assert.equal(fromOurPage(r({ "x-app-request": "1", "sec-fetch-dest": "script" })), false, "a module/script load");
  assert.equal(fromOurPage(r({ "x-app-request": "1", "sec-fetch-dest": "json" })), false);
  assert.equal(fromOurPage(r({ "x-app-request": "1", origin: "https://evil.example" }, "POST")), false, "cross-site");
  assert.equal(fromOurPage(r({ "x-app-request": "0" })), false);
});

test("promptTokenBound counts UTF-8 bytes exactly (emoji, CJK, Yi, accents) without copying the body", () => {
  const messages = [{ role: "user", content: "héllo 世界 ꀀ 👋🏽 𝄞 plain" }];
  const tools = [{ type: "function", function: { name: "x", description: "ünïcödé 🚀" } }];
  const expected = new TextEncoder().encode(JSON.stringify(messages) + JSON.stringify(tools)).length;
  assert.equal(promptTokenBound({ messages, tools }), expected);
});
