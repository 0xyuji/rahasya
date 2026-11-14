"use client";

import { useEffect, useRef, useState } from "react";
import { MARK_PATH } from "./mark";
import s from "./mascot.module.css";

/**
 * The mark as a character: the hood whose face is a keyhole. Asleep, the face is empty, exactly
 * like the plain mark. Awake, two eyes glow inside the keyhole and blink now and then.
 *
 * - `awake`: eyes on.
 * - `wakeOnHover`: eyes on while it, or a link around it, is hovered or focused.
 * - `thinking`: eyes on and pulsing (waiting for a reply).
 * - `unlockOnView`: the first time it scrolls into view a key slides into the keyhole, turns,
 *   and the eyes light up; hovering it plays that again. Under reduced motion it simply wakes.
 */
export function Mascot({
  className,
  awake = false,
  wakeOnHover = false,
  thinking = false,
  unlockOnView = false,
}: {
  className?: string;
  awake?: boolean;
  wakeOnHover?: boolean;
  thinking?: boolean;
  unlockOnView?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [stage, setStage] = useState<"asleep" | "unlocking" | "awake">("asleep");

  useEffect(() => {
    const el = ref.current;
    if (!unlockOnView || !el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        setStage(still ? "awake" : "unlocking");
      },
      { threshold: 0.9 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [unlockOnView]);

  const on = awake || thinking || stage === "awake";
  const classes = [s.mascot, on ? s.awake : "", wakeOnHover ? s.wakeOnHover : "", thinking ? s.thinking : "", stage === "unlocking" ? s.unlocking : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <svg
      ref={ref}
      className={classes}
      viewBox="0 0 512 512"
      aria-hidden
      focusable="false"
      onPointerEnter={(e) => {
        if (unlockOnView && stage === "awake" && e.pointerType === "mouse" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setStage("unlocking");
      }}
    >
      {/* Drawn first, so the hood covers everything but what shows through the keyhole. */}
      <g className={s.lit}>
        <circle className={s.glow} cx="256" cy="250" r="64" />
        <g className={s.eyes}>
          <ellipse className={s.halo} cx="230" cy="244" rx="27" ry="17" transform="rotate(13 230 244)" />
          <ellipse className={s.halo} cx="282" cy="244" rx="27" ry="17" transform="rotate(-13 282 244)" />
          <ellipse cx="230" cy="244" rx="17" ry="9" transform="rotate(13 230 244)" />
          <ellipse cx="282" cy="244" rx="17" ry="9" transform="rotate(-13 282 244)" />
        </g>
      </g>
      <path className={s.hood} fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
      {stage === "unlocking" && (
        <g className={s.key} onAnimationEnd={(e) => e.animationName.includes("keyTurn") && setStage("awake")}>
          <rect x="226" y="281" width="192" height="14" rx="7" />
          <rect x="238" y="293" width="12" height="22" rx="2" />
          <rect x="261" y="293" width="12" height="15" rx="2" />
          <circle cx="448" cy="288" r="29" fill="none" strokeWidth="14" />
        </g>
      )}
    </svg>
  );
}
