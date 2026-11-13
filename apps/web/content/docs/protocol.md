# How it works

This page describes how funds move, which wallet pays for what, how each request is authenticated and paid for, and what each party can see. It also identifies which properties you can verify yourself and which depend on a third party. The implementation lives in `packages/rail` (shared logic), `apps/web` (website and API) and `packages/proxy` (local proxy).

## Summary

- **Two wallets.** The inference wallet (website and local proxy) is derived in the browser from a single signature and is never stored. The API wallet (API keys) is held by our server, encrypted, and used for inference credit only.
- **Funding.** NEAR Intents (1Click) swaps the deposit into USDC on Base, delivers it to one of those wallets, and sends any refund to an address the user controls.
- **Payment.** x402 adds Venice credit through a gasless USDC authorization. SIWX spends that credit, with a freshly signed header on every request. No on-chain transaction is made per message.
- **Truly private mode.** A fresh-nonce attestation is verified in the browser, including Intel's signature chain, and each message is then encrypted to the enclave's key with ECDH, HKDF-SHA256 and AES-256-GCM.
- **Limits of the proof.** The enclave's software measurement is not yet pinned. Against Venice itself, Truly private mode therefore relies on Venice running the enclave software it publishes.

## Components

| Component | Description |
|---|---|
| **Your wallet** | Any EVM, Solana or NEAR wallet you connect. It serves as your login and the source of funds. Rahasya never receives its key. |
| **Inference wallet** | A Base address derived in your browser from one signature by your wallet. It pays for website chat and never leaves your browser. |
| **API wallet** | A Base address whose key our server holds, encrypted. It pays for requests made with API keys and is used for Venice credit only. |
| **NEAR Intents (1Click)** | Swaps a deposit in more than 200 tokens on 39 chains into USDC on Base, delivered to one of your wallets. |
| **x402** | An HTTP payment standard. Your wallet signs a gasless USDC authorization; Venice settles it and credits that wallet. |
| **SIWX** | Sign-In-With-X. A freshly signed message on every request identifies the paying wallet to Venice, which then charges that wallet's credit. |
| **Venice** | Runs the models. It provides prepaid credit per wallet, an OpenAI-compatible API and TEE models with end-to-end encryption. |

## 1. The inference wallet (website)

When you select **Unlock**, your wallet signs a fixed message (EVM `personal_sign`, Solana `signMessage`, or NEAR NEP-413 `signMessage`). The browser derives a secp256k1 key from the signature:

```
key = HKDF-SHA256(ikm = signature, salt = "pay-anything/inference-wallet/v1", info = "<chain>:<lowercased address>" || 0x00)
```

- **The same wallet and message always produce the same key,** on any device. Nothing is stored; you unlock again on your next visit. EOA, ed25519 and NEP-413 signatures are deterministic. Smart-contract wallets, whose signatures are not, are detected and refused. EVM signatures are normalized first (v = 27/28, low s), so wallets that encode the same signature differently still produce the same key.
- **"The same wallet" means the same signing key, not the same account name.**
  - **NEAR:** an account usually has one access key per device or wallet app, and each key produces a different inference wallet. Use the same wallet app to reach your credit. The browser warns you if a different key signs.
  - **Solana:** a Ledger signs messages in a different format from a software wallet, so the two produce different inference wallets even for the same address.
- The message contains neither the site's name nor its domain, so renaming or moving the site does not change anyone's wallet. The message itself warns you to sign it only on a site you trust.
- The key exists only in browser memory.

Code: `packages/rail/src/wallet/derive.ts`, with a golden test vector.

## 2. Funding: any token to USDC on Base (NEAR Intents)

**Add credit** requests a 1Click quote that delivers USDC on Base **to your inference wallet or your API wallet**, with any refund sent **to an address you control**.

- **From your connected wallet:** an `EXACT_OUTPUT` quote for exactly the credit you requested. Your wallet sends the deposit.
- **Any token, anywhere:** a `FLEX_INPUT` quote. You receive a deposit address (with a QR code and memo when required) and can send from any wallet or exchange. The amount to send is sized about 3% above the credit requested, and whatever arrives is converted and credited, so exchange withdrawal fees do not trigger a refund.
- **USDC on Base:** send it directly to the wallet; no swap is involved.

Each quote must echo back exactly the parameters requested (assets, amount, recipient and refund address), or it is refused. Progress is tracked through 1Click's status API (`PENDING_DEPOSIT → PROCESSING → SUCCESS | REFUNDED | FAILED`) and saved locally, so a reload resumes the flow instead of starting over.

Our server proxies 1Click only to attach the partner key, our app fee and a referral tag. It holds no funds and permits only quotes that deliver USDC on Base.

