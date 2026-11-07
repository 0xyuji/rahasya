/**
 * Live E2EE check on the cheapest allowed TEE model (fractions of a cent):
 * attestation with fresh nonce -> local + server checks -> encrypted chat -> decrypt.
 *
 * Run: node --env-file=../../.env scripts/check-e2ee.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import { attest, decryptStream, e2eeRequest, newSession } from "../src/venice/e2ee.ts";
import { createSiwxHeader } from "../src/venice/siwx.ts";

const MODEL = process.argv[2] ?? "e2ee-gemma-4-26b-a4b-uncensored-p";
const account = privateKeyToAccount(process.env.BASE_PRIVATE_KEY as `0x${string}`);
const auth = async (url: string) => ({ "SIGN-IN-WITH-X": await createSiwxHeader(account, url) });

const report = await attest({ model: MODEL, authHeaders: auth });
console.log(`\nAttestation for ${report.model}  →  ${report.ok ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);
console.log(`  provider=${report.teeProvider} hardware=${report.teeHardware} gpu=${report.gpu} upstream=${report.upstreamModel}`);
console.log(`  gateway source: ${report.sourceRepo}@${report.sourceCommit?.slice(0, 12)}`);
for (const c of report.checks) console.log(`  ${c.status === "pass" ? "✓" : "✗"} [${c.by}] ${c.name} — ${c.detail}`);
if (!report.ok) process.exit(1);

const session = newSession(report);
const url = "https://api.venice.ai/api/v1/chat/completions";
const req = e2eeRequest(session, {
  model: MODEL,
  messages: [{ role: "user", content: "Reply with exactly: sealed and delivered" }],
  max_tokens: 60,
  venice_parameters: { include_venice_system_prompt: false, disable_thinking: true },
});
console.log(`\nSent user message as ciphertext: ${(req.body.messages as Array<{ content: string }>)[0]!.content.slice(0, 48)}…`);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...req.headers, "SIGN-IN-WITH-X": await createSiwxHeader(account, url) },
  body: JSON.stringify(req.body),
});
if (!res.ok) {
  console.log("chat HTTP", res.status, (await res.text()).slice(0, 500));
  process.exit(1);
}
let out = "";
let enc = 0;
let plain = 0;
for await (const d of decryptStream(res, session)) {
  if (d.field === "content") out += d.text;
  d.encrypted ? enc++ : plain++;
}
console.log(`Decrypted reply: ${JSON.stringify(out)}  (encrypted chunks: ${enc}, plaintext chunks: ${plain})`);
