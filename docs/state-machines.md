# State machines

Where Rahasya keeps state that moves through stages, and how each one is enforced. The tables in code are the source of truth; this page says where to find them.

## Rules for changing a table

- `defineMachine` (`packages/rail/src/machine.ts`) is a plain table: state → allowed next states. A state with no exits is final.
- Add an edge to the table before writing code that uses it. A move outside the table throws `ILLEGAL_TRANSITION` and nothing is saved.
- Never rename a funding or swap state. The names are saved in users' browsers (`iw:credit:*`, `iw:anywhere:*`), and unfinished deposits resume from them.
- Money is only ever sent from `QUOTED`. A test asserts this.

## Enforced by a table

| Machine | Table | Runs in | Persisted |
|---|---|---|---|
| Add credit from a connected wallet | `CREDIT_MACHINE`, `apps/web/src/funding/machines.ts` | `runCredit`, `funding/flow.ts` | localStorage |
| Any token, anywhere | `ANYWHERE_MACHINE`, same file | `runAnywhere`, `funding/anywhere.ts` | localStorage |
| Server-side swap | `SWAP_MACHINE`, `packages/rail/src/swap/engine.ts` | `SwapEngine` | JSON store |

`creditSteps` and `anywhereSteps`, next to the tables, decide what the progress list shows for each state. They are exhaustive, so a new state has to say what it displays.

## Named states, no table needed

| State | Where | Stages |
|---|---|---|
| Wallet session | `apps/web/src/wallet/session.ts` | disconnected → locked → unlocking → unlocked |
| Chat reply | `Msg.status`, `apps/web/src/chat/conversation.ts`; one `AbortController` per reply in `use-chat.ts` | streaming → done, stopped or error |
| API keys dialog | `phase`, `apps/web/src/app/api-keys-dialog.tsx` | loading → needs-login, ready or failed |

## Left alone on purpose

These are already explicit, audited and covered by regression tests. Don't restructure them without a reason.

| What | Where | Guarded by |
|---|---|---|
| x402 top-up (`SIGNED`, `SUCCESS`, `FAILED`) | `packages/rail/src/venice/client.ts` | `topup.test.ts` |
| Sweep sequence numbers | `planSweep` in `client.ts`; `apps/web/src/server/api-wallet.ts`; `creditIdleUsdc` in `funding/anywhere.ts` | F-02, V2-03 |
| Spend reservation and metering | `reserve`, `meterStream`, `apps/web/src/server/gateway.ts` | V2-01, V2-05, V2-07, R-01, R-02 |
| Login challenge and session | `apps/web/src/server/login.ts` | single-use by `GETDEL`; live probe |
| API key status (active, expired, over limit) | `authorize`, `apps/web/src/server/keys.ts` | computed per request; nothing to get out of step |
| Attestation cache | `VeniceChat.attestation`, `packages/rail/src/inference/chat.ts` | one in flight per model |

## Reading state from a browser or agent

The DOM exposes the current state, so tests and browser agents don't have to infer it from button labels:

| Attribute | Element | Values |
|---|---|---|
| `data-wallet-session` | connect button | wallet session |
| `data-credit-state` | Add credit dialog | a `CREDIT_MACHINE` state, or `NEW` |
| `data-anywhere-state` | Any token panel | an `ANYWHERE_MACHINE` state |
| `data-keys-phase` | API keys dialog | API keys `phase` |
| `data-status` | assistant message | `Msg.status` |
