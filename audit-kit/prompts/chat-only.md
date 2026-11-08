# Prompt: chat-only review (no repository access)

For ChatGPT, Claude.ai, Gemini and the like, where you paste code. Paste the box below first, then attach or paste the files it asks for, one area at a time. This is shallower than an agent run (no tests can be executed), so use it as a second opinion.

```text
You're reviewing the security of a web app + API. I'll paste source files in batches. Context:
- Website and OpenAI-compatible API for uncensored LLMs (via Venice), paid with any token through
  NEAR Intents 1Click.
- The browser derives an "inference wallet" key from a wallet signature (HKDF), pays Venice credit
  via x402 (EIP-3009) and signs each request with SIWX (EIP-4361).
- "Truly private" mode checks a TEE attestation (Intel TDX quote REPORTDATA must bind our nonce
  and the enclave key) and end-to-end encrypts (ECDH secp256k1 + HKDF-SHA256 + AES-256-GCM).
- API keys (nsk_, SHA-256 stored) with spend limits are backed by a server-held "API wallet"
  (AES-GCM sealed in Redis) that only holds non-withdrawable Venice credit.

Things that must always hold:
- Funds only go to a 1Click deposit address from a quote whose recipient is the user's own wallet
  and whose refund address is the user's.
- The server never sees the user's wallet key or the inference key.
- Private mode never sends plaintext to a non-enclave party and refuses on any failed attestation check.
- Keys are checked (existence, expiry, model allowlist, spend limits, rate) before any upstream call.
- Key management requires a wallet-signed, single-use login and only touches the user's own keys.

Accepted / known: limits can overshoot by in-flight requests; the server holds API wallet keys;
API-key prompts are plaintext on our server in transit; no strict CSP; the DCAP chain is not verified
locally; the local proxy doesn't check Host.

For each batch I paste: list concrete issues with file + line, why it's exploitable, a minimal proof
idea, severity (Critical/High/Medium/Low), and a fix. Say "nothing found" when that's the case.
Don't give generic advice. Ask me for any other file you need to follow a code path.
```

## Suggested batches (paste in this order)

1. `apps/web/src/server/keys.ts`, `login.ts`, `http.ts`, `crypto.ts`, `api-wallet.ts`
2. `apps/web/src/server/gateway.ts` + `apps/web/src/app/api/v1/chat/completions/route.ts`
3. `packages/rail/src/venice/e2ee.ts` + `packages/rail/src/inference/chat.ts`
4. `packages/rail/src/oneclick/validate.ts`, `apps/web/src/funding/flow.ts`, `anywhere.ts`, `apps/web/src/app/api/oneclick/[...path]/route.ts`
5. `packages/rail/src/wallet/derive.ts`, `packages/rail/src/venice/client.ts`, `siwx.ts`
6. `packages/proxy/src/server.ts`, `cli.ts`, `config.ts`
