# 7. What changed since kit v3

The last audit (report 2026-11-10) covered commit `d23024b`. Everything after it has had three internal AI reviews and no other audit. If you reviewed v3, start here and read `git diff d23024b..HEAD`, or compare `source/` with your v3 copy.

When this kit was packed, the live site was running `fc2b212`, the first half of this work. `source/COMMIT.txt` may be newer. The K26–K32 work has not been used with a real wallet.

## Status of every v3 finding

| Finding | Status | What's there now |
|---|---|---|
| C-01 (High) | Fixed | Only errors that can't follow a broadcast return to `QUOTED`. Everything else goes to `SEND_UNCONFIRMED`. `flow.ts` (`sentNothing`), `senders.ts` |
| B-01 (High) | Fixed | The reservation is kept after timeouts and late failures, and released for 4xx, never-sent requests and a 500/502/503 or failed connection within 10 s. `gateway.ts` (`nothingGenerated`) |
| D-02 | Fixed | Render gated on the uid, load sequencing, credit target carries the uid, `x-wallet-uid` checked in `withUser` (409), sign-in ends the earlier session |
| E-01 | Fixed | Replies never load images. `message.tsx` (`REPLY_ELEMENTS`) |
| B-02 | Partly | The key is checked before the body is read; 16 MB per-isolate budget, one large body per key, read limits. 8 MB kept on purpose (K27) |
| C-02, C-03, C-07 | Fixed | Earlier hashes kept, resend re-checks 1Click, `depositConfirmed` never offers "Send again", `DISMISSED` state |
| C-05 | Fixed | Expiry needs a successful `PENDING_DEPOSIT` read; closed actions are re-checked when the panel opens (`recheckClosed`) |
| C-06 | Fixed on our side | EVM addresses refused on known non-EVM chains, prefilled only on EVM chains. Whether 1Click accepts them is untested |
| A-01 | Fixed | "Couldn't check" retries once, then asks before sending |
| A-02 | Fixed | `scripts/audit/check-worker-csp.mjs` runs in CI and in `cf:deploy`. The extra probe check and wider CSP weren't added |
| A-03 | Fixed | Names added to the blocklist. An allowlist and a headless-browser test weren't done |
| A-04 | Fixed | Collateral errors are an anchored allowlist; the lockdown's fetch reports every transport failure as one message; Intel 400/404/410 reach the verifier as fail |
| A-05 | Fixed | Footer and panel depend on the Intel status and TCB level |
| B-03 | Partly | The bound covers text-bearing forwarded fields. Image pricing and a field allowlist weren't done |
| B-04, B-05, B-06 | Fixed | E2EE stream cancels upstream; usage after the finish chunk is final; 1Click quote fields are allowlisted |
| C-04 | Fixed | Compare-before-write in `move`; a really-sent deposit is always recorded (`recordSent`). `navigator.locks` wasn't added |
| C-08 | Partly | Amount, floor, deadline and echo checks added. Displayed `amountInFormatted`, a USDC price pin and a price staleness limit weren't done |
| C-09 | Not fixed | Server swap engine, scripts only, not on the website path |
| C-10 | Fixed | `confirmSweep` compares with the expected amount; the sweep carries the wallet uid |
| C-11 | Fixed | Bad records are skipped |
| D-01 | Fixed, softened | Signer checked on all three chains; a mismatch asks once rather than refuses, so smart accounts and Ledgers aren't locked out. NEAR compares the reported account only |
| D-03 | Partly | Lock and Cancel discard a late signature. A → B → A and a brief reconnect are still accepted on purpose (mobile reconnects) |
| D-04 | Fixed | Logout has a timeout and runs when the session's wallet changes |
| E-02, E-03 | Fixed | Attestation timeout, Stop races it; only data lines reset the silence timer, 30-minute cap |
| E-04 | Partly | Actions and npm pinned. The build/publish job split wasn't done |
| E-05 | Fixed | `protocol.md` and the listed lines reworded |
| A-06, D-05, E-09 | Fixed | |
| D-08 | Partly | The inference key is copied to the clipboard from the Local proxy dialog, never displayed |
| B-07, B-08, B-09, C-Info, D-06, D-07, E-06, E-07, E-08 | Not fixed | Low or Info |

K26, K28–K32 were closed in the same work; see the table in `03-known-issues.md`.

## New since v3

| Area | Change | Where |
|---|---|---|
| Non-streamed API | Requests stream upstream and are assembled. A cut-off stream is an error | `gateway.ts` (`collectStream`) |
| Funding | No send from `QUOTED` unless 1Click's own copy of the quote is read and matches | `flow.ts` (`matchesRemote`) |
| Funding | New edges and a `DISMISSED` state | `funding/machines.ts` |
| Sign-in | `signLogin` refuses anything but a sign-in for this host, and never signs the derivation message | `wallet-context.tsx` |
| Docs | Agent guide at `/agents.md`, `/llms.txt`, "What's supported" | `content/docs/` |

Live check made while building this: for a fresh, unfunded deposit address, 1Click's status reply carried `quoteResponse` with matching `quote.depositAddress`, `quote.amountIn` and `quoteRequest.{recipient,refundTo,originAsset}`.

## Not verified

- Real wallets after K26–K32: smart accounts, Solana Ledger, NEAR wallets, mobile browsers. A real-money API-wallet top-up and a reload during a swap have offline tests only.
- Workers: memory at 8 MB, `cancel()` reaching our E2EE stream through OpenNext, behaviour when a client hangs up on a long non-streamed reply.
- Venice's live stream shape: in-stream errors, usage chunks, tool-call deltas.
- The worker lockdown in Safari and Firefox, and `window.confirm` in webviews.
- The new CI build step, until it runs on GitHub.

## Questions we'd most like answered

1. **Double payment (I19, I25).** Is there still any path to a second `deps.send` without "Send again"? Does the pre-send read create a way to block normal deposits?
2. **Charging (I18, I26).** Is every outcome of `collectStream` charged exactly once? Can a crafted stream under-charge? Is the 10-second refund window abusable?
3. **Lock-outs (I22).** Can any legitimate wallet be refused or prompted on every unlock? Is the derived key unchanged (I3)?
4. **Intel (I6).** Can a forged quote reach "unavailable" through the allowlist, including `Missing`, `JSON` or `Unexpected`? Can a real outage read as "fail"?
5. **Sessions (I21, I27).** Can `x-wallet-uid` give a wrong 409, or be useful to anyone who has the cookie?
6. **Late deposits.** Can `recheckClosed` resurrect, double-credit or misattribute an action?
7. **Accepted risks.** Which of the remaining known issues should not be accepted for a public launch?
