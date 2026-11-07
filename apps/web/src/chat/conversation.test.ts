import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildContext, type Msg } from "./conversation.ts";

const msg = (role: Msg["role"], text: string, mode: Msg["mode"], status: Msg["status"] = "done"): Msg => ({
  id: Math.random().toString(36),
  role,
  text,
  mode,
  modelKey: mode === "private" ? "deepseek-abliterated-tee" : "large-v2",
  status,
});

test("anonymous request never carries messages from Truly private mode", () => {
  const history = [msg("user", "public q", "anonymous"), msg("assistant", "public a", "anonymous"), msg("user", "SECRET", "private"), msg("assistant", "SECRET REPLY", "private")];
  const ctx = buildContext(history, { text: "next", mode: "anonymous", modelKey: "large-v2" });
  const all = JSON.stringify(ctx);
  assert.ok(!all.includes("SECRET"), "private-mode content leaked into an anonymous request");
  assert.deepEqual(ctx.map((m) => m.role), ["user", "assistant", "user"]);
});

test("E2EE request sends no plaintext-role history: everything is user/system (encrypted)", () => {
  const history = [msg("user", "q1", "private"), msg("assistant", "a1", "private")];
  const ctx = buildContext(history, { text: "q2", mode: "private", modelKey: "deepseek-abliterated-tee" });
  assert.ok(ctx.every((m) => m.role === "user" || m.role === "system"), "assistant role would travel unencrypted");
  assert.match(ctx[0]!.content, /Assistant: a1/);
  assert.equal(ctx.at(-1)!.content, "q2");
});

test("failed or stopped-empty replies are not replayed as context", () => {
  const history = [msg("user", "q1", "anonymous"), msg("assistant", "", "anonymous", "error")];
  const ctx = buildContext(history, { text: "q2", mode: "anonymous", modelKey: "large-v2" });
  assert.deepEqual(ctx.map((m) => m.content), ["q1", "q2"]);
});

test("first private message is a single encrypted user message", () => {
  assert.deepEqual(buildContext([], { text: "hi", mode: "private", modelKey: "gemma-4-26b-tee" }), [{ role: "user", content: "hi" }]);
});
