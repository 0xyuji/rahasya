# Progress

Working state of the project: what's done, what's left, and decisions made. Update this file whenever something changes; it's the first thing to read when picking the work back up.

**Deadline:** 2026-11-14 23:59 UTC (NEAR hackathon, submit once). Judging 2026-11-16, results by 2026-11-18.
**Last updated:** 2026-11-10 (Fable review items 1-10 fixed and deployed; pick up from "Next steps")

## Status

| Area | State | Notes |
|---|---|---|
| Website chat (anonymous + Truly private) | ✅ Done, tested on mainnet | In-browser Intel DCAP check shows "Genuine Intel hardware ✓" |
| Funding (any token → 1Click → USDC on Base → Venice x402) | ✅ Done, tested on mainnet | 1% app fee on swaps, half to `rahasya.near` |
| API keys (hosted) | ✅ Mostly tested | curl, opencode, daily limit (429), model allowlist (403) verified. Deleted key (401) and sign out everywhere are covered by the live probe (40/40, 11-09). Open: second same-amount top-up on mainnet (offline test F-02 passes) |
| opencode integration | ✅ Done | Generated config lists all non-TEE models, prices, `enabled_providers`. Needs `opencode.jsonc` + `--standalone` |
| Local proxy | ✅ One-file download: `curl -fsSLO https://rahasya.chat/rahasya.mjs && node rahasya.mjs` (Node 22+). First run asks for the key | Tested from the live site with a throwaway key. npm: account made with passkey 2FA (11-08); package `packages/proxy/npm` + workflow `.github/workflows/publish-proxy.yml` ready, first publish after the repo is public (see "npm release") |
| Security audit | ✅ Audit 1 (F-01..F-13), audit 2 (V2-01..V2-08) and the fix review (R-01, R-02, T-01, T-02, notes) fixed, with regression tests. 186 tests (rail 51, web 125, proxy 10) | Residual: two colluding NEAR RPCs (K10); set trusted `BASE_RPC_URL` / `NEAR_RPC_URL` for production |
| Name / brand | ✅ **Rahasya**, `rahasya.chat` bought | `rahasya.ai` only if we win |
| GitHub | ✅ Private repo `0xyuji/rahasya` | Must be **public** by the deadline (ask first) |
| Cloudflare deploy | ✅ Live at **https://rahasya.chat** (+ www, + rahasya.itadori.workers.dev). Probe 40/40 on rahasya.chat (11-09) | Domain at Namecheap, DNS on Cloudflare (MX/TXT email forwarding kept) |
| Landing page | ✅ 11-09: header has API · Local proxy · Docs; a line under the prompt (Chat here · API keys · Local proxy); both dialogs open before connecting, with Connect/Unlock buttons | Not yet clicked end to end with a real wallet. Header tool links hidden under 640px (the row covers mobile) |
| State machines | ✅ 11-10, deployed with the Fable review fixes: transition tables for credit, anywhere and swap; see `docs/state-machines.md` | 134 tests, typecheck and probe 40/40 on rahasya.chat after the deploy. Not yet clicked with a real wallet since the deploy |
| Audit kit | ✅ v3 built 11-10 (`npm run audit:pack`): 24 invariants, delta guide `audit-kit/06-changes-since-v2.md`, prompt `focused/7-changes-since-v2.md` | Owner is sending it for audit; fix findings before the 11-12 freeze |
| Agent guide | ✅ 11-10, live at `/docs/agents` and `/agents.md` (Copy and Download buttons); a test keeps its model table in sync | Source: `apps/web/content/docs/agents.md` |
| Audit v3 fixes | 11-10: both Highs and most Mediums/Lows fixed, then reviewed by Fable and its regressions fixed. Deployed 11-10 from branch `audit-v3-fixes` | Left open: known issues K26-K32. Not yet used with a real wallet |
| K26-K32 | 11-10: closed in the working tree of `audit-v3-fixes`, reviewed by Fable and its findings fixed. **Uncommitted, not deployed**, needs a real-wallet unlock test across wallet types | K27 partly: Workers memory unmeasured |
| Final audit | 11-10 report against `9e3db94`: 0 High, 1 Medium, 15 Low, 19 Info. All 16 findings addressed on `audit-v3-fixes`, deployed 11-10. Not yet used with a real wallet | C-09 and in-page dialogs also done. Not done: approve-twice on a double wallet prompt, Solana/Ledger format check, `x-wallet-uid` required |
| Body limit | ✅ 8 MB (gateway + proxy), raised from 4 MB after a 413 | Owner hasn't said what they were doing when it hit; ask if it recurs |
| Demo video | ⬜ Script + narration lines written (in chat, 11-08); owner records, ElevenLabs voice | Show the new header links |
| X post | ⬜ Not started | Must say it was built at NEAR HACKATHON, tag @NEARProtocol and #NEARHackathon, with the video. Optional tags: @NearLegion, @NearBuilders. Owner posts |
| Hackathon submission | ⬜ Not started | Print the payload and get an explicit yes first |

