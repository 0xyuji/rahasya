# 1. System overview

Full user-facing explanation: `source/apps/web/content/docs/protocol.md`. API reference: `source/apps/web/content/docs/api.md`.

## Components

| Component | Where | Role |
|---|---|---|
| `packages/rail` | shared TS library | 1Click client + quote validation, swap state machine (server-side scripts), Base/Solana deposit senders, Venice client (SIWX auth, x402 top-up), TEE attestation + E2EE, model catalog, privacy modes, inference-wallet derivation |
| `apps/web` | Next.js 16 site + API, deployed to **Cloudflare Workers** with the OpenNext adapter (`wrangler.jsonc`, `open-next.config.ts`) | Wallet connect (Reown AppKit for EVM/Solana, near-connect for NEAR), browser funding flows, chat, API keys UI, `/api/*` server routes |
| `apps/web/src/server` | server-only modules | Sessions + wallet-signature login, API wallet (encrypted key), API keys + limits, OpenAI-compatible gateway, Redis access |
| `packages/proxy` | CLI | Local OpenAI-compatible proxy on 127.0.0.1 using the user's inference key |

**External services:** Cloudflare (hosting: Workers, static assets, DNS for `rahasya.chat`), Venice (models, x402 credit, TEE/E2EE), NEAR Intents 1Click (swaps; we add a server-set app fee and referral tag), Upstash Redis (key/session store), Base / Solana / NEAR RPCs, Reown (wallet connection relay), Intel PCS (attestation collateral, via our relay).

**Runtime notes (Cloudflare Workers):** `nodejs_compat`; `global_fetch_strictly_public` (server-side fetch can't reach private addresses); Smart Placement (runs near Upstash); in-memory caches are per isolate; server secrets are Worker secrets, `NEXT_PUBLIC_*` values are baked in at build. Client IP for rate limits comes from `cf-connecting-ip`.

## The three ways to use it

```
1) Website chat (non-custodial)
   wallet ──sign fixed msg──▶ browser derives inference key (memory only)
   any token ──1Click──▶ USDC on inference wallet ──x402 (browser signs)──▶ Venice credit
   browser ──SIWX-signed request (+ E2EE in private mode)──▶ Venice

2) API keys (server-assisted)
   wallet ──sign challenge──▶ session cookie ──▶ create nsk_ keys (hash stored)
   any token ──1Click──▶ USDC on API wallet ──x402 (server signs)──▶ Venice credit
   tool ──Bearer nsk_──▶ /api/v1 ──authorize + SIWX (server signs w/ API wallet)──▶ Venice

3) Local proxy
   tool ──local token──▶ 127.0.0.1 proxy ──SIWX (inference key on disk, 0600)──▶ Venice
```

## Trust boundaries

| Boundary | What crosses it | What protects it |
|---|---|---|
| Wallet app → browser | Signatures only (derivation message, login challenges, deposit txs) | User approves each in their wallet |
| Internet → Cloudflare → our Worker | Every request; client IP in `cf-connecting-ip` | Cloudflare sets the header; per-IP limits depend on it |
| Browser → our server | 1Click quote/status requests; login proofs; key management (cookie) | Allowlisted proxy routes; Origin check + SameSite=Lax; session in Redis |
| Our server → 1Click | Quotes with **our** `appFees` (recipient + bps from server env) and `referral` | Client's `appFees`/`referral` are deleted before ours are added |
| Browser → Venice | SIWX-signed requests, x402 payments, E2EE ciphertext | Signatures; TEE attestation before encrypting |
| API client → our server | Bearer key + prompt | Key hash lookup, limits, rate limit |
| Our server → Venice | SIWX signed with API wallet; prompt (plaintext in transit) | Server holds sealed API wallet key |
| Our server → Redis | Sessions, key hashes, sealed API wallet keys, spend counters | Upstash token; AES-GCM for wallet keys |
| Local tool → local proxy | Local token + prompt | 127.0.0.1 bind, token, refuses `Origin`, localhost `Host` only |
| Page → Intel-verifier worker | The quote (public) in; a small verdict out | Worker lockdown (no storage, fetch only to our relay, no cookies); the page re-validates the verdict |
| Our server → Intel PCS | Platform FMSPC (public), no user data | Allowlisted endpoints; everything returned is Intel-signed |

## Assets and impact

| Asset | Where it lives | Impact if compromised |
|---|---|---|
| User's wallet key | Wallet app; never in our code | (out of scope) |
| Inference wallet key | Browser memory; optionally `~/.rahasya/inference-key` (0600) | Venice credit spent + any idle USDC on it stolen |
| API wallet keys | Redis, AES-256-GCM, AAD `aw:<uid>`, key in env `API_WALLET_ENC_KEY` | Users' API credit spent (can't be withdrawn); USDC not yet swept stolen |
| API keys `nsk_…` | Only SHA-256 hashes in Redis | Spend up to the key's limits |
| Sessions | Redis + httpOnly cookie (7 days) | Manage that user's keys |
| Deposits in flight | 1Click deposit addresses | Funds misdirected if a quote is tampered with |
| Prompts | In transit only (API keys); never stored | Disclosure |
| Partner key, Upstash token, `API_WALLET_ENC_KEY`, fee settings | Worker secrets (`wrangler secret`); `.dev.vars` locally (gitignored) | Quota abuse / data access / API wallet decryption |

## Code map (security-relevant, ~1,900 of ~6,800 lines)

| Area | Files |
|---|---|
| Gateway, keys, sessions, API wallet | `apps/web/src/server/{gateway,keys,login,api-wallet,crypto,http,kv}.ts`, `apps/web/src/app/api/{auth,keys,account,v1}/**/route.ts` |
| E2EE + attestation | `packages/rail/src/venice/e2ee.ts`; in-browser Intel signature check: `apps/web/src/tee/{lockdown,intel-verify.worker,intel-verify}.ts`, relay `apps/web/src/app/api/tee/pccs/[...path]/route.ts` |
| x402 + SIWX | `packages/rail/src/venice/{client,siwx}.ts` |
| Inference wallet derivation | `packages/rail/src/wallet/derive.ts`, `apps/web/src/wallet/wallet-context.tsx` |
| Browser funding | `apps/web/src/funding/{flow,anywhere,senders,target,local-store}.ts`, `apps/web/src/app/api/oneclick/[...path]/route.ts` |
| Quote validation, swap engine | `packages/rail/src/oneclick/validate.ts`, `packages/rail/src/swap/engine.ts`, `packages/rail/src/chains/*.ts` |
| Privacy-mode context rules | `apps/web/src/chat/conversation.ts`, `packages/rail/src/inference/{chat,models}.ts` |
| Local proxy | `packages/proxy/src/{server,cli,config}.ts` |
| Security headers | `apps/web/next.config.ts` |
| Deployment | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts`, `apps/web/scripts/gen-docs.mjs` |
| Swap fees | `apps/web/src/app/api/oneclick/[...path]/route.ts` |
| Tool configs shown to users | `apps/web/src/app/opencode-config.ts` |

Entry points for reading:
- **Gateway:** `handleChat` → `authorize` → `apiWalletAccount` → `passthrough` (→ `meterStream`) / `e2ee` → `recordSpend`.
- **Login:** `createChallenge` → `verifyLogin` → `createSession`.
- **E2EE:** `attest` → `evaluateAttestation` → `newSession` → `e2eeRequest` → `decryptStream`.
- **Funding:** `quoteCredit` → `runCredit`; `quoteAnywhere` → `runAnywhere`.
