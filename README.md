# Rahasya — Private AI, kept in confidence

Chat with uncensored and abliterated models without an account, a card, or a subscription. You pay with whatever token you hold, from almost any chain, through **NEAR Intents**. A **Truly private** mode runs only on hardware enclaves (TEEs), encrypts every message in your browser, and shows the attestation checks it did before sending.

**Live: https://rahasya.chat** (Cloudflare Workers). Built for NEAR HACKATHON (Nov 2026).

For judges and screening agents, the fastest checks need no wallet and no money:

| Do | See |
|---|---|
| Open https://rahasya.chat/docs | What it is, the API, and how the money and privacy flows work |
| `npm install && npm test` | 186 offline tests pass |
| `npm run verify:tee` | A live TEE attestation from the NEAR AI enclave model, checked locally |
| `npm run quote:dry` | Live NEAR Intents dry quotes for $5 of USDC on Base from SOL, ETH and NEAR |

## The problem

Uncensored models are useful exactly where people least want an account trail: health, legal, security research, fiction, personal questions. Today, using them means a sign-up, a card, and a provider that can read every prompt. Paying with crypto usually means holding the one token on the one chain a provider accepts.

## What it does

1. **Connect any wallet** (EVM, Solana or NEAR). It's your login. One signature derives (the first EVM unlock asks twice, to prove the wallet signs the same way every time) a separate **inference wallet** in your browser. It's recreated from the same signature on any device and never stored or sent anywhere.
2. **Add credit with any token.** NEAR Intents (1Click) swaps from 216 tokens on 39 chains into USDC on your *own* inference wallet. Your browser then pays Venice over **x402** (USDC on Base). Website chat is non-custodial: we never hold those funds or keys. (API keys use a server-held wallet; see Security notes.)
3. **Chat.** Choose a model and a privacy mode in the prompt bar:
   - **Anonymous**: all allowed models, including Abliterated Large V2 / Large Flash. No account, email or card: you are a wallet address, not a name (pseudonymous). The model host can read the prompt. Funding from your connected wallet links it to the inference wallet on-chain; for an unlinked deposit, use *Any token, anywhere* from a fresh or shielded source (Zcash is supported).
   - **Truly private**: TEE models only. The browser fetches an attestation with a fresh nonce, checks it, and encrypts the conversation to a key inside the enclave (ECDH secp256k1 → HKDF-SHA256 → AES-256-GCM). Venice reports that one of the two TEE models runs on **NEAR AI** enclaves.
4. **Use it from your tools.** A local proxy (`npx rahasya@0.1.1`, or one downloadable file) exposes an OpenAI-compatible API on `127.0.0.1`, so opencode, Cursor, SillyTavern or the OpenAI SDK can spend the same credit.

## How NEAR fits

| Piece | Role |
|---|---|
| **NEAR Intents 1Click** | Every deposit: any token, any chain → USDC on the user's own Base address. Exact-output (connected wallet) and flex-input (send from anywhere) quotes, status tracking, refunds to the user's address. Quotes go through a small proxy that adds our partner key, a 1% app fee (1Click keeps half) and a referral tag; clients can't change any of them. |
| **NEAR AI** | The default Truly private model (`e2ee-deepseek-v4-1-flash-1017-abliterated`) is reported by Venice's attestation as `tee_provider: near-ai` (Intel TDX + NVIDIA H100). That field isn't bound to the hardware quote, so the UI shows it as Venice's claim. |
| **NEAR wallets** | Login + derivation via `@hot-labs/near-connect` (NEP-413 `signMessage`). |

## Hackathon tracks

| Track | What fits | See |
|---|---|---|
| `privacy` (Privacy & Private AI) | Truly private mode: fresh-nonce TEE attestation checked in the browser, Intel signature chain verified locally, then end-to-end encryption to the enclave | `npm run verify:tee`, "Who can see what" below |
| `security` (AI Security & Defense) | Tools get a spending key, not a wallet: daily and total limits, model allowlist, expiry, rate limit. The API wallet only ever holds Venice credit, which can't be withdrawn | [docs/api.md](apps/web/content/docs/api.md) "Limits", `apps/web/src/server/keys.ts` |
| `agents` (Agent Economy) | Coding agents pay for inference through an OpenAI-compatible API or local proxy, from x402 credit funded through NEAR Intents. A person adds the credit; the agent spends it inside the key's limits | "Use it from opencode, Cursor and other tools" below |

