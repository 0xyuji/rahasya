# Focused prompt 5: Local proxy, web app, dependencies

```text
You are a security auditor. Scope (run inside the source folder):
(a) The local proxy CLI (packages/proxy): an OpenAI-compatible server on 127.0.0.1 that signs
    Venice requests with the user's inference key from ~/.naisho/inference-key (0600). It requires
    a local bearer token (~/.naisho/proxy-token, constant-time compare) and refuses any request
    carrying an Origin header. Host is NOT checked (known K14).
(b) The Next.js web app's client-side surface: rendering of model output (react-markdown, no raw
    HTML), dangerouslySetInnerHTML (only for QR SVGs we generate), wallet connection, localStorage
    usage, security headers in next.config.ts, the docs pages (Markdown rendered at build time).
(c) Dependencies: package-lock.json, packages that run install scripts, the wallet-library tree.

Files in scope:
  packages/proxy/src/{server,cli,config}.ts (+ server.test.ts)
  apps/web/next.config.ts, apps/web/src/app/**/*.tsx, apps/web/src/chat/*.tsx,
  apps/web/src/wallet/*.ts(x), apps/web/src/app/docs/**
  package-lock.json
Context: audit kit 02-what-to-check.md, 03-known-issues.md (K6, K8, K11, K14).

Invariants to try to break:
  I14 the proxy only on 127.0.0.1, token required, browser Origin refused
  I15 pages can't be framed

Specifically try:
- DNS rebinding / browser-to-localhost attacks on the proxy (is the token enough? any endpoint
  without auth?); token generation, storage, rotation; file permissions; request smuggling via
  Node's http server
- XSS in chat replies (markdown links: javascript: URLs?), in docs rendering, in error messages
  shown in dialogs, in token/model names
- What an XSS could steal: the inference key lives in React state; the "Local proxy" dialog
  reveals it; localStorage holds saved actions
- Header coverage on every route (API routes included)
- `npm audit` and the install-script inventory: anything beyond the known K8 advisories

Rules: don't run anything that spends funds; never read .env; add proofs under audit-findings/.

Output: Markdown report following templates/findings-template.md, with the invariant checklist for I14, I15.
```
