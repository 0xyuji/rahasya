# Naisho — Private AI, just between us

Chat with uncensored and abliterated models without an account, a card, or a subscription. You pay with whatever token you hold, from almost any chain, through **NEAR Intents**. A **Truly private** mode runs only on hardware enclaves (TEEs), encrypts every message in your browser, and shows the attestation checks it did before sending.

Built for NEAR HACKATHON (Nov 2026). The name and tagline are swappable config (`apps/web/src/brand.ts`); the code doesn't depend on them.

## The problem

Uncensored models are useful exactly where people least want an account trail: health, legal, security research, fiction, personal questions. Today, using them means a sign-up, a card, and a provider that can read every prompt. Paying with crypto usually means holding the one token on the one chain a provider accepts.

## What it does

1. **Connect any wallet** (EVM, Solana or NEAR). It's your login. One signature derives a separate **inference wallet** in your browser. It's recreated from the same signature on any device and never stored or sent anywhere.
2. **Add credit with any token.** NEAR Intents (1Click) swaps from 216 tokens on 39 chains into USDC on your *own* inference wallet. Your browser then pays Venice over **x402** (USDC on Base). Non-custodial: we never hold funds or keys.
3. **Chat.** Choose a model and a privacy mode in the prompt bar:
   - **Anonymous**: all allowed models, including Abliterated Large V2 / Large Flash. You're unlinkable (wallet auth, no account), but the model host can read the prompt.
   - **Truly private**: TEE models only. The browser fetches an attestation with a fresh nonce, checks it, and encrypts the conversation to a key inside the enclave (ECDH secp256k1 → HKDF-SHA256 → AES-256-GCM). One of the two TEE models runs on **NEAR AI** enclaves.
4. **Use it from your tools.** A local proxy (`npm run proxy -- serve`) exposes an OpenAI-compatible API on `127.0.0.1`, so opencode, Cursor, SillyTavern or the OpenAI SDK can spend the same credit.

## How NEAR fits

| Piece | Role |
|---|---|
| **NEAR Intents 1Click** | Every deposit: any token, any chain → USDC on the user's own Base address. Exact-output (connected wallet) and flex-input (send from anywhere) quotes, status tracking, refunds to the user's address. |
| **NEAR AI** | The default Truly private model (`e2ee-deepseek-v4-1-flash-1017-abliterated`) is attested as `tee_provider: near-ai` (Intel TDX + NVIDIA H100). |
| **NEAR wallets** | Login + derivation via `@hot-labs/near-connect` (NEP-413 `signMessage`). |

## Try it

Requirements: Node 26+ (runs the TypeScript directly), npm.

```sh
npm install
```

### 1. No keys, no money (about 1 minute)

| Do | See |
|---|---|
| `npm test` | **37 tests pass** offline: swap state machine (crash-resume never double-sends, dropped deposits re-signed once, refunds, kill switch, spend cap, tampered quotes refused), E2EE round trip, attestation checks against a real captured quote (replayed nonce, swapped key and debug enclave all rejected), wallet derivation golden vector, privacy-mode context rules, proxy auth/origin guards. |
| `npm run verify:tee` | A live attestation of the NEAR AI enclave model with a fresh nonce: 7 checks done locally from the raw Intel TDX quote, 3 reported by Venice. Uses a throwaway in-memory wallet. |
| `npm run quote:dry` | Live dry quotes from NEAR Intents for $5 of USDC on Base from SOL, ETH and NEAR. |

### 2. The website (your own wallet, real money, minimum $5)

```sh
cp apps/web/.env.example apps/web/.env.local   # add a free Reown project id
npm run dev                                    # http://localhost:3000
```

| Do | See |
|---|---|
| Click **Connect wallet**, pick EVM/Solana or NEAR | Button turns into **Unlock** |
| Click **Unlock**, sign the message | Account menu shows your inference wallet (a Base address). Lock and unlock again: same address. |
| Menu → **Add credit** → *From your wallet* or *Any token, anywhere* | An exact 1Click quote (what you send, what you get, refund address). After sending: live steps, deposit and delivery tx links, then `Added $5.00 of credit`. |
| Type a message in **Anonymous** mode | Streaming reply; footer shows model, privacy tier and cost |
| Switch to **Truly private**, send a message | Reply footer shows **Verified enclave**; click it to see every check, the enclave key, our nonce and the gateway source commit |

### 3. Use it from an editor

Account menu → **Use in your editor** (shows the key behind a warning and setup for opencode, Cursor, SillyTavern, the OpenAI SDK), then:

