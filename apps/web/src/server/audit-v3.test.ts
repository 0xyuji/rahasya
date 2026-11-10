import { strict as assert } from "node:assert";
import { test } from "node:test";
import { HttpError, VeniceInsufficientBalance } from "@pay/rail/browser";
import { handleChat, meterStream, nothingGenerated, promptTokenBound, takeBodyBudget } from "./gateway.ts";

test("B-01: a reservation is released only when Venice can't have generated anything", () => {
  assert.equal(nothingGenerated(new VeniceInsufficientBalance("no credit")), true);
  assert.equal(nothingGenerated(new HttpError(400, "bad", "u")), true);
  assert.equal(nothingGenerated(Object.assign(new Error("attestation failed"), { beforeRequest: true })), true);
  assert.equal(nothingGenerated(new HttpError(524, "timeout", "u")), false);
  assert.equal(nothingGenerated(new DOMException("timed out", "TimeoutError")), false);
  assert.equal(nothingGenerated(new TypeError("network")), false);
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
  const held = [takeBodyBudget(eight), takeBodyBudget(eight), takeBodyBudget(eight)];
  assert.ok(held.every(Boolean));
  assert.equal(takeBodyBudget(eight), null);
  const small = takeBodyBudget(10_000);
  assert.ok(small);
  small!();
  held.forEach((r) => r!());
  const again = takeBodyBudget(eight);
  assert.ok(again);
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
