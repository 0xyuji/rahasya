"use client";

import { MODELS, PRIVACY_MODES, resolveModel, type PrivacyMode } from "@pay/rail/browser";
import { useEffect, useRef, useState } from "react";
import { ModelPicker, tierLine } from "./model-picker";
import s from "./page.module.css";

const PLACEHOLDER = "Ask anything. No filters.";
/** Questions a filtered model tends to refuse or bury in disclaimers. They type themselves into the
 * empty prompt on the landing page. Kept short enough to fit one line on a phone. */
const EXAMPLES = [
  PLACEHOLDER,
  "Is this memecoin a rug? Be blunt.",
  "Give me a NEAR price target.",
  "How could this contract be drained?",
  "How do mixers hide a payment?",
  "Rate my portfolio. Be brutal.",
  "Which coin is actually private?",
];

/** Types each example out, holds it, deletes it and moves to the next, while `on`. Null when idle. */
function useTypedExamples(on: boolean): string | null {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!on || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(null);
    // Starts from the usual placeholder, already typed, and deletes it first.
    let at = 0;
    let chars = EXAMPLES[0]!.length;
    let step = -1;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      chars += step;
      setShown(EXAMPLES[at]!.slice(0, chars));
      let wait = step > 0 ? 34 + Math.random() * 46 : 14;
      if (step > 0 && chars >= EXAMPLES[at]!.length) {
        step = -1;
        wait = 2300;
      } else if (step < 0 && chars <= 0) {
        step = 1;
        at = (at + 1) % EXAMPLES.length;
        wait = 420;
      }
      timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, 2300);
    return () => clearTimeout(timer);
  }, [on]);
  return shown;
}

const MODE_NOTE: Record<PrivacyMode, string> = {
  anonymous: "but the host can read the prompt",
  private: "to a key the attestation ties to the enclave",
};

export function Prompt({
  onSend,
  busy = false,
  onStop,
  typeExamples = true,
  onPrepare,
  onDraft,
}: {
  onSend: (text: string, mode: PrivacyMode, modelKey: string) => void;
  /** Called when the mode/model changes, so Truly private can attest ahead of the first message. */
  onPrepare?: (mode: PrivacyMode, modelKey: string) => void;
  busy?: boolean;
  onStop?: () => void;
  /** Landing page only: example questions type themselves into the empty, unfocused prompt. */
  typeExamples?: boolean;
  /** Told whenever the box goes from empty to having text, or back. */
  onDraft?: (drafting: boolean) => void;
}) {
  const [mode, setMode] = useState<PrivacyMode>("anonymous");
  // Remember a choice per mode, so flipping the toggle back restores it.
  const [picked, setPicked] = useState<Record<PrivacyMode, string>>({
    anonymous: PRIVACY_MODES.anonymous.chatModel,
    private: PRIVACY_MODES.private.chatModel,
  });
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const example = useTypedExamples(typeExamples && !text && !focused);

  const model = (() => {
    try {
      return resolveModel(mode, picked[mode]);
    } catch {
      return MODELS[PRIVACY_MODES[mode].chatModel]!;
    }
  })();

  useEffect(() => {
    onPrepare?.(mode, model.key);
  }, [onPrepare, mode, model.key]);

  const drafting = text.length > 0;
  useEffect(() => {
    onDraft?.(drafting);
  }, [onDraft, drafting]);

  // Grow with the text, up to the CSS max-height.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim(), mode, model.key);
    setText("");
  };

  return (
    <>
      <form
        className={s.pill}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={area}
          className={`${s.input} ${example !== null ? s.inputTyping : ""}`}
          rows={1}
          placeholder={example ?? PLACEHOLDER}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Message"
        />
        <div className={s.pillRow}>
          <div className={s.controls}>
            <div className={s.modes} role="radiogroup" aria-label="Privacy">
              {(Object.keys(PRIVACY_MODES) as PrivacyMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={`${s.mode} ${mode === m ? s.modeOn : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m === "anonymous" ? "Anonymous" : "Truly private"}
                </button>
              ))}
            </div>
            <ModelPicker mode={mode} value={model.key} onChange={(k) => setPicked((p) => ({ ...p, [mode]: k }))} />
          </div>
          {busy ? (
            <button className={s.send} type="button" onClick={onStop} aria-label="Stop">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button className={s.send} type="submit" disabled={!text.trim()} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </form>
      <p className={s.note}>
        {tierLine(model.tier)}, {MODE_NOTE[mode]}
      </p>
    </>
  );
}
