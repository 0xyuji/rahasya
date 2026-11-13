# Integrations

This page explains how to configure editors, coding agents and chat applications to use Rahasya.

## Summary

- Every tool uses the same base URL and an `nsk_…` API key.
- Coding agents that call tools require a non-TEE model: `large-v2` (most capable), `large-flash` (fastest) or `deepseek-1017-uncensored` (lowest cost).
- opencode has been tested end to end, and the site generates its configuration when you create a key. The other configurations follow each tool's published documentation.
- To keep our server out of the request path, point the same configurations (except Cursor) at the local proxy.

## Endpoint

All of the tools below connect to the same OpenAI-compatible endpoint:

```
Base URL   https://<your-deployment>/api/v1
API key    nsk_…   (account menu → API keys)
Model      large-v2, large-flash, deepseek-1017-uncensored, …   (full list in the API reference)
```

For coding agents that call tools (opencode, Cline, Aider, and Continue in agent mode), choose a **non-TEE** model. End-to-end encryption cannot carry tool definitions, so the two TEE models do not support tools.

The configurations below reflect each tool's documented format as of November 2026. If a tool's settings have moved, look for options labelled "OpenAI-compatible", "custom base URL" or "OpenAI API base".

## opencode

Tested with opencode 2.1.3. Add a provider to `~/.config/opencode/opencode.jsonc`, or to `opencode.jsonc` in a project:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "rahasya/large-v2",
  "enabled_providers": ["rahasya"],
  "providers": {
    "rahasya": {
      "name": "Rahasya",
      "env": ["RAHASYA_API_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "https://<your-deployment>/api/v1" },
      "models": {
        "large-flash":              { "name": "Abliterated Large Flash", "cost": { "input": 1.25, "output": 2.5 } },
        "large-v2":                 { "name": "Abliterated Large V2", "cost": { "input": 3, "output": 5 } },
        "qwen-3.6-plus":            { "name": "Qwen 3.6 Plus Uncensored", "cost": { "input": 0.625, "output": 3.75 } },
        "deepseek-1017-uncensored": { "name": "DeepSeek V4.1 Flash 1017 Uncensored", "cost": { "input": 0.33, "output": 1.32 } },
        "deepseek-uncensored":      { "name": "DeepSeek V4.1 Flash Uncensored", "cost": { "input": 0.33, "output": 1.32 } },
        "qwen-3.8-27b":             { "name": "Qwen 3.8 27B Uncensored", "cost": { "input": 0.45, "output": 3.2 } },
        "gemma-4-uncensored":       { "name": "Gemma 4 Uncensored", "cost": { "input": 0.1625, "output": 0.5 } },
        "venice-uncensored":        { "name": "Venice Uncensored 1.2", "cost": { "input": 0.2, "output": 0.9 } },
        "venice-roleplay":          { "name": "Venice Role Play Uncensored", "cost": { "input": 0.5, "output": 2 } }
      }
    }
  }
}
```

```sh
export RAHASYA_API_KEY=nsk_…
opencode --standalone                     # or: opencode run --standalone -m rahasya/large-v2 "explain this repo"
```

When you create a key, the website shows this configuration with your key and URL filled in. If the key has a model allowlist, the configuration lists only those models.

### Troubleshooting

- **Configuration file name.** opencode reads only `opencode.json` or `opencode.jsonc`. A file named `config.json` is ignored, and opencode falls back to its built-in providers without warning.
- **"Invalid API key." on the first request.** opencode 2 runs a background service that does not see variables exported after it started. Start opencode with `--standalone` from the terminal where you exported the key.
- **Other providers appear in the model list.** `enabled_providers` restricts opencode to this provider. Remove that line to keep opencode's built-in providers as well.
- **Spend shown in the sidebar.** opencode estimates spend from each model's `cost` (US dollars per million tokens, at Venice's list prices). The amount actually charged to your key is shown in the API keys dialog.
- **Some models are missing.** opencode lists only the models named under `models`. The configuration above includes every model that supports coding agents; the two TEE models are omitted because they do not support tools.

## Cursor

In Settings, open **Models**:

1. Enable **OpenAI API Key** and paste your `nsk_…` key.
2. Enable **Override OpenAI Base URL** and enter `https://<your-deployment>/api/v1`.
3. Select **Add model** for each model id you want, for example `large-v2`, and choose it in chat.

