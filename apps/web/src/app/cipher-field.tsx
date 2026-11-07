"use client";

import { useEffect, useRef } from "react";

/**
 * Landing backdrop: a field of ciphertext. Under the pointer ("decryption
 * lens") the glyphs resolve into plaintext; elsewhere they flicker like
 * encrypted traffic. On wide screens a hooded figure with an empty face is
 * drawn in denser glyphs. Original artwork, drawn procedurally.
 *
 * Canvas 2D, ~24 fps, paused when the tab is hidden, static under
 * prefers-reduced-motion. Purely decorative: aria-hidden, no pointer events.
 */
const CIPHER = "0123456789abcdef";
const DENSE = "#%@&$8*+=";
const PLAINTEXT =
  "just between us · ask anything · no account · no card · sealed to the enclave · say it under your breath · nobody else reads this · ";

const CELL_W = 11;
const CELL_H = 18;
const LENS = 130; // px radius
const FPS = 24;

type Cell = { ch: string; dense: boolean; face: boolean };

export function CipherField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cols = 0;
    let rows = 0;
    let cells: Cell[] = [];
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let t = 0;

    // Lens follows the pointer with easing; wanders on its own when idle.
    const lens = { x: -999, y: -999, tx: -999, ty: -999 };
    let lastMove = -1e9;

    const rand = (s: string) => s[(Math.random() * s.length) | 0]!;

    /** Hooded figure as a density mask, sampled from an offscreen path. */
    function figureMask(w: number, h: number) {
      const show = w >= 900;
      const m = document.createElement("canvas");
      m.width = cols;
      m.height = rows;
      const g = m.getContext("2d")!;
      if (show) {
        const fh = rows * 0.78;
        const fw = fh * 0.62 * (CELL_H / CELL_W);
        const ox = cols * 0.8 - fw / 2;
        const oy = rows - fh;
        const P = (x: number, y: number) => [ox + x * fw, oy + y * fh] as const;
        g.fillStyle = "#fff";
        g.beginPath();
        g.moveTo(...P(-0.08, 1));
        g.bezierCurveTo(...P(0.02, 0.82), ...P(0.12, 0.74), ...P(0.18, 0.66));
        g.bezierCurveTo(...P(0.1, 0.42), ...P(0.18, 0.08), ...P(0.5, 0.02));
        g.bezierCurveTo(...P(0.82, 0.08), ...P(0.9, 0.42), ...P(0.82, 0.66));
        g.bezierCurveTo(...P(0.88, 0.74), ...P(0.98, 0.82), ...P(1.08, 1));
        g.closePath();
        g.fill();
        // The empty face: anonymity.
        g.fillStyle = "#f00";
        g.beginPath();
        g.ellipse(...P(0.5, 0.36), fw * 0.17, fh * 0.17, 0, 0, Math.PI * 2);
        g.fill();
      }
      const data = g.getImageData(0, 0, cols, rows).data;
      return (c: number, r: number) => {
        const i = (r * cols + c) * 4;
        return { dense: data[i + 1]! > 128, face: data[i]! > 128 && data[i + 1]! < 128 };
      };
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `13px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "top";
      cols = Math.ceil(w / CELL_W);
      rows = Math.ceil(h / CELL_H);
      const mask = figureMask(w, h);
      cells = Array.from({ length: cols * rows }, (_, i) => {
        const { dense, face } = mask(i % cols, (i / cols) | 0);
        return { ch: dense ? rand(DENSE) : rand(CIPHER), dense, face };
      });
      draw();
    }

    function draw() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = cells[r * cols + c]!;
          const x = c * CELL_W;
          const y = r * CELL_H;
          // Fade out behind the headline + prompt so text stays readable.
          const dxC = (x - cx) / (w * 0.32);
          const dyC = (y - cy) / (h * 0.3);
          const calm = Math.min(1, Math.max(0, Math.hypot(dxC, dyC) - 0.55));
          if (cell.face) {
            if (calm > 0.1 && (r + c) % 7 === 0) {
              ctx.fillStyle = `rgba(236,231,222,${0.05 * calm})`;
              ctx.fillText("·", x, y);
            }
            continue;
          }
          const d = Math.hypot(x - lens.x, y - lens.y);
          const reveal = d < LENS ? 1 - d / LENS : 0;
          if (reveal > 0.15) {
            const ch = PLAINTEXT[(r * 37 + c) % PLAINTEXT.length]!;
            ctx.fillStyle = `rgba(200,164,106,${(0.18 + 0.55 * reveal) * Math.max(calm, 0.35)})`;
            ctx.fillText(ch, x, y);
          } else {
            const base = cell.dense ? 0.16 : 0.055;
            ctx.fillStyle = `rgba(236,231,222,${base * calm})`;
            ctx.fillText(cell.ch, x, y);
          }
        }
      }
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - last < 1000 / FPS) return;
      last = now;
      t += 1;
      // Idle: let the lens wander on a slow Lissajous path.
      if (now - lastMove > 4000) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        lens.tx = w * (0.5 + 0.38 * Math.sin(t / 97));
        lens.ty = h * (0.5 + 0.34 * Math.sin(t / 61 + 1));
      }
      lens.x += (lens.tx - lens.x) * 0.18;
      lens.y += (lens.ty - lens.y) * 0.18;
      // Ciphertext keeps changing, a little at a time.
      for (let i = 0; i < cells.length * 0.02; i++) {
        const cell = cells[(Math.random() * cells.length) | 0]!;
        if (!cell.face) cell.ch = cell.dense ? rand(DENSE) : rand(CIPHER);
      }
      draw();
    }

    const onMove = (e: PointerEvent) => {
      lens.tx = e.clientX;
      lens.ty = e.clientY;
      if (lens.x < -900) {
        lens.x = lens.tx;
        lens.y = lens.ty;
      }
      lastMove = performance.now();
      if (reduce) {
        lens.x = lens.tx;
        lens.y = lens.ty;
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
