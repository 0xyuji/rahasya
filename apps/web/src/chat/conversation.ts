import { MODELS, type ChatMessage, type PrivacyMode } from "@pay/rail/browser";

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
  const e2ee = MODELS[next.modelKey]?.e2ee ?? false;

  if (!e2ee) {
    return [...usable.map((m) => ({ role: m.role, content: m.text }) as ChatMessage), { role: "user", content: next.text }];
  }
  if (!usable.length) return [{ role: "user", content: next.text }];
  const transcript = usable.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n\n");
  return [
    { role: "system", content: `Conversation so far (continue it naturally; do not repeat it):\n\n${transcript}` },
    { role: "user", content: next.text },
  ];
}

export const newId = () => globalThis.crypto.randomUUID().slice(0, 12);