**Fees.** On the live site, swaps through NEAR Intents carry a **1% fee**, split evenly between Rahasya and NEAR Intents. The fee is set in server configuration (`ONECLICK_APP_FEE_BPS`; a fresh clone defaults to no fee), and a client cannot change or add one. When paying from your connected wallet, the fee is included in the amount the quote asks you to send, so you receive exactly the credit you requested. With *Any token, anywhere*, the fee is deducted from what you send, and you are credited what arrives. No fee applies to:

- funding with **USDC on Base** directly (no swap);
- **inference**: you pay Venice's per-token prices without markup, including through API keys.

Code: `apps/web/src/funding/`, `packages/rail/src/oneclick/`.

## 3. Credit: x402 top-up

Venice keeps a **prepaid balance per wallet**. To add to it:

1. `POST /api/v1/x402/top-up` without payment returns `402`, with a `PAYMENT-REQUIRED` header that lists the accepted options (USDC on Base: payee, asset, and a $5 minimum).
2. The wallet signs an **EIP-3009 `transferWithAuthorization`** for the chosen amount. This is gasless for the wallet; Venice's facilitator submits it.
3. The request is retried with the `PAYMENT-SIGNATURE` header. Venice settles the payment and credits the wallet.

The signed authorization is saved **before** it is sent. A retry re-sends the same authorization, whose nonce can settle only once, so a top-up cannot be charged twice.

- **Website:** your browser signs with the inference wallet.
- **API keys:** our server signs with your API wallet when it converts USDC held there (see section 6).

Code: `packages/rail/src/venice/client.ts`.

## 4. Paying per request: SIWX

Every request to Venice carries a `SIGN-IN-WITH-X` header: the base64 encoding of a fresh EIP-4361 (Sign-In with Ethereum) message for `api.venice.ai`, with a random nonce and a 5-minute expiry, signed by the paying wallet. Venice charges the request to that wallet's balance. When the balance is exhausted, Venice returns `402` and the wallet tops up again.

x402 therefore **adds** credit, and SIWX **spends** it. No on-chain transaction is made per message.

Code: `packages/rail/src/venice/siwx.ts`.

## 5. Truly private mode: attestation + E2EE

For the two TEE models, the browser performs the following steps.

1. **Request an attestation.** `GET /tee/attestation?model=…&nonce=<32 random bytes>`. The response includes an Intel TDX quote and NVIDIA GPU evidence. The browser checks:
   - from the response: that it echoes our nonce, that it is for the requested model, and that `keccak(enclave public key)` equals the signing address;
   - from the raw quote bytes: that the quote is TDX version 4, that its REPORTDATA contains our nonce (preventing replay) and the enclave's address (binding the key to this hardware), and that the TD debug bit is off.

