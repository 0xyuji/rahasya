# Findings template

## Severity rubric

| Severity | Meaning (for this system) |
|---|---|
| **Critical** | Steal or redirect user funds; take over another user's API wallet or keys at scale; recover inference or API wallet private keys; send private-mode content in plaintext to a non-enclave party |
| **High** | Spend another user's credit; bypass key limits or the model allowlist without bound; break any invariant I1–I16; make E2EE/attestation accept a forged or replayed enclave; double-charge an x402 top-up |
| **Medium** | Bounded limit overshoot beyond K1; denial of service on a user's keys or funding flow; leak of key hashes, sessions or user identifiers; meaningful privacy leak (e.g. linking wallets) |
| **Low** | Hardening gaps with no direct exploit; misleading UI or docs about security properties; missing validation that fails safe |
| **Info** | Code quality, defense-in-depth suggestions |

## Report header

```
Auditor:            (name / agent + model)
Commit reviewed:    (git rev-parse HEAD)
Date:
Time spent:
Tests run:          npm test → x/y pass; audit:probe → x/y pass against <url>
Scope covered:      (areas from 01-overview.md "Code map")
Not covered:
```

## Finding

```
### F-01: <short title>

Severity:      Critical | High | Medium | Low | Info
Invariant:     I# (or "none")
Location:      path/to/file.ts:LINE (and others)
Status:        new | duplicate of K# but worse | needs-human-check

What's wrong
<one or two sentences>

Exploit scenario
<who the attacker is, what they need, step by step, what they gain>

Proof
<test or script path under audit-findings/, or exact commands and expected vs actual output>

Suggested fix
<concrete change>
```

## Invariant checklist

```
I1  holds / broken (F-xx) / not checked: <how checked>
I2  …
…
I15 …
I16 …
```
