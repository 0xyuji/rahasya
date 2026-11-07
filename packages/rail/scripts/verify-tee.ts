/**
 * No keys, no funds: attest a TEE model with a fresh nonce and print every check.
 * A throwaway wallet is generated in memory only to sign the Venice SIWX header
 * (attestation is free and doesn't need credit).
 *
 *   npm run verify:tee                      # default: DeepSeek V4.1 Flash 1017 Abliterated (NEAR AI enclave)
 *   npm run verify:tee -- gemma-4-26b-tee
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MODELS } from "../src/inference/models.ts";
import { attest } from "../src/venice/e2ee.ts";
import { createSiwxHeader } from "../src/venice/siwx.ts";

const key = process.argv[2] ?? "deepseek-abliterated-tee";
const model = MODELS[key];
if (!model?.e2ee) {
  console.error(`"${key}" is not a TEE model. Options: ${Object.values(MODELS).filter((m) => m.e2ee).map((m) => m.key).join(", ")}`);
  process.exit(1);
}
const throwaway = privateKeyToAccount(generatePrivateKey());
const report = await attest({ model: model.id, authHeaders: async (url) => ({ "SIGN-IN-WITH-X": await createSiwxHeader(throwaway, url) }) });

console.log(`\n${model.label}  →  ${report.ok ? "VERIFIED" : "NOT VERIFIED"}`);
console.log(`  enclave: ${report.teeProvider} · ${report.teeHardware}${report.gpu ? ` + NVIDIA ${report.gpu}` : ""} · upstream ${report.upstreamModel}`);
if (report.sourceRepo) console.log(`  gateway source: ${report.sourceRepo}@${report.sourceCommit}`);
console.log(`  our nonce: ${report.nonce}\n  enclave key address: ${report.signingAddress}\n`);
for (const c of report.checks) console.log(`  ${c.status === "pass" ? "✓" : "✗"} [${c.by === "local" ? "checked here" : "Venice says"}] ${c.name} — ${c.detail}`);
process.exit(report.ok ? 0 : 1);
