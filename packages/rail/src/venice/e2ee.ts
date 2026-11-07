/**
 * Venice TEE attestation + E2EE (browser- and Node-compatible; no Buffer).
 *
 * Protocol (docs.venice.ai/guides/features/tee-e2ee-models, verified live 2026-11-07):
 *   ECDH secp256k1 -> HKDF-SHA256(info="ecdsa_encryption", no salt) -> AES-256-GCM
 *   wire format (hex): ephemeralPub(65) || nonce(12) || ciphertext+tag
 *   headers: X-Venice-TEE-Client-Pub-Key, X-Venice-TEE-Model-Pub-Key, X-Venice-TEE-Signing-Algo: ecdsa
 *
 * Attestation checks are split honestly into:
 *   - "local":  we verified it ourselves from raw bytes in this process
 *   - "server": Venice's verifier says so (we display it, we don't re-prove it)
 */
import { gcm } from "@noble/ciphers/aes.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, keccak256 } from "viem";

const HKDF_INFO = new TextEncoder().encode("ecdsa_encryption");

// ---------- crypto primitives ----------

function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

const hex = (b: Uint8Array) => bytesToHex(b).slice(2);
const unhex = (h: string) => hexToBytes(`0x${h.replace(/^0x/, "")}`);

function newPrivateKey(): Uint8Array {
  const u = secp256k1.utils as { randomSecretKey?: () => Uint8Array; randomPrivateKey?: () => Uint8Array };
  return (u.randomSecretKey ?? u.randomPrivateKey)!();
}

function normalizePub(pubHex: string): string {
  const h = pubHex.replace(/^0x/, "");
  return h.length === 128 ? `04${h}` : h;
}

/** ECDH -> 32-byte x coordinate -> HKDF -> AES key. */
function aesKey(priv: Uint8Array, pubHex: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(priv, unhex(normalizePub(pubHex)), true); // 33 bytes, compressed
  return hkdf(sha256, shared.slice(1), undefined, HKDF_INFO, 32);
}

export function encryptForModel(plaintext: string, modelPubHex: string): string {
  const eph = newPrivateKey();
  const ephPub = secp256k1.getPublicKey(eph, false); // 65 bytes
  const nonce = randomBytes(12);
  const ct = gcm(aesKey(eph, modelPubHex), nonce).encrypt(new TextEncoder().encode(plaintext));
  eph.fill(0);
  const out = new Uint8Array(65 + 12 + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, 65);
  out.set(ct, 77);
  return hex(out);
}

export function decryptFromModel(ciphertextHex: string, clientPriv: Uint8Array): string {
  const raw = unhex(ciphertextHex);
  const serverPub = hex(raw.slice(0, 65));
  const pt = gcm(aesKey(clientPriv, serverPub), raw.slice(65, 77)).decrypt(raw.slice(77));
  return new TextDecoder().decode(pt);
}

/** Minimum encrypted size: 65 + 12 + 16 (tag) bytes = 186 hex chars. */
export const isHexEncrypted = (s: string) => s.length >= 186 && /^[0-9a-fA-F]+$/.test(s);

// ---------- attestation ----------

export interface AttestationCheck {
  name: string;
  status: "pass" | "fail";
  by: "local" | "server";
  detail: string;
}

export interface AttestationReport {
  ok: boolean;
  model: string;
  nonce: string;
  modelPubKey: string;
  signingAddress: string;
  teeProvider?: string;
  teeHardware?: string;
  upstreamModel?: string;
  gpu?: string;
  sourceCommit?: string;
  sourceRepo?: string;
  checks: AttestationCheck[];
  fetchedAt: string;
}

// TDX quote v4: 48-byte header, then TD report body. Offsets within the body:
const TDX_HEADER = 48;
const TD_ATTRIBUTES = TDX_HEADER + 120; // 8 bytes; bit 0 = DEBUG
const TD_REPORT_DATA = TDX_HEADER + 520; // 64 bytes

type Attestation = Record<string, unknown> & {
  verified?: boolean;
  nonce?: string;
  model?: string;
  intel_quote?: string;
  signing_key?: string;
  signing_public_key?: string;
  signing_address?: string;
  tee_provider?: string;
  tee_hardware?: string;
  upstream_model?: string;
  nvidia_payload?: string;
  attestation?: { source_provenance?: { repo_url?: string; repo_commit?: string } };
  server_verification?: {
    tdx?: { valid?: boolean; signatureValid?: boolean; certificateChainValid?: boolean };
    nvidia?: { valid?: boolean };
    signingAddressBinding?: { bound?: boolean };
    nonceBinding?: { bound?: boolean };
  };
};

/**
 * Fetch an attestation with a fresh 32-byte nonce and evaluate it.
 * `authHeaders` builds a fresh SIWX header for the attestation URL.
 */
