# API reference

The Rahasya API is compatible with the OpenAI Chat Completions API. Existing OpenAI code works after you change the base URL, the API key and the model id. Usage is paid from prepaid credit, which you can add with any token on almost any chain. No account or card is required.

## Summary

- Base URL `https://<your-deployment>/api/v1`, authenticated with `Authorization: Bearer nsk_…`. Two endpoints: `GET /models` and `POST /chat/completions`.
- 11 models. Nine support tools; the two TEE models are end-to-end encrypted and do not support tools.
- Prices are Venice's published prices, read live, with no markup. Credit is prepaid and is added on the website by a person.
- Each key can have a daily and a total limit in US dollars, a model allowlist and an expiry. The rate limit is fixed at 60 requests per minute per key.
- Always set `max_tokens` (between 1 and 32768).

```
Base URL   https://<your-deployment>/api/v1        (local development: http://localhost:3000/api/v1)
Auth       Authorization: Bearer nsk_…
```

Any client that implements the OpenAI Chat Completions API is supported, including the official SDKs, opencode, Cursor, Continue, Cline, Aider, SillyTavern, Open WebUI and LiteLLM. Configuration for each is in [Integrations](integrations.md).

## Create an API key

1. Open the site and **connect a wallet** (EVM, Solana or NEAR).
2. In the account menu, select **API keys**, then **Sign in with your wallet**. This signs a single-use message; it is not a transaction.
3. Select **Add credit** to fund your API wallet. You can pay from the connected wallet, with any token on any chain through NEAR Intents, or by sending USDC on Base directly. The minimum top-up is $5, which is Venice's minimum.
4. Select **New key**. Give it a name and, optionally, a daily limit, a total limit, a list of allowed models and an expiry.
5. **Copy the key immediately.** It is displayed once. Rahasya stores only a hash of it.

Keys consist of `nsk_` followed by 40 URL-safe characters. Treat them as passwords: anyone who holds a key can spend that key's share of your credit, up to its limits.

## Endpoints

The examples below use two shell variables:

```sh
export BASE=https://<your-deployment>/api/v1
export KEY=nsk_…
```

### `GET /v1/models`

Returns the models available to this key: all models, or only those in the key's allowlist.

```sh
curl $BASE/models -H "Authorization: Bearer $KEY"
```

```json
{ "object": "list", "data": [ { "id": "large-v2", "object": "model", "name": "Abliterated Large V2", "venice_id": "abliteration-abliterated-model-large-v2", "privacy": "anonymized" } ] }
```

### `POST /v1/chat/completions`

Accepts a standard OpenAI Chat Completions request and returns a standard response.

```sh
curl $BASE/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"large-v2","messages":[{"role":"user","content":"Hello"}],"max_tokens":200}'
```

- **`model`**: one of the model ids listed below. The underlying Venice id (`venice_id`) is also accepted.
- **`stream: true`**: returns Server-Sent Events in the OpenAI chunk format. On every model except the two TEE models, the last chunk before `[DONE]` includes `usage`.
- **Tools and function calling**: passed through unchanged on every model except the TEE models. TEE models accept only `messages`, `max_tokens` and `temperature`; all other fields, including tools, `top_p`, `response_format`, `venice_parameters` and images, are ignored.
- **Other parameters** (`temperature`, `max_tokens`, `top_p`, `response_format`, `reasoning_effort` and others) are passed through to Venice. Of `venice_parameters`, only `disable_thinking` and `strip_thinking_response` are used; other keys are removed, because per-request features such as web search cannot be metered per token. Rahasya always sets `include_venice_system_prompt: false`, so the model receives only your prompt.
- **Output limit**: `max_tokens` or `max_completion_tokens`, between 1 and 32768. If neither is set, the model's maximum applies, and the key is charged a reservation for that maximum until actual usage is known. `n` must be 1.
- **Timeouts**: a request ends after 3 minutes without data from Venice, or after 30 minutes in total, whether or not it streams. Use `stream: true` for long replies: if a client disconnects from a silent non-streamed request, the key can remain charged the full reservation. When a request times out or fails late, the key keeps its reservation, because Venice may already have generated and billed the reply. A 500, 502 or 503 that occurs quickly is refunded. When the key has been charged, the response includes `x-should-retry: false`.

**Migrating from OpenAI:** change the base URL, the API key and the model id. The request and response formats are unchanged, within the limits described on this page.

### Supported features

| Feature | Support |
|---|---|
| Streaming (`stream: true`) | Every model |
| Tools / function calling | Every model except the two TEE models |
| Structured output (`response_format`) | Every model except the two TEE models |
| Reasoning | Depends on the model. Streams deliver it as `reasoning_content`; `venice_parameters.disable_thinking` disables it (not on TEE models) |
| Image input | Depends on the model; see the model's page on Venice. Images are sent base64-encoded, within the 8 MB limit |
| `n` other than 1 | Not supported |
| Embeddings, image generation, audio, the Responses API | Not supported. Only `GET /models` and `POST /chat/completions` are available |

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

Prices are Venice's and are read live, refreshed every 10 minutes. The table shows the fallback values, which apply only if the live catalog cannot be reached.

**Privacy tiers through the API:**