```sh
npm run proxy -- login    # paste the inference key (hidden input), saved 0600 in ~/.naisho
npm run proxy -- serve    # http://127.0.0.1:8787/v1 + a local API key
```

### 4. Mainnet evidence

`docs/demo-runs/2026-11-07-sol-to-venice.md`: a recorded run with explorer links (SOL → 5.0 USDC on Base via 1Click in 94 s → x402 top-up credited $5 → chat), plus live E2EE runs on both TEE models.

To reproduce it with your own throwaway wallets: `cp .env.example .env`, fund the Solana key with about $6 of SOL, then `npm run e2e -- quote` (prints the quote, sends nothing) and `npm run e2e -- run`.

## Who can see what

| Party | Anonymous mode | Truly private mode |
|---|---|---|
| Our server | 1Click quote requests (addresses, amounts) through `/api/oneclick`, which only adds the partner key. No prompts, no keys, no balances. Chat goes browser → Venice directly. | same |
| Venice | Your inference wallet address and your prompts | Your inference wallet address and **ciphertext only** |
| Model host | Prompts (Venice strips identity; "private" tier = Venice-hosted, not retained; "anonymized" tier = third-party host) | Only the attested enclave can decrypt |
| 1Click solver | Deposit and delivery addresses and amounts | same |
| Anyone on-chain | Deposit from your wallet to a 1Click address, USDC arriving at your inference wallet, x402 payment to Venice | same |
| Reown relay | Connection metadata, only when using WalletConnect QR / mobile wallets | same |

Conversations live in browser memory only. Switching from Truly private back to Anonymous never sends private-mode messages to a non-enclave model. In E2EE mode the history is folded into one encrypted message, because Venice only encrypts user/system roles.

## Reliability design

- **The model proposes, code decides.** Every 1Click quote must echo back exactly what we asked for (assets, amount, recipient, refund address), or nothing is sent.
- **Every swap is a persisted state machine** (`QUOTED → DEPOSIT_SIGNED → DEPOSIT_SENT → DEPOSIT_CONFIRMED → PROCESSING → SUCCESS | REFUNDED | FAILED`). Server-side deposits are signed, persisted, *then* broadcast, so a crash can only rebroadcast the same transaction.
- **Idempotent top-ups.** The x402 authorization is persisted before sending; a retry re-sends the same EIP-3009 authorization, which can only settle once.
- **Honest latency.** Live status at each step; the first mainnet run took 94 s against a quoted 22 s, and the UI says "about 1–2 min".
- **Caps.** $5–$50 per credit top-up, a $25 cap on server-side swaps, and a kill switch for anything automated.

## Repository

```
packages/rail     1Click client, asset resolver, swap state machine, Base/Solana depositors,
                  Venice SIWX + x402 client, TEE attestation + E2EE, model catalog, wallet derivation
packages/proxy    local OpenAI-compatible proxy (naisho serve)
apps/web          Next.js site (wallet connect, add credit, chat, proxy setup)
docs/demo-runs    recorded mainnet runs
```

## Known limitations

- Abliterated Large Flash / Large V2 are only available as Venice "anonymized" models (third-party host). Use Truly private mode when the content matters.
- The Intel DCAP signature chain and NVIDIA GPU evidence are reported by Venice's verifier, not re-verified locally (shown as such in the UI).
- One-click funding from a connected NEAR wallet isn't built yet; NEAR tokens work through *Any token, anywhere*.
- Venice credit can't be withdrawn. Top up in small amounts.
- On exact-output swaps the small slippage buffer (0.5%) may not be refunded.
- TEE models can't carry tool calls through E2EE, so agentic editors should use a non-TEE model.

## Built with

**Services:** NEAR Intents 1Click, Venice AI (x402, TEE/E2EE), NEAR AI and Phala enclaves (via Venice), Base, Solana.

**Libraries:** Next.js, React, viem, wagmi, Reown AppKit, `@hot-labs/near-connect`, `@solana/kit`, `@solana/web3.js`, `@solana/spl-token`, `@x402/core`, `@x402/evm`, `@noble/curves`, `@noble/hashes`, `@noble/ciphers`, zod, `@tanstack/react-query`, react-markdown, remark-gfm, qrcode.

**AI assistance:** Most of the code was written with Claude Code (Anthropic) as the coding agent, directed and reviewed by the team.

**Baseline:** everything here was written during the hackathon window. The repository was created on 2026-11-07; there is no pre-hackathon code.

## License

MIT, see `LICENSE`.
