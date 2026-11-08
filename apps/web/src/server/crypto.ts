/** WebCrypto helpers (Node 20+ and Cloudflare Workers). */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "===".slice((norm.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text))));
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function aesKey(): Promise<CryptoKey> {
  const raw = process.env.API_WALLET_ENC_KEY;
  if (!raw) throw new Error("API_WALLET_ENC_KEY is not set");
  const bytes = fromB64(raw);
  if (bytes.length !== 32) throw new Error("API_WALLET_ENC_KEY must be 32 bytes (base64)");
  return globalThis.crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM; output = base64url(iv || ciphertext+tag). `aad` binds the ciphertext to its owner. */
export async function seal(plaintext: string, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(), enc.encode(plaintext)),
  );
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64url(out);
}

export async function open(sealed: string, aad: string): Promise<string> {
  const raw = fromB64(sealed);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(aad) },
    await aesKey(),
    raw.slice(12),
  );
  return dec.decode(pt);
}
