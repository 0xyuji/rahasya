# How it works

This explains the money flow, the two wallets, how requests are authenticated and paid for, and what each party can see. Everything here is implemented in `packages/rail` (shared logic), `apps/web` (site + API) and `packages/proxy` (local proxy).

## Pieces

| Piece | What it is |
|---|---|
| **Your wallet** | Any EVM, Solana or NEAR wallet you connect. Your login and the source of funds. We never get its key. |
| **Inference wallet** | A Base address derived in your browser from one signature by your wallet. Pays for website chat. Never leaves your browser. |
| **API wallet** | A Base address our server holds the key for (encrypted). Pays for requests made with API keys. Holds only Venice credit. |
| **NEAR Intents (1Click)** | Swaps whatever you deposit (216 tokens, 39 chains) into USDC on Base, delivered to one of your wallets. |
| **x402** | HTTP payment standard. Your wallet signs a gasless USDC authorization; Venice settles it and credits that wallet. |
| **SIWX** | "Sign-In-With-X". A fresh signed message on every request that tells Venice which wallet is calling, so it can charge that wallet's credit. |
| **Venice** | Runs the models. Prepaid credit per wallet, OpenAI-compatible API, TEE/E2EE models. |

## 1. The inference wallet (website)

When you click **Unlock**, your wallet signs a fixed message (EVM `personal_sign`, Solana `signMessage`, NEAR NEP-413 `signMessage`). The browser derives a secp256k1 key from that signature:

```
key = HKDF-SHA256(ikm = signature, salt = "pay-anything/inference-wallet/v1", info = "<chain>:<address>")
```

- **Same wallet + same message → same signature → same key**, on any device. Nothing is stored; you unlock again next time. EOA, ed25519 and NEP-413 signatures are deterministic. Smart-contract wallets, whose signatures aren't, are detected and refused. EVM signatures are normalized first (v = 27/28, low s), so wallets that encode the same signature differently still get the same key.
- **What "same wallet" means.** It's the signing key, not the account name:
  - **NEAR:** an account usually has one access key per device or wallet app, and each key unlocks a different inference wallet. Keep using the same wallet app to reach your credit. The browser warns you if a different key signs.
  - **Solana:** a Ledger signs messages in a different format than a software wallet, so they give different inference wallets even for the same address.
- The message contains neither the site's name nor its domain, so renaming or moving the site doesn't change anyone's wallet. The message itself warns you to sign it only on a site you trust.
- The key only ever exists in browser memory.

Code: `packages/rail/src/wallet/derive.ts` (with a golden test vector).

## 2. Funding: any token → USDC on Base (NEAR Intents)

"Add credit" asks 1Click for a quote that delivers USDC on Base **to your inference wallet or your API wallet**, with refunds going **to an address you control**.

- **From your connected wallet:** an `EXACT_OUTPUT` quote for exactly the credit you asked for. Your wallet sends the deposit.
- **Any token, anywhere:** a `FLEX_INPUT` quote. You get a deposit address (plus QR code and memo if needed) and send from any wallet or exchange. Whatever arrives is converted, so exchange withdrawal fees don't cause a refund.
- **USDC on Base:** send it straight to the wallet; no swap.

Every quote must echo back exactly what we asked for (assets, amount, recipient, refund address) or it's refused. Progress is tracked through 1Click's status API (`PENDING_DEPOSIT → PROCESSING → SUCCESS | REFUNDED | FAILED`) and saved locally, so a reload resumes instead of starting over.

Our server proxies 1Click only to attach the partner key, our app fee and a referral tag. It holds no funds and only allows quotes that deliver USDC on Base.

**Fees.** Swaps through NEAR Intents carry a **0.5% app fee** that goes to us. It's already included in the amount the quote asks you to send, so the credit you get is exactly what you asked for. (NEAR Intents may add its own small fee as well; it shows up the same way.) Our fee is set on our server, and a client can't change or add one. There is no fee on:

- funding with **USDC on Base** directly (no swap);
- **inference**: you pay Venice's own per-token prices, with no markup, including through API keys.

Code: `apps/web/src/funding/`, `packages/rail/src/oneclick/`, `packages/rail/src/swap/engine.ts`.

## 3. Credit: x402 top-up

Venice keeps a **prepaid balance per wallet**. To add to it:

1. `POST /api/v1/x402/top-up` with no payment returns `402` with a `PAYMENT-REQUIRED` header listing accepted options (USDC on Base: payee, asset, minimum $5).
2. The wallet signs an **EIP-3009 `transferWithAuthorization`** for the chosen amount. This is gasless for the wallet; Venice's facilitator submits it.
3. The request is retried with the `PAYMENT-SIGNATURE` header. Venice settles it and credits the wallet.

The signed authorization is saved **before** it's sent. A retry re-sends the same authorization, whose nonce can only settle once, so nothing can be charged twice.

- **Website:** your browser signs with the inference wallet.
- **API keys:** our server signs with your API wallet, right after USDC lands on it.

Code: `packages/rail/src/venice/client.ts`.

## 4. Paying per request: SIWX

Every Venice request carries a header `SIGN-IN-WITH-X`: base64 of a fresh EIP-4361 (Sign-In-With-Ethereum) message for `api.venice.ai`, with a random nonce and a 5-minute expiry, signed by the paying wallet. Each header is single-use. Venice charges the request to that wallet's balance; when it runs out, Venice answers `402` and you top up again.

So x402 is for **adding** credit and SIWX is for **spending** it. There is no on-chain transaction per message.

Code: `packages/rail/src/venice/siwx.ts`.

## 5. Truly private mode: attestation + E2EE

For the two TEE models, the browser:

