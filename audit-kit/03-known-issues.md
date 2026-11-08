# 3. Known issues and accepted risks

No need to report these again. **Do** tell us if one is worse than described, and how.

| # | Issue | Status |
|---|---|---|
| K1 | Spend limits can be exceeded by requests already in flight when a limit is crossed. Every request reserves an estimate up front (prompt size + `max_tokens`, 1–32768, default 2048) that's corrected to the real cost at the end, on the same UTC day | Bounded by concurrency × per-request cost (60/min rate limit). A per-key concurrency cap would close it |
| K2 | The rate limit is a fixed 60 requests/minute window per key | Simple by design |
| K3 | The server holds API wallet keys (custody of Venice credit) | Product decision. Credit can't be withdrawn; USDC is swept to credit immediately. A breach means credit gets spent, not funds stolen (except USDC not yet swept) |
| K4 | API-key requests, including TEE models, are plaintext on our server while in transit | Documented. Truly private mode on the website and the local proxy avoid it |
| K5 | ~~`/api/oneclick` has no rate limit~~ **Fixed:** per-IP limits per minute (20 quotes, 30 token lists, 120 status checks). Still unauthenticated by design (the site uses it before sign-in) | Limits are keyed on the platform's client-IP header |
| K6 | No strict `default-src` CSP (the WalletConnect modal loads from many origins) | Anti-framing headers are set; XSS hardening relies on React escaping and react-markdown (no raw HTML) |
| K7 | The derivation message is the same on every site, so a phishing site asking for it gets the inference key | The message warns about this; balances are meant to be small; brand/domain intentionally excluded so the key never changes (I3) |
| K8 | `npm audit` advisories inside third-party libraries: zod < 4.6.6 in Reown AppKit, bigint-buffer via @solana/web3.js 1.x, jayson/stream-json/uuid, and `elliptic` (CVE-2025-14505, low) via `@phala/dcap-qvl` | No fix we can apply without breaking them; our own zod is 4.6.7; we only encode our own amounts with bigint-buffer; the elliptic bug is in signing, and the verifier only verifies (no private keys, sandboxed worker) |
| K9 | **Partly fixed.** The Intel DCAP chain is now verified in the browser (sandboxed worker, `apps/web/src/tee/`). Still open: the enclave's software measurement (MRTD/RTMRs) isn't pinned, NVIDIA GPU evidence is only reported by Venice, and the API-key gateway and local proxy don't run the Intel check (they rely on Venice's verifier). So against Venice itself, Truly private relies on Venice running the enclave software it publishes | Shown as such in the UI and docs. Measurement pinning is on the roadmap |
| K10 | Login verification and the API wallet's USDC balance trust public RPCs: Base via publicnode → drpc → mainnet.base.org, NEAR via fastnear → rpc.mainnet.near.org (`src/server/rpc.ts`; a configured `BASE_RPC_URL` / `NEAR_RPC_URL` goes first). EVM sign-in uses viem `verifyMessage` (which can call the RPC, needed for smart wallets), NEAR sign-in checks the key is FullAccess via RPC | Free endpoints rate-limit cloud IPs, hence the fallbacks. A paid RPC in production would cut both the risk and the latency |
| K11 | Saved actions in localStorage include signed x402 authorizations (single-use, short-lived, credit the user's own wallet) | XSS could only replay them to top up the victim's own credit |
| K12 | `authorize` makes 3 sequential Redis REST calls (key hash → key record → spend counters + rate limit together), then 1 to load the API wallet and 1 to reserve. Far from the database that's ~2 s; co-located (Smart Placement) a few ms | Performance only |
| K13 | 1Click may not refund the 0.5% slippage buffer on exact-output swaps | Seen on mainnet; documented |
| K14 | ~~The local proxy doesn't check `Host`~~ **Fixed:** only `127.0.0.1`, `localhost` and `[::1]` are accepted as Host | Test in `packages/proxy/src/server.test.ts` |
| K15 | Swap fee: we add a 1% app fee to 1Click quotes; 1Click keeps half of it (without an app fee it charges 0.2% itself). Direct USDC-on-Base funding and inference carry no fee | Business decision, stated in `docs/protocol.md` ("Fees"). Not a vulnerability unless a client can change it (I17) |
| K16 | In-memory caches (Intel collateral, 1 h; Venice prices, 10 min) live per Worker isolate, so cold isolates refetch | Rate limits and spend are in Redis, not in memory. Collateral is Intel-signed and verified in the browser |
| K17 | `recordSpend` issues its four writes (day counter, its TTL, total counter, last-used) in parallel, not atomically. A failed write can leave day and total apart by one request's cost, or a day key without a TTL | Bounded to one request per failure. A Redis `MULTI` would close it |
| K18 | The Worker is also reachable on its `*.workers.dev` URL (same code, same secrets) | Same behaviour as `rahasya.chat`; tell us if anything differs there (e.g. client IP) |

## Fixed after the first audit (2026-11-08, report against commit 6be0d23)

Each fix has a regression test; please re-check them.

| Finding | Fix | Test |
|---|---|---|
| F-01 High: `"model": "constructor"` skipped the allowlist and metering | Own-property model lookup (`findModel`) everywhere; `authorize` refuses unknown models | `rail/src/audit-regressions.test.ts`, `web/src/server/server.test.ts`, probe |
| F-02: repeat top-up of the same amount never credited | Sweep ids use a per-wallet sequence (server and browser), plus a lock; returns the amount actually paid | `server.test.ts` "F-02" |
| F-03: x402 re-signed 30 s before `validBefore` | Re-sign only after `validBefore` + 120 s; until then, re-send the same authorization | `rail/src/venice/topup.test.ts` |
| F-04: negative `max_tokens` made the reservation a credit | `max_tokens` must be an integer 1–32768 (400 otherwise); costs and reservations clamp at 0 | `server.test.ts`, probe |
| F-05: `venice_parameters` enabled unmetered paid features | Allowlist: only `disable_thinking`, `strip_thinking_response`; `n` must be 1 | `server.test.ts` |
| F-06: same wallet, different inference key | EVM signatures canonicalized (v 27/28, low s) before HKDF, with existing keys unchanged; NEAR warns when a different access key signs; docs cover Ledger/Solana | `audit-regressions.test.ts` (golden vector unchanged) |
| F-07: "Truly private" overstated protection against Venice | UI, protocol docs and README reworded (see K9) | Review |
| F-08: empty proxy token accepted | Proxy refuses tokens < 32 chars; empty token files are regenerated | `proxy/src/server.test.ts` |
| F-09: daily limit drift at the UTC boundary | The reservation's day is kept and corrected on that day | `server.test.ts` |
| F-10: a rejected top-up stayed FAILED forever | Rejected authorizations are re-sent until they expire, then re-signed | `topup.test.ts` |
| F-11: no upper bound on `amountIn` | Quote input priced independently (token list) and capped at +5% + $0.50; re-validated right before sending | `audit-regressions.test.ts` |
| F-12: login message not domain-bound | EIP-4361 (SIWE) for EVM, the same format for Solana, NEP-413 recipient = our host | `server.test.ts` (incl. NEAR full-access check) |
| F-13 | `GETDEL` for challenges; per-user lock on key creation; rate-limit TTL always set; `GET /api/account` is read-only (POST opens the wallet); expired keys can be renamed; x402 `payTo` pinned to Venice's address; client `appFees` stripped; body read with a streaming 4 MB cap; E2EE non-streamed requests reserve too; proxy logs no upstream error bodies; `__Host-` session cookie over HTTPS; "sign out everywhere" | `server.test.ts`, `topup.test.ts`, probe |

## Fixed after kit v1 (please re-check)

- **Streamed requests could stay charged at the full reservation.** The real cost replaced the reservation only when the upstream stream ended. Clients that hang up right after `[DONE]` (opencode does) cancelled the pipe first, so the correction never ran and keys hit their limits early. Venice was always charged the real amount. Now settled as soon as the usage chunk passes (`meterStream`; the E2EE path settles before closing). Tests in `server.test.ts`.
- **The Intel collateral relay failed on Cloudflare** (`redirect: "error"` isn't supported there); now `redirect: "manual"`, with redirects refused as non-OK responses.

## Fixed while preparing kit v1 (please re-check)

- **A streaming abort skipped billing.** Streamed gateway requests were charged only from the final usage chunk, so aborting just before the end avoided the charge and let a key exceed its limits without bound. Now an up-front reservation is corrected at the end and kept if the stream is cut off (`apps/web/src/server/gateway.ts`, `reserve`).
