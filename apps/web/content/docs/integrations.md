# Using your API key in tools

Every tool below talks to the same OpenAI-compatible endpoint:

```
Base URL   https://<your-deployment>/api/v1
API key    nsk_…   (account menu → API keys)
Model      large-v2, large-flash, deepseek-1017-uncensored, …   (full list in api.md)
```

For coding agents that call tools (opencode, Cline, Aider, Continue's agent mode), pick a **non-TEE** model. The two TEE models can't carry tool definitions through end-to-end encryption. Good picks are `large-v2` (strongest), `large-flash` (fast) and `deepseek-1017-uncensored` (cheap).

The configs below match each tool's documented format at the time of writing (Nov 2026). If a tool's settings screen has moved, look for "OpenAI-compatible", "custom base URL" or "OpenAI API base".

## opencode

Tested with opencode 2.1.3. Add a provider to `~/.config/opencode/opencode.jsonc` (or `opencode.jsonc` in a project):

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

Things that trip people up:

- **File name.** opencode only reads `opencode.json` or `opencode.jsonc`. A file called `config.json` is ignored, and opencode quietly falls back to its built-in providers.
- **The key isn't picked up.** opencode 2 runs a background service, and that service doesn't see variables you `export` after it started. Start with `--standalone` from the terminal where you exported the key. If you get "Invalid API key." straight away, this is why.
- **Other providers in the model list.** `enabled_providers` limits opencode to this provider. Delete that line if you also want opencode's own providers.
- **Spend in the sidebar.** opencode works this out from each model's `cost` (dollars per million tokens, Venice's list prices). It's an estimate. What your key was actually charged is in the API keys dialog.
- **Only some models show up.** opencode lists just the models named under `models`. The config above has every model that works with coding agents. The two TEE models are left out because they can't carry tool definitions.

The website shows this exact config, with your key and URL filled in, when you create a key. If the key has a model allowlist, the config lists only those models.

## Cursor

Settings → **Models**:
1. Turn on **OpenAI API Key** and paste your `nsk_…` key.
2. Turn on **Override OpenAI Base URL** and set `https://<your-deployment>/api/v1`.
3. **Add model** for each id you want, e.g. `large-v2`, then select it in chat.

Cursor routes some features (tab completion, some agent tools) through its own servers no matter which model you pick. Those parts don't go through this key.

## Continue (VS Code / JetBrains)

`~/.continue/config.yaml`:

```yaml
models:
  - name: Abliterated Large V2
    provider: openai
    model: large-v2
    apiBase: https://<your-deployment>/api/v1
    apiKey: nsk_…
    roles: [chat, edit, apply]
```

## Cline, Roo Code, Kilo Code

Settings → **API Provider: OpenAI Compatible**:
- Base URL: `https://<your-deployment>/api/v1`
- API Key: `nsk_…`
- Model ID: `large-v2`

## Aider

```sh
aider --openai-api-base https://<your-deployment>/api/v1 \
      --openai-api-key nsk_… \
      --model openai/large-v2
```

The `openai/` prefix tells Aider (via LiteLLM) to use the OpenAI-compatible route with your base URL.

## Zed

`settings.json`:

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

Zed asks for the API key the first time you use the provider.

## SillyTavern

API Connections → **Chat Completion** → Source: **Custom (OpenAI-compatible)**:
- Custom Endpoint (Base URL): `https://<your-deployment>/api/v1`
- Custom API Key: `nsk_…`
- Model: `venice-roleplay` (tuned for roleplay) or `large-v2`

Tip: create a dedicated key with a daily limit for long roleplay sessions.

## Open WebUI

Admin Settings → **Connections** → **OpenAI API** → add a connection:
- URL: `https://<your-deployment>/api/v1`
- Key: `nsk_…`

The models appear in the picker after saving (Open WebUI reads `/v1/models`).

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
from openai import OpenAI

client = OpenAI(base_url="https://<your-deployment>/api/v1", api_key="nsk_…")
r = client.chat.completions.create(model="large-v2", messages=[{"role": "user", "content": "Hello"}])
print(r.choices[0].message.content)
```

JavaScript / TypeScript:

```ts
import OpenAI from "openai";

const client = new OpenAI({ baseURL: "https://<your-deployment>/api/v1", apiKey: process.env.RAHASYA_API_KEY });
const stream = await client.chat.completions.create({
  model: "large-flash",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
```

## curl

```sh
curl https://<your-deployment>/api/v1/chat/completions \
  -H "Authorization: Bearer nsk_…" -H "Content-Type: application/json" \
  -d '{"model":"deepseek-1017-uncensored","messages":[{"role":"user","content":"Say hi"}],"max_tokens":50}'
```

## Agents with a budget

A key works well as an agent's spending allowance. Give the agent its own key with a **total limit** (say $2), a **model allowlist** and an **expiry**. When the limit is reached the API answers `429 total_limit` and the agent can't spend more, while your other keys and the website keep working.

## Local proxy instead of a hosted key

To keep everything on your machine, use the same configs with `http://127.0.0.1:8787/v1` and the local key printed by `npm run proxy -- serve`. See [api.md](api.md#local-proxy-alternative).
