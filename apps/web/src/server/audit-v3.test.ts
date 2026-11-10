import { strict as assert } from "node:assert";
import { test } from "node:test";
import { HttpError, VeniceInsufficientBalance } from "@pay/rail/browser";
import { fakeKv } from "./fake-kv.test-helper.ts";
import { json, withUser } from "./http.ts";
import { setKvForTests } from "./kv.ts";
import { createSession } from "./login.ts";
import { collectStream, handleChat, meterStream, nothingGenerated, promptTokenBound, takeBodyBudget } from "./gateway.ts";

test("B-01: a reservation is released only when Venice can't have generated anything", () => {
  assert.equal(nothingGenerated(new VeniceInsufficientBalance("no credit")), true);
  assert.equal(nothingGenerated(new HttpError(400, "bad", "u")), true);
  assert.equal(nothingGenerated(Object.assign(new Error("attestation failed"), { beforeRequest: true })), true);
  assert.equal(nothingGenerated(new HttpError(524, "timeout", "u")), false);
  assert.equal(nothingGenerated(new DOMException("timed out", "TimeoutError")), false);
  assert.equal(nothingGenerated(new TypeError("network")), false);
});

test("K26: a streamed reply is assembled into the non-streamed shape, with usage and tool calls", async () => {
  const chunks = [
    { id: "c1", created: 7, choices: [{ delta: { role: "assistant", reasoning_content: "hm" } }] },
    { choices: [{ delta: { content: "Hel" } }] },
    { choices: [{ delta: { content: "lo" } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "get", arguments: '{"a"' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
  ];
  const sse = `${chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
  const out = (await collectStream(new Response(sse, { headers: { "content-type": "text/event-stream" } }))) as { id: string; usage: unknown; choices: Array<{ finish_reason: string; message: { content: string; reasoning_content: string; tool_calls: unknown } }> };
  assert.equal(out.id, "c1");
  assert.deepEqual(out.usage, { prompt_tokens: 3, completion_tokens: 2 });
  const c = out.choices[0]!;
  assert.equal(c.finish_reason, "tool_calls");
  assert.equal(c.message.content, "Hello");
  assert.equal(c.message.reasoning_content, "hm");
  assert.deepEqual(c.message.tool_calls, [{ id: "t1", type: "function", function: { name: "get", arguments: '{"a":1}' } }]);
});

const sse = (s: string) => new Response(s, { headers: { "content-type": "text/event-stream" } });

test("K26: an error inside the stream, or an empty one, is an error", async () => {
  await assert.rejects(collectStream(sse('data: {"error":{"message":"boom"}}\n\n')), (e: { noContent?: boolean }) => e.noContent === true);
  await assert.rejects(collectStream(sse("")));
});

test("K26: a reply cut off mid-stream is an error, never a short complete reply", async () => {
  const cut = 'data: {"choices":[],"usage":{"prompt_tokens":9}}\n\ndata: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
  await assert.rejects(collectStream(sse(cut)), (e: { noContent?: boolean; message: string }) => e.noContent === false && /cut off/.test(e.message));
});

test("K26: tool calls without index or type are assembled the way SDKs expect", async () => {
  const lines = [
    { id: "c", choices: [{ delta: { tool_calls: [{ id: "t1", function: { name: "f", arguments: "{" } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: "}" } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ];
  const out = (await collectStream(sse(lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("")))) as { created: number; choices: Array<{ message: { tool_calls: unknown; content: unknown } }> };
  assert.deepEqual(out.choices[0]!.message.tool_calls, [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }]);
  assert.equal(out.choices[0]!.message.content, null);
  assert.ok(out.created > 0);
});

test("a quick outage doesn't bill retries; a slow failure keeps the charge", () => {
  assert.equal(nothingGenerated(new HttpError(503, "down", "u"), 800), true);
  assert.equal(nothingGenerated(new TypeError("connect failed"), 800), true);
  assert.equal(nothingGenerated(new HttpError(503, "down", "u"), 30_000), false);
  assert.equal(nothingGenerated(new HttpError(524, "timeout", "u"), 800), false);
  assert.equal(nothingGenerated(new DOMException("timed out", "TimeoutError"), 800), false);
});

test("large bodies share a per-isolate budget; small ones are never refused", () => {
  const eight = 8 * 1024 * 1024;
  const held = [takeBodyBudget(eight, "a"), takeBodyBudget(eight, "b")];
  assert.ok(held.every(Boolean));
  assert.equal(takeBodyBudget(eight, "c"), null, "budget full");
  const small = takeBodyBudget(10_000, "a");
  assert.ok(small);
  small!();
  held.forEach((r) => r!());
  const again = takeBodyBudget(eight, "a");
  assert.ok(again);
  assert.equal(takeBodyBudget(eight, "a"), null, "one large body per key");
  again!();
});

test("B-02: a request without a valid key is refused before its body is read", async () => {
  let pulled = false;
  const body = new ReadableStream({ pull: () => void (pulled = true) }, { highWaterMark: 0 });
  const res = await handleChat(new Request("http://x/api/v1/chat/completions", { method: "POST", body, duplex: "half" } as RequestInit));
  assert.equal(res.status, 401);
  assert.equal(pulled, false);
});

test("B-03: the prompt bound covers everything forwarded", () => {
  const schema = "x".repeat(50_000);
  assert.ok(promptTokenBound({ messages: [], response_format: { type: "json_schema", json_schema: { schema } } }) >= 50_000);
});

test("B-05: usage on its own chunk after finish_reason is final, without waiting for [DONE]", async () => {
  const seen: Array<[unknown, boolean]> = [];
  const lines = ['data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', 'data: {"choices":[],"usage":{"completion_tokens":3}}'];
  const upstream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(`${lines.join("\n\n")}\n\n`));
    },
  });
  const reader = upstream.pipeThrough(meterStream(async (u, final) => void seen.push([u, final]))).getReader();
  await reader.read();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [[{ completion_tokens: 3 }, true]]);
});

test("R-02 still holds: usage before any finish_reason is a running total", async () => {
  const seen: boolean[] = [];
  const upstream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":9}}\n\n'));
    },
  });
  const reader = upstream.pipeThrough(meterStream(async (_u, final) => void seen.push(final))).getReader();
  await reader.read();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [false]);
});

test("K28: a request naming a different wallet than the session is refused", async () => {
  setKvForTests(fakeKv() as never);
  const sid = await createSession("evm:0xaaa");
  const req = (claimed?: string) =>
    new Request("https://rahasya.example/api/keys", { headers: { cookie: `__Host-sid=${sid}`, "x-app-request": "1", ...(claimed ? { "x-wallet-uid": claimed } : {}) } });
  const ok = async () => json(200, { ok: true });
  assert.equal((await withUser(req("evm:0xaaa"), ok)).status, 200);
  assert.equal((await withUser(req(), ok)).status, 200, "tools without the header (the probe, older tabs) still work");
  assert.equal((await withUser(req("evm:0xbbb"), ok)).status, 409);
});
