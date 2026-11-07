import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { VeniceClient } from "@pay/rail";
import { createProxy, foldForE2ee } from "./server.ts";

const TOKEN = "nsk-test-token";
const calls: Array<Record<string, unknown>> = [];
const fakeVenice = {
  address: "0xabc",
  chat: async (body: Record<string, unknown>) => (calls.push(body), { choices: [{ message: { role: "assistant", content: "hi" } }] }),
  chatStream: async () => new Response("data: {}\n\n"),
  authHeaders: async () => ({}),
  models: async () => [],
} as unknown as VeniceClient;

const server = createProxy({ venice: fakeVenice, token: TOKEN });
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers }, body: JSON.stringify(body) });

test("rejects requests without the local token", async () => {
  const r = await fetch(`${base}/v1/models`);
  assert.equal(r.status, 401);
});

test("rejects browser-originated requests even with the token", async () => {
  const r = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" } });
  assert.equal(r.status, 403);
});

test("lists only the allowed models", async () => {
  const r = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const j = (await r.json()) as { data: Array<{ id: string; venice_id: string }> };
  assert.ok(j.data.find((m) => m.id === "large-v2"));
  assert.ok(j.data.every((m) => /uncensored|abliterat|qwen-3|role-play/.test(m.venice_id)));
});

test("unknown models are refused, not forwarded", async () => {
  const r = await post("/v1/chat/completions", { model: "gpt-4o", messages: [{ role: "user", content: "x" }] });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test("passthrough maps our model key to the Venice id and keeps tools", async () => {
  const r = await post("/v1/chat/completions", { model: "large-v2", messages: [{ role: "user", content: "x" }], tools: [{ type: "function" }] });
  assert.equal(r.status, 200);
  assert.equal(calls.at(-1)!.model, "abliteration-abliterated-model-large-v2");
  assert.ok(calls.at(-1)!.tools, "tools must be forwarded for agentic editors");
  assert.equal((calls.at(-1)!.venice_parameters as { include_venice_system_prompt: boolean }).include_venice_system_prompt, false);
});

test("E2EE fold: only user/system roles, latest user message last", () => {
  const out = foldForE2ee([
    { role: "system", content: "be terse" },
    { role: "user", content: "q1" },
    { role: "assistant", content: "a1" },
    { role: "tool", content: "tool output" },
    { role: "user", content: [{ type: "text", text: "q2" }] },
  ]);
  assert.ok(out.every((m) => m.role === "user" || m.role === "system"));
  assert.equal(out.at(-1)!.content, "q2");
  assert.match(out[0]!.content, /Assistant: a1/);
});
