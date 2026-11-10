# Security audit kit (final): Rahasya

Thanks for reviewing this. This folder has everything you need: what the system does, what must never break, what to attack first, what we already know is weak, how to run it without spending money, ready-made prompts for AI agents, and the report format.

**The project in one paragraph.** A website and OpenAI-compatible API for chatting with uncensored / abliterated LLMs (served by Venice), paid with any token on any chain through NEAR Intents. The website is non-custodial: a key is derived in the browser from a wallet signature, funds are swapped into that wallet, and the browser pays Venice via x402 and signs every request. A "Truly private" mode attests a hardware enclave (TEE) and end-to-end encrypts to it. Separately, users can create Venice-style API keys (spend limits, model allowlists) backed by a server-held "API wallet" that only ever holds non-withdrawable Venice credit.

## What to read, by who you are

| You are | Read | Then |
|---|---|---|
| **Human auditor** | `01-overview.md` → `02-what-to-check.md` → `03-known-issues.md` | `04-how-to-run.md`, report with `templates/findings-template.md` |
| **Running an AI agent with repo access** (Claude Code, Codex, Cursor agent…) | This file | Paste `prompts/full-audit.md` into the agent, run inside the source folder |
| **Running several agents in parallel** | This file | One agent per file in `prompts/focused/`. Each one is self-contained |
| **Using a chat model without tools** (ChatGPT, Claude.ai…) | This file | `prompts/chat-only.md`; paste the files it asks for |
| **Reviewed kit v3 already, or short on time** | `07-changes-since-v3.md` | `prompts/focused/8-changes-since-v3.md` (delta audit; the newest code has had no outside audit) |
| **Reviewed kit v2** | `06-changes-since-v2.md` | `prompts/focused/7-changes-since-v2.md`, then `8-changes-since-v3.md` |
| **Only reviewed kit v1** | `05-changes-since-v1.md`, then `06-changes-since-v2.md` | `prompts/focused/6-changes-since-v1.md` and `7-changes-since-v2.md` |
| **Checking findings someone else reported** | `03-known-issues.md` | `prompts/triage-findings.md` |

## What's in this folder

```
00-START-HERE.md          this file
01-overview.md            architecture, components, trust boundaries, assets
02-what-to-check.md       the 28 invariants + prioritized attack checklist
03-known-issues.md        accepted risks: don't re-report unless worse than stated
04-how-to-run.md          setup, tests, Cloudflare runtime, black-box probe, safe-testing rules
05-changes-since-v1.md    what changed between kits v1 and v2
06-changes-since-v2.md    what changed between kits v2 and v3
07-changes-since-v3.md    status of every v3 finding, what's new and unverified, and the questions we most want answered
prompts/
  full-audit.md           one agent, whole codebase
  focused/                eight area-specific prompts for parallel agents (6, 7, 8 = delta audits)
  chat-only.md            for chat models: paste-in review
  triage-findings.md      verify and de-duplicate a findings report
templates/
  findings-template.md    severity rubric + finding format + invariant checklist
source/                   snapshot of the code at the commit below (tracked files only)
```

Commit under review: see `source/COMMIT.txt`, or `git rev-parse HEAD` in the repo.

**Live site:** https://rahasya.chat (Cloudflare Workers). Prefer a local run; against the live site, only the black-box probe (`npm run audit:probe -- https://rahasya.chat`), which spends nothing and is rate limited.

## Ground rules (please share these with any agent you run)

1. **No real money.** Don't run anything that sends a transaction, makes a deposit or tops up credit (`npm run e2e -- run`, the site's Add credit). NEAR Intents has no testnet. If a paid path must be tested, ask us; we'll do it with a throwaway wallet.
2. **No secrets.** The snapshot contains none. If you're given a `.env` or `.dev.vars`, don't print, copy or send its contents anywhere.
3. **Our infrastructure only.** Don't test against other people's accounts or keys, and don't load-test Venice, 1Click or public RPCs.
4. **Proof over opinion.** A finding is much more useful with a failing test or a script that demonstrates it. Put those in an `audit-findings/` folder and reference them.
5. **Report privately** to the team, not in public issues.

## What we need back

One report per auditor, following `templates/findings-template.md`: a summary, findings (most severe first, each with file:line, exploit scenario, proof and fix), and the invariant checklist (I1–I28 holding or broken, and how you checked).
