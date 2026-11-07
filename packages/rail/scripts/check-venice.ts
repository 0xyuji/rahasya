/**
 * Zero-cost Venice checks (no funds needed):
 *  1. SIWX header accepted?        GET /x402/balance/{addr}
 *  2. TEE attestation via SIWX?    GET /tee/attestation?model=&nonce=
 *  3. Browser-callable (CORS)?     OPTIONS preflight with an Origin
 *  4. Real top-up terms            POST /x402/top-up (expect 402 + PAYMENT-REQUIRED)
 *
 * Run: node --env-file=../../.env scripts/check-venice.ts
 */
import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { createSiwxHeader } from "../src/venice/siwx.ts";

const BASE = "https://api.venice.ai/api/v1";
const account = privateKeyToAccount(process.env.BASE_PRIVATE_KEY as `0x${string}`);
const TEE_MODEL = "e2ee-gemma-4-26b-a4b-uncensored-p"; // cheapest allowed TEE model

async function authedGet(path: string) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { headers: { "SIGN-IN-WITH-X": await createSiwxHeader(account, url.split("?")[0]!) } });
  return { status: res.status, body: (await res.text()).slice(0, 1500), headers: res.headers };
}

console.log("wallet:", account.address);

console.log("\n[1] balance via SIWX");
const bal = await authedGet(`/x402/balance/${account.address}`);
console.log(bal.status, bal.body);

console.log("\n[2] TEE attestation via SIWX");
const nonce = randomBytes(32).toString("hex");
const att = await authedGet(`/tee/attestation?model=${TEE_MODEL}&nonce=${nonce}`);
console.log(att.status);
try {
  const j = JSON.parse(att.body.length < 1500 ? att.body : "{}");
  console.log("keys:", Object.keys(j));
} catch {}
console.log(att.body.slice(0, 600));

console.log("\n[3] CORS preflight for chat/completions");
for (const origin of ["https://example.com", "http://localhost:3000"]) {
  const pre = await fetch(`${BASE}/chat/completions`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,sign-in-with-x,x-venice-tee-client-pub-key",
    },
  });
  console.log(origin, "->", pre.status, {
    allowOrigin: pre.headers.get("access-control-allow-origin"),
    allowHeaders: pre.headers.get("access-control-allow-headers"),
    exposeHeaders: pre.headers.get("access-control-expose-headers"),
  });
}

console.log("\n[4] top-up payment terms (no payment sent)");
const tu = await fetch(`${BASE}/x402/top-up`, { method: "POST" });
console.log(tu.status);
const pr = tu.headers.get("payment-required");
if (pr) {
  const decoded = decodePaymentRequiredHeader(pr);
  console.log(JSON.stringify({ x402Version: decoded.x402Version, accepts: decoded.accepts, extensions: decoded.extensions }, null, 2));
} else {
  console.log("no PAYMENT-REQUIRED header; body:", (await tu.text()).slice(0, 800));
}
