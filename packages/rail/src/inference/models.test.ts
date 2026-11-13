import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fromUnits, toUnits } from "../util.ts";
import { MODELS, PRIVACY_MODES, modelsForMode, resolveModel } from "./models.ts";

test("private mode only offers TEE models, all E2EE", () => {
  const ms = modelsForMode("private");
  assert.ok(ms.length >= 2);
  for (const m of ms) {
    assert.equal(m.tier, "tee");
    assert.equal(m.e2ee, true);
    assert.ok(m.id.startsWith("e2ee-"));
  }
});

test("private mode refuses non-TEE models instead of downgrading", () => {
  assert.throws(() => resolveModel("private", "large-v2"), /not allowed/);
  assert.equal(resolveModel("anonymous", "large-v2").id, "abliteration-abliterated-model-large-v2");
});

test("mode defaults resolve", () => {
  for (const mode of Object.keys(PRIVACY_MODES) as Array<keyof typeof PRIVACY_MODES>) {
    resolveModel(mode, PRIVACY_MODES[mode].chatModel);
    resolveModel(mode, PRIVACY_MODES[mode].intentModel);
  }
});

test("policy: no standard models: every model is uncensored/abliterated/heretic or a known uncensored family", () => {
  const allowedHint = /uncensored|abliterat|heretic|aion|role-play|qwen-3-6-plus|qwen-3-8-27b/;
  for (const m of Object.values(MODELS)) assert.match(m.id, allowedHint, `${m.id} looks like a standard model`);
});

test("decimal <-> units are exact", () => {
  assert.equal(toUnits("5", 6), 5_000_000n);
  assert.equal(toUnits("0.056652587", 9), 56_652_587n);
  assert.equal(fromUnits(56_652_587n, 9), "0.056652587");
  assert.equal(fromUnits(5_000_000n, 6), "5");
  assert.throws(() => toUnits("1.1234567", 6));
  assert.throws(() => toUnits("1e5", 6));
});
