# Security

## Reporting a vulnerability

Please report security issues privately. Open a GitHub security advisory on this repository ("Security" tab → "Report a vulnerability"), or contact the maintainers listed on the repository. Don't open a public issue for anything that could put users' funds, keys, credit or prompts at risk.

Include what you found, how to reproduce it (a test or script is ideal), and the impact. We'll acknowledge within 72 hours.

## Auditing

Known issues, and every finding from the AI-assisted reviews with its fix and regression test, are in [docs/known-issues.md](docs/known-issues.md). A black-box probe checks a live deployment: `npm run audit:probe -- https://rahasya.chat` (40 checks; it creates throwaway test users and moves no funds).

## Rules for testing

- Use throwaway wallets with small amounts. NEAR Intents has no testnet, so paid paths are mainnet only.
- Don't test against other people's accounts, keys or credit.
- Don't run load tests against shared services (Venice, 1Click, RPCs).
