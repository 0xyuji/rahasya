# 3. Known issues and accepted risks

No need to report these again. **Do** tell us if one is worse than described, and how.

| # | Issue | Status |
|---|---|---|
| K1 | Spend limits can be exceeded by requests already in flight when a limit is crossed. Streamed requests reserve an estimate up front (prompt size + `max_tokens`, default 2048) that's corrected to the real cost at the end; non-streamed requests are charged after the reply | Bounded by concurrency × per-request cost. A per-key concurrency cap would close it |
| K2 | The rate limit is a fixed 60 requests/minute window per key | Simple by design |
| K3 | The server holds API wallet keys (custody of Venice credit) | Product decision. Credit can't be withdrawn; USDC is swept to credit immediately. A breach means credit gets spent, not funds stolen (except USDC not yet swept) |
| K4 | API-key requests, including TEE models, are plaintext on our server while in transit | Documented. Truly private mode on the website and the local proxy avoid it |
| K5 | `/api/oneclick` has no rate limit or auth, so anyone can use our partner key for quotes | To fix before launch (per-IP limit) |
| K6 | No strict `default-src` CSP (the WalletConnect modal loads from many origins) | Anti-framing headers are set; XSS hardening relies on React escaping and react-markdown (no raw HTML) |
| K7 | The derivation message is the same on every site, so a phishing site asking for it gets the inference key | The message warns about this; balances are meant to be small; brand/domain intentionally excluded so the key never changes (I3) |
| K8 | `npm audit` advisories inside wallet libraries: zod < 4.6.6 in Reown AppKit, bigint-buffer via @solana/web3.js 1.x, jayson/stream-json/uuid | No upstream fix that doesn't break them; our own zod is 4.6.7; we only encode our own amounts with bigint-buffer |
| K9 | The Intel DCAP signature chain and NVIDIA GPU evidence aren't verified locally (Venice's verifier reports them) | Labeled as such in the UI and docs |
| K10 | Login verification trusts the configured Base RPC (EVM) and NEAR RPC | Use trusted RPCs in production |
| K11 | Saved actions in localStorage include signed x402 authorizations (single-use, short-lived, credit the user's own wallet) | XSS could only replay them to top up the victim's own credit |
| K12 | `authorize` makes ~5 sequential Redis REST calls (about 1 s per request far from the database, a few ms co-located) | Performance only |
| K13 | 1Click may not refund the 0.5% slippage buffer on exact-output swaps | Seen on mainnet; documented |
| K14 | The local proxy doesn't check `Host` (DNS rebinding); it refuses any `Origin` and requires a token | Planned: Host allowlist |

## Fixed while preparing this kit (please re-check)

- **A streaming abort skipped billing.** Streamed gateway requests were charged only from the final usage chunk, so aborting just before the end avoided the charge and let a key exceed its limits without bound. Now an up-front reservation is corrected at the end and kept if the stream is cut off (`apps/web/src/server/gateway.ts`, `reserve`).
