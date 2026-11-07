import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "viem";
import { decryptFromModel, encryptForModel, evaluateAttestation, isHexEncrypted } from "./e2ee.ts";

// Real attestation captured from Venice on 2026-11-07 for e2ee-gemma-4-26b-a4b-uncensored-p.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/attestation-gemma-tee.json", import.meta.url), "utf8"));
const MODEL = "e2ee-gemma-4-26b-a4b-uncensored-p";
const NONCE: string = fixture._sentNonce;

test("encrypt -> decrypt round trip (wire format: pub65 || nonce12 || ct+tag)", () => {
  const u = secp256k1.utils as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const priv = (u.randomSecretKey ?? u.randomPrivateKey)!();
  const pubHex = bytesToHex(secp256k1.getPublicKey(priv, false)).slice(2);
  const ct = encryptForModel("hello enclave ünïcode", pubHex);
  assert.ok(isHexEncrypted(ct));
  assert.equal(ct.slice(0, 2), "04", "starts with an uncompressed ephemeral key");
  assert.equal(decryptFromModel(ct, priv), "hello enclave ünïcode");
});

test("ciphertext is fresh every time (ephemeral key + random nonce)", () => {
  const pub = fixture.signing_public_key as string;
  assert.notEqual(encryptForModel("same", pub), encryptForModel("same", pub));
});

test("real attestation passes all local + server checks with its own nonce", () => {
  const r = evaluateAttestation(fixture, MODEL, NONCE);
  for (const c of r.checks) assert.equal(c.status, "pass", `${c.name}: ${c.detail}`);
  assert.equal(r.ok, true);
  assert.equal(r.checks.filter((c) => c.by === "local").length, 7);
});

test("replayed attestation (different nonce) fails, including inside the TDX quote", () => {
  const other = "00".repeat(32);
  const r = evaluateAttestation(fixture, MODEL, other);
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.name === "Quote binds our nonce")!.status, "fail");
  assert.equal(r.checks.find((c) => c.name === "Fresh nonce echoed")!.status, "fail");
});

test("swapped encryption key (MITM) fails the key<->address binding", () => {
  const u = secp256k1.utils as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const evil = bytesToHex(secp256k1.getPublicKey((u.randomSecretKey ?? u.randomPrivateKey)!(), false)).slice(2);
  const r = evaluateAttestation({ ...fixture, signing_public_key: evil }, MODEL, NONCE);
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.name === "Encryption key ↔ enclave address")!.status, "fail");
});

test("debug enclave is rejected", () => {
  const q: string = fixture.intel_quote;
  const off = (48 + 120) * 2; // TD_ATTRIBUTES byte 0, hex offset
  const debugQuote = q.slice(0, off) + "01" + q.slice(off + 2);
  const r = evaluateAttestation({ ...fixture, intel_quote: debugQuote }, MODEL, NONCE);
  assert.equal(r.checks.find((c) => c.name === "Not a debug enclave")!.status, "fail");
  assert.equal(r.ok, false);
});