- **Anonymized:** Venice states that it removes your identity, and a third-party host serves the model. The host can read the prompt.
- **Private:** Venice hosts the model and states that it does not retain prompts.
- **TEE:** the model runs inside an attested hardware enclave. Through the API, **our server** is the end-to-end encryption endpoint: it encrypts the request to the enclave and decrypts the reply, so the prompt is in plaintext on our server while the request is in flight. It is never stored. End-to-end encryption cannot carry tool definitions, so tools are dropped for these two models and the conversation history is folded into a single encrypted message. For end-to-end encryption from your own device, use **Truly private** mode on the website or the local proxy described below.

## Limits

Each key can have the following settings:

| Setting | Effect |
|---|---|
| Daily limit (USD) | Requests are refused once the day's spend (UTC) reaches the limit |
| Total limit (USD) | Requests are refused once the key's lifetime spend reaches the limit |
| Allowed models | Requests for other models are refused with `403` |
| Expiry | The key stops working after this time |
| Rate | 60 requests per minute per key (fixed) |

Spend is metered per request, from the actual token usage that Venice reports multiplied by the model's live price. Limits are checked **before** each request, so a single long request can finish slightly over a limit; the next request is then refused.

You can change a key's name, limits and models, or delete the key, at any time. Deletion takes effect immediately.

## Credit and the API wallet

API keys spend from your **API wallet**, a Base address whose private key is held by our server and encrypted at rest. The API wallet is used for inference only:

- USDC that arrives on the API wallet is converted into Venice credit through an x402 top-up signed by our server. Conversion happens when the Add credit dialog detects the USDC, or on the next request that finds the credit exhausted; in that case the server tops up and retries the request once. Amounts under $5 remain as USDC, and at most $200 is converted at a time.
- Venice credit can be spent only on inference. It cannot be withdrawn or transferred, by you or by us. USDC that has not yet been converted is held on a key that our server controls.

Website chat uses a separate wallet, the **inference wallet**, which exists only in your browser. The two balances are independent. See [How it works](protocol.md).

## Errors

Errors follow the OpenAI format: `{ "error": { "message": "...", "type": "<code>", "code": "<code>" } }`.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_json` | The body is not valid JSON |
| 400 | `unknown_model` | The model id is not in the list above |
| 400 | `bad_request` | `max_tokens` is out of range, `n` is not 1, or `messages` is not an array |
| 400 | other lowercase codes | The request was refused before reaching the model; `message` explains why |
| 401 | `invalid_key` | The key is wrong, malformed or deleted |
| 401 | `expired_key` | The key has passed its expiry |
| 402 | `insufficient_credit` | The API wallet has no credit. Add credit on the site |
| 403 | `model_not_allowed` | The key's allowlist does not include this model |
| 413 | `too_large` | The request body exceeds 8 MB. Images are base64-encoded, so send a few at a time |
| 429 | `daily_limit` / `total_limit` | The key has reached a spend limit |
| 429 | `rate_limited` | More than 60 requests in one minute on this key |
| 503 | `busy` | Too many large requests at once (one large request per key at a time, per server instance: a body over 1 MB, or one sent without a declared length). Retry shortly |
| 4xx / 5xx | `upstream_error` | Venice or the network failed. The status is Venice's when available, otherwise 502. Retry on 5xx |

## Data storage and logging

- **Stored** in Redis, hosted by Upstash: your user id (wallet address); the API wallet (address and encrypted key); each key's **hash**, name, 10-character prefix, settings and last-used time; per-key spend counters; top-up records with their signed x402 authorizations (kept for 7 days); short-lived sign-in challenges and sessions; and per-IP rate-limit counters (kept for 2 minutes).
- **Hosting logs:** Cloudflare keeps request logs containing metadata such as path, status and IP address, but not request bodies.
- **Never stored or logged:** prompts, replies and API keys in plaintext.
- **Visible in transit:** prompts pass through our server on their way to Venice, as described under the privacy tiers above.

## Local proxy alternative

To keep our server out of the request path, run the proxy on your own machine. It pays from your **inference wallet** directly, and requests to TEE models are then end-to-end encrypted from your device.

```sh
npx rahasya@0.1.2    # requires Node.js 22 or later; the first run asks for the key from account menu → Local proxy

# or, as a single readable file:
curl -fsSLO https://<your-deployment>/rahasya.mjs
curl -fsSLO https://<your-deployment>/rahasya.mjs.sha256
shasum -a 256 -c rahasya.mjs.sha256   # Linux: sha256sum -c rahasya.mjs.sha256
node rahasya.mjs
```

The proxy prints `http://127.0.0.1:8787/v1` and a local API key. Later runs start immediately; `node rahasya.mjs --help` lists the other commands. The site publishes the file's SHA-256 checksum at `/rahasya.mjs.sha256` and displays it in the Local proxy dialog. The file is built from `packages/proxy` in this repository (`npm run -w @pay/proxy bundle`), and you can also run the proxy from a clone with `npm run proxy`.

The model ids are the same. Point your tool at `http://127.0.0.1:8787/v1` with the local key. The proxy applies none of the key limits, parameter filtering or rate limit described above, and its timeouts differ: a stream stops after 3 minutes of silence or 30 minutes in total, and a non-streamed request to a non-TEE model after 120 seconds (TEE requests always stream upstream, so they get the stream limits). It maps the model id, turns off Venice's system prompt, and enforces the model list and an 8 MB body cap. For TEE models it sends only the text of the messages (the history is folded into the encrypted request; tool definitions, images and every other parameter except the output limit and temperature are dropped), sends no usage chunk in streams, and reports `finish_reason: "stop"`. Its errors use the code `proxy_error`, except `insufficient_credit` (402) when the wallet is out of credit.
