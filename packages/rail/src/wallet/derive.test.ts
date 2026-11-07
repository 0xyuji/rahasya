import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { privateKeyToAccount } from "viem/accounts";
import { DERIVATION_MESSAGE, NEP413_PARAMS, deriveInferenceKey, isReproducibleEvmSignature } from "./derive.ts";

const EVM_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

test("EVM: same wallet + same message -> same inference wallet", async () => {
  const user = privateKeyToAccount(EVM_KEY);
  const sig1 = await user.signMessage({ message: DERIVATION_MESSAGE });
  const sig2 = await user.signMessage({ message: DERIVATION_MESSAGE });
  assert.equal(sig1, sig2, "EOA signatures are deterministic (RFC 6979)");
  assert.ok(isReproducibleEvmSignature(sig1));
  const bytes = Buffer.from(sig1.slice(2), "hex");
  const k1 = deriveInferenceKey(bytes, { chain: "evm", address: user.address });
  const k2 = deriveInferenceKey(bytes, { chain: "evm", address: user.address.toUpperCase() });
  assert.equal(k1, k2, "address case doesn't matter");
  assert.notEqual(privateKeyToAccount(k1).address, user.address, "inference wallet is a different address");
});

test("Solana/NEAR ed25519: signature is deterministic, so the wallet is too", () => {
  const u = ed25519.utils as unknown as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  const priv = (u.randomSecretKey ?? u.randomPrivateKey)!();
  const msg = new TextEncoder().encode(DERIVATION_MESSAGE);
  const a = ed25519.sign(msg, priv);
  const b = ed25519.sign(msg, priv);
  assert.deepEqual(a, b);
  assert.equal(deriveInferenceKey(a, { chain: "sol", address: "X" }), deriveInferenceKey(b, { chain: "sol", address: "X" }));
});

test("different source accounts never share an inference wallet", () => {
  const sig = new Uint8Array(65).fill(7);
  assert.notEqual(
    deriveInferenceKey(sig, { chain: "evm", address: "0xabc" }),
    deriveInferenceKey(sig, { chain: "sol", address: "0xabc" }),
  );
  assert.notEqual(
    deriveInferenceKey(sig, { chain: "near", address: "a.near" }),
    deriveInferenceKey(sig, { chain: "near", address: "b.near" }),
  );
});

test("smart-wallet (wrapped) signatures are flagged as not reproducible", () => {
  assert.equal(isReproducibleEvmSignature(`0x${"ab".repeat(65)}`), true);
  assert.equal(isReproducibleEvmSignature(`0x${"ab".repeat(200)}`), false);
});

test("stability contract: derivation inputs are frozen (changing them strands users' credit)", () => {
  assert.equal(
    Buffer.from(NEP413_PARAMS.nonce).toString("hex").length,
    64,
    "NEP-413 nonce must be 32 bytes",
  );
  // Golden vector: if this changes, every user gets a different wallet.
  const golden = deriveInferenceKey(new Uint8Array(65).fill(1), { chain: "evm", address: "0x0000000000000000000000000000000000000001" });
  assert.equal(golden, "0x4ba9de0efd5488eb81456b669d01e4d2c6dca859eb0b0382aeaedcaf81056832");
  assert.match(DERIVATION_MESSAGE, /Derivation: inference-wallet\/v1$/);
  assert.doesNotMatch(DERIVATION_MESSAGE, /naisho|rahasya|sotto|vercel|\.chat|\.ai\b/i, "no brand/domain in the message");
});
