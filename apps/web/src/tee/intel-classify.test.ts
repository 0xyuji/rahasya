/**
 * Audit T-01: a quote's producer must not be able to turn the Intel check's "fail"
 * into "couldn't check". Offline: uses the captured real Venice quote and collateral.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as qvl from "@phala/dcap-qvl";
import { STALE_COLLATERAL_MESSAGES, checkQuoteCertificates, classifyCollateralError, classifyVerifyError } from "./intel-classify.ts";
import { createHash } from "node:crypto";
import { join } from "node:path";

const COLLATERAL_SHA256 = "04913856ea32d9e1e7af90ccade8f8fc71f74df813412e14eb98935d2138edcb";

const att = JSON.parse(readFileSync(new URL("../../../../packages/rail/src/venice/fixtures/attestation-gemma-tee.json", import.meta.url), "utf8"));
const realQuote = new Uint8Array(Buffer.from(att.intel_quote, "hex"));

test("T-01: the real quote passes the pre-check", () => {
  assert.equal(checkQuoteCertificates(qvl, realQuote), null);
});

test("T-01: a quote with a broken certificate section fails before any network (was 'unavailable')", () => {
  const broken = Buffer.from(Buffer.from(realQuote).toString("latin1").replaceAll("-----BEGIN CERTIFICATE-----", "-----BEGIN CERTIFICATX-----"), "latin1");
  assert.match(checkQuoteCertificates(qvl, new Uint8Array(broken)) ?? "", /no PCK certificate chain|invalid/);
});

test("T-01: truncated or garbage quotes fail the pre-check", () => {
  assert.notEqual(checkQuoteCertificates(qvl, realQuote.slice(0, 600)), null);
  assert.notEqual(checkQuoteCertificates(qvl, new Uint8Array(1000)), null);
});

test("T-01: a quote declaring another certification data type fails (the relay serves no PCK certs)", () => {
  // Find the cert type field (u16 LE) right before the embedded PEM chain and change 5 to 3 (encrypted PPID).
  const q = Buffer.from(realQuote);
  const pem = q.indexOf("-----BEGIN CERTIFICATE-----");
  const typeAt = pem - 6; // cert_type (2 bytes) + cert_data_size (4 bytes) precede the data
  assert.equal(q.readUInt16LE(typeAt), 5, "fixture layout as expected");
  q.writeUInt16LE(3, typeAt);
  assert.match(checkQuoteCertificates(qvl, new Uint8Array(q)) ?? "", /certification data type 3|invalid/);
});

test("T-01: only stale-collateral messages are 'couldn't check'; quote-side errors fail", () => {
  for (const m of STALE_COLLATERAL_MESSAGES) assert.equal(classifyVerifyError(m), "stale-collateral");
  for (const m of ["Certificate is expired or not yet valid", "Invalid quote signature", "TCBInfo expired yesterday", "Signature verification failed", ""]) {
    assert.equal(classifyVerifyError(m), "fail", m);
  }
});

test("T-01: every stale-collateral message still exists in the pinned library (upgrade guard)", () => {
  const src = ["verify.js", "utils.js"].map((f) => readFileSync(new URL(`../../../../node_modules/@phala/dcap-qvl/src/${f}`, import.meta.url), "utf8")).join("\n");
  for (const m of STALE_COLLATERAL_MESSAGES) assert.ok(src.includes(`'${m}'`), `library no longer throws "${m}"`);
});

test("T-01: Intel's 'not found' for the quote's platform fails; network trouble doesn't", () => {
  assert.equal(classifyCollateralError("Failed to fetch TCB info: 404"), "fail");
  assert.equal(classifyCollateralError("Failed to fetch PCK CRL: 400"), "unavailable", "only the TCB lookup depends on the quote");
  assert.equal(classifyCollateralError("Failed to fetch TCB info: 429"), "unavailable");
  assert.equal(classifyCollateralError("Failed to fetch QE identity: 502"), "unavailable");
  assert.equal(classifyCollateralError("network access is limited to the collateral relay"), "unavailable");
  assert.equal(classifyCollateralError("Failed to fetch"), "unavailable");
  assert.equal(classifyCollateralError("Failed to fetch https://relay/x: 503"), "unavailable");
  assert.equal(classifyCollateralError("Load failed"), "unavailable");
  assert.equal(classifyCollateralError("collateral relay unreachable"), "unavailable");
  assert.equal(classifyCollateralError("Missing TCB-Info-Issuer-Chain"), "unavailable", "about Intel's reply, not the quote");
  assert.equal(classifyCollateralError("Unexpected token < in JSON at position 0"), "unavailable");
  assert.equal(classifyCollateralError("Failed to fetch QE identity: 404"), "unavailable");
  assert.equal(classifyCollateralError("some new library error"), "unavailable", "asks the user; the pre-check and a hash pin cover the quote side");
});

test("the verifier library is the version the classifier was checked against", () => {
  const file = join(import.meta.dirname, "..", "..", "..", "..", "node_modules", "@phala", "dcap-qvl", "src", "collateral.js");
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), COLLATERAL_SHA256, "dcap-qvl changed: re-check what getCollateral can throw before updating this hash");
});