## Try it

Requirements: Node 22.18 or newer (runs the TypeScript directly; tests pass on 22, 24 and 26), npm.

```sh
npm install
```

### 1. No keys, no money (about 1 minute)

| Do | See |
|---|---|
| `npm test` | **186 tests pass** offline: swap state machine (crash-resume never double-sends, dropped deposits re-signed once, refunds, kill switch, spend cap, tampered quotes refused), E2EE round trip, attestation checks against a real captured quote (replayed nonce, swapped key and debug enclave all rejected), wallet derivation golden vector, x402 top-up idempotency, API-key limits and login, privacy-mode context rules, proxy auth/origin/Host guards, the in-browser Intel quote verifier against a real captured quote (tampering and forged collateral rejected) and its worker lockdown, plus a regression test for every audit finding. |
| `npm run verify:tee` | A live attestation of the NEAR AI enclave model with a fresh nonce: 7 checks done locally from the raw Intel TDX quote, 3 reported by Venice. Uses a throwaway in-memory wallet. |
| `npm run quote:dry` | Live dry quotes from NEAR Intents for $5 of USDC on Base from SOL, ETH and NEAR. |

### 2. The website (your own wallet, real money, minimum $5)

On **https://rahasya.chat**, nothing to install. (To run it yourself: `cp apps/web/.env.example apps/web/.env.local`, add a free Reown project id, then `npm run dev` for http://localhost:3000. Chat and funding need nothing else; API keys also need the Upstash Redis and encryption key values described in that file.)

| Do | See |
|---|---|
| Click **Connect wallet**, pick EVM/Solana or NEAR | Button turns into **Unlock** |
| Click **Unlock**, sign the message | Account menu shows your inference wallet (a Base address). Lock and unlock again: same address. |
| Menu → **Add credit** → *From your wallet* or *Any token, anywhere* | An exact 1Click quote (what you send, what you get, refund address). After sending: live steps, deposit and delivery tx links, then `Added $5.00 of credit`. |
| Type a message in **Anonymous** mode | Streaming reply; footer shows model, privacy tier and cost |
| Switch to **Truly private**, send a message | Reply footer shows **Verified enclave**; click it to see every check, including **Genuine Intel hardware ✓** (Intel's signature chain verified in your browser), the enclave key, our nonce and the enclave's measurement |

### 3. Use it from opencode, Cursor and other tools

**API keys (hosted):** account menu → **API keys** → sign in with your wallet → **Add credit** to your API wallet → **New key** (optional daily/total limit, model allowlist, expiry). Paste the key into any OpenAI-compatible tool with base URL `https://rahasya.chat/api/v1`. Quick check: `curl https://rahasya.chat/api/v1/chat/completions -H "Authorization: Bearer nsk_…" -H "content-type: application/json" -d '{"model":"gemma-4-uncensored","messages":[{"role":"user","content":"hi"}],"max_tokens":20}'` returns a reply and its token usage. The dialog shows a ready-made opencode config. Full reference: [docs/api.md](apps/web/content/docs/api.md); per-tool setup: [docs/integrations.md](apps/web/content/docs/integrations.md).

**Local proxy (most private):** account menu → **Local proxy**, then (Node.js 22+, no clone needed):

```sh
npx rahasya@0.1.1         # or: curl -fsSLO https://rahasya.chat/rahasya.mjs && node rahasya.mjs
                          # first run: paste the inference key (hidden input, saved 0600 in ~/.rahasya), then it serves
                          # http://127.0.0.1:8787/v1 + a local API key
```

`rahasya.mjs` is `packages/proxy` bundled into one readable file (`npm run -w @pay/proxy bundle`); its SHA-256 is published at `/rahasya.mjs.sha256`. From a clone, `npm run proxy` does the same.

### 4. Mainnet evidence

`docs/demo-runs/2026-11-07-sol-to-venice.md`: a recorded run with explorer links (SOL → 5.0 USDC on Base via 1Click in 94 s → x402 top-up credited $5 → chat), plus live E2EE runs on both TEE models.

To reproduce it with your own throwaway wallets: `cp .env.example .env`, fund the Solana key with about $6 of SOL, then `npm run e2e -- quote` (prints the quote, sends nothing) and `npm run e2e -- run`.

## Docs

On the site at **`/docs`** (rendered from `apps/web/content/docs/`):

- [docs/agents.md](apps/web/content/docs/agents.md): one file to give a coding agent (also served at `/agents.md`)
- [docs/api.md](apps/web/content/docs/api.md): API reference (keys, endpoints, models, limits, errors)
- [docs/integrations.md](apps/web/content/docs/integrations.md): opencode, Cursor, Continue, Cline, Aider, Zed, SillyTavern, Open WebUI, LiteLLM, SDKs
- [docs/protocol.md](apps/web/content/docs/protocol.md): how it works (wallets, NEAR Intents funding, x402, SIWX, attestation + E2EE, API keys)

## Who can see what

| Party | Anonymous mode | Truly private mode |
|---|---|---|
| Our server | 1Click quote requests (addresses, amounts) through `/api/oneclick`, which adds our partner key, fee and referral, so our server sees your IP, inference wallet and refund address together. No prompts, no keys, no balances. Chat goes browser → Venice directly. | same |
| Venice | Your IP (the browser calls Venice directly), your inference wallet address and your prompts | Your IP, your inference wallet address and **ciphertext only**\* |
| Model host | Prompts (Venice strips identity; "private" tier = Venice-hosted, not retained; "anonymized" tier = third-party host) | Only the attested enclave can decrypt |
| 1Click solver | Deposit and delivery addresses and amounts | same |
| Anyone on-chain | Deposit from your wallet to a 1Click address, USDC arriving at your inference wallet, x402 payment to Venice | same |
| Base RPC provider | Your IP and inference wallet address (balance reads about every 30 s while unlocked) | same |
| Reown relay | Connection metadata, only when using WalletConnect QR / mobile wallets | same |

\* The browser checks that the attestation is fresh, bound to the key it encrypts to, and from a non-debug Intel TDX enclave, and verifies Intel's signature chain itself (in a sandboxed worker, with Intel's data relayed through our server so your browser contacts no third party). Which software runs inside the enclave isn't pinned yet, so against Venice itself this relies on Venice running the code it publishes.