## Next steps (in order)

0. ~~Deploy the state-machine work and Fable review fixes~~ ✅ 11-10. ~~Merge to master, add CI~~ ✅ 11-10. Before going public: trim this file. Real-wallet run must also cover: Cancel unlock, an API-wallet top-up.
1. Owner reviews the new landing page on rahasya.chat; adjust if wanted. Click the dialogs' Connect wallet / NEAR wallet / Unlock buttons with a real wallet.
2. Pick tracks (unanswered). Suggested: privacy (primary), agents, maybe security.
3. ~~Probe rahasya.chat~~ ✅ 40/40. ~~Venice accepts both output-limit fields~~ ✅.
4. (11-10: plain NEAR sent from a NEAR wallet through Any token worked on the live site, before the deploy: wNEAR route, $5.17 credited in a few minutes.) Truly private follow-up messages failed on the live site with HTTP 400 ("Encrypted field is not valid hex", two system messages in a row); fixed in `buildContext` and deployed. Confirmed after the deploy with a real wallet: Anonymous then Truly private follow-up, Verified enclave, Intel check passes in the browser. Still to run (free): Cancel unlock, NEAR tab default, fee check. Skipped on purpose (owner, to save $5): real-money API-wallet top-up and reload during a swap; both have offline tests only. One real end-to-end run on the live site: pay with a non-USDC token, chat in both modes, use an API key. Check the fee lands in `rahasya.near`'s NEAR Intents balance.
5. ~~Deleted key → 401, sign out everywhere~~ ✅ (live probe). Second same-amount top-up: do it during step 4, real money (offline test F-02 passes).
6. Demo video (2–3 min): pay with any token → chat → Truly private with the Intel check → API key in opencode.
7. ~~Check the README against HACKATHON.md~~ ✅ 11-10 (clean keyless copy: `npm install`, tests on Node 22/24/26, `verify:tee`, `quote:dry` all pass). Name the chosen tracks in the README. Make the repo public (ask first).
8. X post, then the submission (payload shown, explicit yes).

## Deploy (Cloudflare Workers)

Config: `apps/web/wrangler.jsonc` (routes for `rahasya.chat` and `www`, Smart Placement), `apps/web/open-next.config.ts`.

```sh
cd apps/web
npx wrangler login                     # owner, in a browser (done 11-08)
npx wrangler secret bulk .dev.vars     # Upstash, API_WALLET_ENC_KEY, ONECLICK_* (done 11-08; owner runs it: auto mode blocks secret writes)
npm run cf:deploy                      # builds, then deploys (plain `opennextjs-cloudflare deploy` does NOT rebuild)
```

- `rahasya.chat` must be a zone in the same Cloudflare account.
- `NEXT_PUBLIC_*` values come from `apps/web/.env.local` at build time.
- `API_WALLET_ENC_KEY` must stay the same everywhere: the funded API wallet is encrypted with it, and local and production share one Upstash database.
- Server-side RPCs: free endpoints rate-limit Cloudflare (mainnet.base.org → 429), so `src/server/rpc.ts` falls back across publicnode, drpc and mainnet.base.org (Base) and fastnear, rpc.mainnet.near.org (NEAR). Set `BASE_RPC_URL` / `NEAR_RPC_URL` secrets for a paid RPC.
- Bundle: about 2.9 MB gzipped. The free plan limit is 3 MB; the paid plan ($5/month) allows 10 MB.

## npm release (after the repo is public)

**State (11-10):** 0.1.0 is already on npm, published by hand by the owner on 11-08, so step 5 below is done. It predates the 11-10 proxy fixes (no upstream hang-up). **Owner wants `npx` offered by the time judges look (judging 11-16).** 11-10: `proxy-v0.1.1` built and staged from the private repo, so no provenance record and approved by the owner: **live on npm as latest**, checked with `npx` from a clean folder. Done next: `npx rahasya@0.1.1` next to the curl command in the Local proxy dialog, the API docs and the agent guide, and deploy. Fallback if the workflow fails: publish 0.1.1 by hand (step 5), no provenance.

