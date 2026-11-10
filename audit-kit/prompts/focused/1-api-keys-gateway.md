# Focused prompt 1: API keys, sessions, gateway, API wallet

```text
You are a security auditor. Scope: ONLY the API-key system of this repository (run inside the source
folder). It's a Next.js app whose /api/v1 is an OpenAI-compatible gateway: users sign in with a
wallet signature, get a server-held "API wallet" (secp256k1 key AES-256-GCM-sealed in Redis) that
only holds Venice credit, and create nsk_ API keys (SHA-256 stored) with daily/total USD limits, a
model allowlist, expiry and a 60/min rate limit. The gateway checks the key, signs a SIWX header
with the API wallet, forwards to Venice, and charges the key from real token usage (streamed
requests reserve an estimate up front, corrected at the end).

Files in scope:
  apps/web/src/server/{gateway,keys,login,api-wallet,crypto,http,kv}.ts
  apps/web/src/app/api/{auth,keys,account,v1}/**/route.ts
  apps/web/src/server/server.test.ts (existing tests + an in-memory Redis fake: setKvForTests)
  scripts/audit/probe.ts (black-box checks)
Context: apps/web/content/docs/api.md and protocol.md; the audit kit's 02-what-to-check.md and
03-known-issues.md (skip K1–K25 unless worse than stated).

Invariants to try to break:
  I8  key plaintext never stored; authorize checks existence, expiry, allowlist, limits, rate before upstream
  I9  key CRUD only with a valid session, our own origin, and keys owned by that user
  I10 login challenges single-use, 5 min, bound to chain+address; per-chain signature verification
      (EVM incl. ERC-1271/6492 via publicClient.verifyMessage; Solana ed25519; NEAR NEP-413 hash +
      the key must be a FullAccess key of the account via RPC view_access_key)
  I11 API wallet keys decrypt only for their user (AAD), created at most once per user (SET NX)
  I12 prompts/replies never logged or stored
  I13 /api/oneclick only forwards 4 routes and only quotes delivering USDC on Base
  I17 only our server sets swap appFees/referral (client values dropped)
  I18 every key request charged exactly once: reservation, then one correction from Venice's usage
      (streams settle as the usage chunk passes, in meterStream), kept if no usage arrives

Specifically try:
- Getting a session for a wallet you don't control (replay, chain/address confusion, NEAR
  function-call keys, malformed base58/base64, ERC-6492 wrappers)
- IDOR on /api/keys/[id], /api/account, /api/account/sweep; CSRF (SameSite=Lax + Origin check,
  no token: test missing/"null" Origin)
- Spend-limit bypass: concurrent requests, aborting streams, missing usage chunks, odd max_tokens,
  model-id variants vs the allowlist, float accumulation, the UTC day rollover
- Body fields overriding what the gateway sets; error responses leaking secrets
- Behavior when Redis or Venice errors mid-request (does anything fail open?)

Rules: never send transactions or top-ups; never read or print .env contents; only add files under
audit-findings/. Prove findings with node tests (use setKvForTests, run with
`node --conditions=react-server --test`) or scripts against a local dev server.

Output: Markdown report following templates/findings-template.md (header, summary, findings with
severity/invariant/file:line/scenario/proof/fix, invariant checklist for I8–I13, I17, I18, coverage).
```
