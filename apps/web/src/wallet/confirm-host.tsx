"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import s from "../app/credit-dialog.module.css";
import { currentQuestion, subscribeQuestions } from "./ask";

/** A "yes" within this long of a question appearing is ignored: it was meant for the previous one. */
const SETTLE_MS = 500;

export function ConfirmHost() {
  const question = useSyncExternalStore(subscribeQuestions, currentQuestion, () => null);
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const shownAt = useRef(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (question && !d.open) d.showModal();
    if (!question && d.open) d.close();
    if (question) {
      // Every new question starts fresh: focus on Cancel, and a moment before "yes" counts.
      // Back-to-back questions keep the dialog open, so this is per question, not per open.
      shownAt.current = performance.now();
      cancel.current?.focus();
    }
  }, [question]);

  const yes = () => {
    if (!question) return;
    if (performance.now() - shownAt.current < SETTLE_MS) return; // a double click or repeated Enter from the last question
    question.answer(true);
  };

  return (
    <dialog
      ref={ref}
      className={`${s.dialog} ${s.confirm}`}
      onCancel={(e) => {
        e.preventDefault(); // Escape is a "no", and the question has to be cleared either way
        question?.answer(false);
      }}
      // A browser can close the dialog without a cancelable event (a second Escape, Android back):
      // that's a "no" too, or the question would block every later one. Harmless when we close it.
      // The close event is async: if the next question already reopened the dialog, this close
      // belongs to the previous one and must not answer the new question.
      onClose={() => {
        if (!ref.current?.open) question?.answer(false);
      }}
    >
      {question && (
        <div key={question.id} style={{ display: "contents" }}>
          <p className={s.p} style={{ whiteSpace: "pre-line" }}>
            {question.message}
          </p>
          <div className={s.row}>
            <button ref={cancel} className={s.secondary} onClick={() => question.answer(false)}>
              Cancel
            </button>
            <button className={s.primary} onClick={yes}>
              {question.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
