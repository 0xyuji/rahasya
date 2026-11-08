"use client";

import { MODELS, PRIVACY_MODES, resolveModel, type PrivacyMode } from "@pay/rail/browser";
import { useEffect, useRef, useState } from "react";
import { ModelPicker, tierLine } from "./model-picker";
import s from "./page.module.css";

const CHIPS = ["Answer without the disclaimers", "Argue the side nobody will", "Write a dark short story", "Roast my code"];

const MODE_NOTE: Record<PrivacyMode, string> = {
  anonymous: "you stay anonymous; the model host can read the prompt",
  private: "encrypted in your browser, readable only inside the attested enclave",
};

export function Prompt({
  onSend,
  busy = false,
  onStop,
  showChips = true,
  onPrepare,
}: {
  onSend: (text: string, mode: PrivacyMode, modelKey: string) => void;
  /** Called when the mode/model changes, so Truly private can attest ahead of the first message. */
  onPrepare?: (mode: PrivacyMode, modelKey: string) => void;
  busy?: boolean;
  onStop?: () => void;
  showChips?: boolean;
}) {
  const [mode, setMode] = useState<PrivacyMode>("anonymous");
  // Remember a choice per mode, so flipping the toggle back restores it.
  const [picked, setPicked] = useState<Record<PrivacyMode, string>>({
    anonymous: PRIVACY_MODES.anonymous.chatModel,
    private: PRIVACY_MODES.private.chatModel,
  });
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

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
          className={s.input}
          rows={1}
          placeholder="Ask anything. No filters."
          value={text}
          onChange={(e) => setText(e.target.value)}
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
        {tierLine(model.tier)} · {MODE_NOTE[mode]}
      </p>
      {showChips && (
        <div className={s.chips}>
          {CHIPS.map((c) => (
            <button key={c} type="button" className={s.chip} onClick={() => (setText(c), area.current?.focus())}>
              {c}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
