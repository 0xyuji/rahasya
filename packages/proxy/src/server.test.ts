import { strict as assert } from "node:assert";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { VeniceClient } from "@pay/rail";
import { createProxy, foldForE2ee } from "./server.ts";

const TOKEN = "nsk-test-token-0123456789abcdefghijkl";
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

// ---------- 2026-11-08 audit regressions ----------

test("F-08: the proxy refuses to start with an empty or short token", () => {
  for (const token of ["", "short", "x".repeat(31)]) {
    assert.throws(() => createProxy({ venice: fakeVenice, token }), /at least 32/, JSON.stringify(token));
  }
});

test("F-08: an empty token file is replaced with a strong one", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "naisho-test-"));
  const prev = process.env.NAISHO_HOME;
  process.env.NAISHO_HOME = dir;
  try {
    writeFileSync(join(dir, "proxy-token"), "\n");
    const { loadOrCreateToken } = await import("./config.ts");
    const t = loadOrCreateToken();
    assert.ok(t.length >= 32);
    assert.equal(readFileSync(join(dir, "proxy-token"), "utf8").trim(), t);
  } finally {
    process.env.NAISHO_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("K14: DNS rebinding is refused (Host must be localhost / 127.0.0.1)", async () => {
  const { request } = await import("node:http");
  const port = (server.address() as AddressInfo).port;
  const status = (host: string) =>
    new Promise<number>((resolve, reject) => {
      const r = request({ host: "127.0.0.1", port, path: "/v1/models", headers: { host, authorization: `Bearer ${TOKEN}` } }, (res) => (res.resume(), resolve(res.statusCode!)));
      r.on("error", reject);
      r.end();
    });
  assert.equal(await status("attacker.example"), 403);
  assert.equal(await status(`attacker.example:${port}`), 403);
  assert.equal(await status(`127.0.0.1:${port}`), 200);
  assert.equal(await status(`localhost:${port}`), 200);
});