Conversations live in browser memory only. Switching from Truly private back to Anonymous never sends private-mode messages to a non-enclave model. In E2EE mode the history is folded into one encrypted message, because Venice only encrypts user/system roles.

## Reliability design

- **The model proposes, code decides.** Every 1Click quote must echo back exactly what we asked for (assets, amount, recipient, refund address), or nothing is sent.
- **Every swap is a persisted state machine** (`QUOTED → DEPOSIT_SIGNED → DEPOSIT_SENT → DEPOSIT_CONFIRMED → PROCESSING → SUCCESS | REFUNDED | FAILED`). Server-side deposits are signed, persisted, *then* broadcast, so a crash can only rebroadcast the same transaction.
- **Idempotent top-ups.** The x402 authorization is persisted before sending; a retry re-sends the same EIP-3009 authorization, which can only settle once.
- **Honest latency.** Live status at each step; the first mainnet run took 94 s against a quoted 22 s, and the UI says "about 1–2 min".
- **Caps.** $5–$50 per credit top-up, a $25 cap on server-side swaps, and a kill switch for anything automated.

## Security notes

- **Website chat is non-custodial.** The inference key exists only in the browser's memory, or in `~/.rahasya` (mode 0600) for the local proxy; the server never sees it.
- **API keys are server-assisted.** The server holds each user's API wallet key, AES-256-GCM sealed in Redis (`API_WALLET_ENC_KEY`, AAD bound to the user). That wallet only holds Venice credit, which can't be withdrawn; incoming USDC is swept into credit. API keys are stored as SHA-256 hashes only.
- **Audits:** four rounds of AI-assisted security audits (findings F-01..F-13, V2-01..V2-08, R-01/R-02, T-01/T-02, and the v3 report). Fixes have regression tests. Findings left open or only partly closed are listed in the known issues. The record is in [`audit-kit/03-known-issues.md`](audit-kit/03-known-issues.md).
- **Audit kit:** [`audit-kit/`](audit-kit/00-START-HERE.md) has the invariants, threat model, known issues, ready-made auditor prompts and a black-box probe (`npm run audit:probe -- https://rahasya.chat` runs 40 checks against a deployment; it creates throwaway test users and moves no funds). `npm run audit:pack` builds a shareable zip.
- **Headers:** anti-framing (`frame-ancestors 'none'` + `X-Frame-Options: DENY`), so wallet prompts can't be clickjacked; `Referrer-Policy: no-referrer`; `nosniff`; HSTS; a locked-down `Permissions-Policy`. The pages have no strict `default-src` CSP because the WalletConnect modal loads from many origins, but the Intel-verifier worker gets its own (`script-src`/`connect-src 'self'`, `apps/web/public/_headers`), and cookie-authenticated routes only answer the site's own `fetch()`.
- **Local proxy:** binds to 127.0.0.1, requires a local bearer token (constant-time compare), refuses any request with a browser `Origin`, and never logs prompts.
- **`npm audit`** reports upstream advisories, all inside third-party libraries (none in our code):
  - zod < 4.6.6 bundled inside Reown AppKit (our own zod is 4.6.7, not affected);
  - `bigint-buffer` via `@solana/web3.js` 1.x / `spl-token` (we only encode our own amounts; no untrusted decoding);
  - `jayson` / `stream-json` / `uuid` in web3.js's Node RPC client (not on our browser path);
  - `elliptic` (CVE-2025-14505, low, no fixed version) via `@phala/dcap-qvl`: the bug is in signature *generation*; the verifier only verifies, holds no private keys, and runs in a sandboxed worker.

  None has a fix we can apply without breaking those libraries.

