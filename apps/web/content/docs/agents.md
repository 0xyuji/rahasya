# Rahasya for AI agents

This page contains everything a coding agent or tool needs to use Rahasya. It is also available as plain Markdown at `https://<your-deployment>/agents.md`.

## Summary

- Rahasya is an **OpenAI-compatible Chat Completions API** for uncensored and abliterated models, served by Venice.
- Point any OpenAI client at the base URL below and authenticate with an API key. Billing uses prepaid credit; there is no account or card.
- **A person must create the key and add credit.** Neither action is available through the API.
- The API exposes two endpoints: `GET /models` and `POST /chat/completions`. It has no embeddings, image or audio endpoints.

## Connection

| | Hosted API | Local proxy (on the user's machine) |
|---|---|---|
| Base URL | `https://<your-deployment>/api/v1` | `http://127.0.0.1:8787/v1` |
| API key | `nsk_…` | The local key printed by the proxy |
| Prompts pass through | Rahasya's server (never stored), then Venice and the model host | The user's machine, then Venice and the model host |

Read the key from an environment variable such as `RAHASYA_API_KEY`. Do not ask anyone to paste a key into a chat, and never print, log or commit one.

To confirm that the key works:

```sh
curl https://<your-deployment>/api/v1/chat/completions \
  -H "Authorization: Bearer $RAHASYA_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemma-4-uncensored","messages":[{"role":"user","content":"Say ok"}],"max_tokens":20}'
```

With the OpenAI SDK:

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "https://<your-deployment>/api/v1", apiKey: process.env.RAHASYA_API_KEY });
const reply = await client.chat.completions.create({
  model: "large-v2",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 1024,
});
```

## Obtaining a key

If no key is available, ask the person to complete these steps. They require a wallet and at least $5 in any token.

1. Open `https://<your-deployment>` and connect a wallet (EVM, Solana or NEAR).
2. In the account menu, select **API keys**, then **Sign in with your wallet**.
3. Select **Add credit** to fund the API wallet.
4. Select **New key**. For agents, a daily limit, a total limit and a model allowlist are recommended.
5. Store the key in the environment variable that your tool reads.

## Models

`GET /models` is the authoritative list of models available to a key. Prices are read live from Venice.

| Model id | Tools | Privacy |
|---|---|---|
| `large-v2` | yes | Anonymized: a third-party host can read the prompt |
| `large-flash` | yes | Anonymized |
| `qwen-3.6-plus` | yes | Anonymized |
| `deepseek-1017-uncensored` | yes | Private: hosted by Venice, not retained |
| `deepseek-uncensored` | yes | Private |
| `qwen-3.8-27b` | yes | Private |
| `gemma-4-uncensored` | yes | Private (lowest cost with tools) |
| `venice-uncensored` | yes | Private |
| `venice-roleplay` | yes | Private |
| `deepseek-abliterated-tee` | no | TEE with end-to-end encryption |
| `gemma-4-26b-tee` | no | TEE with end-to-end encryption |

- **Agents that call tools must use a model with tool support.** End-to-end encryption cannot carry tool definitions, so TEE models drop them and receive the conversation as a single encrypted message.
- **Through the hosted API, TEE prompts are readable on Rahasya's server while in flight,** because that server performs the encryption. For encryption on the user's own device, use the local proxy.

## Request rules (hosted API)

The local proxy forwards requests unchanged, without these limits or filters. All of its errors use the code `proxy_error`.

- A request ends after 3 minutes without data from Venice, or after 30 minutes in total, whether or not it streams. Streaming reports progress sooner. After a timeout or a late failure, the key keeps its reservation, so retry with care.
- `max_tokens` or `max_completion_tokens` must be between 1 and 32768. **Always set one.** Without it, the key is charged a reservation for the model's maximum output until actual usage is known, which can exhaust a small limit.
- `n` must be 1. The request body limit is 8 MB, and images are sent base64-encoded.
- The rate limit is 60 requests per minute per key.
- Of `venice_parameters`, only `disable_thinking` and `strip_thinking_response` are used. Other keys are removed.
- In streams, reasoning arrives as `reasoning_content`, and the last chunk before `[DONE]` carries `usage` (except on TEE models).

## Errors (hosted API)

Errors use this shape: `{ "error": { "message": "...", "type": "<code>", "code": "<code>" } }`.

| HTTP | `code` | Recommended action |
|---|---|---|
| 400 | `bad_json`, `bad_request`, `unknown_model` | Correct the request. Do not retry it unchanged |
| 401 | `invalid_key`, `expired_key` | Stop and ask the person for a new key |
| 402 | `insufficient_credit` | Stop and ask the person to add credit |
| 403 | `model_not_allowed` | Call `GET /models` and choose an allowed model |
| 413 | `too_large` | Send less content, or fewer images per request |
| 429 | `daily_limit`, `total_limit` | Stop and inform the person. Retrying will not help |
| 429 | `rate_limited` | Wait for the next minute, then retry |
| 503 | `busy` | Too many large requests are in progress. Retry shortly |
| 5xx | `upstream_error` | Retry with backoff, unless the response includes `x-should-retry: false`, which means the key was charged |

## Local proxy

The person runs the proxy with Node.js 22 or later:

```sh
npx rahasya@0.1.1         # the first run asks for the inference key, with hidden input
npx rahasya@0.1.1 token   # prints the local API key
```

The inference key can spend the user's credit and move any USDC held by that wallet. Never ask for it or read it. The proxy answers only on localhost and refuses requests that carry a browser `Origin` header, so call it from a CLI, an SDK or an editor rather than a web page.

## Related pages

- [API reference](https://<your-deployment>/docs/api): complete model table, limits and errors
- [Integrations](https://<your-deployment>/docs/integrations): opencode, Cursor, Continue, Cline, Aider, Zed, SillyTavern, Open WebUI and LiteLLM
- [How it works](https://<your-deployment>/docs/protocol): wallets, payments, attestation, and what each party can see
