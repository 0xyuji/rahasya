# Prompt: changes since kit v3 (delta audit)

For an auditor or agent reviewing what changed after the audit of commit `d23024b`. **Run inside `source/`.** Copy everything in the box.

```text
You are a senior security auditor reviewing fixes made after an audit of commit d23024b, plus the
new code they added. Those fixes have had internal AI reviews only, and earlier rounds of this
work repeatedly introduced regressions that passing tests didn't catch. Be skeptical.

The project: a website + OpenAI-compatible API for uncensored LLMs (served by Venice), paid with
any token via NEAR Intents 1Click. The website is non-custodial; API keys are backed by a
server-held "API wallet" holding non-withdrawable Venice credit. Runs on Cloudflare Workers.
Read, in the audit kit next to this source:
  07-changes-since-v3.md   (status of every finding, what's new, what's unverified, the questions)
  02-what-to-check.md      (invariants; I25 to I28 are new)
  03-known-issues.md       (don't re-report unless worse than stated)
  04-how-to-run.md
  templates/findings-template.md
and docs/state-machines.md in the source.

Steps:
1. `npm install`, `npm test`, `npm run typecheck`. Then `git diff d23024b..HEAD --stat` if this is
   a clone.
2. Check each finding marked Fixed or Partly in 07-changes-since-v3.md: is it actually closed?
3. Trace the real user flows, happy path first, then failures:
   - Add credit: apps/web/src/funding/{flow,senders,machines,anywhere}.ts and the dialogs.
   - A non-streamed and a streamed API call: apps/web/src/server/gateway.ts, keys.ts.
   - Unlock on EVM, Solana, NEAR: apps/web/src/wallet/.
   - Truly private: packages/rail/src/inference/chat.ts, packages/rail/src/venice/, apps/web/src/tee/.
   - API keys session: apps/web/src/server/http.ts, apps/web/src/app/api-keys-dialog.tsx.
4. Look for anything the fixes broke for a normal user, marked as such.
5. Answer each question in 07-changes-since-v3.md explicitly.
6. Optional: run the Worker locally (04-how-to-run.md) and
   `npm run audit:probe -- http://127.0.0.1:8788`.

Hard rules:
- NEVER send a transaction, make a deposit or top up credit. Dry quotes and the probe are fine.
- NEVER print, copy or send the contents of any .env or .dev.vars file.
- Don't modify product code. Only add files under audit-findings/.

Output: a Markdown report following templates/findings-template.md, with findings most severe
first (file:line, scenario, proof, fix), explicit answers to the questions, and the invariant
checklist for I1, I4, I5, I6, I18 to I28.
```
