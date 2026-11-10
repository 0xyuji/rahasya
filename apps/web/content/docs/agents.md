# Rahasya for AI agents

Everything a coding agent or tool needs to use Rahasya, in one file. Raw version: `https://<your-deployment>/agents.md`

## TL;DR

- Rahasya is an **OpenAI-compatible Chat Completions API** for uncensored and abliterated models, served by Venice.
- Point any OpenAI client at the base URL below and use an API key. Billing is prepaid credit; there is no account or card.
- **A person has to create the key and add credit.** Neither can be done through the API.
- Only two endpoints exist: `GET /models` and `POST /chat/completions`. There are no embeddings, image or audio endpoints.

## Connect

| | Hosted API | Local proxy (on the user's machine) |
|---|---|---|
| Base URL | `https://<your-deployment>/api/v1` | `http://127.0.0.1:8787/v1` |
| API key | `nsk_…` | The local key the proxy prints |
| Prompts pass through | Rahasya's server, never stored | Only the user's machine and Venice |

Read the key from an environment variable such as `RAHASYA_API_KEY`. Don't ask anyone to paste a key into a chat, and never print, log or commit one.

Check that it works:

```sh
curl https://<your-deployment>/api/v1/chat/completions \
  -H "Authorization: Bearer $RAHASYA_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"gemma-4-uncensored","messages":[{"role":"user","content":"Say ok"}],"max_tokens":20}'
```

OpenAI SDK:

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "https://<your-deployment>/api/v1", apiKey: process.env.RAHASYA_API_KEY });
const reply = await client.chat.completions.create({
  model: "large-v2",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 1024,
});
```

## If there's no key yet

Ask the person to do this. It takes a wallet and at least $5 in any token:

1. Open `https://<your-deployment>` and connect a wallet (EVM, Solana or NEAR).
2. Account menu → **API keys** → **Sign in with your wallet**.
3. **Add credit** to the API wallet.
4. **New key**. A daily limit, a total limit and a model allowlist are a good idea for agents.
5. Store the key in the environment variable your tool reads.

## Models

`GET /models` is the source of truth for what a key may use. Prices are read live from Venice.

| Model id | Tools | Privacy |
|---|---|---|
| `large-v2` | yes | Anonymized: a third-party host can read the prompt |
| `large-flash` | yes | Anonymized |
| `qwen-3.6-plus` | yes | Anonymized |
| `deepseek-1017-uncensored` | yes | Private: Venice-hosted, not retained |
| `deepseek-uncensored` | yes | Private |
| `qwen-3.8-27b` | yes | Private |
| `gemma-4-uncensored` | yes | Private (cheapest with tools) |
| `venice-uncensored` | yes | Private |
| `venice-roleplay` | yes | Private |
| `deepseek-abliterated-tee` | no | TEE + encryption |
| `gemma-4-26b-tee` | no | TEE + encryption |

- **Agents that call tools need a model with tools.** TEE models can't carry tool definitions, so tools are dropped, and the conversation is folded into one encrypted message.
- **Through the hosted API, TEE prompts are readable on Rahasya's server** while in flight, because that server does the encrypting. For encryption from the user's own device, use the local proxy.

## Request rules

- Use `stream: true` for long outputs. Non-streaming requests fail after 2 minutes. A stream ends after 3 minutes with no data, or 30 minutes in total. After a timeout or a late failure the key keeps its reservation, so retry with care.
- `max_tokens` or `max_completion_tokens` must be 1 to 32768. **Always set one.** Without it the key is charged a reservation for the model's maximum until real usage arrives, which can use up a small limit.
- `n` must be 1. The body limit is 8 MB, and images are sent base64-encoded.
- The rate limit is 60 requests per minute per key.
- Of `venice_parameters`, only `disable_thinking` and `strip_thinking_response` are used. Other keys are dropped.
- In streams, reasoning arrives as `reasoning_content`, and the last chunk before `[DONE]` carries `usage`.

## Errors

The shape is `{ "error": { "message": "...", "type": "<code>", "code": "<code>" } }`.

| HTTP | `code` | What to do |
|---|---|---|
| 400 | `bad_json`, `bad_request`, `unknown_model` | Fix the request. Don't retry it unchanged |
| 401 | `invalid_key`, `expired_key` | Stop and ask the person for a new key |
| 402 | `insufficient_credit` | Stop and ask the person to add credit |
| 403 | `model_not_allowed` | Call `GET /models` and pick an allowed model |
| 413 | `too_large` | Send less, or fewer images at a time |
| 429 | `daily_limit`, `total_limit` | Stop and tell the person. Retrying won't help |
| 429 | `rate_limited` | Wait for the next minute, then retry |
| 5xx | `upstream_error` | Retry with backoff |

## Local proxy

The person runs this (Node.js 22 or newer):

```sh
curl -fsSLO https://<your-deployment>/rahasya.mjs
node rahasya.mjs          # first run asks for the inference key, with hidden input
node rahasya.mjs token    # prints the local API key
```

The inference key can spend the user's credit and move any USDC on that wallet. Never ask for it or read it. The proxy only answers on localhost and refuses requests that have a browser `Origin` header, so call it from a CLI, SDK or editor, not from a web page.

## More

- [API reference](https://<your-deployment>/docs/api): full model table, limits, errors
- [Integrations](https://<your-deployment>/docs/integrations): opencode, Cursor, Continue, Cline, Aider, Zed, SillyTavern, Open WebUI, LiteLLM
- [How it works](https://<your-deployment>/docs/protocol): wallets, payments, attestation, who can see what
