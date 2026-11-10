"use client";

import { modelsForMode, type ModelDef, type PrivacyMode, type PrivacyTier } from "@pay/rail/browser";
import { useEffect, useId, useRef, useState } from "react";
import s from "./model-picker.module.css";

const TIER_LABEL: Record<PrivacyTier, string> = {
  tee: "Enclave, end-to-end encrypted",
  private: "Venice-hosted, not retained",
  anonymized: "Third-party host, identity stripped",
};
const TIER_ORDER: PrivacyTier[] = ["anonymized", "private", "tee"];
const ROLEPLAY_LABEL = "Roleplay & storytelling";

/** General models grouped by tier; fiction specialists always last. */
const groupOf = (m: ModelDef) => (m.use === "roleplay" ? ROLEPLAY_LABEL : TIER_LABEL[m.tier]);
const rank = (m: ModelDef) => (m.use === "roleplay" ? 10 : 0) + TIER_ORDER.indexOf(m.tier);

const fmt = (n: number) => (n < 1 ? `$${n.toFixed(2).replace(/0$/, "")}` : `$${n % 1 ? n.toFixed(2) : n}`);
export const priceLine = (m: ModelDef) => `${fmt(m.fallbackPrice.in)} in · ${fmt(m.fallbackPrice.out)} out / 1M tokens`;
export const tierLine = (t: PrivacyTier) => TIER_LABEL[t];
const shortName = (m: ModelDef) => m.label.replace(" (TEE)", "");
const fullName = (m: ModelDef) => (m.basedOn ? `${shortName(m)} (based on ${m.basedOn})` : shortName(m));

export function ModelPicker({ mode, value, onChange }: { mode: PrivacyMode; value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const [maxHeight, setMaxHeight] = useState(360);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const models = modelsForMode(mode).sort((a, b) => rank(a) - rank(b));
  const current = models.find((m) => m.key === value) ?? models[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) setActive(Math.max(0, models.findIndex((m) => m.key === current.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Near the bottom of the screen (the chat dock) the list opens upward instead of off the page.
  const openList = () => {
    const r = root.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      const up = below < 300 && r.top > below;
      setAbove(up);
      setMaxHeight(Math.max(180, Math.min(360, (up ? r.top : below) - 24))); // always fits on screen
    }
    setOpen(true);
  };

  const pick = (m: ModelDef) => {
    onChange(m.key);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") setActive((i) => Math.min(models.length - 1, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Enter") pick(models[active]!);
    else return;
    e.preventDefault();
  };

  let lastGroup: string | undefined;
  return (
    <div className={s.root} ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className={s.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className={s.triggerLabel} title={fullName(current)}>
          {shortName(current)}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={open ? s.chevUp : undefined}>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className={`${s.list} ${above ? s.listUp : ""}`} style={{ maxHeight }} role="listbox" id={listId} aria-label="Model">
          {models.map((m, i) => {
            const group = groupOf(m);
            const header = group !== lastGroup ? group : null;
            lastGroup = group;
            return (
              <li key={m.key} role="presentation">
                {header && <div className={s.group}>{header}</div>}
                <div
                  role="option"
                  aria-selected={m.key === current.key}
                  className={`${s.option} ${i === active ? s.active : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                >
                  <span className={s.optName}>
                    {fullName(m)}
                    {m.key === current.key && <span className={s.check}>Selected</span>}
                  </span>
                  <span className={s.optMeta}>
                    {m.host ? `${m.host} · ` : ""}
                    {priceLine(m)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
