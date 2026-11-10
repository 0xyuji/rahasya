# 6. What changed since kit v2

The last outside review covered commit `c3c7624` (2026-11-08). Its findings were fixed in `8f3b6c6` and `bbaae47`, and those fixes have not been re-reviewed. If you reviewed v2, start here.

To see the full diff: `git diff c3c7624..HEAD` in a clone, or compare `source/` with your v2 copy. The live site runs commit `3a907ec`; anything after it in `source/COMMIT.txt` is this kit and its packer only.

Commit `d683de2` is the one to read hardest. It rewrote the browser funding flows, and it has had one internal AI review and light real-wallet use, no outside review.

## At a glance

| Area | Change | Where | Why it matters |
|---|---|---|---|
| **Funding** | Credit, any-token and swap flows now run through transition tables. A move not in the table throws before anything is saved | `rail/src/machine.ts`, `web/src/funding/machines.ts`, `rail/src/swap/engine.ts` (`SWAP_MACHINE`) | Is every real path in the table? Can a bad edge strand or re-send funds? (I20) |
| **Funding** | One run per credit action. A second `runCredit` joins the first | `web/src/funding/flow.ts` | Reopening the dialog during a wallet prompt used to mark the send unconfirmed. Per tab only (K21) |
| **Funding** | A send that fails after broadcast (`DepositBroadcastError`) moves to `DEPOSIT_SENT` instead of back to `QUOTED` | `flow.ts`, `senders.ts`, `machines.ts` | Used to offer "Confirm and send" again after funds had left (I19) |
| **Funding** | `SEND_UNCONFIRMED` now re-checks 1Click and can resume. A deposit 1Click doesn't see for 5 minutes goes to `SEND_UNCONFIRMED` | `flow.ts` | New edges from `DEPOSIT_SENT` and `SWAPPING`. Only "Send again" returns to `QUOTED` |
| **Funding** | Any-token quotes now check the echoed amount, `amountIn <= amount`, `minAmountIn <= amountIn` and an independent price ceiling | `web/src/funding/anywhere.ts` (`checkAnywhereQuote`) | Closes the gap kit v2 listed against `quoteAnywhere` (I1) |
| **API wallet** | A $0 sweep no longer counts as success unless the USDC is already gone | `flow.ts` (`confirmSweep`), `web/src/funding/target.ts`, `usdc-panel.tsx` | I23, K20 |
| **API wallet** | The dialogs ignore and refuse to drive an action made for the other wallet | `credit-dialog.tsx`, `anywhere-panel.tsx` | Inference and API targets share the dialog |
| **Sessions** | The API keys dialog treats a session as signed out unless its `uid` matches the connected wallet. Disconnect calls logout | `api-keys-dialog.tsx`, `wallet-context.tsx`, `wallet/session.ts` | Client-side only: the cookie alone still authorizes the API routes (I21) |
| **Unlock** | Account and key are one state. One unlock at a time, cancellable. A signature from a wallet no longer connected, or from an abandoned attempt, is discarded | `wallet-context.tsx`, `wallet/session.ts` | I22 |
| **Chat** | Stop aborts the HTTP request, and readers cancel when a consumer stops early. Stopping during attestation prevents the paid request | `web/src/chat/use-chat.ts`, `rail/src/inference/chat.ts`, `rail/src/venice/{client,e2ee}.ts` | I24 |
| **Chat** | The `chatStream` timeout now limits silence, not total length | `rail/src/venice/client.ts` | Runs on the gateway too. Does a stalled upstream still end? |
| **Chat** | At most one system message on E2EE requests. Two in a row got HTTP 400 from Venice, so every Truly private follow-up failed | `web/src/chat/conversation.ts` | I5 |
| **Proxy** | A client disconnect aborts the upstream stream | `proxy/src/server.ts` | I24 |
| **Attestation UI** | `tee_provider` is labelled as Venice's claim. The footer no longer says "Verified enclave" when the Intel check couldn't run | `web/src/chat/message.tsx` | K22 |
| **Gateway** | Body limit raised from 4 MB to 8 MB (gateway and proxy), with an allocation-free UTF-8 count for the reservation | `web/src/server/gateway.ts`, `proxy/src/server.ts` | Memory on Workers; R-01's bound still holds? |
| **Landing** | API and Local proxy dialogs open before a wallet is connected | `web/src/app/*` | No new server routes |
| **Docs** | Privacy wording changed from "unlinkable" to pseudonymous, and the who-sees-what table now lists IP and Base RPC | `README.md`, `content/docs/*` | Tell us if any claim is still stronger than the code |

## Not tested with real money

An API-wallet top-up after these changes and a reload during a swap have offline tests only. Tested with a real wallet: plain NEAR through Any token (before `d683de2`), and an Anonymous message followed by a Truly private follow-up with every attestation check passing (after it).

## Questions we'd most like answered

1. **Double payment (I19).** Is there any path from a broadcast deposit back to a second `deps.send` without the user clicking "Send again"? Consider sender errors that happen after broadcast but aren't `DepositBroadcastError`, such as a wallet that broadcasts and then throws from `sendTransaction` or `signAndSendTransaction`.
2. **The tables (I20).** Is any edge missing, so a legitimate state throws and strands an action? Is any edge too permissive? `move()` checks an in-memory copy of the action: can a stale copy overwrite newer state in a way that matters?
3. **Saved state.** Can a tampered localStorage record reach `SENDING` with a changed deposit address now that resume paths have changed?
4. **Unlock (I22).** Can the inference wallet ever be set from a signature by a wallet other than the connected one? Consider a brief reconnect, A → B → A switching, and a signature arriving during the source-change effect.
5. **Sessions (I21).** Should the server bind anything here, given the check is client-side? Does signing out on Disconnect race with signing in on another wallet?
6. **Stop and timeouts (I24).** Can an abort leave spend metered wrongly on the gateway, which doesn't pass a signal? Is a stalled stream always ended by the silence timer, including when the consumer stops reading? The hosted gateway's E2EE stream has no cancel handler: does a client hang-up keep it reading upstream, and what does that cost?
7. **The unreviewed fixes.** Do R-01, R-02, T-01 and T-02 hold, and is the 8 MB limit safe on Workers?
8. **Quote check.** Can a hostile 1Click response still show a misleading deposit amount or address on the any-token path?
