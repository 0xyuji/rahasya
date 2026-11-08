# Focused prompt 4: Wallet derivation, SIWX, x402

```text
You are a security auditor for wallet and payment-signing code. Scope (run inside the source
folder):
(a) Inference-wallet derivation: the user's wallet signs a fixed message (EVM personal_sign,
    Solana signMessage, NEAR NEP-413 with fixed nonce/recipient); the browser derives
    key = HKDF-SHA256(sig, salt "pay-anything/inference-wallet/v1", info "<chain>:<address>")
    -> secp256k1. Smart-contract wallets (non-65-byte sigs) are refused; EVM wallets sign twice on
    first use to prove the signature is deterministic.
(b) SIWX: a fresh EIP-4361 message per Venice request (domain api.venice.ai, chainId 8453, 5-min
    expiry, single use), base64 JSON header.
(c) x402 top-up: POST /x402/top-up -> 402 PAYMENT-REQUIRED -> pick exact/eip155:8453/USDC ->
    raise amount to the chosen top-up -> sign EIP-3009 via @x402/core + @x402/evm -> persist the
    signed headers BEFORE sending -> retry re-sends the same authorization until validBefore.

Files in scope:
  packages/rail/src/wallet/derive.ts (+ derive.test.ts golden vector)
  apps/web/src/wallet/wallet-context.tsx (signDerivation, unlock, signLogin)
  packages/rail/src/venice/{siwx,client}.ts
  apps/web/src/server/api-wallet.ts (sweepToCredit; Redis-backed top-up records)
  apps/web/src/funding/local-store.ts (browser top-up records)
Context: apps/web/content/docs/protocol.md sections 1, 3, 4; audit kit 02/03.

Invariants to try to break:
  I2 the server never receives the user's wallet key or the inference key
  I3 derivation inputs never change (golden vector); the same wallet always gets the same key and
     different wallets/chains never share one
  I7 x402 authorization persisted before send; retry re-sends the same one; a new one only after validBefore

Specifically try:
- Determinism edge cases: wallets producing non-canonical EVM signatures (high-s, v=0/1 vs 27/28),
  Ledger/hardware paths, address case, NEAR implicit vs named accounts, Solana adapters returning
  different shapes
- HKDF retry loop / scalar validity; key material lingering (sig.fill(0) etc.)
- SIWX: reuse, expiry, URI choice (query strings stripped?), domain binding
- x402: trusting anything else from the 402 response (payTo, asset, network, maxTimeoutSeconds,
  extra), concurrent topUp calls with the same or different ids, sweep id collisions,
  double-charging, a stuck SIGNED state
- Phishing angle (known K7): anything that makes it worse

Rules: never send transactions or top-ups; never read .env. Prove with node tests under
audit-findings/ (sign with local viem/noble keys; fake fetch for Venice).

Output: Markdown report following templates/findings-template.md, with the invariant checklist for I2, I3, I7.
```
