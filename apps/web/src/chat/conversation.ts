import { findModel, type ChatMessage, type PrivacyMode } from "@pay/rail/browser";
import { brand } from "../brand.ts";

export interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  /** Privacy mode the message was exchanged in. */
  mode: PrivacyMode;
  modelKey: string;
  status: "streaming" | "done" | "error" | "stopped";
  error?: { code?: string; text: string };
  costUsd?: number;
  e2ee?: boolean;
  plaintextChunks?: number;
  attestationId?: string;
}

/**
 * Build the context for a new request without leaking across privacy modes:
 *  - Anonymous requests never include messages exchanged in Truly private mode
 *    (those must never reach a non-enclave host).
 *  - E2EE requests fold the whole history into ONE encrypted system message:
 *    Venice E2EE only encrypts user/system roles, so prior assistant turns
 *    sent as role "assistant" would travel in plaintext.
 */
export function buildContext(history: Msg[], next: { text: string; mode: PrivacyMode; modelKey: string }): ChatMessage[] {
  const usable = history.filter((m) => m.status === "done" && m.text.trim() && (next.mode === "private" || m.mode === "anonymous"));
  const e2ee = findModel(next.modelKey)?.e2ee ?? false;
  const id = identity(next.modelKey);
  const head: ChatMessage[] = id ? [{ role: "system", content: id }] : [];

  if (!e2ee) {
    return [...head, ...usable.map((m) => ({ role: m.role, content: m.text }) as ChatMessage), { role: "user", content: next.text }];
  }
  if (!usable.length) return [...head, { role: "user", content: next.text }];
  const transcript = usable.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
  return [
    ...head,
    { role: "system", content: `Conversation so far (continue it naturally; do not repeat it):\n\n${transcript}` },
    { role: "user", content: next.text },
  ];
}

/**
 * One line so the model can say what it is. Models don't know their own
 * identity (abliterated DeepSeek often claims to be ChatGPT). Website chat only:
 * API keys and the local proxy forward exactly what the user's tool sends.
 */
export function identity(modelKey: string): string | null {
  const m = findModel(modelKey);
  if (!m) return null;
  const name = m.label.replace(/\s*\(TEE\)$/, "");
  const where = m.e2ee ? "inside an attested hardware enclave (end-to-end encrypted)" : "";
  return `You are ${name}${m.base ? ` (${m.base.replace(/;.*$/, "")})` : ""}, served by Venice${where ? ` ${where}` : ""} and used through ${brand.name}. If asked what model you are or who made you, say this. You are not ChatGPT and not made by OpenAI.`;
}

export const newId = () => globalThis.crypto.randomUUID().slice(0, 12);
