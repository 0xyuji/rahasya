import "server-only";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getBase58Encoder } from "@solana/kit";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { base } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import { b64url, hex, randomBytes } from "./crypto.ts";
import { kv } from "./kv.ts";

/**
 * Wallet-signature login for managing API keys (EVM, Solana, NEAR).
 * The server issues a one-time message; the wallet signs it; we verify and
 * open a session. Nonces are single-use and expire after 5 minutes.
 *
 * The message names our domain in the standard form each wallet understands
 * (EIP-4361 "Sign-In with Ethereum", the Solana equivalent, and the site host as
 * the NEP-413 recipient), so a wallet can warn when another site asks for it.
 */
export type Chain = "evm" | "sol" | "near";

export interface Challenge {
  id: string;
  message: string;
  /** 32-byte nonce, hex (NEAR NEP-413 needs it as bytes). */
  nonce: string;
  /** NEAR NEP-413 recipient: our host. */
  recipient: string;
}

const CHALLENGE_TTL = 300;
const STATEMENT = "Sign in to manage your API keys. This only proves you own this wallet. It is not a transaction and costs nothing.";

export function challengeMessage(origin: string, chain: Chain, address: string, nonce: string, now = new Date()): string {
  const { host } = new URL(origin);
  const expires = new Date(now.getTime() + CHALLENGE_TTL * 1000);
  if (chain === "evm") {
    return createSiweMessage({ domain: host, address: getAddress(address), statement: STATEMENT, uri: origin, version: "1", chainId: base.id, nonce, issuedAt: now, expirationTime: expires });
  }
  const account = chain === "sol" ? "Solana" : "NEAR";
  return [
    `${host} wants you to sign in with your ${account} account:`,
    address,
    "",
    STATEMENT,
    "",
    `URI: ${origin}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join("\n");
}

export async function createChallenge(origin: string, chain: Chain, address: string): Promise<Challenge> {
  const nonce = hex(randomBytes(32));
  const id = b64url(randomBytes(18));
  if (chain === "evm" && !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("Not an EVM address.");
  const message = challengeMessage(origin, chain, address, nonce);
  const recipient = new URL(origin).host;
  await kv().set(`chal:${id}`, { message, nonce, chain, address, recipient }, { ex: CHALLENGE_TTL });
  return { id, message, nonce, recipient };
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
  // GETDEL: two concurrent submissions of the same proof can't both get a session.
  const chal = await kv().getdel<{ message: string; nonce: string; chain: Chain; address: string; recipient?: string }>(`chal:${p.challengeId}`);
  if (!chal) throw new Error("Sign-in request expired. Try again.");
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
    ok = ed25519.verify(b64(p.signature), nep413Hash(chal.message, hexToBytes(chal.nonce), chal.recipient ?? ""), pub);
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
  await kv().sadd(`usess:${uid}`, sid); // index, for "sign out everywhere"
  await kv().expire(`usess:${uid}`, SESSION_TTL);
  return sid;
}

/**
 * Over HTTPS the cookie is `__Host-sid`: the browser then only accepts it if it's
 * Secure, host-only and Path=/, so a sibling subdomain can't plant or overwrite
 * it. Plain `sid` is only used on http://localhost during development.
 */
export const cookieName = (secure: boolean) => (secure ? "__Host-sid" : "sid");

export function sessionCookie(sid: string, secure: boolean): string {
  return `${cookieName(secure)}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${cookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function sessionId(req: Request): string | null {
  const secure = new URL(req.url).protocol === "https:";
  const re = new RegExp(`(?:^|;\\s*)${cookieName(secure)}=([A-Za-z0-9_-]+)`);
  return re.exec(req.headers.get("cookie") ?? "")?.[1] ?? null;
}

export async function sessionUser(req: Request): Promise<string | null> {
  const sid = sessionId(req);
  if (!sid) return null;
  const s = await kv().get<{ uid: string }>(`sess:${sid}`);
  return s?.uid ?? null;
}

/** End this session, or (everywhere) every session of the same user. */
export async function endSession(req: Request, everywhere = false) {
  const sid = sessionId(req);
  if (!sid) return;
  const s = await kv().get<{ uid: string }>(`sess:${sid}`);
  await kv().del(`sess:${sid}`);
  if (!s) return;
  await kv().srem(`usess:${s.uid}`, sid);
  if (everywhere) {
    const all = await kv().smembers(`usess:${s.uid}`);
    if (all.length) await kv().del(...all.map((x) => `sess:${x}`), `usess:${s.uid}`);
  }
}
