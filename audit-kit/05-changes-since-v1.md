# 5. What changed since kit v1

Kit v1 was built from commit `7e16acc` (2026-11-08). It already covered the fixes for the first audit (F-01 to F-13) and the in-browser Intel signature check. If you reviewed v1, start here: everything below is new attack surface or changed code.

To see the full diff: `git diff 7e16acc..HEAD` in a clone, or compare `source/` with your v1 copy.

## At a glance

| Area | Change | Where | Why it matters |
|---|---|---|---|
| **Hosting** | The site now runs on **Cloudflare Workers** (OpenNext adapter) instead of Vercel/Node | `apps/web/wrangler.jsonc`, `apps/web/open-next.config.ts` | New runtime: client IP comes from `cf-connecting-ip`; outbound fetch is limited to public addresses (`global_fetch_strictly_public`); in-memory caches are per isolate; "Smart Placement" runs the Worker near the database |
| **Hosting** | Docs markdown is baked into the bundle at build time (Workers have no file system) | `apps/web/scripts/gen-docs.mjs`, `src/app/docs/docs.generated.ts` | A test fails if the generated file is stale |
| **Hosting** | The Intel collateral relay uses `redirect: "manual"` (Workers don't support `"error"`) | `src/app/api/tee/pccs/[...path]/route.ts` | A redirect becomes a non-OK response and is refused. Please confirm |
| **Money** | **App fee on swaps:** our server adds `appFees` (1%, paid to `rahasya.near`; 1Click keeps half) and a fixed `referral` tag to every 1Click quote. Client-supplied `appFees` and `referral` are dropped | `src/app/api/oneclick/[...path]/route.ts` | New invariant **I17** |
| **Metering** | Streamed API-key requests now settle on the **usage chunk** (just before `[DONE]`), not at stream end. Clients like opencode hang up right after `[DONE]`, which cancelled the pipe and left the whole reservation charged | `src/server/gateway.ts` (`meterStream`, `e2ee`) | New invariant **I18**. Found in our own testing; overcharged the key's counters (Venice charged the real amount) |
| **Metering** | Redis calls run in parallel: `authorize` makes 3 round trips instead of 5, and `recordSpend` makes 1 instead of 4 | `src/server/keys.ts` | `recordSpend` is now 4 independent writes in `Promise.all`. A partial failure can leave the day/total counters disagreeing (K17) |
| **Product** | opencode config generated in one place, with every non-TEE model, per-model `cost`, and `enabled_providers`; a per-key config in the API keys dialog | `src/app/opencode-config.ts`, `api-keys-dialog.tsx`, `editor-dialog.tsx` | Rendered as text in a `<pre>`; the key itself is never shown again (only its 10-character prefix) |
| **Product** | Website chat sends a one-line identity system prompt ("You are <model>, served by Venice…") | `src/chat/conversation.ts` (`identity`) | In Truly private mode it goes through E2EE like any system message; it must never leak into anonymous requests' history in a way that breaks I5 |
| **Brand** | Renamed Naisho → **Rahasya** (`rahasya.chat`). Proxy CLI is now `rahasya`, `~/.rahasya`, `RAHASYA_*` env vars. Two browser-storage keys keep the `naisho:` prefix on purpose | `src/brand.ts`, `packages/proxy/src/*` | Renaming `naisho:idle-seq:*` would reset a top-up sequence and could reuse an old x402 top-up id |

## Commits

| Commit | Summary |
|---|---|
| `e663790` | Website chat: one-line model identity system prompt |
| `2fb87a8` | opencode config: every non-TEE model (or the key's allowlist), generated in one place |
| `95d8e72` | API keys dialog: per-key opencode config |
| `182e075` | 1Click: referral tag, integer fee bps |
| `ffe126b`, `64aca19` | Docs: swap fee (now 1% total, split with NEAR Intents) |
| `79546f4` | opencode config: per-model cost and `enabled_providers` |
| `6e5b7e3` | Gateway: settle streamed spend on the usage chunk |
| `eaf7e3a` | Gateway latency: parallel Redis calls; forward the usage chunk before settling |
| `d9007b7` | Rename to Rahasya |
| `14fad23` | Cloudflare Workers deployment |
| (this kit) | Probe check for I17; kit v2 |

## Questions we'd most like answered

1. **Fees (I17).** Can a client influence `appFees`, `referral` or the fee recipient by any route: a different body shape, duplicate JSON keys, a `v0/deposit/submit` or status call, unusual casing in the path? Can our fee push a quote past the funding check (`checkMaxInput`: +5% + $0.50) or make a deposit refund?
2. **Metering (I18).** Can model output, a client or a crafted upstream response make `meterStream` settle with the wrong usage (too low), settle twice, or never settle when it should? OpenAI-style streams send `"usage": null` in normal chunks (skipped) and the real usage in a final chunk; we haven't confirmed Venice never sends running totals earlier. What happens if a provider sends running usage totals in every chunk?
3. **Cloudflare.** Is `cf-connecting-ip` the only client-IP source that can matter in production, or can a request reach the Worker with a header it controls, for example via the `*.workers.dev` URL? Do per-isolate caches (Intel collateral, Venice prices) open any poisoning or staleness issue? Does anything server-side still assume Node (Buffer, fs, process.cwd)?
4. **Partial writes (K17).** Is there a sequence of Redis failures in `recordSpend` that lets a key spend more than its limits, as opposed to just leaving the two counters slightly apart?
5. **Identity prompt.** Does the identity system message change what's sent in either privacy mode in a way that matters for I4/I5?
