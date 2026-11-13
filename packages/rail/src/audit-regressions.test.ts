import { strict as assert } from "node:assert";
import { test } from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { privateKeyToAccount } from "viem/accounts";
import { MODELS, costUsd, findModel, resolveModel } from "./inference/models.ts";
import { checkMaxInput } from "./oneclick/validate.ts";
import { canonicalEvmSignature, deriveInferenceKey } from "./wallet/derive.ts";

/** Regression tests for the 2026-11-08 audit (docs/known-issues.md, "Fixed"). */

test("F-01: Object.prototype names are not models", () => {
  for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(findModel(k), undefined, k);
    assert.equal(findModel(k, true), undefined, k);
    assert.throws(() => resolveModel("anonymous", k), /not in the allowed list/);
  }
  assert.equal(findModel(123), undefined);
  const any = Object.values(MODELS)[0]!;
  assert.equal(findModel(any.key), any);
  assert.equal(findModel(any.id, true), any);
  assert.equal(findModel(any.id), undefined, "Venice ids only resolve when asked");
});

test("F-04: costs are never negative, whatever the usage says", () => {
  const m = Object.values(MODELS)[0]!;
  assert.equal(costUsd(m, { prompt_tokens: -1e9, completion_tokens: -1e9 }), 0);
  assert.equal(costUsd(m, { prompt_tokens: Number.NaN, completion_tokens: 10 })! > 0, true);
  assert.equal(costUsd(m, { prompt_tokens: "5" as never, completion_tokens: 0 }), 0);
});

const EVM_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const src = { chain: "evm" as const, address: "0x0000000000000000000000000000000000000001" };

test("F-06: the same EOA signature derives the same key in every encoding", async () => {
  const sig = hexToBytes((await privateKeyToAccount(EVM_KEY).signMessage({ message: "x" })).slice(2));
  assert.ok(sig[64] === 27 || sig[64] === 28, "viem returns v = 27/28");
  const canonical = deriveInferenceKey(canonicalEvmSignature(sig), src);
  assert.equal(canonical, deriveInferenceKey(sig, src), "canonical wallets are unaffected (no key changes)");

  const v01 = Uint8Array.from(sig);
  v01[64] = sig[64]! - 27; // wallet stacks that return v = 0/1
  assert.equal(deriveInferenceKey(canonicalEvmSignature(v01), src), canonical);

  // The high-s twin of the same signature (equally valid ECDSA, flipped recovery bit).
  const N = (secp256k1 as unknown as { CURVE: { n: bigint } }).CURVE.n;
  const s = BigInt(`0x${Buffer.from(sig.subarray(32, 64)).toString("hex")}`);
  const high = Uint8Array.from(sig);
  high.set(hexToBytes((N - s).toString(16).padStart(64, "0")), 32);
  high[64] = sig[64] === 27 ? 28 : 27;
  assert.equal(deriveInferenceKey(canonicalEvmSignature(high), src), canonical);
});

test("F-11: the browser refuses quotes asking for much more than the credit is worth", () => {
  const usdc = { decimals: 6, priceUsd: 1, symbol: "USDC" };
  checkMaxInput(usdc, "5100000", 5); // 2% over: fine
  assert.throws(() => checkMaxInput(usdc, "9000000", 5), /refusing/);
  const sol = { decimals: 9, priceUsd: 150, symbol: "SOL" };
  checkMaxInput(sol, "34000000", 5); // 0.034 SOL = $5.10
  assert.throws(() => checkMaxInput(sol, "3400000000", 5), /refusing/); // 3.4 SOL = $510
  assert.throws(() => checkMaxInput({ decimals: 9, priceUsd: 0 }, "1", 5), /refusing/, "no price = no send");
});
