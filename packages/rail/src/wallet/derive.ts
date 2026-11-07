/**
 * Deterministic "inference wallet" derived from a signature by the user's own
 * wallet (EVM personal_sign, Solana signMessage, NEAR NEP-413 signMessage).
 * Same wallet + same message -> same signature -> same inference key, on any
 * device. Nothing is stored server-side; the key only ever exists in memory.
 *
 * STABILITY CONTRACT: the message, salt and NEP-413 params below must never
 * change, and must not include the brand or domain. Changing any of them gives
 * every user a different wallet and strands their credit.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export type SourceChain = "evm" | "sol" | "near";

export const DERIVATION_VERSION = "v1";

export const DERIVATION_MESSAGE = [
  "Unlock my private inference wallet.",
  "",
  "Signing this recreates the same wallet key every time, inside this browser only.",
  "It is not a transaction and costs nothing.",
  "",
  "Only sign this on a site you trust: this signature controls that wallet's credit.",
  "",
  `Derivation: inference-wallet/${DERIVATION_VERSION}`,
].join("\n");

const SALT = new TextEncoder().encode(`pay-anything/inference-wallet/${DERIVATION_VERSION}`);

/** NEP-413 needs a 32-byte nonce and a recipient; fixed so the signature is reproducible. */
export const NEP413_PARAMS = {
  message: DERIVATION_MESSAGE,
  recipient: `inference-wallet.${DERIVATION_VERSION}`,
  nonce: sha256(new TextEncoder().encode(`pay-anything/inference-wallet/${DERIVATION_VERSION}/nep413-nonce`)),
} as const;

/**
 * signature bytes -> HKDF-SHA256 -> secp256k1 private key (0x-hex).
 * `source` binds the key to the signing account, so two accounts never collide.
 */
export function deriveInferenceKey(signature: Uint8Array, source: { chain: SourceChain; address: string }): `0x${string}` {
  if (signature.length < 64) throw new Error("signature too short to derive a key from");
  const info = new TextEncoder().encode(`${source.chain}:${source.address.toLowerCase()}`);
  for (let counter = 0; counter < 8; counter++) {
    const okm = hkdf(sha256, signature, SALT, new Uint8Array([...info, counter]), 32);
    if (isValidScalar(okm)) return `0x${bytesToHex(okm)}`;
  }
  throw new Error("could not derive a valid key"); // probability ~2^-1024
}

function isValidScalar(k: Uint8Array): boolean {
  const u = secp256k1.utils as { isValidSecretKey?: (k: Uint8Array) => boolean; isValidPrivateKey?: (k: Uint8Array) => boolean };
  return (u.isValidSecretKey ?? u.isValidPrivateKey)!(k);
}

/**
 * EVM smart-contract wallets (ERC-1271/6492) return wrapped, non-deterministic
 * signatures. Only plain 65-byte ECDSA signatures from EOAs are reproducible.
 */
export function isReproducibleEvmSignature(sigHex: string): boolean {
  return /^0x[0-9a-fA-F]{130}$/.test(sigHex);
}
