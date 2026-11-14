"use client";

import { useEffect, useRef, useState } from "react";
import { CipherField } from "../app/cipher-field";
import { LandingSections } from "../app/landing";
import { Prompt } from "../app/prompt";
import page from "../app/page.module.css";
import { notifyCreditChanged } from "../wallet/use-credit";
import { useWallet } from "../wallet/wallet-context";
import { Message } from "./message";
import { useChat } from "./use-chat";
import s from "./chat.module.css";

export function ChatApp() {
  const w = useWallet();
  const { messages, attestations, busy, send, stop, clear, prepare } = useChat(notifyCreditChanged);
  const end = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);

  // Keeping the newest text in view. The reply arrives a few characters at a time, so this runs
  // many times a second: it must jump, not glide (a glide restarted on every character is what
  // made the page shake), and it must leave the reader alone once they have scrolled up.
  const follow = useRef(true);
  const bottom = () => {
    if (!end.current) return 0;
    const room = window.innerHeight - (dock.current?.offsetHeight ?? 0); // the part of the screen above the prompt
    return Math.max(0, end.current.getBoundingClientRect().bottom + window.scrollY - room);
  };
  useEffect(() => {
    const onScroll = () => {
      follow.current = bottom() - window.scrollY < 140;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const asked = messages.length;
  useEffect(() => {
    follow.current = true; // a new question is always followed
  }, [asked]);
  useEffect(() => {
    if (!follow.current) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: bottom() }));
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  // The header stays pinned while the landing page scrolls, not during a chat.
  const chatting = messages.length > 0;
  useEffect(() => {
    document.body.dataset.chat = chatting ? "on" : "off";
  }, [chatting]);

  // Once someone starts typing, the page is only the prompt: the sections below go, and with
  // them anything to scroll to. Clearing the box brings them back.
  const [drafting, setDrafting] = useState(false);
  useEffect(() => {
    if (drafting) window.scrollTo({ top: 0 });
  }, [drafting]);

  if (!messages.length) {
    return (
      <>
        <main className={page.main}>
          <CipherField />
          <div className={page.center}>
            <h1 className={page.headline}>
              Talk without <em>limits.</em>
            </h1>
            <p className={page.sub}>
              Uncensored and abliterated models, built not to refuse or lecture. Paid with whatever token you hold. No account. No card.
            </p>
            <Prompt onSend={send} onPrepare={prepare} onDraft={setDrafting} />
          </div>
        </main>
        {!drafting && <LandingSections />}
      </>
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
      <div className={s.dock} ref={dock}>
        <div className={s.dockInner}>
          {!busy && (
            <button className={s.newChat} onClick={clear}>
              New chat (nothing is saved)
            </button>
          )}
          <Prompt onSend={send} onPrepare={prepare} busy={busy} onStop={stop} typeExamples={false} />
        </div>
      </div>
    </>
  );
}
