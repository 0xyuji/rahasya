# Focused prompt 2: TEE attestation, E2EE, privacy modes

```text
You are a security auditor specializing in applied cryptography. Scope: ONLY the "Truly private"
mode of this repository (run inside the source folder). Before encrypting, the browser fetches a
Venice TEE attestation with a fresh 32-byte nonce and checks: nonce echoed, model id,
keccak(enclave pubkey) == signing address, Intel TDX quote v4 / type 0x81, the quote's REPORTDATA
contains our nonce (bytes 32..64) and the signing address (bytes 0..20), and the TD debug bit is 0.
On the website, the Intel DCAP chain is also verified in the browser with @phala/dcap-qvl, inside a
locked-down Web Worker (apps/web/src/tee/), with Intel's collateral relayed by /api/tee/pccs/. NVIDIA
evidence is only reported by Venice, and measurements aren't pinned (K9). It then encrypts
user/system messages with ECDH secp256k1 -> HKDF-SHA256 (info "ecdsa_encryption", no salt) ->
AES-256-GCM, wire format hex(ephemeralPub65 || nonce12 || ct+tag), and decrypts the streamed
reply. History is folded into one encrypted message because Venice only encrypts user/system roles.

Files in scope:
  packages/rail/src/venice/e2ee.ts (+ e2ee.test.ts, intel-verdict.test.ts, fixtures/attestation-gemma-tee.json: a real capture)
  apps/web/src/tee/{lockdown,intel-verify.worker,intel-verify}.ts (+ tests, fixtures/collateral-gemma-tee.json)
  apps/web/src/app/api/tee/pccs/[...path]/route.ts (collateral relay)
  packages/rail/src/inference/{chat,models}.ts (+ models.test.ts)
  apps/web/src/chat/{conversation,use-chat}.ts (+ conversation.test.ts)
  apps/web/src/chat/message.tsx (the "Verified enclave" panel)
  packages/proxy/src/server.ts (foldForE2ee) and apps/web/src/server/gateway.ts (fold, e2ee path)
Context: apps/web/content/docs/protocol.md section 5; audit kit 02-what-to-check.md.

Invariants to try to break:
  I4 private mode never sends plaintext user/system content, never falls back to a non-TEE model,
     refuses if any attestation check fails
  I5 anonymous requests never include private-mode messages; E2EE requests have no plaintext-role history
  I6 the attestation acceptance rules above, including the in-browser Intel signature check
  I16 the verifier library only runs inside the locked-down worker

Specifically try:
- Crafting an attestation (start from the fixture) that passes evaluateAttestation with a key the
  attacker controls: field confusion (signing_key / signing_public_key / aci/1 nested keys),
  alternate REPORTDATA layouts, non-hex or odd-length quotes, quote-length edge cases
- Making a plaintext chunk count as "decrypted" (isHexEncrypted heuristic) or a decryption failure
  get silently ignored; reply chunks in reasoning vs content fields
- The 10-minute attestation cache in VeniceChat: substitution or rotation under us
- Crypto details: HKDF usage, ECDH x-coordinate handling, GCM nonce randomness, key zeroing
- Every code path where messages are built for a TEE model (web, proxy, gateway), plus mode
  switching mid-conversation

Run `npm run verify:tee` (free; throwaway wallet) to see a live attestation. Never send
transactions; never read .env; add proofs under audit-findings/ as node tests.

Output: Markdown report following templates/findings-template.md, with the invariant checklist for I4–I6.
```
