"use client";

import { RailError, VeniceChat, resolveModel, type AttestationReport, type PrivacyMode } from "@pay/rail/browser";
import { useCallback, useMemo, useRef, useState } from "react";
import { friendly, veniceFor } from "../funding/flow";
import { verifyIntelQuote } from "../tee/intel-verify";
import { useWallet } from "../wallet/wallet-context";
import { buildContext, newId, type Msg } from "./conversation";

/** Conversation state lives in memory only: nothing is persisted or sent to our servers. */
export function useChat(onCreditChange: () => void) {
  const w = useWallet();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [attestations, setAttestations] = useState<Record<string, AttestationReport>>({});
  const run = useRef<AbortController | null>(null); // the one reply being generated
  const sendUnverified = useRef(false); // this conversation's answer to "Intel's check couldn't run"
  const busy = messages.some((m) => m.status === "streaming");

  // Truly private: every attestation's Intel signature is also verified here, in a sandboxed worker.
  const chat = useMemo(() => (w.inference ? new VeniceChat({ venice: veniceFor(w.inference), verifyQuote: verifyIntelQuote }) : null), [w.inference]);

  /** Attest (and verify) ahead of time when Truly private is selected, so the first message doesn't wait. */
  const prepare = useCallback(
    (mode: PrivacyMode, modelKey: string) => {
      if (mode !== "private" || !chat) return;
      try {
        void chat.attestation(resolveModel(mode, modelKey)).catch(() => {});
      } catch {}
    },
    [chat],
  );

  const patch = (id: string, p: Partial<Msg>) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const send = useCallback(
    async (text: string, mode: PrivacyMode, modelKey: string) => {
      if (!text.trim() || busy || run.current) return;
      const user: Msg = { id: newId(), role: "user", text, mode, modelKey, status: "done" };
      const reply: Msg = { id: newId(), role: "assistant", text: "", mode, modelKey, status: "streaming" };
      const context = buildContext(messages, { text, mode, modelKey });
      setMessages((ms) => [...ms, user, reply]);

      if (!w.source || !w.inference || !chat) {
        patch(reply.id, {
          status: "error",
          error: { code: w.source ? "LOCKED" : "NO_WALLET", text: w.source ? "Unlock your wallet to chat." : "Connect a wallet to start. It's your login and pays for credit." },
        });
        return;
      }

      const confirmUnverified = () => {
        sendUnverified.current ||= window.confirm("Intel's hardware check couldn't run right now, so this enclave can't be fully confirmed. Your message would still be encrypted to it.\n\nSend anyway? (You won't be asked again in this conversation.)");
        return sendUnverified.current;
      };
      const ctl = new AbortController();
      run.current = ctl;
      let chunks: () => number | undefined = () => undefined;
      try {
        const { meta, deltas } = await chat.stream({ mode, model: modelKey, messages: context, maxTokens: 4096, signal: ctl.signal, confirmUnverified, unverifiedAccepted: sendUnverified.current });
        chunks = () => meta.plaintextChunks;
        if (meta.attestation) {
          const aid = `${meta.attestation.model}:${meta.attestation.nonce.slice(0, 8)}`;
          setAttestations((a) => ({ ...a, [aid]: meta.attestation! }));
          patch(reply.id, { e2ee: meta.e2ee, attestationId: aid });
        } else patch(reply.id, { e2ee: false });

        let out = "";
        let reasoning = "";
        for await (const d of deltas) {
          if (d.type === "text") out += d.text;
          else if (d.type === "reasoning") reasoning += d.text;
          else if (d.type === "usage") patch(reply.id, { costUsd: d.costUsd });
          if (d.type !== "usage") patch(reply.id, { text: out, reasoning: reasoning || undefined });
        }
        patch(reply.id, { status: "done", plaintextChunks: chunks() });
        onCreditChange();
      } catch (e) {
        if (ctl.signal.aborted) {
          patch(reply.id, { status: "stopped", plaintextChunks: chunks() });
          onCreditChange();
          return;
        }
        const code = e instanceof RailError ? e.code : undefined;
        patch(reply.id, {
          status: "error",
          error: code === "VENICE_402" ? { code, text: "You're out of credit." } : { code, text: friendly(e) },
        });
      } finally {
        if (run.current === ctl) run.current = null;
      }
    },
    [busy, messages, w.source, w.inference, chat, onCreditChange],
  );

  const stop = () => run.current?.abort();
  const clear = () => {
    run.current?.abort();
    sendUnverified.current = false;
    setMessages([]);
  };

  return { messages, attestations, busy, send, stop, clear, prepare };
}
