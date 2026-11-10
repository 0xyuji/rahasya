# 4. How to run it

**Requirements:** Node 22.18 or newer (runs the TypeScript directly; tests pass on 22, 24 and 26), npm. macOS or Linux. No Docker.

Open `source/` (or clone the repo), then:

```sh
npm install
```

## No keys, no money (start here)

```sh
npm test               # 134 offline tests: rail 45, web 79, proxy 10. No network, no keys.
npm run typecheck      # all packages
npm run verify:tee     # live TEE attestation with a throwaway in-memory wallet: 10 checks, prints PASS/FAIL
npm run quote:dry      # live NEAR Intents dry quotes (nothing is created or sent)
```

## The site and API locally

You need three free things: a Reown project id (dashboard.reown.com), an Upstash Redis database (upstash.com, REST credentials, region us-east-1), and a random encryption key.

```sh
cp apps/web/.env.example apps/web/.env.local
# then fill in:
#   NEXT_PUBLIC_REOWN_PROJECT_ID=...
#   UPSTASH_REDIS_REST_URL=...
#   UPSTASH_REDIS_REST_TOKEN=...
#   API_WALLET_ENC_KEY=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
npm run dev            # http://localhost:3000
```

Use **your own** Upstash database, not ours.

## Cloudflare runtime (what production runs)

The site is deployed to Cloudflare Workers. To run the same build locally in Cloudflare's runtime (workerd), after the `.env.local` setup above:

```sh
cd apps/web
grep -E "^(UPSTASH_|API_WALLET_ENC_KEY|ONECLICK_)" .env.local > .dev.vars   # server secrets for the local Worker (gitignored)
npm run cf:build                       # Next.js build + OpenNext packaging into .open-next/
npx wrangler dev --port 8788           # http://127.0.0.1:8788
```

`npx wrangler deploy --dry-run --outdir /tmp/cf` prints the bundle size (about 2.9 MB gzipped; the free plan allows 3 MB).

## Black-box probe

With the site running:

```sh
npm run audit:probe                     # against http://localhost:3000
npm run audit:probe -- http://127.0.0.1:8788   # against the local Cloudflare runtime
npm run audit:probe -- https://<site>   # against a deployment (only one we gave you permission for)
```

It signs in with throwaway in-memory wallets (no funds) and runs 40 checks:
- security headers
- login replay and forged signatures
- requests from another origin
- key validation
- one user editing or deleting another's key
- key auth on the gateway
- the model allowlist
- 402 when out of credit
- the 8 MB body limit
- the rate limit
- 1Click proxy restrictions, client fees/referral being replaced (one dry quote), and its per-IP rate limit
- read-only `GET /api/account`
- deleted keys, logout and "sign out everywhere"

It prints PASS/FAIL and exits non-zero on any failure. Our last run: **40/40** against https://rahasya.chat on 2026-11-10, after the `d683de2` deploy. Note it uses up your IP's 1Click quote allowance for a minute.

Side effect: a couple of throwaway users and their empty API wallets are created in that deployment's Redis. Their keys are deleted at the end.

## Writing your own proofs

- **Unit-level:** add a `*.test.ts` next to the module and run it with `node --test path/to/file.test.ts`. For `apps/web/src/server/*`, run with `node --conditions=react-server --test …` and use the in-memory Redis fake in `apps/web/src/server/server.test.ts` (`setKvForTests`).
- **HTTP-level:** copy `scripts/audit/probe.ts` and add requests against your local instance.
- Put your proofs in `audit-findings/` and reference them in the report.

## Paid paths (don't, unless we ask)

Deposits, x402 top-ups and paid completions only exist on mainnet; NEAR Intents has no testnet. `npm run e2e -- quote` prints a quote and sends nothing; `npm run e2e -- run` spends real money. If something can only be proven with funds, describe the steps and we'll run it with a throwaway wallet.
