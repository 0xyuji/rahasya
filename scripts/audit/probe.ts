/**
 * Black-box security probe against a running deployment. No funds needed:
 * it creates throwaway wallets in memory, signs in, creates keys, and checks
 * that every guard answers the way audit-kit/02-what-to-check.md says it should.
 *
 *   npm run audit:probe                          # http://localhost:3000
 *   npm run audit:probe -- https://your-site     # a deployment
 *
 * Side effects: two throwaway users (+ their empty API wallets) in that
 * deployment's Redis; their keys are deleted at the end.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const ORIGIN = { origin: BASE, "content-type": "application/json", "x-app-request": "1" }; // the header our pages send (server/http.ts)
type Row = { check: string; expected: string; got: string; ok: boolean };
const rows: Row[] = [];
const expect = (check: string, expected: number | string, got: number | string) =>
  rows.push({ check, expected: String(expected), got: String(got), ok: String(expected) === String(got) });

async function login(acct = privateKeyToAccount(generatePrivateKey())) {
  const chal = await (await fetch(`${BASE}/api/auth/challenge`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ chain: "evm", address: acct.address }) })).json();
  const signature = await acct.signMessage({ message: chal.message });
  const r = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ challengeId: chal.id, chain: "evm", address: acct.address, signature }) });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  return { acct, chal, signature, cookie, status: r.status };
}

const keyHeaders = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });

// --- headers ---
const home = await fetch(`${BASE}/`);
expect("security header: frame-ancestors 'none'", true, String(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")));
expect("security header: X-Frame-Options", "DENY", home.headers.get("x-frame-options") ?? "missing");
expect("security header: Referrer-Policy", "no-referrer", home.headers.get("referrer-policy") ?? "missing");
expect("no x-powered-by header", "absent", home.headers.get("x-powered-by") ? "present" : "absent");

// --- login ---
const alice = await login();
expect("sign-in with valid signature", 200, alice.status);
const replay = await fetch(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: ORIGIN,
  body: JSON.stringify({ challengeId: alice.chal.id, chain: "evm", address: alice.acct.address, signature: alice.signature }),
});
expect("sign-in replay (same challenge) refused", 401, replay.status);
{
  const other = privateKeyToAccount(generatePrivateKey());
  const chal = await (await fetch(`${BASE}/api/auth/challenge`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ chain: "evm", address: other.address }) })).json();
  const forged = await alice.acct.signMessage({ message: chal.message }); // signed by the wrong wallet
  const r = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ challengeId: chal.id, chain: "evm", address: other.address, signature: forged }) });
  expect("sign-in with another wallet's signature refused", 401, r.status);
}
expect("challenge with unknown chain refused", 400, (await fetch(`${BASE}/api/auth/challenge`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ chain: "btc", address: "x" }) })).status);
expect("challenge from another origin refused", 403, (await fetch(`${BASE}/api/auth/challenge`, { method: "POST", headers: { ...ORIGIN, origin: "https://evil.example" }, body: "{}" })).status);

// --- session-protected routes ---
const A = { ...ORIGIN, cookie: alice.cookie };
expect("GET /api/keys without session", 401, (await fetch(`${BASE}/api/keys`)).status);
{
  // T-02: a cookie route only answers the page's own fetch(): not import()/<script> loads, not requests without our header.
  const { "x-app-request": _h, ...noHeader } = A;
  expect("GET /api/keys without the app header refused (T-02)", 403, (await fetch(`${BASE}/api/keys`, { headers: noHeader })).status);
  expect("GET /api/account as a module load (sec-fetch-dest: script) refused (T-02)", 403, (await fetch(`${BASE}/api/account`, { headers: { ...A, "sec-fetch-dest": "script" } })).status);
}
expect("POST /api/keys from another origin (with session)", 403, (await fetch(`${BASE}/api/keys`, { method: "POST", headers: { ...A, origin: "https://evil.example" }, body: "{}" })).status);
expect("create key with unknown model refused", 400, (await fetch(`${BASE}/api/keys`, { method: "POST", headers: A, body: JSON.stringify({ name: "x", models: ["gpt-4o"] }) })).status);
expect("create key with negative limit refused", 400, (await fetch(`${BASE}/api/keys`, { method: "POST", headers: A, body: JSON.stringify({ name: "x", limits: { dailyUsd: -1 } }) })).status);
const created = await (await fetch(`${BASE}/api/keys`, { method: "POST", headers: A, body: JSON.stringify({ name: "probe", models: ["gemma-4-uncensored"] }) })).json();
expect("create key", "nsk_", String(created.token).slice(0, 4));
const listed = await (await fetch(`${BASE}/api/keys`, { headers: A })).json();
expect("key list never contains the token or its hash", false, JSON.stringify(listed).includes(created.token) || JSON.stringify(listed).includes('"hash"'));

// --- another user can't touch alice's key ---
const bob = await login();
const B = { ...ORIGIN, cookie: bob.cookie };
{
  const before = await (await fetch(`${BASE}/api/account`, { headers: B })).json();
  expect("GET /api/account is read-only (no wallet created)", "null", String(before.apiWallet));
  const opened = await (await fetch(`${BASE}/api/account`, { method: "POST", headers: B })).json();
  expect("POST /api/account opens the API wallet", true, /^0x[0-9a-fA-F]{40}$/.test(String(opened.apiWallet)));
}
expect("other user can't delete the key", 404, (await fetch(`${BASE}/api/keys/${created.key.id}`, { method: "DELETE", headers: B })).status);
expect("other user can't edit the key", 404, (await fetch(`${BASE}/api/keys/${created.key.id}`, { method: "PATCH", headers: B, body: JSON.stringify({ name: "pwned" }) })).status);

// --- gateway ---
const K = keyHeaders(created.token);
expect("/v1/models without key", 401, (await fetch(`${BASE}/api/v1/models`)).status);
expect("/v1/models with a made-up key", 401, (await fetch(`${BASE}/api/v1/models`, { headers: keyHeaders("nsk_" + "A".repeat(40)) })).status);
const models = await (await fetch(`${BASE}/api/v1/models`, { headers: K })).json();
expect("/v1/models lists only the allowlisted model", "gemma-4-uncensored", models.data?.map((m: { id: string }) => m.id).join(","));
const chat = (body: unknown, h = K) => fetch(`${BASE}/api/v1/chat/completions`, { method: "POST", headers: h, body: typeof body === "string" ? body : JSON.stringify(body) });
expect("chat: invalid JSON", 400, (await chat("{nope")).status);
expect("chat: unknown model", 400, (await chat({ model: "gpt-4o", messages: [] })).status);
expect("chat: Object.prototype name as model (F-01)", 400, (await chat({ model: "constructor", messages: [{ role: "user", content: "x" }] })).status);
expect("chat: negative max_tokens (F-04)", 400, (await chat({ model: "gemma-4-uncensored", messages: [{ role: "user", content: "x" }], max_tokens: -1000000 })).status);
expect("chat: model outside the allowlist", 403, (await chat({ model: "large-v2", messages: [{ role: "user", content: "x" }] })).status);
expect("chat: unfunded API wallet", 402, (await chat({ model: "gemma-4-uncensored", messages: [{ role: "user", content: "x" }], max_tokens: 1 })).status);
expect("chat: body over 4 MB", 413, (await chat({ model: "gemma-4-uncensored", messages: [{ role: "user", content: "x".repeat(4.2 * 1024 * 1024) }] })).status);

// --- rate limit: 60/min per key, fixed window (models endpoint doesn't call Venice) ---
// Fired in parallel so all requests land in the same minute window.
{
  let got429 = false;
  for (let attempt = 0; attempt < 2 && !got429; attempt++) {
    const statuses = await Promise.all(Array.from({ length: 70 }, () => fetch(`${BASE}/api/v1/models`, { headers: K }).then((r) => r.status)));
    got429 = statuses.includes(429);
  }
  expect("over 60 requests in a minute get rate limited", true, got429);
}

// --- 1Click proxy ---
expect("1Click proxy: route outside the allowlist", 404, (await fetch(`${BASE}/api/oneclick/v0/account/balances`)).status);
expect(
  "1Click proxy: quote not delivering USDC on Base",
  400,
  (await fetch(`${BASE}/api/oneclick/v0/quote`, { method: "POST", headers: ORIGIN, body: JSON.stringify({ destinationAsset: "nep141:sol.omft.near", recipientType: "DESTINATION_CHAIN", depositType: "ORIGIN_CHAIN" }) })).status,
);

{
  // I17: a client can't set swap fees or the referral tag. A dry quote (nothing is created or sent)
  // with our own appFees and referral: neither may survive to 1Click.
  const dry = {
    dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 50, originAsset: "nep141:eth.omft.near", depositType: "ORIGIN_CHAIN",
    destinationAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", amount: "5000000",
    refundTo: "0x0000000000000000000000000000000000000001", refundType: "ORIGIN_CHAIN",
    recipient: "0x0000000000000000000000000000000000000001", recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 3600_000).toISOString(),
    appFees: [{ recipient: "probe-attacker.near", fee: 100 }], referral: "probe-attacker",
  };
  const r = await fetch(`${BASE}/api/oneclick/v0/quote`, { method: "POST", headers: ORIGIN, body: JSON.stringify(dry) });
  const j = (await r.json().catch(() => ({}))) as { quoteRequest?: { appFees?: { recipient: string }[]; referral?: string } };
  const fees = j.quoteRequest?.appFees ?? [];
  expect("1Click proxy: client appFees and referral are replaced (I17)", "stripped", r.ok && !fees.some((f) => f.recipient === "probe-attacker.near") && j.quoteRequest?.referral !== "probe-attacker" ? "stripped" : `status ${r.status}, ${JSON.stringify(j.quoteRequest ?? {}).slice(0, 120)}`);
}

{
  // Rate limit per IP (20 quotes/min). These quotes fail local validation, so nothing reaches 1Click.
  const bad = { destinationAsset: "nep141:sol.omft.near", recipientType: "DESTINATION_CHAIN", depositType: "ORIGIN_CHAIN" };
  const statuses = await Promise.all(Array.from({ length: 25 }, () => fetch(`${BASE}/api/oneclick/v0/quote`, { method: "POST", headers: ORIGIN, body: JSON.stringify(bad) }).then((r) => r.status)));
  expect("1Click proxy: quotes are rate limited per IP (K5)", true, statuses.includes(429));
}

// --- cleanup + deleted key ---
expect("delete own key", 200, (await fetch(`${BASE}/api/keys/${created.key.id}`, { method: "DELETE", headers: A })).status);
expect("deleted key stops working", 401, (await fetch(`${BASE}/api/v1/models`, { headers: K })).status);
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: A });
{
  // Two sessions of one wallet; "sign out everywhere" from one ends both.
  const carol = privateKeyToAccount(generatePrivateKey());
  const s1 = await login(carol);
  const s2 = await login(carol);
  await fetch(`${BASE}/api/auth/logout?everywhere=1`, { method: "POST", headers: { ...ORIGIN, cookie: s1.cookie } });
  expect("sign out everywhere ends the wallet's other sessions", 401, (await fetch(`${BASE}/api/keys`, { headers: { cookie: s2.cookie } })).status);
}
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: B });
expect("session gone after logout", 401, (await fetch(`${BASE}/api/keys`, { headers: A })).status);

const w = Math.max(...rows.map((r) => r.check.length));
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(w)}  expected ${r.expected}, got ${r.got}`);
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed against ${BASE}`);
process.exit(failed ? 1 : 0);
