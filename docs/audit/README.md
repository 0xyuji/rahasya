# Audit kit

Everything an external auditor (human or AI agent) needs to review this codebase: what it does, what's at stake, what must always hold, where to look first, what we already know is weak, and how to run it without spending real money.

- Agent auditors: start with **[AGENT_PROMPT.md](AGENT_PROMPT.md)**.
- Report findings using **[FINDINGS_TEMPLATE.md](FINDINGS_TEMPLATE.md)**.
- How the system works end to end: **[protocol.md](../../apps/web/content/docs/protocol.md)**. API surface: **[api.md](../../apps/web/content/docs/api.md)**.

## 1. What this is

A site and API for chatting with uncensored models, paid with any token through NEAR Intents.

- **Website chat (non-custodial).** The user's wallet signs one message; the browser derives an "inference wallet" key from it. Deposits go through NEAR Intents 1Click into USDC on that wallet, the browser pays Venice via x402, and every chat request is authenticated with a fresh SIWX signature. "Truly private" mode attests a TEE and end-to-end encrypts to it from the browser.
- **API keys (server-assisted).** Users sign in with a wallet signature, get a server-held "API wallet" (key encrypted at rest) that only ever holds Venice credit, and create `nsk_…` keys with limits. The `/api/v1` gateway signs requests with the API wallet.
- **Local proxy.** A CLI that runs the same OpenAI-compatible API on 127.0.0.1 using the user's own inference key.

## 2. Scope

Commit: see `git log -1` (kit written at `883d53b`). About 6,800 lines of non-test TypeScript; the security-relevant core is about 1,900.

**In scope, in priority order:**

| Area | Files | Lines |
|---|---|---|
| API keys, sessions, API wallet, gateway | `apps/web/src/server/{keys,login,api-wallet,gateway,crypto,http,kv}.ts`, `apps/web/src/app/api/{auth,keys,account,v1}/**` | ~800 |
| E2EE + attestation | `packages/rail/src/venice/e2ee.ts` | 299 |
| x402 top-up + SIWX | `packages/rail/src/venice/{client,siwx}.ts` | 317 |
| Inference wallet derivation | `packages/rail/src/wallet/derive.ts`, `apps/web/src/wallet/wallet-context.tsx` | 319 |
| Funding flows (browser) | `apps/web/src/funding/*.ts`, `apps/web/src/app/api/oneclick/[...path]/route.ts` | ~660 |
| Quote validation + swap state machine | `packages/rail/src/oneclick/validate.ts`, `packages/rail/src/swap/engine.ts`, `packages/rail/src/chains/*.ts` | ~730 |
| Privacy-mode context rules | `apps/web/src/chat/conversation.ts`, `packages/rail/src/inference/{chat,models}.ts` | ~370 |
| Local proxy | `packages/proxy/src/*.ts` | 319 |
| Headers | `apps/web/next.config.ts` | 36 |

**Out of scope:** the third-party services themselves (Venice, NEAR Intents/1Click, Upstash, Reown/WalletConnect, Base/Solana/NEAR RPCs), wallet apps and extensions, Next.js/React internals, purely visual components (`cipher-field.tsx`, CSS), the `scripts/` used for our own mainnet runs.

## 3. Assets and what's at stake

| Asset | Where it lives | Worst case if compromised |
|---|---|---|
| User's own wallet key | User's wallet app; never touches our code | Out of scope; we only ever ask for message signatures |
| Inference wallet key | Browser memory only; derived from a signature; optionally pasted into the local proxy (`~/.naisho`, 0600) | Attacker spends that wallet's Venice credit and takes any idle USDC on it |
| Deposits in flight | 1Click deposit addresses (non-custodial, solver-side) | Funds sent to a wrong address. Mitigated by quote validation and refund addresses the user controls |
| API wallet keys | Redis, AES-256-GCM, AAD = `aw:<uid>`, key in `API_WALLET_ENC_KEY` | Attacker spends users' API credit (Venice credit can't be withdrawn); any USDC not yet swept could be moved |
| API keys (`nsk_…`) | Only SHA-256 hashes in Redis | Spend up to the key's limits |
| Sessions | Redis `sess:<sid>`, httpOnly cookie, 7 days | Manage that user's keys (create keys → spend credit) |
| Prompts | Browser → Venice directly (website); through our server in transit (API keys) | Disclosure. Never stored or logged by design |
| 1Click partner key, Upstash token | Server env | Quota abuse / data access |

## 4. Invariants (what must always hold)

Each invariant names where it's enforced and what tests it. **A break of any of these is at least High.**

