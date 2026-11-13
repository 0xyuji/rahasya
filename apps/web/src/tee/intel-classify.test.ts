/**
 * Audit T-01: a quote's producer must not be able to turn the Intel check's "fail"
 * into "couldn't check". Offline: uses the captured real Venice quote and collateral.
 */
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as qvl from "@phala/dcap-qvl";
import { STALE_COLLATERAL_MESSAGES, checkQuoteCertificates, classifyCollateralError, classifyVerifyError } from "./intel-classify.ts";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Every source file of @phala/dcap-qvl 0.7.1. The classifier's "couldn't check" rule relies on
 * how utils.getFmspc, quote.js and getCollateral behave, so all of them are pinned (audit v4 A-14). */
const QVL_SHA256: Record<string, string> = {
  "collateral.js": "04913856ea32d9e1e7af90ccade8f8fc71f74df813412e14eb98935d2138edcb",
  "constants.js": "07bd40a677ffe950af6548a164b28930ddf1835c9826778dcffa742e284e08f8",
  "crypto-compat.js": "dac34b50daf5243adbf45119138c9e6e2be8bbbc42057784a6dbe6ce13966a68",
  "index.js": "44bf36117e7d48ef0b48fc71f13eb740c94e46443c99e20ca4886f4e7d772a50",
  "intel.js": "8ad8743e353bb26ab6046d7e8fd3e32ae5ff11bed1fc6cc6065f275558fd5422",
  "oids.js": "21d4342b2b49167f2eb67544a435ac9f74f73a535819df5a97db0a2d78d1e0ec",
  "qe_identity.js": "513616dc152c0ee945ff88c75597686b5ef99e9c9bc16325e9c5e68e4a9296b1",
  "quote.js": "1271bb0de36136e9ce6d9ddd04d12f71c2800d3c3d76f76c26764f9e329bc9c8",
  "tcb_info.js": "8bf2a6083d421d487e9e6146101f658b6d3bf0a810c9e5087290caf73a469817",
  "utils.js": "fffb3d63b65739b89c0490bb7ec05ac77d1c42cf59f8aa6835d40e2a3da5d5e8",
  "verify.js": "9b79b5d7d59a2a3f207f3db7090cd76b19a10cb351f42de438dae122a73a6550"
};

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
  assert.equal(classifyCollateralError("Failed to fetch PCK CRL: 404"), "unavailable", "a CRL 404 isn't about the quote");
  // A PCK CRL 422 (our relay refusing the quote's CA) is a fail: see the A-14 test below.
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
  const dir = join(import.meta.dirname, "..", "..", "..", "..", "node_modules", "@phala", "dcap-qvl", "src");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(files, Object.keys(QVL_SHA256).sort(), "dcap-qvl's file list changed: re-check the classifier before updating the pins");
  for (const f of files) {
    const got = createHash("sha256").update(readFileSync(join(dir, f))).digest("hex");
    assert.equal(got, QVL_SHA256[f], `dcap-qvl ${f} changed: re-check what getCollateral and getFmspc can throw before updating this hash`);
  }
});

test("A-14: the relay refusing a query built from the quote (422) is a fail, not 'couldn't check'", () => {
  assert.equal(classifyCollateralError("Failed to fetch TCB info: 422"), "fail");
  assert.equal(classifyCollateralError("Failed to fetch PCK CRL: 422"), "fail");
  assert.equal(classifyCollateralError("Failed to fetch TCB info: 400"), "unavailable", "a 400 can come from a CDN or proxy in front: an outage");
  assert.equal(classifyCollateralError("Failed to fetch PCK CRL: 400"), "unavailable");
  assert.equal(classifyCollateralError("Failed to fetch TCB info: 502"), "unavailable", "Intel's own errors reach us as 502: an outage");
  assert.equal(classifyCollateralError("Failed to fetch QE identity: 422"), "unavailable", "not built from the quote");
});
