import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** ~/.naisho (override with NAISHO_HOME). Files are 0600, the dir 0700. */
export const home = () => process.env.NAISHO_HOME ?? join(homedir(), ".naisho");

const keyFile = () => join(home(), "inference-key");
const tokenFile = () => join(home(), "proxy-token");

function ensureHome() {
  mkdirSync(home(), { recursive: true, mode: 0o700 });
  chmodSync(home(), 0o700);
}

function writePrivate(path: string, data: string) {
  ensureHome();
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function saveInferenceKey(hex: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex.trim())) throw new Error("That isn't a 0x-prefixed 32-byte private key.");
  writePrivate(keyFile(), hex.trim());
}

export function loadInferenceKey(): `0x${string}` | null {
  const env = process.env.NAISHO_INFERENCE_KEY;
  if (env) return env as `0x${string}`;
  return existsSync(keyFile()) ? (readFileSync(keyFile(), "utf8").trim() as `0x${string}`) : null;
}

/** Local access token tools must send as `Authorization: Bearer <token>`. Created once, reused. */
export function loadOrCreateToken(): string {
  if (process.env.NAISHO_PROXY_TOKEN) return process.env.NAISHO_PROXY_TOKEN;
  if (existsSync(tokenFile())) return readFileSync(tokenFile(), "utf8").trim();
  const t = `nsk-${randomBytes(24).toString("base64url")}`;
  writePrivate(tokenFile(), t);
  return t;
}

export function rotateToken(): string {
  const t = `nsk-${randomBytes(24).toString("base64url")}`;
  writePrivate(tokenFile(), t);
  return t;
}