export async function attest(opts: {
  model: string;
  authHeaders: (url: string) => Promise<Record<string, string>>;
  baseUrl?: string;
  fetch?: typeof fetch;
}): Promise<AttestationReport> {
  const base = (opts.baseUrl ?? "https://api.venice.ai/api/v1").replace(/\/$/, "");
  const url = `${base}/tee/attestation`;
  const nonce = hex(randomBytes(32));
  const res = await (opts.fetch ?? fetch)(`${url}?model=${encodeURIComponent(opts.model)}&nonce=${nonce}`, {
    headers: await opts.authHeaders(url),
  });
  if (!res.ok) throw new Error(`attestation HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return evaluateAttestation((await res.json()) as Attestation, opts.model, nonce);
}

export function evaluateAttestation(a: Attestation, model: string, sentNonce: string): AttestationReport {
  const checks: AttestationCheck[] = [];
  const add = (name: string, ok: boolean, by: "local" | "server", detail: string) =>
    checks.push({ name, status: ok ? "pass" : "fail", by, detail });

  const modelPubKey = normalizePub(a.signing_key ?? a.signing_public_key ?? "");
  const signingAddress = (a.signing_address ?? "").toLowerCase();

  // --- local checks ---
  add("Fresh nonce echoed", a.nonce === sentNonce, "local", "response nonce equals the random 32-byte nonce we just sent");
  add("Attested model", a.model === model, "local", `attestation is for ${a.model ?? "?"}`);

  let derived = "";
  try {
    derived = `0x${keccak256(unhex(modelPubKey).slice(1)).slice(-40)}`;
  } catch {}
  add(
    "Encryption key ↔ enclave address",
    !!signingAddress && derived === signingAddress,
    "local",
    "keccak(enclave public key) equals the signing address bound into the quote",
  );

  const quote = typeof a.intel_quote === "string" && /^[0-9a-fA-F]+$/.test(a.intel_quote) ? unhex(a.intel_quote) : undefined;
  if (quote && quote.length >= TD_REPORT_DATA + 64) {
    const version = quote[0]! | (quote[1]! << 8);
    const teeType = quote[4]! | (quote[5]! << 8) | (quote[6]! << 16) | (quote[7]! << 24);
    add("Intel TDX quote format", version === 4 && teeType === 0x81, "local", `quote v${version}, TEE type 0x${teeType.toString(16)}`);

    const reportData = hex(quote.slice(TD_REPORT_DATA, TD_REPORT_DATA + 64));
    const addrPart = reportData.slice(0, 40);
    const noncePart = reportData.slice(64, 128);
    add(
      "Quote binds our nonce",
      noncePart === sentNonce,
      "local",
      "REPORTDATA[32..64] inside the hardware quote equals our nonce (no replay)",
    );
    add(
      "Quote binds enclave key",
      `0x${addrPart}` === signingAddress,
      "local",
      "REPORTDATA[0..20] inside the hardware quote equals the enclave signing address",
    );
    const debug = (quote[TD_ATTRIBUTES]! & 0x01) === 1;
    add("Not a debug enclave", !debug, "local", "TD_ATTRIBUTES.DEBUG bit is 0 (debuggable enclaves can be inspected)");
  } else {
    add("Intel TDX quote present", false, "local", "no parseable intel_quote in response");
  }

  // --- server-side checks (Venice's verifier; displayed, not re-proven) ---
  const sv = a.server_verification ?? {};
  add("TDX quote signature + cert chain", !!(sv.tdx?.valid && sv.tdx?.signatureValid && sv.tdx?.certificateChainValid), "server", "Intel DCAP verification by Venice");
  if (a.nvidia_payload) add("NVIDIA GPU attestation", !!sv.nvidia?.valid, "server", "GPU confidential-computing evidence verified by Venice");
  add("Overall verdict", a.verified === true, "server", "Venice's attestation verifier");

  let gpu: string | undefined;
  try {
    gpu = (JSON.parse(a.nvidia_payload ?? "{}") as { arch?: string }).arch;
  } catch {}

  return {
    ok: checks.every((c) => c.status === "pass"),
    model,
    nonce: sentNonce,
    modelPubKey,
    signingAddress,
    teeProvider: a.tee_provider,
    teeHardware: a.tee_hardware,
    upstreamModel: a.upstream_model,
    gpu,
    sourceRepo: a.attestation?.source_provenance?.repo_url,
    sourceCommit: a.attestation?.source_provenance?.repo_commit,
    checks,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------- E2EE chat ----------

export interface E2EESession {
  clientPriv: Uint8Array;
  clientPubHex: string;
  report: AttestationReport;
}

export function newSession(report: AttestationReport): E2EESession {
  if (!report.ok) throw new Error("refusing E2EE: attestation checks did not all pass");
  const clientPriv = newPrivateKey();
  return { clientPriv, clientPubHex: hex(secp256k1.getPublicKey(clientPriv, false)), report };
}

/** Build the encrypted request: all user/system contents encrypted, E2EE headers set. */
export function e2eeRequest(
  s: E2EESession,
  body: { model: string; messages: Array<{ role: string; content: string }> } & Record<string, unknown>,
): { headers: Record<string, string>; body: Record<string, unknown> } {
  return {
    headers: {
      "X-Venice-TEE-Client-Pub-Key": s.clientPubHex,
      "X-Venice-TEE-Model-Pub-Key": s.report.modelPubKey,
      "X-Venice-TEE-Signing-Algo": "ecdsa",
    },
    body: {
      ...body,
      stream: true,
      messages: body.messages.map((m) =>
        m.role === "user" || m.role === "system" ? { ...m, content: encryptForModel(m.content, s.report.modelPubKey) } : m,
      ),
    },
  };
}

/**
 * Read an SSE stream and yield decrypted text deltas. Never falls back to
 * plaintext silently: unencrypted content is flagged so the UI can show it.
 */
export async function* decryptStream(
  res: Response,
  s: E2EESession,
): AsyncGenerator<{ text: string; encrypted: boolean; field: "content" | "reasoning" }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let chunk: { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta ?? {};
      for (const [field, v] of [["content", delta.content], ["reasoning", delta.reasoning_content]] as const) {
        if (!v) continue;
        if (isHexEncrypted(v)) yield { text: decryptFromModel(v, s.clientPriv), encrypted: true, field };
        else yield { text: v, encrypted: false, field };
      }
    }
  }
}
