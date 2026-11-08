# 2. What to check

## A. Invariants: these must always hold

Breaking any of them is **High or worse**. For each, the right column says where it's enforced and what already tests it. Please report each one as *holding* (and how you checked) or *broken* (with proof).

| # | Invariant | Enforced in | Existing tests |
|---|---|---|---|
| **I1** | Value only ever goes to (a) a 1Click deposit address from a quote that echoes our exact request with recipient = the user's own wallet and refundTo = an address the user gave, or (b) Venice via an x402 authorization signed by the paying wallet | `rail/oneclick/validate.ts`, `web/funding/flow.ts`, `web/funding/anywhere.ts`, `rail/swap/engine.ts` | `engine.test.ts` (tampered recipient) |
| **I2** | Our server never receives the user's wallet key or the inference wallet key | Architecture; `web/wallet/wallet-context.tsx` | Review |
| **I3** | The derivation message, salt and NEP-413 params never change (or every user silently gets a new wallet) | `rail/wallet/derive.ts` | Golden vector in `derive.test.ts` |
| **I4** | Truly private mode never sends user/system content in plaintext, never falls back to a non-TEE model, and refuses if any attestation check fails | `rail/inference/chat.ts`, `rail/inference/models.ts` (`resolveModel`), `rail/venice/e2ee.ts` (`newSession`) | `models.test.ts`, `e2ee.test.ts` |
| **I5** | Anonymous requests never include messages exchanged in Truly private mode; E2EE requests carry no plaintext-role history | `web/chat/conversation.ts`, `proxy/server.ts` (`foldForE2ee`), `web/server/gateway.ts` (`fold`) | `conversation.test.ts`, `proxy/server.test.ts` |
| **I6** | An attestation passes only if: the nonce is echoed, the model matches, keccak(enclave key) = signing address, it's a TDX v4 quote, REPORTDATA binds our nonce and that address, and the debug bit is off. On the website, Intel's DCAP signature chain must also verify for that same quote (same REPORTDATA); "fail" blocks, "couldn't check" doesn't, and "couldn't check" is only possible for failures that say nothing about the quote (network, rate limits, Intel errors, stale collateral) | `rail/venice/e2ee.ts` (`evaluateAttestation`, `withQuoteVerdict`), `web/tee/*` | `e2ee.test.ts`, `intel-verdict.test.ts`, `web/tee/intel-verify.test.ts`, `web/tee/intel-classify.test.ts` |
| **I7** | An x402 authorization is persisted before sending; a retry re-sends the same one; a new one is signed only after the old `validBefore` + 120 s; payment only to Venice's known `payTo` | `rail/venice/client.ts` (`topUp`) | Review |
| **I8** | API key plaintext is never stored; `authorize` checks existence, expiry, model allowlist, daily/total limits and rate **before** any upstream call | `web/server/keys.ts` | `server.test.ts`, probe |
| **I9** | Key create/edit/delete only with a valid session, from our own origin, on keys owned by that user | `web/server/http.ts`, `web/server/keys.ts` (`own`) | `server.test.ts`, probe |
| **I10** | Login challenges are single-use, expire in 5 minutes, and are bound to chain + address; signatures verified per chain (EVM incl. ERC-1271/6492, Solana ed25519, NEAR NEP-413 + full-access key check) | `web/server/login.ts` | `server.test.ts` (Solana), probe (EVM) |
| **I11** | API wallet keys decrypt only for their own user (AAD), and at most one API wallet is created per user | `web/server/crypto.ts`, `web/server/api-wallet.ts` (`set NX`) | `server.test.ts` |
| **I12** | Gateway and proxy never log or store prompts or replies | `web/server/gateway.ts`, `proxy/server.ts` | Review |
| **I13** | `/api/oneclick` forwards only 4 routes, only quotes delivering USDC on Base to `DESTINATION_CHAIN`, never the caller's `appFees`, within per-IP rate limits | `web/app/api/oneclick/[...path]/route.ts` | Probe |
| **I14** | The local proxy listens only on 127.0.0.1, requires a token of ≥ 32 chars (constant-time compare), refuses requests with an `Origin` header, and only accepts a localhost `Host` | `proxy/server.ts`, `proxy/cli.ts` | `proxy/server.test.ts` |
| **I15** | Pages can't be framed (wallet prompts can't be clickjacked) | `web/next.config.ts` | Probe |
| **I16** | Third-party verifier code (`@phala/dcap-qvl`) never runs on our server or in the page: only in a worker that has no storage, no raw network, a `fetch` limited to GET on `/api/tee/pccs/` without cookies, a CSP limiting scripts and connections to our origin (`public/_headers`), and no way to read our cookie routes (they require a header `import()` can't send) | `web/tee/lockdown.ts`, `web/tee/intel-verify.worker.ts`, `web/public/_headers`, `web/server/http.ts` (`fromOurPage`) | `web/tee/lockdown.test.ts` (emulated), `audit-v2.test.ts` (T-02), probe; verified in headless Chrome on the Cloudflare build |
| **I17** | Only our server decides swap fees and attribution: a client's `appFees` and `referral` are always dropped; ours come from server env (recipient, bps as an integer, capped at 100) | `web/app/api/oneclick/[...path]/route.ts` | Probe ("client appFees and referral are replaced") |
| **I18** | Every API-key request is charged exactly once: a reservation before the upstream call, corrected once to Venice's reported cost (for streams: as soon as the usage chunk passes, so a client hanging up after `[DONE]` doesn't matter), kept in full if no usage arrives, refunded only if the upstream call failed before generating anything | `web/server/gateway.ts` (`reserve`, `meterStream`, `passthrough`, `e2ee`), `web/server/keys.ts` (`recordSpend`) | `server.test.ts` ("streamed spend settles…", "a stream without usage…") |

