import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { INTEL_CHECK, evaluateAttestation, newSession, withQuoteVerdict, type QuoteVerdict } from "./e2ee.ts";

/** How a local Intel-signature verdict combines with the other attestation checks. */
const fixture = JSON.parse(readFileSync(new URL("./fixtures/attestation-gemma-tee.json", import.meta.url), "utf8"));
const NONCE: string = fixture._sentNonce;
const MODEL: string = fixture._model ?? fixture.model;
const base = () => evaluateAttestation(fixture, MODEL, NONCE);
const reportData = () => base().quoteHex!.slice((48 + 520) * 2, (48 + 520 + 64) * 2);

test("the report carries the raw quote for verification", () => {
  const r = base();
  assert.ok(r.ok);
  assert.equal(r.quoteHex, String(fixture.intel_quote).toLowerCase());
});

test("pass: added as a local check, MRTD recorded, still ok", () => {
  const r = withQuoteVerdict(base(), { status: "pass", detail: "ok", reportDataHex: reportData(), mrTd: "ab".repeat(48) });
  const c = r.checks.find((x) => x.name === INTEL_CHECK)!;
  assert.equal(c.status, "pass");
  assert.equal(c.by, "local");
  assert.equal(r.mrTd, "ab".repeat(48));
  assert.ok(r.ok);
});

test("a pass for a different report (other REPORTDATA) counts as a failure", () => {
  const r = withQuoteVerdict(base(), { status: "pass", detail: "ok", reportDataHex: "00".repeat(64) });
  assert.equal(r.checks.find((x) => x.name === INTEL_CHECK)!.status, "fail");
  assert.equal(r.ok, false);
  assert.throws(() => newSession(r), /refusing E2EE/);
});

test("unavailable is shown but doesn't block; fail blocks", () => {
  const u = withQuoteVerdict(base(), { status: "unavailable", detail: "offline" });
  assert.equal(u.ok, true);
  assert.equal(u.mrTd, undefined);
  newSession(u);
  const f = withQuoteVerdict(base(), { status: "fail", detail: "bad signature" } satisfies QuoteVerdict);
  assert.equal(f.ok, false);
  assert.throws(() => newSession(f), /refusing E2EE/);
});

test("applying a verdict twice replaces it instead of stacking", () => {
  const once = withQuoteVerdict(base(), { status: "unavailable", detail: "x" });
  const twice = withQuoteVerdict(once, { status: "pass", detail: "y", reportDataHex: reportData() });
  assert.equal(twice.checks.filter((c) => c.name === INTEL_CHECK).length, 1);
  assert.ok(twice.ok);
});