| # | Invariant | Enforced in | Tested by |
|---|---|---|---|
| I1 | No browser or server code sends value anywhere except (a) a 1Click deposit address from a quote that echoes our exact request with **recipient = the user's own wallet** and **refundTo = an address the user gave**, or (b) Venice via a user-signed x402 authorization | `oneclick/validate.ts`, `funding/flow.ts`, `funding/anywhere.ts`, `swap/engine.ts` | `swap/engine.test.ts` (tampered recipient refused) |
| I2 | The server never receives the user's wallet key or the inference wallet key | Architecture; `wallet-context.tsx` keeps the key in React state only | Review |
| I3 | The derivation message, salt and NEP-413 parameters never change (otherwise users silently get new wallets) | `wallet/derive.ts` | Golden vector in `derive.test.ts` |
| I4 | Truly private mode never sends user/system content in plaintext, never falls back to a non-TEE model, and refuses if any attestation check fails | `inference/chat.ts`, `inference/models.ts` (`resolveModel`), `venice/e2ee.ts` (`newSession`) | `models.test.ts`, `e2ee.test.ts` |
| I5 | Anonymous-mode requests never include messages exchanged in Truly private mode; E2EE requests carry no plaintext-role history | `chat/conversation.ts`, `proxy/server.ts` (`foldForE2ee`), `server/gateway.ts` (`fold`) | `conversation.test.ts`, `proxy/server.test.ts` |
| I6 | An attestation passes only if: the nonce is echoed, the model matches, keccak(enclave key) = signing address, it's a TDX v4 quote, REPORTDATA binds both our nonce and that address, and the debug bit is off | `venice/e2ee.ts` (`evaluateAttestation`) | `e2ee.test.ts` (replay, swapped key, debug enclave) |
| I7 | An x402 authorization is persisted before it's sent; a retry re-sends the same one; a new one is signed only after the old one's `validBefore` passed | `venice/client.ts` (`topUp`) | Review |
| I8 | API key plaintext is never stored; `authorize` enforces existence, expiry, model allowlist, daily/total limits and rate before any upstream call | `server/keys.ts` | `server.test.ts`, `npm run audit:probe` |
| I9 | Key CRUD only works with a valid session, from our own origin, on keys owned by that session's user | `server/http.ts`, `server/keys.ts` (`own`) | `server.test.ts`, probe |
| I10 | Sign-in challenges are single-use, expire in 5 minutes, and are bound to chain + address; signatures are verified per chain (EVM incl. ERC-1271/6492; Solana ed25519; NEAR NEP-413 + full-access key check) | `server/login.ts` | `server.test.ts` (Solana), probe (EVM) |
| I11 | API wallet keys decrypt only for their own user (AAD) and are created at most once per user | `server/crypto.ts`, `server/api-wallet.ts` (`set NX`) | `server.test.ts` |
| I12 | The gateway never logs or stores prompts or replies | `server/gateway.ts`, `proxy/server.ts` | Review; proxy log check in `docs/demo-runs/` |
| I13 | `/api/oneclick` only forwards 4 routes and only quotes that deliver USDC on Base to `DESTINATION_CHAIN` | `app/api/oneclick/[...path]/route.ts` | Probe |
| I14 | The local proxy only listens on 127.0.0.1, requires its token (constant-time compare), and refuses any request carrying an `Origin` header | `proxy/server.ts`, `proxy/cli.ts` | `proxy/server.test.ts` |
| I15 | Pages can't be framed (wallet prompts can't be clickjacked) | `next.config.ts` headers | Probe |

## 5. Threat model: what we most want you to try