Cursor sends requests for custom models from its own servers. Your prompts therefore also pass through Cursor, and Cursor cannot reach a local proxy on `127.0.0.1`. Some features, such as tab completion and certain agent tools, use Cursor's own models regardless of your selection.

## Continue (VS Code and JetBrains)

In `~/.continue/config.yaml`:

```yaml
models:
  - name: Abliterated Large V2
    provider: openai
    model: large-v2
    apiBase: https://<your-deployment>/api/v1
    apiKey: nsk_…
    roles: [chat, edit, apply]
```

## Cline, Roo Code and Kilo Code

In Settings, set **API Provider** to **OpenAI Compatible**:

- Base URL: `https://<your-deployment>/api/v1`
- API Key: `nsk_…`
- Model ID: `large-v2`

## Aider

```sh
aider --openai-api-base https://<your-deployment>/api/v1 \
      --openai-api-key nsk_… \
      --model openai/large-v2
```

The `openai/` prefix tells Aider (through LiteLLM) to use the OpenAI-compatible route with your base URL.

## Zed

In `settings.json`:

```json
{
  "language_models": {
    "openai_compatible": {
      "Rahasya": {
        "api_url": "https://<your-deployment>/api/v1",
        "available_models": [{ "name": "large-v2", "display_name": "Abliterated Large V2", "max_tokens": 128000 }]
      }
    }
  }
}
```

Zed prompts for the API key the first time you use the provider.

## SillyTavern

In **API Connections**, select **Chat Completion**, then set **Source** to **Custom (OpenAI-compatible)**:

- Custom Endpoint (Base URL): `https://<your-deployment>/api/v1`
- Custom API Key: `nsk_…`
- Model: `venice-roleplay` (tuned for roleplay) or `large-v2`

For long roleplay sessions, consider a dedicated key with a daily limit.

## Open WebUI

In **Admin Settings**, open **Connections**, then **OpenAI API**, and add a connection:

- URL: `https://<your-deployment>/api/v1`
- Key: `nsk_…`

The models appear in the model picker after you save, because Open WebUI reads `/v1/models`.

## LiteLLM proxy

```yaml
model_list:
  - model_name: large-v2
    litellm_params:
      model: openai/large-v2
      api_base: https://<your-deployment>/api/v1
      api_key: os.environ/RAHASYA_API_KEY
```

## OpenAI SDK

Python:

```python
import os
from openai import OpenAI

client = OpenAI(base_url="https://<your-deployment>/api/v1", api_key=os.environ["RAHASYA_API_KEY"])
reply = client.chat.completions.create(
    model="large-v2",
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=1024,
)
print(reply.choices[0].message.content)
```

JavaScript or TypeScript, with streaming:

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "https://<your-deployment>/api/v1", apiKey: process.env.RAHASYA_API_KEY });
const stream = await client.chat.completions.create({
  model: "large-flash",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 1024,
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
```

## curl

```sh
curl https://<your-deployment>/api/v1/chat/completions \
  -H "Authorization: Bearer $RAHASYA_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-1017-uncensored","messages":[{"role":"user","content":"Say hi"}],"max_tokens":50}'
```

## Spending limits for agents

An API key can serve as an agent's spending allowance. Give each agent its own key with a **total limit** (for example $2), a **model allowlist** and an **expiry**. When the limit is reached, the API returns `429 total_limit` and the agent cannot start new requests (requests already in flight can finish slightly over the limit), while your other keys and the website continue to work.

## Using the local proxy instead of a hosted key

To keep requests on your machine, use the same configurations (except Cursor) with the base URL `http://127.0.0.1:8787/v1` and the local key that the proxy prints when you run `npx rahasya@0.1.2`. Setup instructions are in the Local proxy dialog and the [API reference](api.md#local-proxy-alternative).
