import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildContext, identity, type Msg } from "./conversation.ts";

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
  assert.deepEqual(ctx.map((m) => m.role), ["system", "user", "assistant", "user"]);
});

test("E2EE request sends no plaintext-role history: everything is user/system (encrypted)", () => {
  const history = [msg("user", "q1", "private"), msg("assistant", "a1", "private")];
  const ctx = buildContext(history, { text: "q2", mode: "private", modelKey: "deepseek-abliterated-tee" });
  assert.ok(ctx.every((m) => m.role === "user" || m.role === "system"), "assistant role would travel unencrypted");
  assert.match(ctx[0]!.content, /Assistant: a1/);
  assert.equal(ctx.filter((m) => m.role === "system").length, 1, "Venice rejects two system messages in a row on E2EE models");
  assert.match(ctx[0]!.content, /^You are /, "the identity line is kept");
  assert.equal(ctx.at(-1)!.content, "q2");
});

test("failed or stopped-empty replies are not replayed as context", () => {
  const history = [msg("user", "q1", "anonymous"), msg("assistant", "", "anonymous", "error")];
  const ctx = buildContext(history, { text: "q2", mode: "anonymous", modelKey: "large-v2" });
  assert.deepEqual(ctx.slice(1).map((m) => m.content), ["q1", "q2"]);
});

test("first private message: identity line + the user message, both encrypted roles", () => {
  const ctx = buildContext([], { text: "hi", mode: "private", modelKey: "gemma-4-26b-tee" });
  assert.deepEqual(ctx.map((m) => m.role), ["system", "user"]);
  assert.equal(ctx[1]!.content, "hi");
});

test("every request starts with a line telling the model what it is", () => {
  const tee = identity("deepseek-abliterated-tee")!;
  assert.match(tee, /^You are DeepSeek V4\.1 Flash 1017 Abliterated \(DeepSeek V4\.1 Flash 1017, abliterated\), served by Venice inside an attested hardware enclave/);
  assert.doesNotMatch(tee, /\(TEE\)|NEAR AI enclave/);
  assert.match(identity("large-v2")!, /^You are Abliterated Large V2 \(GLM-5\.3, abliterated \+ fine-tuned\), served by Venice and used through /);
  assert.match(identity("large-v2")!, /not ChatGPT/);
  assert.equal(identity("constructor"), null);
  const ctx = buildContext([], { text: "who are you?", mode: "anonymous", modelKey: "large-flash" });
  assert.equal(ctx[0]!.role, "system");
  assert.match(ctx[0]!.content, /Abliterated Large Flash/);
});
