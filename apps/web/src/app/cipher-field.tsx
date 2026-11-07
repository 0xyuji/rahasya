"use client";

import { useEffect, useRef } from "react";

/**
 * Landing backdrop, symbols only.
 *  - A faint field of flickering light symbols.
 *  - A hooded figure wearing a blank mask (traditional Venetian "volto" form,
 *    procedurally modelled here as a height field: original artwork). Its
 *    shading is recomputed every frame with the light at the pointer, so moving
 *    the mouse relights the face. Eye slits and mouth are true voids.
 *  - Occasional glitch: row tears and drifting dash streaks.
 * Canvas 2D, ~24 fps, paused when hidden, static under prefers-reduced-motion.
 */
const FIELD = ".,:;'-+/\\|";
const RAMP = " .,:;-=+*!%#&$@"; // dark -> bright by visual weight
const STREAK = ["-", "_", "=", "~"];

const CELL_W = 9;
const CELL_H = 15;
const FPS = 24;

type Fig = { c: number; r: number; nx: number; ny: number; nz: number; kind: "mask" | "hood" | "void" };

export function CipherField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0;
    let rows = 0;
    let field: string[] = [];
    let fig: Fig[] = [];
    let figMap = new Map<number, Fig>();
    let fx = 0; // figure center (px)
    let fy = 0;
    let raf = 0;
    let last = 0;
    let t = 0;

    const light = { x: 0, y: 0, tx: 0, ty: 0 };
    let lastMove = -1e9;
    const tears = new Map<number, { dx: number; life: number }>();
    let streaks: Array<{ x: number; y: number; len: number; vx: number; life: number; ch: string }> = [];

    const rand = (s: string) => s[(Math.random() * s.length) | 0]!;
    const g = (x: number, s: number) => Math.exp(-(x / s) ** 2);

    /** Mask surface height at normalized (u, v) ∈ [-1, 1]², or null outside / in a hole. */
    function mask(u: number, v: number): number | null {
      const wv = 0.78 * (1 - 0.18 * v); // egg shape: narrower at the chin
      const e = (u / wv) ** 2 + v ** 2;
      if (e > 1) return null;
      const au = Math.abs(u);
      // Eye slits (almond shaped) and a closed mouth line are cut through.
      const ex = (au - 0.3) / 0.15;
      if (Math.abs(ex) < 1 && Math.abs(v + 0.1) < 0.045 * (1 - ex * ex) + 0.004) return Number.NaN;
      if (au < 0.18 && Math.abs(v - 0.55 - 0.08 * (u / 0.18) ** 2) < 0.018) return Number.NaN;
      let h = Math.sqrt(1 - e) * 0.75;
      h += 0.26 * g(u, 0.085) * g(v - 0.18, 0.32); // nose ridge
      h += 0.1 * g(v + 0.27, 0.07) * g(u, 0.55); // brow
      h += 0.09 * g(au - 0.36, 0.17) * g(v - 0.2, 0.16); // cheekbones
      h -= 0.16 * g(au - 0.3, 0.15) * g(v + 0.1, 0.09); // eye sockets
      h += 0.05 * g(u, 0.2) * g(v - 0.82, 0.1); // chin
      return h;
    }

    /** Hood: a larger soft dome around the mask, cut off at the shoulders. */
    function hood(u: number, v: number): number | null {
      const hu = u / 1.22;
      const hv = (v + 0.05) / 1.2;
      const e = hu * hu + (hv < 0 ? hv * hv * 1.15 : hv * hv);
      if (e > 1 || v > 1.35) return null;
      return Math.sqrt(1 - e) * 0.6 + 0.04 * Math.sin(u * 10 + v * 3); // cloth folds
    }

    function build() {
      fig = [];
      figMap = new Map();
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w < 900) return;
      const maskH = h * 0.34; // half-height of the mask in px
      fx = w * 0.8;
      fy = h * 0.5;
      const unit = maskH;
      const c0 = Math.floor((fx - unit * 1.6) / CELL_W);
      const c1 = Math.ceil((fx + unit * 1.6) / CELL_W);
      const r0 = Math.floor((fy - unit * 1.5) / CELL_H);
      const r1 = Math.min(rows - 1, Math.ceil((fy + unit * 1.45) / CELL_H));
      const eps = 0.02;
      for (let r = Math.max(0, r0); r <= r1; r++) {
        for (let c = Math.max(0, c0); c < Math.min(cols, c1); c++) {
          const u = (c * CELL_W + CELL_W / 2 - fx) / unit;
          const v = (r * CELL_H + CELL_H / 2 - fy) / unit;
          const m = mask(u, v);
          let f: Fig | null = null;
          if (m !== null && Number.isNaN(m)) f = { c, r, nx: 0, ny: 0, nz: 1, kind: "void" };
          else if (m !== null) {
            // Neighbours that fall outside or into a hole count as flat (no NaN normals).
            const at = (a: number, b: number) => {
              const x = mask(a, b);
              return x === null || Number.isNaN(x) ? m : x;
            };
            const dx = (at(u + eps, v) - at(u - eps, v)) / (2 * eps);
            const dy = (at(u, v + eps) - at(u, v - eps)) / (2 * eps);
            const n = Math.hypot(dx, dy, 1);
            f = { c, r, nx: -dx / n, ny: -dy / n, nz: 1 / n, kind: "mask" };
          } else {
            const hh = hood(u, v);
            if (hh !== null) {
              const at = (a: number, b: number) => hood(a, b) ?? hh;
              const dx = (at(u + eps, v) - at(u - eps, v)) / (2 * eps);
              const dy = (at(u, v + eps) - at(u, v - eps)) / (2 * eps);
              const n = Math.hypot(dx, dy, 1);
              f = { c, r, nx: -dx / n, ny: -dy / n, nz: 1 / n, kind: "hood" };
            }
          }
          if (f) {
            fig.push(f);
            figMap.set(r * cols + c, f);
          }
        }
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `600 12px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "top";
      cols = Math.ceil(w / CELL_W);
      rows = Math.ceil(h / CELL_H);
      field = Array.from({ length: cols * rows }, () => rand(FIELD));
      if (!light.tx) {
        light.tx = light.x = w * 0.55;
        light.ty = light.y = h * 0.2;
      }
      build();
      draw();
    }

    function draw() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;

      // Background field, quiet behind the headline + prompt.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (figMap.has(r * cols + c)) continue;
          const x = c * CELL_W;
          const y = r * CELL_H;
          const calm = Math.min(1, Math.max(0, Math.hypot((x - cx) / (w * 0.32), (y - cy) / (h * 0.3)) - 0.55));
          if (calm <= 0) continue;
          const near = Math.max(0, 1 - Math.hypot(x - light.x, y - light.y) / 160);
          ctx.fillStyle = near > 0.05 ? `rgba(200,164,106,${(0.05 + 0.25 * near * near) * calm})` : `rgba(236,231,222,${0.045 * calm})`;
          ctx.fillText(field[r * cols + c]!, x, y);
        }
      }
      if (!fig.length) return;

      // Light direction from the figure toward the pointer, a bit in front of the face.
      let lx = light.x - fx;
      let ly = light.y - fy;
      let lz = Math.max(w, h) * 0.7;
      const ln = Math.hypot(lx, ly, lz);
      lx /= ln;
      ly /= ln;
      lz /= ln;

      for (const f of fig) {
        if (f.kind === "void") continue; // eye slits and mouth: pure black
        const lambert = Math.max(0, f.nx * lx + f.ny * ly + f.nz * lz);
        let s: number;
        if (f.kind === "mask") {
          // Specular-ish highlight on the mask, plus ambient.
          s = 0.1 + 0.85 * lambert ** 2.2 + 0.3 * lambert ** 24;
        } else {
          s = 0.02 + 0.3 * lambert ** 4; // cloth: mostly in shadow, rim catches light
        }
        s = Math.min(1, s);
        if (!Number.isFinite(s)) continue;
        const idx = Math.min(RAMP.length - 1, Math.floor(s * RAMP.length));
        const ch = RAMP[idx]!;
        if (ch === " ") continue;
        const tear = tears.get(f.r);
        const x = (f.c + (tear?.dx ?? 0)) * CELL_W;
        const y = f.r * CELL_H;
        const a = f.kind === "mask" ? 0.1 + 0.72 * s : 0.06 + 0.5 * s;
        ctx.fillStyle = s > 0.85 ? `rgba(236,224,200,${a})` : `rgba(236,231,222,${a})`;
        ctx.fillText(ch, x, y);
      }

      for (const st of streaks) {
        ctx.fillStyle = `rgba(236,231,222,${0.12 * Math.min(1, st.life / 10)})`;
        ctx.fillText(st.ch.repeat(st.len), st.x, st.y);
      }
    }

    function step(now: number) {
      t += 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (now - lastMove > 4000) {
        light.tx = w * (0.62 + 0.3 * Math.sin(t / 90));
        light.ty = h * (0.42 + 0.32 * Math.sin(t / 57 + 1));
      }
      light.x += (light.tx - light.x) * 0.2;
      light.y += (light.ty - light.y) * 0.2;
      for (let i = 0; i < field.length * 0.015; i++) field[(Math.random() * field.length) | 0] = rand(FIELD);

      // Glitch: short-lived row tears on the figure and drifting dash streaks.
      for (const [r, tr] of tears) if (--tr.life <= 0) tears.delete(r);
      if (fig.length && Math.random() < 0.06) {
        const r = fig[(Math.random() * fig.length) | 0]!.r;
        const dx = (Math.random() < 0.5 ? -1 : 1) * (1 + ((Math.random() * 4) | 0));
        for (let k = 0; k < 1 + ((Math.random() * 3) | 0); k++) tears.set(r + k, { dx, life: 2 + ((Math.random() * 5) | 0) });
      }
      if (fig.length && streaks.length < 14 && Math.random() < 0.25) {
        streaks.push({
          x: fx + (Math.random() - 0.5) * h * 0.9,
          y: fy + (Math.random() - 0.5) * h * 0.95,
          len: 1 + ((Math.random() * 5) | 0),
          vx: (Math.random() - 0.5) * 6,
          life: 20 + ((Math.random() * 40) | 0),
          ch: STREAK[(Math.random() * STREAK.length) | 0]!,
        });
      }
      streaks = streaks.filter((s) => (s.x += s.vx, --s.life > 0));
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      last = now;
      step(now);
      draw();
    }

    const onMove = (e: PointerEvent) => {
      light.tx = e.clientX;
      light.ty = e.clientY;
      lastMove = performance.now();
      if (reduce) {
        light.x = light.tx;
        light.y = light.ty;
        draw();
      }
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    if (!reduce) raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}
