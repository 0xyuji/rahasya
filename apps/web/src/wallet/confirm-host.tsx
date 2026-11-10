"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import s from "../app/credit-dialog.module.css";
import { currentQuestion, subscribeQuestions } from "./ask";

export function ConfirmHost() {
  const question = useSyncExternalStore(subscribeQuestions, currentQuestion, () => null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (question && !d.open) d.showModal();
    if (!question && d.open) d.close();
  }, [question]);

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      onCancel={(e) => {
        e.preventDefault(); // Escape is a "no", and the question has to be cleared either way
        question?.answer(false);
      }}
    >
      {question && (
        <>
          <p className={s.p} style={{ whiteSpace: "pre-line" }}>
            {question.message}
          </p>
          <div className={s.row}>
            <button className={s.secondary} onClick={() => question.answer(false)}>
              Cancel
            </button>
            <button className={s.primary} onClick={() => question.answer(true)}>
              {question.confirmLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