## B. Attack checklist (highest value first)

### Spend someone else's credit (Critical/High)
- [ ] Any way to get a session for a wallet you don't control: challenge replay, cross-chain confusion (`chain` vs `address` format), NEAR function-call keys counting as ownership, EVM smart-wallet signature edge cases, Solana base58/base64 parsing
- [ ] IDOR on `/api/keys/[id]` (PATCH/DELETE), `/api/account`, `/api/account/sweep`
- [ ] CSRF on cookie routes (we rely on SameSite=Lax + an Origin check, with no token). Try missing/`null` Origin, method overrides, top-level navigations
- [ ] Key lookup confusion in `authorize` (hash collisions, prefix tricks, whitespace/case in the bearer token)
- [ ] Session cookie attributes and lifetime; logout actually invalidating

### Get around spend limits (High)
- [ ] Concurrent requests racing `authorize` → `recordSpend` (how far over the limit can N parallel requests go?)
- [ ] Streaming: aborting mid-stream; streams that never send a usage chunk; client-supplied `stream_options`; `max_tokens` = 0 / negative / huge (affects the up-front reservation)
- [ ] Non-streaming requests where Venice returns no `usage` (cost recorded as 0?)
- [ ] The E2EE path's accounting; float accumulation in `incrbyfloat`; the UTC day boundary
- [ ] Model id tricks: Venice id vs our key vs case variants against the allowlist

### Make the gateway misbehave (High/Medium)
- [ ] Body fields that override what we set (`model`, `venice_parameters`, `stream_options`, `user`, `n`), unexpected types
- [ ] Response content leaking upstream errors or headers that contain secrets
- [ ] Anything that builds a URL or header from user input (SSRF, header injection)
- [ ] Very large / deeply nested JSON, slow-loris streaming

### Fees and metering (new in v2, High)
- [ ] Set or influence `appFees`, `referral` or the fee recipient from the client (body shapes, duplicate keys, other routes, path casing) (I17)
- [ ] Make our 1% fee push a quote past `checkMaxInput` (+5% + $0.50) or cause refunds
- [ ] Make `meterStream` settle with too-low usage, settle twice, or not settle: usage split across chunks, `usage: null`, usage in every chunk, the word usage inside content, cancelling at each point (I18)
- [ ] Partial failures of the four parallel writes in `recordSpend` (K17): can they let a key exceed its limits?

### Cloudflare runtime (new in v2, Medium)
- [ ] Client IP: can a request reach the Worker with a `cf-connecting-ip` / `x-real-ip` / `x-forwarded-for` it controls (e.g. via the `*.workers.dev` URL)? Per-IP limits (K5) depend on it
- [ ] Per-isolate in-memory caches (Intel collateral in the relay, Venice prices): poisoning, unbounded growth, staleness
- [ ] The relay's `redirect: "manual"`: is every redirect refused?
- [ ] Anything server-side that still assumes Node (`Buffer`, `fs`, `process.cwd`) and fails open on Workers

### Redirect or lose a deposit (Critical)
- [ ] A malicious or MITM'd 1Click response: is every field we act on validated? (`quoteAnywhere` checks fewer fields than `validateQuote`; memo handling)
- [ ] localStorage tampering of a saved action (deposit address, amounts) before `runCredit` sends
- [ ] The `/api/oneclick` proxy rewriting or relaying something dangerous
- [ ] Refund-address handling (wrong chain format accepted?)

### Break E2EE / attestation (High)
- [ ] The in-browser Intel check (`apps/web/src/tee/`): can anything in the worker get around the lockdown (storage, network, cookies, the page's memory)? Can the page be made to accept a "pass" for a different quote? Can the relay `/api/tee/pccs/` be made to fetch anything other than Intel's four collateral endpoints?
- [ ] Field confusion between `signing_key`, `signing_public_key` and the `aci/1` nested format; a different REPORTDATA layout
- [ ] A plaintext chunk accepted as decrypted (`isHexEncrypted` heuristic)
- [ ] Attestation caching (10 min): could the enclave key rotate or be substituted under us?
- [ ] Encryption details: HKDF parameters, nonce reuse, ephemeral key handling

### x402 / credit (High)
- [ ] `sweepToCredit` id scheme (`sweep_<address>_<seq>`, plus a Redis lock) under concurrency; double sign; retry after `validBefore`
- [ ] The top-up `amount` override: we raise `accepts[].amount` to the chosen top-up; is anything else trusted from the 402 response?

### Derivation (Critical if broken)
- [ ] Any path where the same wallet gets a different inference key (or two wallets get the same one)
- [ ] NEP-413 nonce/recipient constants; EVM "sign twice" check; smart-wallet detection

### Local proxy (Medium)
- [ ] DNS rebinding: `Host` must be localhost/127.0.0.1 and `Origin` is refused. Any way around both?
- [ ] Token generation, storage, rotation; key file permissions

### Web app / supply chain (Medium/Low)
- [ ] XSS anywhere model output or user input is rendered (react-markdown with no raw HTML; `dangerouslySetInnerHTML` is used only for QR SVGs we generate)
- [ ] The dependency tree (wallet libraries pull many packages); anything running install scripts
