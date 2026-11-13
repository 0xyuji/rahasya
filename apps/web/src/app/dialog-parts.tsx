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

/** Copies `text`. A blocked clipboard is said out loud, never silently ignored (audit v4 D-17). */
export function CopyButton({
  text,
  label = "Copy",
  className = s.copyBtn,
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const show = (next: "done" | "failed", ms: number) => {
    setState(next);
    setTimeout(() => setState("idle"), ms);
  };
  return (
    <button
      type="button"
      className={className}
      onClick={() =>
        void (() => {
          // Called right in the click (Safari only allows clipboard writes inside the gesture); a
          // missing Clipboard API (insecure origin, some webviews) throws here and is a "couldn't copy" too.
          try {
            return navigator.clipboard.writeText(text);
          } catch (e) {
            return Promise.reject(e);
          }
        })().then(
          () => (show("done", 1200), onCopied?.()),
          () => show("failed", 3000),
        )
      }
    >
      {state === "done" ? "Copied" : state === "failed" ? "Couldn't copy: try again" : label}
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
