"use client";

import { useState } from "react";
import s from "./credit-dialog.module.css";

/** The pinned top of every dialog: the body scrolls underneath it. */
export function DialogHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className={s.head}>
      <h2 className={s.title}>{title}</h2>
      <button type="button" className={s.x} onClick={onClose} aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <path d="M2 2l10 10M12 2 2 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={s.copyBtn}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }, () => {})
      }
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** A single value (base URL, command, key) with its Copy button. */
export function CopyRow({ label, text }: { label?: string; text: string }) {
  return (
    <div className={s.copyRow}>
      {label && <span>{label}</span>}
      <code>{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

/** Code with its Copy button in a bar above it, so the button never sits on the text. Wide lines scroll inside the block. */
export function CodeBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className={s.codeBlock}>
      <div className={s.codeBar}>
        <span>{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className={s.code} tabIndex={0}>
        {text}
      </pre>
    </div>
  );
}
