# Progress

Working state of the project: what's done, what's left, and decisions made. Update this file whenever something changes; it's the first thing to read when picking the work back up.

**Deadline:** 2026-11-14 23:59 UTC (NEAR hackathon, submit once). Judging 2026-11-16, results by 2026-11-18.
**Last updated:** 2026-11-08 (evening)

## Status

| Area | State | Notes |
|---|---|---|
| Website chat (anonymous + Truly private) | ✅ Done, tested on mainnet | In-browser Intel DCAP check shows "Genuine Intel hardware ✓" |
| Funding (any token → 1Click → USDC on Base → Venice x402) | ✅ Done, tested on mainnet | 1% app fee on swaps, half to `rahasya.near` |
| API keys (hosted) | ✅ Mostly tested | curl, opencode, daily limit (429), model allowlist (403) verified. Open: deleted key (401), sign out everywhere, second same-amount top-up (F-02) |
| opencode integration | ✅ Done | Generated config lists all non-TEE models, prices, `enabled_providers`. Needs `opencode.jsonc` + `--standalone` |
| Local proxy | ✅ One-file download: `curl -fsSL https://rahasya.chat/rahasya.mjs -o rahasya.mjs && node rahasya.mjs` (Node 22+). First run asks for the key | Tested from the live site with a throwaway key. Optional: publish to npm as `npx rahasya` (name is free; needs the owner's npm account) |
| Security audit | ✅ Audit 1 (F-01..F-13), audit 2 (V2-01..V2-08) and the fix review (R-01, R-02, T-01, T-02, notes) fixed, with regression tests. 112 tests | Residual: two colluding NEAR RPCs (K10); set trusted `BASE_RPC_URL` / `NEAR_RPC_URL` for production |
| Name / brand | ✅ **Rahasya**, `rahasya.chat` bought | `rahasya.ai` only if we win |
| GitHub | ✅ Private repo `0xyuji/rahasya` | Must be **public** by the deadline (ask first) |
| Cloudflare deploy | ✅ Live at **https://rahasya.chat** (+ www, + rahasya.itadori.workers.dev). 38/38 probe on workers.dev | Domain at Namecheap, DNS on Cloudflare (MX/TXT email forwarding kept) |
| Demo video | ⬜ Not started | |
| X post | ⬜ Not started | Tag @NEARProtocol #NEARHackathon, with the video |
| Hackathon submission | ⬜ Not started | Print the payload and get an explicit yes first |

## Next steps (in order)

1. Probe `https://rahasya.chat` once the owner's Mac DNS cache clears (it still had the old parking IP); test wallet connect live (Reown domains added).
2. ~~Confirm Venice accepts `max_tokens` + `max_completion_tokens` together~~ ✅ 11-08: curl through an API key on rahasya.chat answered (26 tokens, $0.000008).
4. One real end-to-end run on the live site: pay with a non-USDC token, chat in both modes, use an API key. Check the fee lands in `rahasya.near`'s NEAR Intents balance.
5. Finish the API checks: deleted key → 401, sign out everywhere, second same-amount top-up.
6. Demo video (2–3 min): pay with any token → chat → Truly private with the Intel check → API key in opencode.
7. Make the repo public (ask first), re-read https://nearhackathon.com/HACKATHON.md, check the README against it.
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

## Decisions

| Date | Decision | Why |
|---|---|---|
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
