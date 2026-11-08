import "server-only";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getBase58Encoder } from "@solana/kit";
import { createPublicClient, http, type Hex } from "viem";
import { base } from "viem/chains";
import { b64url, hex, randomBytes } from "./crypto.ts";
import { kv } from "./kv.ts";

/**
 * Wallet-signature login for managing API keys (EVM, Solana, NEAR).
 * The server issues a one-time message; the wallet signs it; we verify and
 * open a session. Nonces are single-use and expire after 5 minutes.
 */
export type Chain = "evm" | "sol" | "near";
export const NEP413_RECIPIENT = "api-keys";

export interface Challenge {
  id: string;
  message: string;
  /** 32-byte nonce, hex (NEAR NEP-413 needs it as bytes). */
  nonce: string;
}

export async function createChallenge(origin: string, chain: Chain, address: string): Promise<Challenge> {
  const nonce = hex(randomBytes(32));
  const id = b64url(randomBytes(18));
  const message = [
    `Sign in to manage your API keys at ${origin}`,
    "",
    "This only proves you own this wallet. It is not a transaction and costs nothing.",
    "",
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${new Date().toISOString()}`,
  ].join("\n");
  await kv().set(`chal:${id}`, { message, nonce, chain, address }, { ex: 300 });
  return { id, message, nonce };
}

export interface LoginProof {
  challengeId: string;
  chain: Chain;
  address: string;
  /** EVM: 0x hex. Solana / NEAR: base64. */
  signature: string;
  /** NEAR only: "ed25519:<base58>" key that signed. */
  publicKey?: string;
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b58 = (s: string) => new Uint8Array(getBase58Encoder().encode(s));

export async function verifyLogin(p: LoginProof): Promise<string> {
  const chal = await kv().get<{ message: string; nonce: string; chain: Chain; address: string }>(`chal:${p.challengeId}`);
  if (!chal) throw new Error("Sign-in request expired. Try again.");
  await kv().del(`chal:${p.challengeId}`); // single use
  if (chal.chain !== p.chain || chal.address !== p.address) throw new Error("Wallet doesn't match the sign-in request.");

  let ok = false;
  if (p.chain === "evm") {
    // publicClient.verifyMessage also handles smart-contract wallets (ERC-1271 / ERC-6492).
    const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
    ok = await client.verifyMessage({ address: p.address as Hex, message: chal.message, signature: p.signature as Hex });
  } else if (p.chain === "sol") {
    ok = ed25519.verify(b64(p.signature), new TextEncoder().encode(chal.message), b58(p.address));
  } else {
    if (!p.publicKey?.startsWith("ed25519:")) throw new Error("NEAR sign-in needs the signing public key.");
    const pub = b58(p.publicKey.slice(8));
    ok = ed25519.verify(b64(p.signature), nep413Hash(chal.message, hexToBytes(chal.nonce), NEP413_RECIPIENT), pub);
    if (ok) ok = await nearKeyBelongsTo(p.address, p.publicKey);
  }
  if (!ok) throw new Error("Signature check failed.");
  return userId(p.chain, p.address);
}

export function userId(chain: Chain, address: string): string {
  return `${chain}:${chain === "evm" ? address.toLowerCase() : address}`;
}

function hexToBytes(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** NEP-413: sha256( u32le(2^31 + 413) || borsh({message, nonce[32], recipient, callbackUrl: None}) ). */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const str = (s: string) => {
    const b = new TextEncoder().encode(s);
    const out = new Uint8Array(4 + b.length);
    new DataView(out.buffer).setUint32(0, b.length, true);
    out.set(b, 4);
    return out;
  };
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, 2 ** 31 + 413, true);
  const parts = [tag, str(message), nonce, str(recipient), new Uint8Array([0])];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return sha256(all);
}

/** The signing key must be a full-access key of the claimed NEAR account. */
async function nearKeyBelongsTo(accountId: string, publicKey: string): Promise<boolean> {
  const res = await fetch(process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json()) as { result?: { permission?: unknown }; error?: unknown };
  return !!j.result && j.result.permission === "FullAccess";
}

// ---------- sessions ----------

const SESSION_TTL = 7 * 24 * 3600;

export async function createSession(uid: string): Promise<string> {
  const sid = b64url(randomBytes(24));
  await kv().set(`sess:${sid}`, { uid, createdAt: Date.now() }, { ex: SESSION_TTL });
  return sid;
}

export function sessionCookie(sid: string, secure: boolean): string {
  return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure ? "; Secure" : ""}`;
}

export async function sessionUser(req: Request): Promise<string | null> {
  const m = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.get("cookie") ?? "");
  if (!m) return null;
  const s = await kv().get<{ uid: string }>(`sess:${m[1]}`);
  return s?.uid ?? null;
}

export async function endSession(req: Request) {
  const m = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.get("cookie") ?? "");
  if (m) await kv().del(`sess:${m[1]}`);
}
