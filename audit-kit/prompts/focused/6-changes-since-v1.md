# Prompt: changes since kit v1 (delta audit)

For an auditor or agent that already reviewed kit v1 (commit `7e16acc`). **Run inside `source/`.** Copy everything in the box.

```text
You are a senior security auditor re-reviewing a codebase you (or a colleague) audited before at
commit 7e16acc. Only the changes since then are in scope, plus anything they touch.

The project: a website + OpenAI-compatible API for uncensored LLMs (served by Venice), paid with
any token via NEAR Intents 1Click. The website is non-custodial; API keys are backed by a
server-held "API wallet" holding non-withdrawable Venice credit. It now runs on Cloudflare Workers
(OpenNext). Read, in the audit kit next to this source:
  05-changes-since-v1.md   (what changed, and the five questions we most want answered)
  02-what-to-check.md      (invariants; new ones are I17 swap fees and I18 metering)
  03-known-issues.md       (K1–K18; don't re-report unless worse than stated)
  04-how-to-run.md         (tests, the local Cloudflare runtime, the black-box probe)
  templates/findings-template.md

Steps:
1. `npm install`, `npm test`, `npm run typecheck`. Then `git diff 7e16acc..HEAD --stat` if this
   is a clone (otherwise use the file list in 05-changes-since-v1.md).
2. For each changed file, read the change and everything it calls. Focus on:
   - apps/web/src/app/api/oneclick/[...path]/route.ts: I17. Try to set or influence appFees,
     referral or the fee recipient from the client, by any request shape or route.
   - apps/web/src/server/gateway.ts (meterStream, passthrough, e2ee) and keys.ts (authorize,
     recordSpend): I18 and the spend limits. Write tests that stream crafted SSE through
     meterStream: usage split across chunks, usage: null, usage in every chunk, usage inside
     content, a client that cancels at each point. Try to under-charge or double-charge.
   - apps/web/wrangler.jsonc, open-next.config.ts, src/server/ratelimit.ts: Cloudflare runtime
     assumptions (client IP headers, the workers.dev URL, per-isolate caches, outbound fetch).
   - src/app/api/tee/pccs/[...path]/route.ts: redirect "manual" handling.
   - src/app/opencode-config.ts and the dialogs: anything that renders untrusted text.
   - src/chat/conversation.ts (identity): I4/I5 still hold.
3. Answer each of the five questions in 05-changes-since-v1.md explicitly.
4. Optional: build and run the Worker locally (04-how-to-run.md, "Cloudflare runtime") and run
   `npm run audit:probe -- http://127.0.0.1:8788`.

Hard rules:
- NEVER send a transaction, make a deposit or top up credit. Dry quotes and the probe are fine.
- NEVER print, copy or send the contents of any .env or .dev.vars file.
- Don't modify product code. Only add files under audit-findings/.

Output: a Markdown report following templates/findings-template.md, with findings most severe
first (file:line, scenario, proof, fix), explicit answers to the five questions, and the
invariant checklist for I13, I17 and I18 (plus any other invariant a change touched).
```
