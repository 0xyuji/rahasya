"use client";

import { useEffect, useRef } from "react";

/**
 * Landing backdrop, symbols only. Every glyph is a particle on a spring:
 * the pointer pushes glyphs out of its way and sweeps them along with its
 * motion; they spring back home. While moving, a glyph turns into a stroke
 * (- / | \) aligned with its motion. Click for a shockwave. A hooded figure
 * with an empty face (heavier glyphs, stiffer springs) sits on wide screens.
 * Canvas 2D, paused when hidden, static under prefers-reduced-motion.
 */
const RAMP = ".,:;'-+/\\|!*=%#&$@";
const LIGHT = RAMP.slice(0, 10); // background field
const HEAVY = RAMP.slice(10); // hooded figure

const CELL_W = 11;
const CELL_H = 18;
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
  dense: boolean; // part of the figure (rim or body)
  rim: boolean; // lit outline of the figure
  face: boolean; // the empty hood opening: never drawn
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

    /**
     * Hooded figure (wide shoulders, narrow hood), sampled from an offscreen
     * path into per-cell flags: rim (bright outline), body (dark, sparse), face (empty).
     */
    function figureMask(w: number) {
      const inside = new Uint8Array(cols * rows); // 0 out, 1 body, 2 face opening
      if (w >= 900) {
        const m = document.createElement("canvas");
        m.width = cols;
        m.height = rows;
        const g = m.getContext("2d")!;
        const fh = rows * 0.84;
        const fw = cols * 0.62;
        const ox = cols * 0.74 - fw / 2;
        const oy = rows - fh;
        const P = (x: number, y: number) => [ox + x * fw, oy + y * fh] as const;
        g.fillStyle = "#fff";
        g.beginPath();
        g.moveTo(...P(0, 1.02));
        g.bezierCurveTo(...P(0.02, 0.86), ...P(0.05, 0.72), ...P(0.12, 0.64));
        g.bezierCurveTo(...P(0.2, 0.55), ...P(0.3, 0.5), ...P(0.37, 0.46));
        g.bezierCurveTo(...P(0.37, 0.36), ...P(0.37, 0.18), ...P(0.41, 0.07));
        g.bezierCurveTo(...P(0.44, 0.0), ...P(0.56, 0.0), ...P(0.59, 0.07));
        g.bezierCurveTo(...P(0.63, 0.18), ...P(0.63, 0.36), ...P(0.63, 0.46));
        g.bezierCurveTo(...P(0.7, 0.5), ...P(0.8, 0.55), ...P(0.88, 0.64));
        g.bezierCurveTo(...P(0.95, 0.72), ...P(0.98, 0.86), ...P(1, 1.02));
        g.closePath();
        g.fill();
        g.fillStyle = "#f00"; // the hood opening: no face, just dark
        g.beginPath();
        g.ellipse(...P(0.5, 0.25), fw * 0.072, fh * 0.15, 0, 0, Math.PI * 2);
        g.fill();
        const data = g.getImageData(0, 0, cols, rows).data;
        for (let i = 0; i < cols * rows; i++) {
          const red = data[i * 4]! > 128;
          const green = data[i * 4 + 1]! > 128;
          inside[i] = green ? 1 : red ? 2 : 0;
        }
      }
      return (c: number, r: number) => {
        const v = inside[r * cols + c]!;
        if (v !== 1) return { rim: false, body: false, face: v === 2 };
        // Rim light: body cells within ~2 columns / 1 row of the outside or the face.
        let rim = false;
        for (let dy = -1; dy <= 1 && !rim; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const cc = c + dx;
            const rr = r + dy;
            if (rr < 0 || rr >= rows) continue;
            if (cc < 0 || cc >= cols || inside[rr * cols + cc] !== 1) {
              rim = true;
              break;
            }
          }
        }
        return { rim, body: !rim, face: false };
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
      ctx.font = `13px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      cols = Math.ceil(w / CELL_W);
      rows = Math.ceil(h / CELL_H);
      const mask = figureMask(w);
      cells = Array.from({ length: cols * rows }, (_, i) => {
        const c = i % cols;
        const r = (i / cols) | 0;
        const { rim, body, face } = mask(c, r);
        const dense = rim || body;
        return {
          hx: c * CELL_W + CELL_W / 2,
          hy: r * CELL_H + CELL_H / 2,
          ox: 0,
          oy: 0,
          vx: 0,
          vy: 0,
          ch: rim ? rand(HEAVY) : rand(LIGHT),
          dense,
          rim,
          face,
        };
      });
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
        if (c.face) continue;
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
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      for (const c of cells) {
        if (c.face) continue;
        const x = c.hx + c.ox;
        const y = c.hy + c.oy;
        // Stay quiet behind the headline + prompt so text remains readable.
        const calm = Math.min(1, Math.max(0, Math.hypot((c.hx - cx) / (w * 0.32), (c.hy - cy) / (h * 0.3)) - 0.55));
        if (calm <= 0) continue;
        const disp = Math.hypot(c.ox, c.oy);
        const speed = Math.hypot(c.vx, c.vy);
        const ch = speed > 0.9 ? stroke(c.vx, c.vy) : disp > 3 ? stroke(c.ox, c.oy) : c.ch;
        // Rim-lit silhouette: bright outline, a body darker than the field around it.
        if (c.dense && !c.rim && disp < 2 && (c.hx / CELL_W + c.hy / CELL_H) % 3 !== 0) continue;
        const base = c.rim ? 0.3 : c.dense ? 0.035 : 0.06;
        const a = Math.min(0.5, base + disp * 0.006 + speed * 0.02) * calm;
        ctx.fillStyle = `rgba(236,231,222,${a})`;
        ctx.fillText(ch, x, y);
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
        if (!c.face && Math.abs(c.ox) + Math.abs(c.oy) < 1) c.ch = c.rim ? rand(HEAVY) : rand(LIGHT);
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