## Repository

```
packages/rail     1Click client, asset resolver, swap state machine, Base/Solana depositors,
                  Venice SIWX + x402 client, TEE attestation + E2EE, model catalog, wallet derivation
packages/proxy    local OpenAI-compatible proxy (one-file bundle: rahasya.chat/rahasya.mjs)
apps/web          Next.js site + API (wallet connect, add credit, chat, API keys, docs), on Cloudflare Workers
scripts/audit     black-box probe and audit-kit packer
docs/demo-runs    recorded mainnet runs
docs/state-machines.md  every stateful flow: where its table lives, what to leave alone, DOM state attributes
audit-kit         security audit brief, auditor prompts, findings template
```

## Known limitations

- Abliterated Large Flash / Large V2 are only available as Venice "anonymized" models (third-party host). Use Truly private mode when the content matters.
- Intel's signature chain is verified in the browser, but the enclave's software measurement isn't pinned yet, and NVIDIA GPU evidence is reported by Venice's verifier (shown as such in the UI). Until pinning is done, Truly private mode protects you from everyone except Venice itself, where it relies on Venice running the enclave software it publishes. API keys and the local proxy don't run the in-browser Intel check.
- One-click funding from a connected NEAR wallet isn't built yet; NEAR tokens work through *Any token, anywhere*.
- Venice credit can't be withdrawn. Top up in small amounts.
- On exact-output swaps the small slippage buffer (0.5%) may not be refunded. 1Click's docs say unused input is refunded; on a $5 mainnet swap we didn't see it come back.
- TEE models can't carry tool calls through E2EE, so agentic editors should use a non-TEE model.

## Built with

**Services:** NEAR Intents 1Click, Venice AI (x402, TEE/E2EE), NEAR AI and Phala enclaves (via Venice), Base, Solana, Cloudflare Workers (hosting), Upstash Redis (sessions, API keys, spend counters).

**Libraries:** Next.js, React, viem, wagmi, Reown AppKit, `@hot-labs/near-connect`, `@solana/kit`, `@solana/web3.js`, `@solana/spl-token`, `@solana-program/system`, `@x402/core`, `@x402/evm`, `@noble/curves`, `@noble/hashes`, `@noble/ciphers`, `@phala/dcap-qvl` (Intel TDX quote verification), `@upstash/redis`, `@opennextjs/cloudflare` + wrangler, esbuild, zod, `@tanstack/react-query`, react-markdown, remark-gfm, qrcode, dotenv, TypeScript, tsx.

**AI assistance:** Most of the code was written with Claude Code (Anthropic) as the coding agent, directed and reviewed by the team.

**Baseline:** everything here was written during the hackathon window. The repository was created on 2026-11-07; there is no pre-hackathon code.

## License

MIT, see `LICENSE`.
