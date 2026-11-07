"use client";

import { useEffect, useRef } from "react";
import { Prompt } from "../app/prompt";
import page from "../app/page.module.css";
import { notifyCreditChanged } from "../wallet/use-credit";
import { useWallet } from "../wallet/wallet-context";
import { Message } from "./message";
import { useChat } from "./use-chat";
import s from "./chat.module.css";

export function ChatApp() {
  const w = useWallet();
  const { messages, attestations, busy, send, stop, clear } = useChat(notifyCreditChanged);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages]);

  if (!messages.length) {
    return (
      <main className={page.main}>
        <div className={page.center}>
          <h1 className={page.headline}>
            Talk without <em>limits.</em>
          </h1>
          <p className={page.sub}>
            Uncensored and abliterated models, built not to refuse or lecture. Paid with whatever token you hold. No account. No card.
          </p>
          <Prompt onSend={send} />
        </div>
      </main>
    );
  }

  return (
    <>
      <div className={s.thread}>
        {messages.map((m) => (
          <Message key={m.id} m={m} attestation={m.attestationId ? attestations[m.attestationId] : undefined} onUnlock={() => void w.unlock()} />
        ))}
        <div ref={end} />
      </div>
      <div className={s.dock}>
        <div className={s.dockInner}>
          {!busy && (
            <button className={s.newChat} onClick={clear}>
              New chat (nothing is saved)
            </button>
          )}
          <Prompt onSend={send} busy={busy} onStop={stop} showChips={false} />
        </div>
      </div>
    </>
  );
}