2. **Verify Intel's signature in the browser.** The quote's ECDSA signature, the quoting enclave's report, Intel's certificate chain up to Intel's root (built into the verifier), the revocation lists and the platform's TCB level are all checked with [`@phala/dcap-qvl`](https://github.com/Phala-Network/dcap-qvl) at a pinned version. The verified report must be the same quote checked in step 1 (same REPORTDATA). The verifier is isolated as follows:
   - It runs in a disposable Web Worker that first removes storage (IndexedDB, caches, file system) and network access (XHR, WebSocket and others), and replaces `fetch` with a version that can only GET our collateral relay, without cookies. The worker cannot access the page's memory, where your inference key resides.
   - Intel's public collateral (CRLs, TCB info, QE identity) is fetched through our relay at `/api/tee/pccs/…` and cached for one hour, so your browser does not contact a third party. All collateral is signed by Intel; the relay can withhold it but cannot forge it.
   - A failed signature check blocks sending. If the collateral cannot be fetched, the browser retries once, then asks you before sending; the other checks still apply.

   The GPU evidence is verified by Venice's verifier and labelled as such.

   **What this proves, and what it does not.** Together, these checks show that the key you encrypt to was generated inside a genuine, non-debug Intel TDX enclave, with a fresh nonce. The website reuses a verified attestation for up to 10 minutes, then requests a new one. The checks do not yet prove *which software* runs in the enclave: its measurement (MRTD) is displayed but not pinned. Truly private mode therefore protects your messages from us, from your network and from the model host's operators; against Venice itself, it relies on Venice running the enclave software it publishes. Pinning measurements is planned. API keys and the local proxy rely on Venice's verifier for the Intel signature; the in-browser check is available on the website only.

3. **Encrypt.** ECDH on secp256k1 with the enclave key, then HKDF-SHA256, then AES-256-GCM, with a fresh ephemeral key for each message. Venice's end-to-end encryption covers only the user and system roles, so the conversation history is folded into a single encrypted message rather than sent as plaintext assistant turns.

4. **Decrypt** the streamed reply. Any chunk that arrives unencrypted is counted, and the interface flags it.

Code: `packages/rail/src/venice/e2ee.ts`, with tests against a captured real attestation in `e2ee.test.ts`. To run the check without keys: `npm run verify:tee`.

## 6. API keys and the API wallet

Tools such as opencode cannot sign SIWX messages, so for API keys our server signs on your behalf, using a separate wallet:

```
opencode ──Bearer nsk_…──▶ /api/v1 (our server)
                             ├─ key → hash lookup, expiry, model allowlist, spend limits, rate limit
                             ├─ decrypt your API wallet key (AES-256-GCM, bound to your user id)
                             ├─ sign a fresh SIWX header ──▶ Venice (charges the API wallet's credit)
                             └─ read token usage from the reply × live price ──▶ add to the key's spend
```

- **One API wallet per user.** It is created on first use; its private key is sealed with a server secret and stored in Redis.
- **Inference only.** USDC sent to the API wallet is converted into Venice credit when the Add credit dialog detects it, or on the next request that finds the credit exhausted (at least $5, and at most $200 at a time). Until then, it remains USDC on a key our server holds. Venice credit cannot be withdrawn, so once converted, value cannot be moved out, even by us. At worst, someone with server access could spend users' API credit on inference.
- **Keys** are random 240-bit tokens, and only their SHA-256 hashes are stored. Each key has optional daily and total limits in US dollars, a model allowlist, an expiry and a fixed rate limit of 60 requests per minute.
- **Managing keys** requires a session: your wallet signs a single-use challenge that expires after 5 minutes. EVM signatures are verified with ERC-1271 and ERC-6492 support. NEAR signatures are checked against a full-access key of the account through NEAR RPC.

Code: `apps/web/src/server/` (`keys.ts`, `api-wallet.ts`, `gateway.ts`, `login.ts`), with tests in `server.test.ts`.

## Who can see what

| | Website, Anonymous | Website, Truly private | API key | Local proxy |
|---|---|---|---|---|
| **Our server** | No prompts (chat goes from the browser to Venice). 1Click quote requests, in which it sees your IP address, inference wallet and refund address together, and adds our partner key, fee and referral | Same | Prompts in transit (not stored), key hashes, spend, 1Click quote requests | Nothing |
| **Venice** | Your IP address (the browser calls Venice directly), inference wallet address and prompts | IP address, wallet address and **ciphertext**\* | API wallet address and prompts (TEE models: ciphertext\*) | Inference wallet address and prompts (TEE models: ciphertext\*) |
| **Model host** | Prompts (anonymized tier: a third party; private tier: Venice) | Only the attested enclave | Same as Anonymous (TEE models: the enclave) | Same as the website |
| **1Click solver** | Deposit and delivery addresses and amounts | Same | Same | — |
| **Public blockchain** | Your deposit to 1Click, the USDC delivered to your wallet, and the x402 settlement | Same | Same | — |
| **Base RPC provider** | Your IP address and inference wallet address (balance reads about every 30 seconds while unlocked) | Same | — | — |
| **Reown (wallet modal)** | Your IP address when the page loads its remote configuration; connection metadata when using WalletConnect QR or mobile wallets | Same | Same (sign-in) | — |
| **Cloudflare, Upstash** | Cloudflare hosts the site and terminates TLS, so it can see what our server sees, and keeps request logs (metadata, not bodies). Upstash hosts the database | Same | Same | — |

\* The enclave is verified as genuine Intel hardware (in your browser, on the website). Which software runs inside it is not yet pinned, so against Venice itself this relies on Venice running the software it publishes. See "What this proves, and what it does not" in section 5.

No on-chain link exists between your connected wallet and your inference wallet unless you fund one from the other.

## Failure handling

| Situation | Behavior |
|---|---|
| The browser closes during a deposit | The saved state resumes. If no transaction hash was returned, you are asked to wait or to send again (1Click refunds any extra deposit). |
| A deposit arrives short | A `FLEX_INPUT` quote converts it anyway; an `EXACT_OUTPUT` quote is refunded by its deadline. |
| A swap fails | 1Click refunds to your refund address, and the status shows Refunded. |
| An x402 top-up is interrupted | The same signed authorization is re-sent; it can settle only once. |
| The API wallet has no credit | The API returns `402 insufficient_credit`. If USDC is waiting on the API wallet, it is converted and the request is retried once. |
| A key reaches its limit | The API returns `429`; other keys are unaffected. |
