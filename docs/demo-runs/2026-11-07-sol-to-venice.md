# Mainnet run, 2026-11-07: SOL → USDC on Base (NEAR Intents 1Click) → Venice x402 top-up → chat

Command: `node --env-file=../../.env scripts/e2e.ts quote` then `... run swap_c6289e3027d848f0` (from `packages/rail`).
Wallets are throwaway burners generated for this test.

> Recorded on 2026-11-07, early in the build. Some details have changed since: the chat model used here is no longer in the catalog, the exact-output slippage buffer is now 0.5% (was 1%), and the product was renamed (old env names like `NAISHO_API_KEY`). The flow itself (1Click swap → x402 top-up → chat, and E2EE on both TEE models) is unchanged.

| Step | Result | Proof |
|---|---|---|
| Quote (EXACT_OUTPUT 5.0 USDC) | send 0.056652587 SOL (~$5.07), min 0.056086061 | 1Click correlationId `fd209080-eff0-4168-acb6-f7a942c846ef` |
| Deposit (Solana, signed → persisted → broadcast) | confirmed in ~3 s | [solscan](https://solscan.io/tx/52wB3wmTyGRpwACfvssYCpcJE19xvySK4K8kjg87W8Ni66UsDFhYdSN3W5YRMTU6kEdJgpiSaFH5J3ZpkUYYHtkN) |
| 1Click settlement | SUCCESS, 5.0 USDC delivered, 0.056096212 SOL used | intents `9bA81gQy…`, `AfHRxEtw…`; [basescan payout](https://basescan.org/tx/0x372d647cbe11ac635070c40f7abdf9e3791cb6377140cdf6d620c54911631919) |
| Venice x402 top-up ($5, EIP-3009, gasless for payer) | `amountCredited: 5`, `newBalance: 5` | paymentId `x402-f5838da37ef8006ea04c45fc849bc8c6` |
| Chat on `olafangensan-glm-4.7-flash-heretic` | `"rail works"` (with `disable_thinking`) | balance after: $4.99998955 |

State machine history (persisted in `data/swaps.json`):

```
15:37:42.025Z QUOTED
15:38:23.239Z DEPOSIT_SIGNED
15:38:23.370Z DEPOSIT_SENT
15:38:26.526Z DEPOSIT_CONFIRMED
15:38:26.832Z PROCESSING
15:39:55.824Z SUCCESS          (≈94 s deposit→delivery; quote estimated 22 s)
```

Observations (honest notes):
- Real latency was ~94 s vs the quoted 22 s estimate; ~68 s of it was 1Click registering the Solana deposit. UI copy should say "~1–2 min".
- The 1% slippage buffer (0.000556 SOL ≈ $0.05) had **not** been refunded at time of writing (`refundedAmount: 0`). Likely below an economic refund threshold; consider lower slippage for EXACT_OUTPUT.
- First chat attempt returned `""`: the reasoning model spent all 20 `max_tokens` thinking. Fixed with `venice_parameters.disable_thinking`.
- `X-Balance-Remaining` was not present on chat responses; read balance from `GET /x402/balance/{address}` (response is wrapped in `{success, data}`).

## Follow-up: E2EE + attestation (same day, `scripts/check-e2ee.ts`)

Paid via the same x402 credit; prompt sent as ciphertext, reply decrypted locally. 7 checks done locally from raw bytes, 3 reported by Venice's verifier.

| Model | TEE provider | Hardware | Local checks | Server checks | Reply (decrypted) |
|---|---|---|---|---|---|
| `e2ee-gemma-4-26b-a4b-uncensored-p` | phala | Intel TDX + NVIDIA Hopper | 7/7 | 3/3 | `"sealed and delivered"` (3 encrypted chunks, 0 plaintext) |
| `e2ee-deepseek-v4-1-flash-1017-abliterated` | **near-ai** | Intel TDX + NVIDIA Hopper | 7/7 | 3/3 | `"sealed and delivered"` (2 encrypted chunks, 0 plaintext) |

Local checks: nonce echoed; model id; keccak(enclave pubkey) == signing address; TDX quote v4 / type 0x81; quote REPORTDATA binds our nonce; quote REPORTDATA binds enclave address; TD debug bit off.
Not checked locally (shown as server-verified): Intel DCAP quote signature + cert chain, NVIDIA GPU evidence.

## Follow-up: opencode through the local proxy (2026-11-08)

`npm run proxy -- serve` (burner inference wallet) + a project-local `opencode.jsonc` using
`"package": "@opencode/ai/providers/openai-compatible"`, `"settings": { "baseURL": "http://127.0.0.1:<port>/v1" }`,
`"env": ["NAISHO_API_KEY"]` (the proxy's local token). `opencode run --standalone -m naisho/gemma-4-uncensored "…"` (opencode v2.1.3)
replied `opencode works through naisho`; the proxy logged two calls (reply + session title) with model and latency only.
Not yet run here: an agentic tool-call session (needs interactive approval in opencode).
