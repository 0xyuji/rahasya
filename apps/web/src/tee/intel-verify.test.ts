import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as qvl from "@phala/dcap-qvl";
import { parseVerdict } from "./intel-verify.ts";

/**
 * The pinned verifier against a real Venice TEE quote (captured 2026-11-08) and
 * Intel collateral fetched through our relay at the same time. Fully offline.
 */
const att = JSON.parse(readFileSync(new URL("../../../../packages/rail/src/venice/fixtures/attestation-gemma-tee.json", import.meta.url), "utf8"));
const { capturedAt, collateral } = JSON.parse(readFileSync(new URL("./fixtures/collateral-gemma-tee.json", import.meta.url), "utf8"));
const quote = () => Uint8Array.from(Buffer.from(att.intel_quote, "hex"));
const REPORT_DATA = 48 + 520;

test("a real Venice TEE quote verifies: genuine Intel TDX, up to date, report matches the quote", () => {
  const r = qvl.verify(quote(), collateral, capturedAt);
  assert.equal(r.status, "UpToDate");
  const td = r.report.asTd10()!;
  assert.equal(Buffer.from(td.reportData).toString("hex"), Buffer.from(quote().slice(REPORT_DATA, REPORT_DATA + 64)).toString("hex"));
});

test("tampering with anything Intel signed is rejected", () => {
  for (const [what, offset] of [["our nonce in REPORTDATA", REPORT_DATA + 40], ["the enclave key in REPORTDATA", REPORT_DATA + 3], ["the debug bit", 48 + 120], ["MRTD", 48 + 136]] as const) {
    const q = quote();
    q[offset] = q[offset]! ^ 0x01;
    assert.throws(() => qvl.verify(q, collateral, capturedAt), Error, what);
  }
});

test("forged collateral is rejected (it's signed by Intel too)", () => {
  const tcb = JSON.parse(collateral.tcb_info);
  tcb.tcbLevels[0].tcbStatus = tcb.tcbLevels[0].tcbStatus === "UpToDate" ? "OutOfDate" : "UpToDate";
  assert.throws(() => qvl.verify(quote(), { ...collateral, tcb_info: JSON.stringify(tcb) }, capturedAt), /Signature is invalid for tcb_info/);
  const qe = JSON.parse(collateral.qe_identity);
  qe.isvprodid = 99;
  assert.throws(() => qvl.verify(quote(), { ...collateral, qe_identity: JSON.stringify(qe) }, capturedAt), /Signature is invalid for qe_identity/);
});

test("stale collateral fails with an 'expired' error (the worker reports it as unavailable, not as a fake enclave)", () => {
  assert.throws(() => qvl.verify(quote(), collateral, capturedAt + 400 * 86_400), /expired/i);
});

test("the page only accepts a well-formed verdict from the worker", () => {
  const rd = "ab".repeat(64);
  assert.equal(parseVerdict({ status: "pass", detail: "ok", reportDataHex: rd, mrTd: "cd".repeat(48) }).status, "pass");
  assert.equal(parseVerdict({ status: "pass", detail: "ok" }).status, "unavailable", "a pass without the report data isn't a pass");
  assert.equal(parseVerdict({ status: "pass", reportDataHex: "zz".repeat(64) }).status, "unavailable");
  assert.equal(parseVerdict({ status: "fail", detail: "x" }).status, "fail");
  assert.equal(parseVerdict({ status: "PASS" }).status, "unavailable");
  assert.equal(parseVerdict(null).status, "unavailable");
  assert.ok(parseVerdict({ status: "fail", detail: "x".repeat(10_000) }).detail.length <= 400);
});
