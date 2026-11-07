"use client";

import { MODELS, PRIVACY_MODES, type PrivacyMode } from "@pay/rail/browser";
import { useState } from "react";
import s from "./page.module.css";

const NOTES: Record<PrivacyMode, string> = {
  anonymous: `${MODELS[PRIVACY_MODES.anonymous.chatModel]!.label} · you stay anonymous; the model host can read the prompt`,
  private: `${MODELS[PRIVACY_MODES.private.chatModel]!.label} · encrypted in your browser, readable only inside the attested enclave`,
};

const CHIPS = ["Pay with any token", "Use it in your editor", "Check the enclave", "What gets logged?"];

export function Prompt() {
  const [mode, setMode] = useState<PrivacyMode>("anonymous");
  const [text, setText] = useState("");

  return (
    <>
      <form className={s.pill} onSubmit={(e) => e.preventDefault()}>
        <textarea
          className={s.input}
          rows={1}
          placeholder="Ask anything"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Message"
        />
        <div className={s.pillRow}>
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
          <button className={s.send} type="submit" disabled={!text.trim()} aria-label="Send">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </form>
      <p className={s.note}>{NOTES[mode]}</p>
      <div className={s.chips}>
        {CHIPS.map((c) => (
          <button key={c} type="button" className={s.chip} onClick={() => setText(c)}>
            {c}
          </button>
        ))}
      </div>
    </>
  );
}
