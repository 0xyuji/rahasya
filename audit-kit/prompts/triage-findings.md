# Prompt: triage findings

Use this after reports come back, to verify, de-duplicate and rank them. Run it in an agent with repo access (Claude Code, Codex), with the reports pasted in or saved as files.

```text
You're triaging security findings for this repository (run inside the source folder; the audit
kit's 02-what-to-check.md, 03-known-issues.md and templates/findings-template.md are next to it).
I'll give you one or more audit reports.

For EACH finding:
1. Reproduce it: run the provided proof (test or script) or write a minimal one. Never run anything
   that sends transactions or tops up credit; never read .env.
2. Classify it as: CONFIRMED (reproduced), PLAUSIBLE (code path exists, not reproduced; say what's
   missing), NOT A BUG (explain), DUPLICATE (of which finding or known issue K#), or KNOWN-BUT-WORSE
   (a known issue where the report shows more impact).
3. Re-assess severity with the rubric in findings-template.md, mapped to invariants I1–I18.
4. For CONFIRMED ones: the smallest correct fix (file:line + diff sketch) and a regression test to add.

Output:
- A table: id | title | reporter | status | severity (reported -> assessed) | invariant | fix effort
- Then details for CONFIRMED and KNOWN-BUT-WORSE items, most severe first
- Then the merged invariant checklist across all reports (which invariants were checked by
  anyone and still hold)
- Then gaps: important areas from 02-what-to-check.md that no report covered
```
