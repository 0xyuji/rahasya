import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { VeniceClient } from "../venice/client.ts";
import { decryptStream } from "../venice/e2ee.ts";
import { VeniceChat } from "./chat.ts";

const CHUNK = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`;

/** An SSE response that never ends on its own, and records being hung up on. */
function endless() {
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull: (ctl) => ctl.enqueue(new TextEncoder().encode(CHUNK)),
    cancel: () => {
      state.cancelled = true;
    },
  });
  return { state, res: new Response(body) };
}

test("stopping early hangs up on Venice (anonymous), so it stops generating", async () => {
  const { state, res } = endless();
  let passed: AbortSignal | undefined;
  const venice = {
    chatStream: async (_b: unknown, _h: unknown, signal?: AbortSignal) => ((passed = signal), res),
    models: async () => [],
  };
  const ctl = new AbortController();
  const { deltas } = await new VeniceChat({ venice: venice as never }).stream({ mode: "anonymous", messages: [{ role: "user", content: "x" }], signal: ctl.signal });
  for await (const d of deltas) {
    assert.equal(d.type, "text");
    break;
  }
  assert.ok(state.cancelled, "the upstream response was left open");
  assert.equal(passed, ctl.signal, "Stop must reach the HTTP request");
});

test("the stream timeout limits silence, not the length of the reply; Stop still ends it", async () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let upstream: AbortSignal;
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (sent++ < 8) {
        await pause(10);
        ctl.enqueue(new TextEncoder().encode(CHUNK));
      } else await new Promise(() => {}); // then Venice goes quiet
    },
  });
  const client = (b: ReadableStream<Uint8Array>) =>
    new VeniceClient({
      account: privateKeyToAccount(generatePrivateKey()),
      topups: {} as never,
      maxTopUpUsd: 1,
      timeoutMs: 40,
      fetch: (async (_u: unknown, init: RequestInit) => ((upstream = init.signal!), new Response(b))) as typeof fetch,
    });

  const reader = (await client(body).chatStream({})).body!.getReader();
  for (let i = 0; i < 8; i++) await reader.read();
  assert.ok(!upstream!.aborted, "a reply longer than the timeout must keep going while chunks arrive");
  await pause(90);
  assert.ok(upstream!.aborted, "silence must still end the request");

  const stop = new AbortController();
  await client(new ReadableStream()).chatStream({}, {}, stop.signal);
  assert.ok(!upstream!.aborted);
  stop.abort();
  assert.ok(upstream!.aborted, "Stop must reach the request after headers arrive");
});

test("stopping early hangs up on Venice (Truly private stream)", async () => {
  const { state, res } = endless();
  for await (const _ of decryptStream(res, { clientPriv: new Uint8Array(32) } as never)) break;
  assert.ok(state.cancelled, "the upstream response was left open");
});

test("a keep-alive comment doesn't count as progress", async () => {
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let upstream: AbortSignal;
  let running = true;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      await pause(10);
      if (running) ctl.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
      else ctl.close();
    },
  });
  const client = new VeniceClient({
    account: privateKeyToAccount(generatePrivateKey()),
    topups: {} as never,
    maxTopUpUsd: 1,
    timeoutMs: 40,
    fetch: (async (_u: unknown, init: RequestInit) => ((upstream = init.signal!), new Response(body))) as typeof fetch,
  });
  const reader = (await client.chatStream({})).body!.getReader();
  void (async () => {
    while (!(await reader.read()).done);
  })();
  await pause(150);
  running = false;
  assert.ok(upstream!.aborted, "only data lines should reset the silence timer");
});

test("Stop doesn't wait for a hung attestation", async () => {
  const venice = { authHeaders: async () => ({}), models: async () => [] };
  const chat = new VeniceChat({ venice: venice as never });
  (chat as unknown as { attestation: () => Promise<never> }).attestation = () => new Promise(() => {});
  const stop = new AbortController();
  const pending = chat.stream({ mode: "private", messages: [{ role: "user", content: "x" }], signal: stop.signal });
  stop.abort();
  await assert.rejects(pending, (e: { name?: string }) => e.name === "AbortError");
});