1. **Spend someone else's credit.** Key confusion in `authorize`, session fixation or theft, IDOR on `/api/keys/[id]`, CSRF on cookie routes (we rely on SameSite=Lax + an Origin check, with no CSRF token), challenge replay or cross-chain confusion in `verifyLogin`, NEAR access-key checks (function-call keys must not count).
2. **Get around spend limits.** Concurrent requests racing `authorize` → `recordSpend`, streaming responses that end without a usage chunk (cost 0?), clients that send `stream_options` themselves, E2EE path accounting, float accumulation in `incrbyfloat`.
3. **Make the gateway leak or misroute.** Request-body fields that override what we set (`model`, `venice_parameters`, `stream_options`), header injection, response bodies that include upstream secrets, SSRF via any URL we build from input.
4. **Redirect a deposit.** A malicious or MITM'd 1Click response, the `/api/oneclick` proxy, `quoteAnywhere` validation (it checks fewer fields than `validateQuote`; memo handling), localStorage tampering that changes a saved action's deposit address before it's sent.
5. **Break the E2EE/attestation claim.** Field-confusion between `signing_key` / `signing_public_key` / the `aci/1` format, a quote whose REPORTDATA layout differs, a plaintext chunk passed off as decrypted, attestation caching (10 min) letting a key rotate under us.
6. **x402 double charge or stuck funds.** `sweepToCredit` id scheme (`sweep_<address>_<cents>`), concurrent sweeps, a retry after `validBefore`.
7. **Derivation.** Any path where the inference key could change for the same wallet, or collide across wallets or chains; NEP-413 nonce/recipient handling; smart-wallet detection.
8. **Local proxy.** DNS rebinding (we refuse any `Origin`; is `Host` checked? It isn't), token storage, request smuggling.
9. **Supply chain.** The dependency tree pulled in by wallet libraries; anything that runs install scripts.

## 6. Known issues and accepted risks (no need to re-report; do tell us if they're worse than stated)

| # | Issue | Why it's accepted / status |
|---|---|---|
| K1 | Spend limits can be exceeded by requests already in flight when the limit is crossed. Streamed requests reserve an estimate up front (prompt size + `max_tokens`, default 2048) that's corrected to the real cost at the end; non-streamed requests are charged after the reply | Bounded by concurrency × per-request cost. A strict per-key concurrency limit would close it |
| K2 | The rate limit is a fixed 60/min window per key | Simple by design |
| K3 | The server holds API wallet keys (custody of Venice credit) | User decision; credit can't be withdrawn; USDC is swept immediately. A breach = credit spent, not funds stolen, except USDC not yet swept |
| K4 | API-key requests (including TEE models) are plaintext on our server in transit | Documented; Truly private on the website and the local proxy avoid it |
| K5 | `/api/oneclick` has no rate limit or auth, so anyone can use our partner key for quotes | Known; add a per-IP limit before launch |
| K6 | No strict `default-src` CSP (the WalletConnect modal needs many origins) | Anti-framing is set; XSS hardening relies on React escaping + react-markdown (no raw HTML) |
| K7 | The derivation message is the same on every site, so a phishing site asking for it gets the inference key | Message carries a warning; balances meant to be small; brand/domain intentionally excluded for stability (I3) |
| K8 | `npm audit` advisories in wallet libraries (zod < 4.6.6 in AppKit, bigint-buffer via web3.js 1.x, jayson/stream-json/uuid) | Triage in the README's Security notes; no upstream fix that doesn't break them |
| K9 | The Intel DCAP signature chain and NVIDIA GPU evidence aren't verified locally (reported by Venice's verifier) | Labeled as such in the UI and docs |
| K10 | EVM/NEAR login verification trusts the configured Base RPC / NEAR RPC | Configure trusted RPCs in production |
| K11 | Saved credit/top-up actions in localStorage include signed x402 authorizations (single-use, short-lived, credit the user's own wallet) | XSS could replay them only to top up the victim's own credit |
| K12 | The authorize path makes about 5 sequential Redis REST calls (~1 s per request from far away; a few ms co-located) | Performance, not security; pipeline later |
| K13 | The EXACT_OUTPUT slippage buffer (0.5%) may not be refunded by 1Click | Observed on mainnet; documented |

## 6b. Fixed while preparing this kit

- **Streaming abort skipped billing.** Streamed requests were only charged from the final usage chunk, so a client that aborted just before the end was never charged and a key could exceed its limits without bound. Fixed in `server/gateway.ts` (`reserve`): an up-front reservation, corrected at the end and kept if the stream is cut off. Please re-check this path.

## 7. Running it

**Requirements:** Node 26+ (runs TypeScript directly), npm. No Docker.

```sh
npm install
npm test                 # 44 offline tests: rail 27, web 11, proxy 6. No network, no keys.
npm run typecheck
npm run verify:tee       # live TEE attestation with a throwaway in-memory wallet (no funds)
npm run quote:dry        # live NEAR Intents dry quotes (no funds)
```

**The site and API locally:**

```sh
cp apps/web/.env.example apps/web/.env.local
# NEXT_PUBLIC_REOWN_PROJECT_ID=…   (free at dashboard.reown.com)
# UPSTASH_REDIS_REST_URL=… / UPSTASH_REDIS_REST_TOKEN=…   (free Upstash Redis, use your own)
# API_WALLET_ENC_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
npm run dev                         # http://localhost:3000
npm run audit:probe                 # black-box checks against it (no funds; creates throwaway users)
npm run audit:probe -- https://…    # or against a deployment
```

`audit:probe` signs in with throwaway wallets and checks headers, login replay and forgery, origin checks, key validation, cross-user IDOR, gateway auth, the model allowlist, 402 when unfunded, body size, the rate limit, 1Click proxy restrictions, key deletion and logout. It prints PASS/FAIL per check and exits non-zero on any failure. Latest run: 31/31.

**Paid paths** (deposits, top-ups, completions) are mainnet only; NEAR Intents has no testnet. If you test them, use throwaway wallets with a few dollars, never a real wallet. `npm run e2e -- dry|quote|run` shows the full server-side flow (`quote` prints and sends nothing; `run` spends).

## 8. Useful entry points for reading

- **Funding (browser):** `funding/flow.ts` `quoteCredit` → `runCredit`; `funding/anywhere.ts` `quoteAnywhere` → `runAnywhere`.
- **Gateway:** `server/gateway.ts` `handleChat` → `authorize` (`server/keys.ts`) → `apiWalletAccount` (`server/api-wallet.ts`) → `passthrough` / `e2ee` → `recordSpend`.
- **Login:** `server/login.ts` `createChallenge` → `verifyLogin` → `createSession`.
- **E2EE:** `venice/e2ee.ts` `attest` → `evaluateAttestation` → `newSession` → `e2eeRequest` → `decryptStream`.
- **Server-side swaps** (scripts only): `swap/engine.ts` `quote` → `execute` → `run`.
