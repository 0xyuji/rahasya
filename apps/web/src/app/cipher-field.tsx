"use client";

import { useEffect, useRef } from "react";
import { FIGURE, FIGURE_H, FIGURE_W } from "./hooded-figure";

/**
 * Landing backdrop, symbols only. Every glyph is a particle on a spring:
 * the pointer pushes glyphs out of its way and sweeps them along with its
 * motion; they spring back home. While moving, a glyph turns into a stroke
 * (- / | \) aligned with its motion. Click for a shockwave. A hooded figure
 * with an empty face, in finer and brighter glyphs on stiffer springs, stands
 * to the right on wide screens.
 * Canvas 2D, paused when hidden, static under prefers-reduced-motion.
 */
const RAMP = ".,:;'-+/\\|!*=%#&$@";
const LIGHT = RAMP.slice(0, 10); // background field
const HEAVY = RAMP.slice(10); // hooded figure

const CELL_W = 11;
const CELL_H = 18;
const FINE_W = 4; // the figure's grid, far finer than the field's, so folds and cords survive
const FINE_H = 6.5;
const FONT = `13px ui-monospace, "SF Mono", Menlo, monospace`;
const FINE_FONT = `7px ui-monospace, "SF Mono", Menlo, monospace`;
const COLUMN = 380; // half the width of the headline and prompt
const HOOD_LEFT = 262; // in figure units
const HOOD_BOTTOM = 470; // in figure units
const UNDER_COLUMN = 70; // px of hood allowed to pass behind the prompt
const FIGURE_MIN_SCALE = 0.45; // any smaller and the detail is lost
const RADIUS = 110; // px, cursor push radius
const FPS = 45;

type Cell = {
  hx: number; // home position (px)
  hy: number;
  ox: number; // offset from home
  oy: number;
  vx: number;
  vy: number;
  ch: string;
  dense: boolean; // part of the figure
  fade: number; // 0..1, kept down near the headline and prompt
};

/** Stroke glyph for a motion direction (screen y points down). */
function stroke(dx: number, dy: number): string {
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180; // 0..180
  if (a < 22.5 || a >= 157.5) return "-";
  if (a < 67.5) return "\\";
  if (a < 112.5) return "|";
  return "/";
}