Trusted publisher set up on npmjs.com (11-08): GitHub Actions, 0xyuji/rahasya, `publish-proxy.yml`, **stage only** (both "Allow" boxes unchecked). Status: pending validation until 2026-11-10 16:32 UTC. Owner chose to release later, once fully confident; if it expires, delete it on npmjs.com and add it again (same values).

1. Release: bump `packages/proxy/npm/package.json` version, commit, `git tag proxy-v<version> && git push --tags`. GitHub builds, tests and **stages** it.
2. Approve with your passkey: npmjs.com (package `rahasya` → staged versions), or `npm stage list rahasya` then `npm stage approve <id>`.
3. npmjs.com → package → Settings → Publishing access → **require 2FA and disallow tokens**.
4. Docs then say `npx rahasya@<version>` (pinned).
5. If npm refuses to stage the very first version (package doesn't exist yet), publish 0.1.0 once by hand: `cd packages/proxy && npm run bundle && cp dist/rahasya.mjs ../../LICENSE npm/ && cd npm && npm login && npm publish --access public`.

## Submission facts (collected from the owner)

- Only project this person submits to the hackathon (11-08): no Q-015 disclosure needed.
- Keep rahasya.chat up through 2026-11-18, ideally 11-25 (Q-012); the repo stays public through judging (Q-014).
- Still to collect before submitting: tracks, team lead name, contact email, team size (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`), demo post link, consent (read the notice verbatim). Payout account: ask explicitly (don't assume `rahasya.near`, the fee recipient).

## Decisions

| Date | Decision | Why |
|---|---|---|
| 11-10 | Tracks: `privacy`, `security`, `agents`. README says "AI-assisted security audits" | Owner confirmed the audits were run with AI |
| 11-10 | Demo uses a fresh NEAR wallet, about $7 of NEAR, paying through Any token | NEAR hackathon; also keeps the owner's main account out of public transaction links |
| 11-10 | Upstash token and 1Click partner key rotate after results, not before the demo | Neither is in the repo; a bad rotation would break sign-in at the worst time |
| 11-10 | State machines are a small in-repo table (`defineMachine`), no XState; audited top-up, sweep and metering code left as is | Bundle is near the 3 MB limit; those paths are already explicit and regression-tested. State names are persisted in browsers: never rename them |
| 11-08 | Domain stays registered at Namecheap; DNS moves to Cloudflare | Workers custom domains need a Cloudflare zone |
| 11-08 | Host on Cloudflare Workers, not Vercel | Owner's choice; the domain is there. Server code was kept fetch-only for this |
| 11-08 | Name: Rahasya, "Private AI, kept in confidence" | Domain bought |
| 11-08 | Swap fee 1% total (1Click keeps half). Mentioned in the docs only, not in the UI | Owner's choice. 1Click charges 0.2% even with no app fee, and a partner key doesn't change that |
| 11-08 | Browser storage keys keep the `naisho:` prefix | Renaming `naisho:idle-seq` could reuse an old x402 top-up id |
| 11-08 | Website chat adds a one-line model identity system prompt | Models claimed to be ChatGPT. API keys and the proxy send exactly what the tool sends |
| 11-08 | opencode config hides other providers (`enabled_providers`) | Owner's request; one line to delete if a user wants them |

## Known gaps (not blocking the submission)

- Keep Cloudflare's **Pseudo IPv4 "Overwrite headers"** off for rahasya.chat (it would undo per-/64 rate limits).

- Enclave software measurement (MRTD) is shown but not pinned (audit K9).
- `recordSpend` writes aren't atomic (K17).
- NEAR wallet one-click funding, mobile polish.
- After the hackathon: rotate the Upstash token and the 1Click partner key (both were handled in chat).

## Ground rules

- Never push to a public place, make the repo public, post on X, submit, or sign a mainnet transaction without the owner's explicit yes.
- Never commit secrets. They live in `.env`, `apps/web/.env.local` and `apps/web/.dev.vars`, all gitignored.
- Test with the cheapest models (`gemma-4-uncensored`, `deepseek-1017-uncensored`; TEE: `gemma-4-26b-tee`).
