# 3. Known issues and accepted risks

No need to report these again. **Do** tell us if one is worse than described, and how.

| # | Issue | Status |
|---|---|---|
| K1 | Spend limits can be exceeded by requests already in flight when a limit is crossed. Every request reserves an estimate up front (prompt size + the output limit: `max_tokens`, 1–32768, default the model's maximum) that's corrected to the real cost at the end, on the same UTC day | Bounded by concurrency × per-request cost (60/min rate limit). A per-key concurrency cap would close it |
| K2 | The rate limit is a fixed 60 requests/minute window per key | Simple by design |
| K3 | The server holds API wallet keys (custody of Venice credit) | Product decision. Credit can't be withdrawn; USDC is swept to credit when the API keys dialog sees it or on the next out-of-credit request. A breach means credit gets spent, not funds stolen (except USDC not yet swept) |
| K4 | API-key requests, including TEE models, are plaintext on our server while in transit | Documented. Truly private mode on the website and the local proxy avoid it |
| K5 | ~~`/api/oneclick` has no rate limit~~ **Fixed:** per-IP limits per minute (20 quotes, 30 token lists, 120 status checks). Still unauthenticated by design (the site uses it before sign-in) | Limits are keyed on the platform's client-IP header |
| K6 | No strict `default-src` CSP (the WalletConnect modal loads from many origins) | Anti-framing headers are set; XSS hardening relies on React escaping and react-markdown (no raw HTML) |
| K7 | The derivation message is the same on every site, so a phishing site asking for it gets the inference key | The message warns about this; balances are meant to be small; brand/domain intentionally excluded so the key never changes (I3) |
| K8 | `npm audit` advisories inside third-party libraries: zod < 4.6.6 in Reown AppKit, bigint-buffer via @solana/web3.js 1.x, jayson/stream-json/uuid, and `elliptic` (CVE-2025-14505, low) via `@phala/dcap-qvl` | No fix we can apply without breaking them; our own zod is 4.6.7; we only encode our own amounts with bigint-buffer; the elliptic bug is in signing, and the verifier only verifies (no private keys, sandboxed worker) |
| K9 | **Partly fixed.** (A forged quote can no longer downgrade the Intel check to "couldn't check": T-01.) The Intel DCAP chain is now verified in the browser (sandboxed worker, `apps/web/src/tee/`). Still open: the enclave's software measurement (MRTD/RTMRs) isn't pinned, NVIDIA GPU evidence is only reported by Venice, and the API-key gateway and local proxy don't run the Intel check (they rely on Venice's verifier). So against Venice itself, Truly private relies on Venice running the enclave software it publishes | Shown as such in the UI and docs. Measurement pinning is on the roadmap |
| K10 | **Partly fixed (V2-02).** Plain EVM signatures are now verified locally, with no RPC. Smart-contract wallets and NEAR access keys still need chain state: a configured `BASE_RPC_URL` / `NEAR_RPC_URL` is trusted alone; without one, at least two independent public endpoints must agree and none may disagree (`src/server/rpc.ts`). Remaining risk: two colluding public providers, or a lying configured RPC | Configure a trusted RPC in production. Balance reads for sweeps still use a plain fallback (a wrong answer can only make a top-up fail) |
| K11 | Saved actions in localStorage include signed x402 authorizations (single-use, short-lived, credit the user's own wallet) | XSS could only replay them to top up the victim's own credit |
| K12 | `authorize` makes 3 sequential Redis REST calls (key hash → key record → spend counters + rate limit together), then 1 to load the API wallet and 1 to reserve. Far from the database that's ~2 s; co-located (Smart Placement) a few ms | Performance only |
| K13 | 1Click may not refund the 0.5% slippage buffer on exact-output swaps | Seen on mainnet; documented |
| K14 | ~~The local proxy doesn't check `Host`~~ **Fixed:** only `127.0.0.1`, `localhost` and `[::1]` are accepted as Host | Test in `packages/proxy/src/server.test.ts` |
| K15 | Swap fee: we add a 1% app fee to 1Click quotes; 1Click keeps half of it (without an app fee it charges 0.2% itself). Direct USDC-on-Base funding and inference carry no fee | Business decision, stated in `docs/protocol.md` ("Fees"). Not a vulnerability unless a client can change it (I17) |
| K16 | In-memory caches (Intel collateral, 1 h; Venice prices, 10 min) live per Worker isolate, so cold isolates refetch | Rate limits and spend are in Redis, not in memory. Collateral is Intel-signed and verified in the browser |
| K17 | `recordSpend` issues its four writes (day counter, its TTL, total counter, last-used) in parallel, not atomically. A failed write can leave day and total apart by one request's cost, or a day key without a TTL | Bounded to one request per failure. A Redis `MULTI` would close it |
| K18 | The Worker was also reachable on its `*.workers.dev` URL (same code, same secrets) | Fixed: `workers_dev` is off, so `rahasya.chat` (and `www`) is the only hostname |
| K19 | The proxy download (`/rahasya.mjs`) and its SHA-256 come from the same site, so the checksum only catches a broken download, not a compromised deployment. The file is built from the public repo on every deploy, but the build isn't reproducible-verified | Users who don't want to trust the site can run it from a clone (`npm run proxy`). A signed release (or npm provenance) would close it |
| K20 | After a $0 API-wallet sweep, the browser treats the top-up as already done if it also reads less than $5 of USDC. If both reads lag behind a just-arrived deposit, "Added" can appear before credit exists | Narrow. The USDC stays on the API wallet and is swept on the next out-of-credit request |
| K21 | One run per credit action is enforced per browser tab. A second tab can mark a send unconfirmed while the first wallet prompt is open. A stale copy can no longer overwrite newer state, and a deposit that was really sent is always recorded | A double send still needs the user to click "Send again". The Web Locks API would close it |
| K22 | `tee_provider` ("near-ai") comes from Venice's attestation JSON and isn't bound to the hardware quote | Labelled in the UI and README as Venice's claim. A cross-check against NEAR AI's own attestation would close it |
| K23 | The UI says an extra deposit to a used 1Click address is "normally refunded, minus a refund fee". 1Click's docs don't cover a second deposit after a completed swap | Not tested with a real second deposit |
| K24 | Local development and production currently share one Upstash database and `API_WALLET_ENC_KEY` | Operational, not a code issue. Separation and rotation of both are scheduled right after judging (kept stable so the live demo keeps working) |
| K25 | The local proxy cancels upstream only for streamed requests; a non-streamed request finishes after the client disconnects | Bounded by that one request |
| K33 | NEAR unlock compares the wallet-reported `accountId` only | Signer questions are in-page dialogs (`wallet/ask.ts`) |
| K34 | npm `rahasya@0.1.1` and earlier were released from the private repo, so they have no provenance record | Fixed in 0.1.2: built by GitHub Actions from the public repo with npm provenance (trusted publishing, staged and approved by the owner) |
| K27 | Body limit stays 8 MB. The key is checked before the body is read, and large bodies share a 16 MB per-isolate budget (503 when full). At most one large body per key (held for a whole non-streamed generation), a body-read limit of 30 s idle and 120 s total, and several copies still held per request. Workers memory wasn't measured (B-02) | The owner raised the limit after real 413s |

## Fixed after the first audit (2026-11-08, report against commit 8e1d47c)

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

## Fixed after the final audit (2026-11-10, report against 969a9d5), not yet re-reviewed

C-14 (every money field must be present in 1Click's copy and equal; refunds tied to the paying wallet; the token comes from the live list), C-13 (a nonce check catches a send hidden behind a declined retry; the approve-twice variant remains), B-10, B-11, B-12 (usage checks and `x-should-retry`), B-13 (streams must finish, on every path), B-14, C-15 (balance check before the prompt; a missing field is a try-again), C-16 (compare-before-write, `navigator.locks` around top-ups), A-07 (only Intel's TCB 404 is a fail; a hash test pins the library), A-08 (consent per enclave, reset on a wallet change), A-09 (60-second cache after consent), D-09, D-10, D-11 (`account` passed to the wallet), E-10, E-11, E-15, E-16, A-11, C-17, C-18, B-16.

Live checks made for these: sign-in message host on `rahasya.chat` and `www`; every compared field in 1Click's status copy, including `deadline`; `[DONE]` and a `finish_reason` on plain and both TEE streams.

## Closed after audit v3 (2026-11-10), not yet re-reviewed by anyone outside

| Was | Now |
|---|---|
| K26 non-streamed requests timing out | Upstream is always streamed and collected (`collectStream`), so usage always arrives and only silence can time out |
| K28 no server-side wallet check | Pages send `x-wallet-uid`; `withUser` answers 409 on a mismatch. A new sign-in ends the browser's earlier session. Clients that omit the header (the probe, tools) are unaffected: the cookie still authorizes |
| K29 unlock signer unchecked | EVM signer recovered and compared; Solana signature verified. EVM, Solana and NEAR mismatches ask once per account and signer rather than refuse, because smart accounts, Ledgers and multi-account wallets are legitimate. NEAR compares the self-reported `accountId` only. Asked in an in-page dialog |
| K30 Intel check | "Couldn't check" retries once, then asks before sending (once per conversation). Collateral errors are an allowlist: anything unrecognised is "fail". Intel 4xx pass through as fail. CI checks the worker CSP after the build |
| K31 late deposits | Re-checked for the newest few closed actions (under 7 days old) when the panel opens |
| K32 saved quote tampering | Compared with 1Click's own copy before sending. If 1Click can't confirm the quote, nothing is sent. The any-token panel still shows the saved address without this check; a tamperer with that access could change the page too |

## Fixed after audit v3 (2026-11-10, report against 0bfcb4f), not yet re-reviewed

Tests in `apps/web/src/funding/flow.test.ts`, `apps/web/src/server/audit-v3.test.ts`, `packages/rail/src/inference/chat-stop.test.ts`.

C-01, B-01, D-02 (client side and credit target), E-01, B-02 (auth before body), C-02, C-03, C-04, C-05 (expiry), C-06, C-07, C-08 (quote checks and deadlines), C-10, C-11, A-03, A-05, B-03, B-04, B-05, B-06, D-03 (Lock), D-04, E-02, E-03, E-04 (pins), E-05, A-06, D-05, D-08, E-09.

## Fixed after an internal AI review (2026-11-10), not yet reviewed by anyone else

Details and questions are in `06-changes-since-v2.md`. Tests in `apps/web/src/funding/flow.test.ts`, `packages/rail/src/machine.test.ts`, `packages/rail/src/inference/chat-stop.test.ts`, `packages/proxy/src/server.test.ts`.

| Finding | Fix |
|---|---|
| R3-01: a send failing after broadcast offered "Confirm and send" again | `DepositBroadcastError` keeps tracking the deposit; a deposit 1Click never sees goes to `SEND_UNCONFIRMED` after 5 minutes |
| R3-02: "Added" with $0 credited; quotes crossing wallets | `confirmSweep`; dialogs ignore actions for the other wallet |
| R3-03: API keys session not tied to the wallet, survived Disconnect | `uid` compared with the connected wallet; Disconnect logs out |
| R3-04: cancelled tools kept billing through the proxy; Stop left the connection open | Upstream aborted; readers cancel on early exit |
| R3-05: replies cut off at 3 minutes | Timeout limits silence only |
| R3-06: a hung wallet prompt locked the account menu | Cancel unlock; late signatures discarded |
| R3-07: Truly private follow-ups got HTTP 400 (two system messages) | One system message on E2EE requests |
| R3-08: weaker any-token quote checks than documented | `checkAnywhereQuote` |
| R3-09: wording stronger than the code ("unlinkable", near-ai as fact, "Verified" when Intel was unavailable) | Reworded in the UI and docs |

## Fixed after the fix-verification review (2026-11-08, report against bd69659)

The review found all eight V2 fixes holding, plus these. Tests in `apps/web/src/server/audit-v2.test.ts` and `apps/web/src/tee/intel-classify.test.ts`.

| Finding | Fix |
|---|---|
| T-01 High (I6): the quote's producer could turn the Intel check's "fail" into "couldn't check" by breaking its own certificate section | The worker first does everything `getCollateral` reads from the quote, with no network: parse it, require an embedded PCK chain (cert type 5), read the FMSPC and issuer (`tee/intel-classify.ts` `checkQuoteCertificates`). Any error there is a **fail**. Intel answering 404 for the quote's FMSPC (the relay now passes it through) is a **fail**. Only network errors, 429 and 5xx are "couldn't check", plus `verify` errors whose message is exactly one of six stale-collateral messages (a test pins them to the library source). Checked in headless Chrome on the Cloudflare build: the real quote passes, the broken-certificate forgery fails |
| T-02 High (I16): `import()` escaped the worker lockdown (credentialed same-origin GETs, any-origin egress) | (1) Cookie routes answer only a page's own `fetch()`: `withUser` and logout require the `x-app-request: 1` header and refuse any `Sec-Fetch-Dest` other than `empty` (`server/http.ts` `fromOurPage`; pages use `app/app-fetch.ts`). (2) The worker's chunks are served with their own CSP from `public/_headers` (`default-src 'none'; script-src 'self'; connect-src 'self'`). (3) The lockdown also removes `WebSocketStream`, `navigator.serviceWorker` and `navigator.locks`. Checked in headless Chrome on the Cloudflare build with a worker under the same CSP: a cross-origin `import()` is blocked before any request leaves, and `import("/api/keys", {type: "json"})` gets a 403. Probe checks added |
| R-01 Medium: the prompt half of the reservation was UTF-16 length / 3 (about 9× low for some scripts) | `promptTokenBound`: UTF-8 byte length of the messages **and tool definitions**, plus 4096 tokens per image part. An upper bound for byte-level BPE; ordinary text is over-reserved and corrected when usage arrives |
| R-02 Low: an early `choices: []` usage chunk counted as final | Final only on a chunk with a `finish_reason`, or at `[DONE]` / end of stream (using the last usage seen). Everything else is a running total, which can only raise the charge |
| Info: no tests for V2-06 / V2-07 | Added: case variants of `fmspc` share one upstream fetch and the cache stays ≤ 32 entries (`server/pccs-cache.ts`); the settle write reaches `ctx.waitUntil` |
| Info: IPv4-mapped IPv6 (`::ffff:1.2.3.4`) all in one bucket | Mapped to the IPv4 address. **Keep Cloudflare's Pseudo IPv4 "Overwrite headers" off** for the zone: it would replace IPv6 clients' `cf-connecting-ip` and undo the /64 bucketing |
| Info: other output-limit aliases | `max_output_tokens` is removed before our limit is set |
| Info: login availability with 2-of-3 public RPCs | Unchanged in code; see K10 (configure trusted `BASE_RPC_URL` / `NEAR_RPC_URL`) |

## Fixed after the second audit (2026-11-08, report against f4500bb)

Each fix has a regression test in `apps/web/src/server/audit-v2.test.ts`. The auditor's original proofs fail against the fixed code, as they should, except V2-02c (two colluding NEAR RPCs; see K10).

| Finding | Fix |
|---|---|
| V2-01 High: reservation and upstream read different output-token fields | One limit per request (`outputLimit`: `max_completion_tokens`, else `max_tokens`, else the model's maximum; capped at the model's maximum and 32768). It sizes the reservation and is sent to Venice as **both** fields, on the passthrough and E2EE paths. Per-model maximums come from Venice's `/models` (`maxOutputTokens` in `rail/inference/models.ts`) |
| V2-02 Medium: one lying fallback RPC could sign anyone in | Local ECDSA recovery first; RPCs only for smart wallets / NEAR keys, with a trusted configured RPC or a 2-of-N quorum and no dissent (see K10) |
| V2-03 Medium: a stale balance read wedged top-ups | `planSweep` (rail): re-send a saved authorization only if the wallet can cover it; otherwise wait until it can't settle any more, then use a new sequence number for the real balance. Server sweep and browser idle-USDC credit both use it |
| V2-04 Low: per-IP limits keyed on the full IPv6 address | IPv6 buckets by /64 (`rateKey`); in production only `cf-connecting-ip` is read (no client-controlled fallbacks), and a missing header shares one bucket |
| V2-05 Low: settled on the first usage object | `meterStream` reports every usage object with a `final` flag (no choices, a finish_reason, or `[DONE]` / end of stream after usage). Running totals can only raise the charge; the final one sets it |
| V2-06 Low: unbounded PCCS cache keyed on the raw query | Keyed on the upstream URL, at most 32 entries, expired entries dropped |
| V2-07 Low: settle writes not tied to `waitUntil` | The request's Cloudflare context is captured when the request starts (`server/runtime.ts`) and every late spend write is registered with `ctx.waitUntil` |
| V2-08 Info | Swallowed auto-top-up errors are logged (code and status only); the 1Click proxy reads at most 4 KB and requires a JSON object; failed spend corrections no longer turn a paid reply into a 502; `buildContext` uses `findModel`; the opencode config explains a TEE-only allowlist instead of an empty list |

## Fixed after kit v1 (please re-check)

- **Streamed requests could stay charged at the full reservation.** The real cost replaced the reservation only when the upstream stream ended. Clients that hang up right after `[DONE]` (opencode does) cancelled the pipe first, so the correction never ran and keys hit their limits early. Venice was always charged the real amount. Now settled as soon as the usage chunk passes (`meterStream`; the E2EE path settles before closing). Tests in `server.test.ts`.
- **The Intel collateral relay failed on Cloudflare** (`redirect: "error"` isn't supported there); now `redirect: "manual"`, with redirects refused as non-OK responses.

## Fixed while preparing kit v1 (please re-check)

- **A streaming abort skipped billing.** Streamed gateway requests were charged only from the final usage chunk, so aborting just before the end avoided the charge and let a key exceed its limits without bound. Now an up-front reservation is corrected at the end and kept if the stream is cut off (`apps/web/src/server/gateway.ts`, `reserve`).