export function CipherField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0;
    let rows = 0;
    let cells: Cell[] = [];
    let raf = 0;
    let last = 0;

    const ptr = { x: -9999, y: -9999, vx: 0, vy: 0, px: -9999, py: -9999, active: false };
    const waves: Array<{ x: number; y: number; r: number; life: number }> = [];

    const rand = (s: string) => s[(Math.random() * s.length) | 0]!;

    /** Paints the figure into a mask with one pixel per fine cell. */
    function figureMask(w: number, h: number) {
      const fineCols = Math.ceil(w / FINE_W);
      const fineRows = Math.ceil(h / FINE_H);
      // As large as the height allows, while the empty face stays clear of the text column.
      const scale = Math.min((h * 0.87) / FIGURE_H, (w / 2 - COLUMN + UNDER_COLUMN) / (FIGURE_W - HOOD_LEFT));
      if (scale < FIGURE_MIN_SCALE) return null;
      const m = document.createElement("canvas");
      m.width = fineCols;
      m.height = fineRows;
      const g = m.getContext("2d", { willReadFrequently: true })!;
      const fh = FIGURE_H * scale;
      const left = w - FIGURE_W * scale;
      g.fillStyle = "#000";
      g.fillRect(0, 0, fineCols, fineRows);
      g.setTransform(scale / FINE_W, 0, 0, scale / FINE_H, left / FINE_W, (h - fh) / FINE_H);
      g.lineCap = "round";
      const color = { shape: "#0f0", lit: "#fff", shadow: "#0f0", face: "#f00" };
      for (const p of FIGURE) {
        const path = new Path2D(p.d);
        if (p.width) {
          g.strokeStyle = color[p.tone];
          g.lineWidth = p.width;
          g.stroke(path);
        } else {
          g.fillStyle = color[p.tone];
          g.fill(path);
        }
      }
      const data = g.getImageData(0, 0, fineCols, fineRows).data;
      const at = (c: number, r: number) => (r * fineCols + c) * 4;
      return {
        fineCols,
        fineRows,
        shoulders: h - fh + HOOD_BOTTOM * scale,
        lit: (c: number, r: number) => data[at(c, r)]! > 128 && data[at(c, r) + 1]! > 128,
        /** Any part of the figure, so the field stays out and the body reads as dark. */
        solid: (px: number, py: number) => {
          const i = at(Math.floor(px / FINE_W), Math.floor(py / FINE_H));
          return data[i]! > 128 || data[i + 1]! > 128;
        },
      };
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
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      cols = Math.ceil(w / CELL_W);
      rows = Math.ceil(h / CELL_H);
      const mask = figureMask(w, h);
      const cell = (hx: number, hy: number, ch: string, dense: boolean, fade: number): Cell => ({ hx, hy, ox: 0, oy: 0, vx: 0, vy: 0, ch, dense, fade });
      const next: Cell[] = [];
      const cx = w / 2;
      const cy = h * 0.46;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const hx = c * CELL_W + CELL_W / 2;
          const hy = r * CELL_H + CELL_H / 2;
          if (mask?.solid(hx, hy)) continue;
          // Stay quiet behind the headline + prompt so text remains readable.
          const fade = Math.min(1, Math.max(0, Math.hypot((hx - cx) / (w * 0.32), (hy - cy) / (h * 0.3)) - 0.55));
          if (fade > 0) next.push(cell(hx, hy, rand(LIGHT), false, fade));
        }
      }
      // Sorted after the field: draw() switches font once, at the first figure cell.
      if (mask) {
        const edge = cx + COLUMN;
        for (let r = 0; r < mask.fineRows; r++) {
          for (let c = 0; c < mask.fineCols; c++) {
            if (!mask.lit(c, r)) continue;
            const hx = c * FINE_W + FINE_W / 2;
            const hy = r * FINE_H + FINE_H / 2;
            // His body drops to a trace below the prompt; the hood is level with no text but the prompt, which has its own background.
            const fade = hy < mask.shoulders ? 1 : 0.22 + 0.78 * Math.min(1, Math.max(0, (hx - edge) / 40));
            next.push(cell(hx, hy, rand(HEAVY), true, fade));
          }
        }
      }
      cells = next;
      draw();
    }

    function physics() {
      // Pointer velocity (for the "sweep"), decays when the pointer stops.
      if (ptr.px > -9000) {
        ptr.vx = ptr.vx * 0.5 + (ptr.x - ptr.px) * 0.5;
        ptr.vy = ptr.vy * 0.5 + (ptr.y - ptr.py) * 0.5;
      }
      ptr.px = ptr.x;
      ptr.py = ptr.y;
      for (const wv of waves) {
        wv.r += 14;
        wv.life -= 1;
      }
      for (let i = waves.length - 1; i >= 0; i--) if (waves[i]!.life <= 0) waves.splice(i, 1);

      const R2 = RADIUS * RADIUS;
      for (const c of cells) {
        const x = c.hx + c.ox;
        const y = c.hy + c.oy;
        const heavy = c.dense ? 0.45 : 1; // the figure resists more
        if (ptr.active) {
          const dx = x - ptr.x;
          const dy = y - ptr.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = (1 - d / RADIUS) ** 2;
            c.vx += (dx / d) * f * 3.2 * heavy + ptr.vx * f * 0.12 * heavy;
            c.vy += (dy / d) * f * 3.2 * heavy + ptr.vy * f * 0.12 * heavy;
          }
        }
        for (const wv of waves) {
          const dx = x - wv.x;
          const dy = y - wv.y;
          const d = Math.hypot(dx, dy) || 1;
          const band = Math.abs(d - wv.r);
          if (band < 26) {
            const f = (1 - band / 26) * (wv.life / 40) * 4 * heavy;
            c.vx += (dx / d) * f;
            c.vy += (dy / d) * f;
          }
        }
        const k = c.dense ? 0.11 : 0.07; // spring back home
        c.vx = (c.vx - c.ox * k) * 0.84;
        c.vy = (c.vy - c.oy * k) * 0.84;
        c.ox += c.vx;
        c.oy += c.vy;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.font = FONT;
      let fine = false;
      for (const c of cells) {
        if (c.dense && !fine) {
          fine = true;
          ctx.font = FINE_FONT;
        }
        const disp = Math.hypot(c.ox, c.oy);
        const speed = Math.hypot(c.vx, c.vy);
        const ch = speed > 0.9 ? stroke(c.vx, c.vy) : disp > 3 ? stroke(c.ox, c.oy) : c.ch;
        const a = c.dense ? Math.min(0.7, 0.36 + disp * 0.006 + speed * 0.02) : Math.min(0.5, 0.06 + disp * 0.006 + speed * 0.02);
        ctx.fillStyle = `rgba(236,231,222,${a * c.fade})`;
        ctx.fillText(ch, c.hx + c.ox, c.hy + c.oy);
      }
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      last = now;
      physics();
      // Ciphertext keeps changing, a little at a time (only glyphs at rest).
      for (let i = 0; i < cells.length * 0.01; i++) {
        const c = cells[(Math.random() * cells.length) | 0]!;
        if (Math.abs(c.ox) + Math.abs(c.oy) < 1) c.ch = c.dense ? rand(HEAVY) : rand(LIGHT);
      }
      draw();
    }

    const onMove = (e: PointerEvent) => {
      if (ptr.px < -9000) {
        ptr.px = e.clientX;
        ptr.py = e.clientY;
      }
      ptr.x = e.clientX;
      ptr.y = e.clientY;
      ptr.active = true;
    };
    const onLeave = () => {
      ptr.active = false;
      ptr.vx = ptr.vy = 0;
    };
    const onDown = (e: PointerEvent) => waves.push({ x: e.clientX, y: e.clientY, r: 0, life: 40 });
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("blur", onLeave);
      document.addEventListener("visibilitychange", onVis);
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }} />;
}
