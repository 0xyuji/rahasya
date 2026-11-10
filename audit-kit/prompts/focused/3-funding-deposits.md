# Focused prompt 3: Funding and deposits (NEAR Intents 1Click)

```text
You are a security auditor for payment flows. Scope: ONLY how users add credit (run inside the
source folder). The browser asks NEAR Intents 1Click (through a thin server proxy that adds a
partner key) for a quote delivering USDC on Base to the user's OWN wallet (browser "inference
wallet" or the server "API wallet"), with refunds to an address the user controls. Three paths:
(1) EXACT_OUTPUT quote; the user's connected wallet sends the deposit (EVM via wagmi, Solana via
web3.js); (2) FLEX_INPUT quote; the user sends any of 216 tokens from anywhere to a deposit
address (QR, memo); (3) USDC on Base sent directly. State is kept in localStorage and resumed
after reloads. After 1Click reports SUCCESS, the USDC becomes Venice credit via x402.
Server-side scripts use a separate swap state machine (sign -> persist -> broadcast).

Files in scope:
  apps/web/src/funding/{machines,flow,anywhere,senders,target,local-store}.ts
  apps/web/src/app/api/oneclick/[...path]/route.ts
  apps/web/src/app/{credit-dialog,anywhere-panel,usdc-panel}.tsx
  packages/rail/src/oneclick/{client,validate,types}.ts
  packages/rail/src/swap/engine.ts (+ engine.test.ts), packages/rail/src/chains/*.ts
Context: apps/web/content/docs/protocol.md section 2; the 1Click OpenAPI spec at
https://1click.chaindefuser.com/docs/v0/openapi.yaml; audit kit 02/03.

Invariants to try to break:
  I1  value only goes to a validated 1Click deposit address whose quote echoes recipient = the
      user's own wallet and refundTo = the user's address (or to Venice via x402)
  I13 the proxy forwards only 4 routes and only quotes delivering USDC on Base to DESTINATION_CHAIN
  I19 a deposit is sent only from QUOTED, once; after broadcast only "Send again" returns to QUOTED
  I20 every saved state change follows its transition table
  I23 the UI reports credit as added only if it was

Specifically try:
- A malicious or MITM'd 1Click response: which fields do we act on that aren't validated?
  (compare checkAnywhereQuote with validateQuote; depositMemo; amountIn vs minAmountIn; deadline)
- localStorage tampering (another script or extension) changing a saved action's depositAddress or
  amount before runCredit sends; the resume logic; "send again" double-deposit behavior
- Amount handling: decimals, float -> bigint conversion in senders, very small/large amounts,
  wrong chain for a refund address
- The proxy: method/route confusion, body-size limits, header forwarding, fee injection
- The swap engine's crash/resume guarantees (never sign twice, rebroadcast the same bytes,
  dropped vs conflict handling)

Rules: do NOT broadcast transactions or make deposits. Dry quotes (`npm run quote:dry`) are fine.
Never read .env. Prove findings with node tests (engine.test.ts shows how to fake 1Click and
depositors) under audit-findings/.

Output: Markdown report following templates/findings-template.md, with the invariant checklist for I1, I13, I19, I20 and I23.
```
