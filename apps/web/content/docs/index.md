# Docs

Uncensored and abliterated models, paid with whatever token you hold. No account, no card. Use them in the chat on this site, or from opencode, Cursor, SillyTavern and anything else that speaks the OpenAI API.

## Quick start: chat

1. **Connect a wallet** (top right). EVM, Solana or NEAR all work. Your wallet is your login.
2. **Unlock.** Sign one message. Your browser derives a private **inference wallet** from it; it never leaves your browser.
3. **Add credit** from the account menu: from your connected wallet, from any token on any chain (via NEAR Intents), or by sending USDC on Base. Minimum $5.
4. **Chat.** Pick a model and a mode in the prompt bar:
   - **Anonymous**: every model. You're unlinkable, but the model host can read the prompt.
   - **Truly private**: enclave (TEE) models only. Messages are encrypted in your browser and only the attested enclave can read them. Click **Verified enclave** under a reply to see every check.

## Quick start: API keys

1. Account menu → **API keys** → **Sign in with your wallet**.
2. **Add credit** to your API wallet (same options as above).
3. **New key**. Optionally set a daily or total spend limit, the allowed models and an expiry. Copy it; it's shown once.
4. Use it anywhere OpenAI-compatible:

```
Base URL   https://<your-deployment>/api/v1
API key    nsk_…
Model      large-v2
```

```sh
curl https://<your-deployment>/api/v1/chat/completions \
  -H "Authorization: Bearer nsk_…" -H "Content-Type: application/json" \
  -d '{"model":"large-v2","messages":[{"role":"user","content":"Hello"}]}'
```

Next: set up your tool in [Integrations](integrations.md), see every endpoint, model and error in the [API reference](api.md), or read [How it works](protocol.md).

## Which should I use?

| | Website chat | API key | Local proxy |
|---|---|---|---|
| Where | This site | Any tool, any machine | Any tool, on your machine |
| Setup | None | Paste a key | Run `npm run proxy -- serve` |
| Pays from | Inference wallet (in your browser) | API wallet (server signs) | Inference wallet (on your machine) |
| Spend limits per key | – | Daily, total, models, expiry | – |
| Prompts pass through our server | No | Yes, in transit, never stored | No |
| End-to-end encryption on TEE models | Yes, from your browser | To our server, then to the enclave | Yes, from your machine |
