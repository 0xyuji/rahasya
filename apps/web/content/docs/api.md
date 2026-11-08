# API reference

An OpenAI-compatible API for uncensored and abliterated models. You pay with credit you added from any token on any chain; there is no account and no card.

```
Base URL   https://<your-deployment>/api/v1        (local dev: http://localhost:3000/api/v1)
Auth       Authorization: Bearer nsk_…
```

Anything that speaks the OpenAI Chat Completions API works: the official SDKs, opencode, Cursor, Continue, Cline, Aider, SillyTavern, Open WebUI, LiteLLM. Setup for each is in [integrations.md](integrations.md).

## Getting a key

1. Open the site and **connect a wallet** (EVM, Solana or NEAR).
2. Account menu → **API keys** → **Sign in with your wallet**. This signs a one-time message; it is not a transaction.
3. **Add credit** to your API wallet: from your connected wallet, from any token on any chain via NEAR Intents, or by sending USDC on Base directly. The minimum per top-up is $5 (Venice's minimum).
4. **New key**: give it a name and, optionally, a daily limit, a total limit, an allowed-model list and an expiry.
5. **Copy the key now.** It's shown exactly once. We only keep a hash of it.

Keys look like `nsk_` followed by 40 URL-safe characters. Treat them like passwords: anyone holding one can spend that key's share of your credit, up to its limits.

## Endpoints

### `GET /v1/models`

Lists the models this key may use (all of them, or the key's allowlist).

```sh
curl $BASE/models -H "Authorization: Bearer $KEY"
```

```json
{ "object": "list", "data": [ { "id": "large-v2", "object": "model", "name": "Abliterated Large V2", "venice_id": "abliteration-abliterated-model-large-v2", "privacy": "anonymized" } ] }
```

### `POST /v1/chat/completions`

Standard OpenAI Chat Completions request and response.

```sh
curl $BASE/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"large-v2","messages":[{"role":"user","content":"Hello"}]}'
```

- **`model`**: one of the ids below. The underlying Venice id (`venice_id`) is accepted too.
- **`stream: true`**: returns Server-Sent Events in OpenAI chunk format. The last chunk before `[DONE]` carries `usage` (we always request it, because it's how spend is metered).
- **Tools / function calling**: passed through unchanged for every model except the TEE models (see below).
- **Other parameters** (`temperature`, `max_tokens`, `top_p`, `response_format`, `reasoning_effort`, …) are passed through to Venice. You may also send `venice_parameters`; we always set `include_venice_system_prompt: false`, so the model gets only your prompt.

### Models

| Model id | Name | Based on | Privacy | Tools | Fallback price in / out per 1M tokens |
|---|---|---|---|---|---|
| `large-flash` | Abliterated Large Flash | DeepSeek V4.1 Flash | Anonymized (third-party host) | yes | $1.25 / $2.50 |
| `large-v2` | Abliterated Large V2 | GLM 5.3 | Anonymized (third-party host) | yes | $3 / $5 |
| `qwen-3.6-plus` | Qwen 3.6 Plus Uncensored | Qwen 3.6 Plus | Anonymized (third-party host) | yes | $0.625 / $3.75 |
| `deepseek-1017-uncensored` | DeepSeek V4.1 Flash 1017 Uncensored | DeepSeek V4.1 Flash 1017, abliterated | Private (Venice-hosted) | yes | $0.33 / $1.32 |
| `deepseek-uncensored` | DeepSeek V4.1 Flash Uncensored | DeepSeek V4.1 Flash, abliterated | Private (Venice-hosted) | yes | $0.33 / $1.32 |
| `qwen-3.8-27b` | Qwen 3.8 27B Uncensored | Qwen 3.8 27B | Private (Venice-hosted) | yes | $0.45 / $3.20 |
| `gemma-4-uncensored` | Gemma 4 Uncensored | Gemma 4 | Private (Venice-hosted) | yes | $0.1625 / $0.50 |
| `venice-uncensored` | Venice Uncensored 1.2 | Mistral Small 24B | Private (Venice-hosted) | yes | $0.20 / $0.90 |
| `venice-roleplay` | Venice Role Play Uncensored | Mistral Small 24B | Private (Venice-hosted) | yes | $0.50 / $2 |
| `deepseek-abliterated-tee` | DeepSeek V4.1 Flash 1017 Abliterated | DeepSeek V4.1 Flash 1017, abliterated | TEE + E2EE (NEAR AI enclave) | no | $0.375 / $1.50 |
| `gemma-4-26b-tee` | Gemma 4 26B A4B Uncensored | Gemma 4 26B A4B | TEE + E2EE (Phala enclave) | no | $0.19 / $0.88 |

Prices are Venice's and are read live (refreshed every 10 minutes). The table shows the values used only if the live catalog can't be reached.

**Privacy tiers when using a key:**
- **Anonymized:** Venice strips your identity and a third-party host serves the model. The host can read the prompt.
- **Private:** Venice hosts the model and doesn't retain prompts.
- **TEE:** the model runs inside an attested hardware enclave. Through the API, **our server** is the E2EE endpoint: it encrypts to the enclave and decrypts the reply, so the prompt is in plaintext on our server while the request is in flight (never stored). E2EE can't carry tool definitions, so tools are dropped for these two models and the conversation history is folded into a single encrypted message. If you need end-to-end encryption from your own device, use **Truly private** mode on the website or the local proxy (see below).

## Limits

Each key can have:

| Setting | Effect |
|---|---|
| Daily limit (USD) | Requests are refused once that day's spend (UTC) reaches it |
| Total limit (USD) | Requests are refused once the key's lifetime spend reaches it |
| Allowed models | Requests for other models are refused (`403`) |
| Expiry | The key stops working after this time |
| Rate | 60 requests per minute per key (fixed) |

Spend is metered per request from the actual token usage Venice returns, times the model's live price. A limit is checked **before** each request, so one long request can end slightly over the limit; the next one is refused.

You can edit a key's name, limits and models at any time, and delete it. Deleting takes effect immediately.

## Credit and the API wallet

Keys spend from your **API wallet**, a Base address our server holds the key for (encrypted at rest). It only ever holds Venice credit:

- USDC that arrives on it is turned into Venice credit straight away with an x402 top-up (signed by our server).
- Venice credit can only be spent on inference. It can't be withdrawn or sent anywhere, by you or by us.

If a request finds the credit empty but USDC is waiting on the API wallet, the server tops up and retries once, automatically.

Your website chat uses a different wallet, the **inference wallet**, which exists only in your browser. The two balances are separate. See [protocol.md](protocol.md).

## Errors

Errors use the OpenAI shape: `{ "error": { "message": "...", "type": "<code>", "code": "<code>" } }`.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_json` | Body isn't valid JSON |
| 400 | `unknown_model` | Model id isn't in the list above |
| 401 | `invalid_key` | Wrong, malformed or deleted key |
| 401 | `expired_key` | Key passed its expiry |
| 402 | `insufficient_credit` | API wallet is out of credit. Add credit on the site |
| 403 | `model_not_allowed` | The key's allowlist excludes this model |
| 413 | `too_large` | Request body over 8 MB (images are sent base64-encoded, so send a few at a time) |
| 429 | `daily_limit` / `total_limit` | The key hit a spend limit |
| 429 | `rate_limited` | More than 60 requests in a minute on this key |
| 502 | `upstream_error` | Venice or the network failed; safe to retry |

## What we log and store

- **Stored** (Redis): your user id (wallet address), the API wallet (address + encrypted key), each key's **hash** and settings, per-key spend counters, short-lived sign-in challenges and sessions.
- **Never stored or logged:** prompts, replies, key plaintext.
- **Seen in transit:** prompts pass through our server on their way to Venice (see the privacy tiers above).

## Local proxy alternative

If you don't want anything passing through our server, run the proxy on your own machine. It uses your browser **inference wallet** directly, and TEE models are then end-to-end encrypted from your device:

```sh
curl -fsSL https://<your-deployment>/rahasya.mjs -o rahasya.mjs   # one readable file; needs Node.js 22+
node rahasya.mjs     # first run asks for the key from account menu → Local proxy, then serves
```

It prints `http://127.0.0.1:8787/v1` and a local API key. Later runs start straight away (`node rahasya.mjs --help` lists the other commands). The site publishes the file's SHA-256 at `/rahasya.mjs.sha256` and shows it in the Local proxy dialog. The file is built from `packages/proxy` in this repo (`npm run -w @pay/proxy bundle`), so you can also run it from a clone with `npm run proxy`.

Same API, same model ids. Point your tool at `http://127.0.0.1:8787/v1` with the local key instead.
