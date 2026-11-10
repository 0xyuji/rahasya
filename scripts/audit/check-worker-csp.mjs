/**
 * T-02 layer 2 guard: does the _headers CSP actually cover the URL the Intel-verifier worker is
 * started from in the Cloudflare build? Audit finding A-02.
 * Dependency-free; reads the build output, optionally HEADs the files on a LOCAL preview.
 *
 * After a build (CI runs this): npm run -w @pay/web cf:build && npm run audit:csp
 *
 * Exit code 0 only if: _headers is in the assets root with the expected rule, the Turbopack worker
 * bootstrap and the chunk holding the lockdown are found, every one of them matches the rule, and
 * (if a base URL is given) each is served with that exact CSP.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const [assets, base] = process.argv.slice(2);
if (!assets || !existsSync(assets)) {
  console.error("usage: node check-worker-csp.mjs <.open-next/assets dir> [http://127.0.0.1:PORT]");
  process.exit(2);
}
const WANT = "default-src 'none'; script-src 'self'; connect-src 'self'";
const BOOTSTRAP = "Worker entrypoint must be loaded in a worker context"; // Turbopack 16.4.5 worker entrypoint
const LOCKDOWN = "network access is limited to the collateral relay"; // apps/web/src/tee/lockdown.ts
let ok = true;
const bad = (m) => ((ok = false), console.log(`FAIL  ${m}`));
const good = (m) => console.log(`ok    ${m}`);

// 1. _headers: parse rules (path line, then indented "Name: value" lines)
const hp = join(assets, "_headers");
const rules = [];
if (!existsSync(hp)) bad(`no _headers in ${assets} (public/_headers wasn't copied into the assets root)`);
else {
  let cur;
  for (const line of readFileSync(hp, "utf8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push((cur = { path: line.trim(), headers: {} }));
    else if (cur) {
      const i = line.indexOf(":");
      cur.headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  good(`_headers rules: ${rules.map((r) => r.path).join(", ")}`);
}
const matches = (pattern, urlPath) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(urlPath);
const cspFor = (urlPath) => rules.filter((r) => matches(r.path, urlPath)).map((r) => r.headers["content-security-policy"]).find(Boolean);

// 2. find the worker bootstrap(s) and the lockdown chunk(s)
const found = { bootstrap: [], lockdown: [] };
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".js")) {
      const s = readFileSync(p, "utf8");
      const urlPath = "/" + relative(assets, p).split(sep).join("/");
      if (s.includes(BOOTSTRAP)) found.bootstrap.push(urlPath);
      if (s.includes(LOCKDOWN)) found.lockdown.push(urlPath);
    }
  }
})(assets);
if (!found.bootstrap.length) bad("no Turbopack worker bootstrap found (webpack build? then find the worker entry chunk by hand)");
if (!found.lockdown.length) bad("no chunk contains the lockdown (is the verifier worker in this build?)");

// 3. each must match a rule carrying exactly the expected CSP
for (const [kind, list] of Object.entries(found)) {
  for (const urlPath of list) {
    const csp = cspFor(urlPath);
    if (csp === WANT) good(`${kind}: ${urlPath} -> CSP from _headers`);
    else bad(`${kind}: ${urlPath} -> ${csp ? `different CSP: ${csp}` : "NO CSP rule matches this path"}`);
  }
}

// 4. optional: what a LOCAL preview actually serves (refuses anything but localhost)
if (base) {
  const u = new URL(base);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    console.error("refusing a non-local base URL");
    process.exit(2);
  }
  for (const urlPath of [...found.bootstrap, ...found.lockdown]) {
    const r = await fetch(new URL(urlPath, base), { method: "HEAD" });
    const csp = r.headers.get("content-security-policy");
    if (r.ok && csp === WANT) good(`served ${urlPath}: ${r.status}, CSP ok`);
    else bad(`served ${urlPath}: ${r.status}, CSP=${csp ?? "none"}`);
  }
}
console.log(ok ? "\nPASS: the worker script is served under the T-02 CSP" : "\nFAIL: T-02 layer 2 does not cover the worker");
process.exit(ok ? 0 : 1);
