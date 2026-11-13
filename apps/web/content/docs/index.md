# Overview

Rahasya provides private chat and an OpenAI-compatible API for uncensored and abliterated language models. You pay with the token you already hold, on almost any chain, through NEAR Intents. Rahasya requires no account, email address or card.

## Summary

- **Product.** A chat interface and an OpenAI-compatible API for uncensored and abliterated models, served by Venice. Available at https://<your-deployment>.
- **Payment.** NEAR Intents (1Click) converts more than 200 tokens on 39 chains into USDC on the user's own Base wallet. The USDC buys Venice credit over x402, and each request spends that credit with a freshly signed header. No on-chain transaction is made per message.
- **Truly private mode.** Requests go only to models running in hardware enclaves (TEEs), including one on a NEAR AI enclave, as reported by Venice. The browser verifies the enclave's attestation, including Intel's signature chain, and then encrypts every message to the enclave.
- **Custody.** Website chat is non-custodial. The wallet that pays for chat is derived in the browser from a single signature and never leaves it.
- **Developer access.** API keys support daily and total spend limits, a model allowlist and an expiry. A local proxy offers the same API from the user's machine, with encryption performed locally.
- **Verifiability.** The code is open source (MIT) with 186 offline tests. `npm run verify:tee` checks a live enclave attestation without a wallet or funds.

## Get started

| To… | Start with |
|---|---|
| Chat in the browser | [Quickstart: chat](#quickstart-chat) |
| Call the API from code or a tool | [Quickstart: API](#quickstart-api) |
| Keep requests on your own machine | [Local proxy](api.md#local-proxy-alternative) |
| Give a coding agent everything it needs | [For AI agents](agents.md) |
| Read every page in one file | `https://<your-deployment>/llms-full.txt` |

## Quickstart: chat

1. **Connect a wallet.** Select **Connect wallet** and choose an EVM, Solana or NEAR wallet. The wallet serves as your login.
2. **Unlock.** Sign one message. Your browser derives a private **inference wallet** from the signature; this wallet pays for your chats. It never leaves your browser, and the same signature recreates it on any device.
3. **Add credit.** Open the account menu and select **Add credit**. You can pay from the connected wallet, send any token from any wallet or exchange (NEAR Intents converts it), or send USDC on Base directly. The minimum is $5.
4. **Send a message.** Choose a model and a privacy mode in the prompt bar.

Credit typically arrives within one to two minutes. The dialog reports each step as it happens. You can close it at any time; on reload, the site resumes from the last saved step.

## Privacy modes

| Mode | Available models | Who can read the prompt |
|---|---|---|
| **Anonymous** | All models | The model host. You are identified only by a wallet address: no email address or card |
| **Truly private** | The two enclave (TEE) models | Only the attested enclave. The browser verifies the attestation, then encrypts every message to a key held inside the enclave |

After a Truly private reply, select **Verified enclave** to review each check the browser performed, including Intel's signature chain. For the assumptions behind this mode, see [Truly private mode](protocol.md#5-truly-private-mode-attestation-e2ee).

## Quickstart: API

1. **Create an API key.** In the account menu, select **API keys**, then **Sign in with your wallet**. This signs a message; it is not a transaction. Select **Add credit** to fund your API wallet, then **New key**. You can set a daily limit, a total limit, allowed models and an expiry. The key is displayed once, so copy it before closing the dialog.

2. **Store the key in your environment.**

   ```sh
   export RAHASYA_API_KEY=nsk_…
   ```

3. **Send your first request.** The API implements OpenAI Chat Completions, so the official OpenAI SDKs work without changes.

   ```sh
   curl https://<your-deployment>/api/v1/chat/completions \
     -H "Authorization: Bearer $RAHASYA_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"gemma-4-uncensored","messages":[{"role":"user","content":"Why is privacy important?"}],"max_tokens":200}'
   ```

   ```python
   import os
   from openai import OpenAI

   client = OpenAI(base_url="https://<your-deployment>/api/v1", api_key=os.environ["RAHASYA_API_KEY"])
   reply = client.chat.completions.create(
       model="gemma-4-uncensored",
       messages=[{"role": "user", "content": "Why is privacy important?"}],
       max_tokens=200,
   )
   print(reply.choices[0].message.content)
   ```

   ```ts
   import OpenAI from "openai";

   const client = new OpenAI({ baseURL: "https://<your-deployment>/api/v1", apiKey: process.env.RAHASYA_API_KEY });
   const reply = await client.chat.completions.create({
     model: "gemma-4-uncensored",
     messages: [{ role: "user", content: "Why is privacy important?" }],
     max_tokens: 200,
   });
   console.log(reply.choices[0].message.content);
   ```

4. **Connect your tool.** [Integrations](integrations.md) covers opencode, Cursor, Continue, Cline, Aider, Zed, SillyTavern, Open WebUI and LiteLLM. When you create a key, the site also generates a complete opencode configuration with your key and URL filled in.

> **Note:** Always set `max_tokens`. If it is omitted, the key reserves the model's maximum output until the reply completes, which can exhaust a small limit.

## Access methods

| | Website chat | API key | Local proxy |
|---|---|---|---|
| Runs | On this site | In any tool, on any machine | In any tool, on your machine |
| Setup | None | Paste a key | Run `npx rahasya@0.1.2`, or download one file |
| Pays from | Inference wallet (in your browser) | API wallet (signed by our server) | Inference wallet (on your machine) |
| Per-key spend limits | Not applicable | Daily, total, models, expiry | Not applicable |
| Prompts pass through our server | No | Yes, in transit only; never stored | No |
| End-to-end encryption on TEE models | Yes, from your browser | To our server, then to the enclave | Yes, from your machine |

TEE models support chat but not tool calls. Coding agents such as opencode should use a non-TEE model. For private conversations from scripts or chat applications, use a TEE model through the local proxy.

## Next steps

- [API reference](api.md): endpoints, models, prices, limits and errors
- [Integrations](integrations.md): configuration for each supported tool
- [How it works](protocol.md): wallets, the payment flow, attestation, and what each party can see
