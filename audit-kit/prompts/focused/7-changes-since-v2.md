# Prompt: changes since kit v2 (delta audit)

For an auditor or agent that already reviewed the code at commit `c3c7624`, or that only has time for the newest code. **Run inside `source/`.** Copy everything in the box.

```text
You are a senior security auditor re-reviewing a codebase audited before at commit c3c7624. Only
the changes since then are in scope, plus anything they touch.

The project: a website + OpenAI-compatible API for uncensored LLMs (served by Venice), paid with
any token via NEAR Intents 1Click. The website is non-custodial; API keys are backed by a
server-held "API wallet" holding non-withdrawable Venice credit. Runs on Cloudflare Workers.
Read, in the audit kit next to this source:
  06-changes-since-v2.md   (what changed, and the questions we most want answered)
  02-what-to-check.md      (invariants; new ones are I19 to I24)
  03-known-issues.md       (K1 to K25; don't re-report unless worse than stated)
  04-how-to-run.md         (tests, the local Cloudflare runtime, the black-box probe)
  templates/findings-template.md
and docs/state-machines.md in the source.

Steps:
1. `npm install`, `npm test`, `npm run typecheck`. Then `git diff c3c7624..HEAD --stat` if this
   is a clone (otherwise use the file list in 06-changes-since-v2.md).
2. For each changed file, read the change and everything it calls. Focus on:
   - apps/web/src/funding/{machines,flow,anywhere,senders,target}.ts: I1, I19, I20, I23. Extend
     apps/web/src/funding/flow.test.ts (it fakes localStorage, 1Click and the RPC) to try to send
     twice, strand an action, or show success without credit. Include sender errors that happen
     after broadcast but aren't DepositBroadcastError.
   - apps/web/src/app/{credit-dialog,anywhere-panel,api-keys-dialog,connect-button}.tsx: stale
     actions across wallets, buttons reachable in the wrong state.
   - apps/web/src/wallet/{wallet-context.tsx,session.ts}: I21, I22.
   - packages/rail/src/venice/client.ts (chatStream), inference/chat.ts, venice/e2ee.ts,
     apps/web/src/chat/{use-chat,conversation}.ts, packages/proxy/src/server.ts: I4, I5, I24.
     The chatStream change also runs on the hosted gateway: confirm I18 still holds.
   - packages/rail/src/swap/engine.ts: SWAP_MACHINE and the re-sign path.
   - The fixes never re-reviewed: 8f3b6c6 (R-01, R-02) and bbaae47 (T-01, T-02), plus the 8 MB
     body limit from 4907fde.
3. Answer each question in 06-changes-since-v2.md explicitly.
4. Optional: run the Worker locally (04-how-to-run.md) and
   `npm run audit:probe -- http://127.0.0.1:8788`.

Hard rules:
- NEVER send a transaction, make a deposit or top up credit. Dry quotes and the probe are fine.
- NEVER print, copy or send the contents of any .env or .dev.vars file.
- Don't modify product code. Only add files under audit-findings/.

Output: a Markdown report following templates/findings-template.md, with findings most severe
first (file:line, scenario, proof, fix), explicit answers to the questions, and the invariant
checklist for I1, I4, I5, I18 and I19 to I24 (plus any other invariant a change touched).
```
