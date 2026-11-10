# Focused prompts (run in parallel)

Eight self-contained prompts, one per area. Give each to a separate agent running in its own copy of `source/`. Each produces a report in the same format, so you can merge them and then run `../triage-findings.md` over the combined result.

| File | Area | Invariants |
|---|---|---|
| `1-api-keys-gateway.md` | Sessions, login, API keys, limits, gateway, API wallet | I8, I9, I10, I11, I12, I13 |
| `2-e2ee-attestation.md` | TEE attestation, E2EE, privacy-mode context rules | I4, I5, I6 |
| `3-funding-deposits.md` | 1Click quotes, deposit flows, refunds, browser state | I1, I13, I19, I20, I23 |
| `4-derivation-x402.md` | Inference wallet derivation, SIWX, x402 top-ups | I2, I3, I7 |
| `5-proxy-and-web.md` | Local proxy, headers, XSS, dependencies | I14, I15 |
| `6-changes-since-v1.md` | Everything changed since kit v1: fees, metering, Cloudflare runtime | I13, I17, I18 |
| `8-changes-since-v3.md` | Everything changed since the v3 audit: fixes, non-streamed API, unlock checks, Intel allowlist | I1, I4, I5, I6, I18–I28 |
| `7-changes-since-v2.md` | Everything changed since the last outside review: funding state machines, wallet switching, Stop and timeouts | I1, I4, I5, I18, I19–I24 |

If you can only run one agent, use `../full-audit.md` instead.