1. **Attests:** `GET /tee/attestation?model=…&nonce=<32 random bytes>`. The response includes an Intel TDX quote and NVIDIA GPU evidence. We check locally, from the raw quote bytes:
   - the response echoes our nonce
   - it's for the right model
   - `keccak(enclave public key)` equals the signing address
   - the quote is TDX v4
   - the quote's REPORTDATA contains our nonce (no replay)
   - REPORTDATA contains the enclave's address (so the key is bound to this hardware)
   - the TD debug bit is off

2. **Verifies Intel's signature, in your browser.** The quote's ECDSA signature, the quoting enclave's report, Intel's certificate chain up to Intel's root (built into the verifier), the revocation lists and the platform's TCB level are all checked with [`@phala/dcap-qvl`](https://github.com/Phala-Network/dcap-qvl) (pinned version). The verified report must be the same quote checked above (same REPORTDATA). How it's isolated:
   - It runs in a throwaway Web Worker that first removes storage (IndexedDB, caches, file system) and network access (XHR, WebSocket, …) and replaces `fetch` with one that can only GET our collateral relay, without cookies. The worker can't see the page's memory, where your inference key lives.
   - Intel's public collateral (CRLs, TCB info, QE identity) comes through our relay `/api/tee/pccs/…`, cached for an hour, so your browser never contacts a third party. Everything there is signed by Intel, so the relay can withhold it but can't forge it.
   - A failed signature check blocks sending. If the collateral can't be fetched, the check shows as "couldn't check" and the other checks still apply.

   The GPU evidence is reported by Venice's verifier and shown as such.

   **What this does and doesn't prove.** Together these show that the key you encrypt to was generated inside a genuine, non-debug Intel TDX enclave, for this request (no replay). They don't yet prove *which software* runs in that enclave: its measurement (MRTD) is shown but not pinned. So Truly private mode protects your messages from us, your network and the model host's operators; against Venice itself, it relies on Venice running the enclave software it publishes. Pinning measurements is on the roadmap. (API keys and the local proxy rely on Venice's verifier for the Intel signature; the in-browser check is website-only.)
3. **Encrypts:** ECDH on secp256k1 with the enclave key → HKDF-SHA256 → AES-256-GCM, a fresh ephemeral key per message. Only the user and system roles are encrypted (that's Venice's E2EE), so the conversation history is folded into one encrypted message rather than sent as plaintext assistant turns.
4. **Decrypts** the streamed reply, and counts any chunk that arrives unencrypted (the UI flags it).

Code: `packages/rail/src/venice/e2ee.ts`, tests against a captured real attestation in `e2ee.test.ts`. Try it with no keys: `npm run verify:tee`.

## 6. API keys and the API wallet

Tools like opencode can't sign SIWX messages, so for API keys our server signs on your behalf, using a separate wallet:

```
opencode ──Bearer nsk_…──▶ /api/v1 (our server)
                             ├─ key → hash lookup, expiry, model allowlist, spend limits, rate limit
                             ├─ decrypt your API wallet key (AES-256-GCM, bound to your user id)
                             ├─ sign a fresh SIWX header ──▶ Venice (charges the API wallet's credit)
                             └─ read token usage from the reply × live price ──▶ add to the key's spend
```

- **One API wallet per user.** It's created on first use, its private key is sealed with a server secret, and it's stored in Redis.
- **Credit only.** USDC delivered to it is immediately topped up into Venice credit. Venice credit can't be withdrawn, so even we can't move value out; at worst someone with server access could spend users' API credit on inference.
- **Keys** are random 240-bit tokens. Only their SHA-256 is stored. Each has optional daily and total USD limits, a model allowlist, an expiry and a fixed 60 requests per minute.
- **Managing keys** requires a session: your wallet signs a single-use challenge (5-minute expiry). EVM signatures are verified with ERC-1271/6492 support. NEAR signatures are checked against a full-access key of the account via NEAR RPC.

Code: `apps/web/src/server/` (`keys.ts`, `api-wallet.ts`, `gateway.ts`, `login.ts`), with tests in `server.test.ts`.

## Who can see what

| | Website, Anonymous | Website, Truly private | API key | Local proxy |
|---|---|---|---|---|
| **Our server** | no prompts (chat goes browser → Venice); only 1Click quote requests (addresses, amounts) | same | prompts in transit (not stored), key hashes, spend, 1Click quote requests | nothing |
| **Venice** | your inference wallet address + prompts | address + **ciphertext**\* | API wallet address + prompts (TEE models: ciphertext\*) | inference wallet address + prompts (TEE: ciphertext\*) |
| **Model host** | prompts (anonymized: third party; private: Venice) | only the attested enclave | same as Anonymous (TEE models: enclave) | same as website |
| **1Click solver** | deposit and delivery addresses and amounts | same | same | — |
| **Anyone on-chain** | your deposit to 1Click, USDC to your wallet, x402 settlement | same | same | — |

\* The enclave is verified as genuine Intel hardware (in your browser on the website); which software runs in it isn't pinned yet, so against Venice itself this relies on Venice running what it publishes. See "What this does and doesn't prove" in section 5.

Nothing here links your connected wallet to your inference wallet on-chain unless you fund one from the other.

## Failure handling

| Situation | What happens |
|---|---|
| Browser closes mid-deposit | Saved state resumes. If no tx hash came back, you're asked to wait or send again (1Click refunds an extra deposit). |
| Deposit arrives short | `FLEX_INPUT` converts it anyway; `EXACT_OUTPUT` is refunded by its deadline. |
| Swap fails | 1Click refunds to your refund address; shown as Refunded. |
| x402 top-up interrupted | The same signed authorization is re-sent; it can only settle once. |
| Out of credit (API) | `402 insufficient_credit`; if USDC is waiting on the API wallet, it's topped up and the request retried once. |
| Key limit reached | `429`; other keys unaffected. |
