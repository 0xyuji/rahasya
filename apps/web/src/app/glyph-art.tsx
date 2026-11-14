"use client";

import { useEffect, useRef } from "react";

/**
 * A small picture made of the same cipher glyphs as the landing backdrop. `draw` paints the
 * picture in greys on black (brighter = denser glyph); it is sampled once per size into a grid of
 * glyphs. A few glyphs change every tick while the picture is on screen, so it reads as live
 * cipher rather than a still image. Static under prefers-reduced-motion.
 */
export type GlyphDraw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const RAMP = ".,:;'-+/\\|!*=%#&$@";
const CELL_W = 4;
const CELL_H = 7;
const FONT = `7px ui-monospace, "SF Mono", Menlo, monospace`;
const TONES = { paper: "236,231,222", brass: "200,164,106" };
const LEVELS = 8; // alpha steps, so fill styles are built once

type Cell = { x: number; y: number; style: string; base: number; at: number };

export function GlyphArt({ draw, tone = "paper", className }: { draw: GlyphDraw; tone?: keyof typeof TONES; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    // One fill style per colour and brightness step. Grey paint takes the picture's tone; coloured
    // paint keeps its own hue (the coins).
    const styles = new Map<string, string>();
    const styleFor = (rgb: string, level: number) => {
      const key = `${rgb}/${level}`;
      let style = styles.get(key);
      if (!style) styles.set(key, (style = `rgba(${rgb},${(0.22 + (0.78 * (level + 1)) / LEVELS).toFixed(2)})`));
      return style;
    };
    let cells: Cell[] = [];
    let dpr = 1;
    let w = 0;
    let h = 0;
    let visible = false;

    function paint() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const c of cells) {
        ctx.fillStyle = c.style;
        ctx.fillText(RAMP[c.at]!, c.x, c.y);
      }
    }

    function build() {
      const box = canvas.getBoundingClientRect();
      w = Math.round(box.width);
      h = Math.round(box.height);
      if (!w || !h) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const cols = Math.floor(w / CELL_W);
      const rows = Math.floor(h / CELL_H);
      // Painting at one pixel per cell lets the browser average each cell's brightness for us.
      const small = document.createElement("canvas");
      small.width = cols;
      small.height = rows;
      const sctx = small.getContext("2d", { willReadFrequently: true })!;
      sctx.fillStyle = "#000";
      sctx.fillRect(0, 0, cols, rows);
      sctx.scale(cols / w, rows / h);
      draw(sctx, w, h);
      const px = sctx.getImageData(0, 0, cols, rows).data;
      const padX = (w - cols * CELL_W) / 2;
      const padY = (h - rows * CELL_H) / 2;
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = (r * cols + c) * 4;
          const [red, green, blue] = [px[i]!, px[i + 1]!, px[i + 2]!];
          const peak = Math.max(red, green, blue);
          const light = peak / 255;
          if (light < 0.07) continue;
          const base = Math.min(RAMP.length - 1, Math.floor(light * RAMP.length));
          const grey = peak - Math.min(red, green, blue) < 12;
          const rgb = grey ? TONES[tone] : [red, green, blue].map((v) => Math.round((v / peak) * 255)).join(",");
          cells.push({ x: padX + c * CELL_W + CELL_W / 2, y: padY + r * CELL_H + CELL_H / 2, style: styleFor(rgb, Math.min(LEVELS - 1, Math.floor(light * LEVELS))), base, at: base });
        }
      }
      paint();
    }

    build();
    const resize = new ResizeObserver(build);
    resize.observe(canvas);
    const seen = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    seen.observe(canvas);

    let timer: ReturnType<typeof setInterval> | undefined;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = setInterval(() => {
        if (!visible || document.hidden || !cells.length) return;
        for (let i = Math.ceil(cells.length * 0.025); i > 0; i--) {
          const c = cells[Math.floor(Math.random() * cells.length)]!;
          // Stay within one step of the cell's own density, so the picture keeps its shading.
          c.at = Math.max(0, Math.min(RAMP.length - 1, c.base + Math.floor(Math.random() * 3) - 1));
        }
        paint();
      }, 150);
    }
    return () => {
      resize.disconnect();
      seen.disconnect();
      clearInterval(timer);
    };
  }, [draw, tone]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

const grey = (v: number) => {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgb(${n},${n},${n})`;
};
/* Shading used by every picture: a faint inside, a bright edge. Lines are never thinner than
   about two glyphs, or they break up. */
const INSIDE = 0.13;
const EDGE = 1;
const thick = (v: number, min = 8) => Math.max(min, v);

/** Paint at brightness v (0..1) in a colour, so the glyphs sampled from it keep that hue. */
const tint = (v: number, [r, g, b]: readonly [number, number, number]) => `rgb(${Math.round(r * v)},${Math.round(g * v)},${Math.round(b * v)})`;
const ZCASH_GOLD = [244, 183, 40] as const;
const BITCOIN_ORANGE = [247, 147, 26] as const;
const NEAR_GREEN = [0, 236, 151] as const;

/* The three token marks, each drawn around the origin for a coin of radius r. */

/** Zcash: a Z with a short stroke through the top and the bottom. */
function markZcash(ctx: CanvasRenderingContext2D, r: number) {
  const a = r * 0.36; // half width
  const b = r * 0.4; // half height
  const bar = r * 0.16;
  const lean = r * 0.3;
  ctx.fillRect(-a, -b, a * 2, bar);
  ctx.fillRect(-a, b - bar, a * 2, bar);
  ctx.beginPath();
  ctx.moveTo(a - lean, -b + bar);
  ctx.lineTo(a, -b + bar);
  ctx.lineTo(-a + lean, b - bar);
  ctx.lineTo(-a, b - bar);
  ctx.closePath();
  ctx.fill();
  const tick = r * 0.14;
  ctx.fillRect(-tick / 2, -b - r * 0.17, tick, r * 0.19);
  ctx.fillRect(-tick / 2, b - r * 0.02, tick, r * 0.19);
}

/** Bitcoin: a B leaning to the right, with two strokes above and below and a slab on the stem. */
function markBitcoin(ctx: CanvasRenderingContext2D, r: number) {
  ctx.rotate(0.244); // the mark leans 14 degrees
  ctx.scale(1.16, 1.16);
  const line = r * 0.155;
  const top = -r * 0.46;
  const bottom = r * 0.46;
  const left = -r * 0.3;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = line;
  ctx.lineJoin = "miter";
  // Two bowls drawn as outlines, so the counters stay open; the lower one is wider.
  const bowl = (y0: number, y1: number, width: number) => {
    const h = y1 - y0;
    ctx.beginPath();
    ctx.roundRect(left + line / 2, y0, width - line, h, [0, h / 2, h / 2, 0]);
    ctx.stroke();
  };
  bowl(top + line / 2, 0, r * 0.62);
  bowl(0, bottom - line / 2, r * 0.72);
  const bar = r * 0.11;
  const reach = r * 0.19;
  for (const x of [left + r * 0.17, left + r * 0.4]) {
    ctx.fillRect(x, top - reach, bar, reach + 1);
    ctx.fillRect(x, bottom - 1, bar, reach + 1);
  }
  ctx.fillRect(left - r * 0.14, top, r * 0.16, line);
  ctx.fillRect(left - r * 0.14, bottom - line, r * 0.16, line);
}

/** NEAR: the N mark, from its published outline (a 90-unit square). */
const NEAR_MARK =
  "M72.2 4.6L53.4 32.5c-1.3 1.9 1.2 4.2 3 2.6L74.9 19c.5-.4 1.2-.1 1.2.6v50.3c0 .7-.9 1-1.3.5l-56-67C17.1 1.3 14.4 0 11.5 0h-2C4.3 0 0 4.3 0 9.6v70.8C0 85.7 4.3 90 9.600 90c3.300 0 6.400-1.700 8.200-4.600l18.800-27.900c1.300-1.900-1.200-4.200-3-2.600l-18.500 16c-.5.4-1.200.1-1.200-.6V20.100c0-.7.9-1 1.300-.5l56 67c1.800 2.200 4.600 3.500 7.400 3.500h2c5.300 0 9.600-4.300 9.600-9.600V9.600C90 4.300 85.700 0 80.400 0c-3.400 0-6.500 1.700-8.200 4.600z";
function markNear(ctx: CanvasRenderingContext2D, r: number) {
  const size = r * 1.1;
  ctx.translate(-size / 2, -size / 2);
  ctx.scale(size / 90, size / 90);
  ctx.fill(new Path2D(NEAR_MARK));
}

/** Three coins in a row: Zcash, Bitcoin in front and larger, NEAR. */
export const drawCoins: GlyphDraw = (ctx, w, h) => {
  const R = Math.min(h * 0.4, w * 0.196);
  const cx = w / 2;
  const cy = h / 2 - R * 0.1;
  // The side coins tuck only a little way behind the front one, so each mark shows whole.
  const coins = [
    { x: cx - R * 1.6, y: cy + R * 0.24, r: R * 0.8, mark: markZcash, ink: ZCASH_GOLD },
    { x: cx + R * 1.6, y: cy + R * 0.24, r: R * 0.8, mark: markNear, ink: NEAR_GREEN },
    { x: cx, y: cy, r: R, mark: markBitcoin, ink: BITCOIN_ORANGE },
  ];
  for (const c of coins) {
    ctx.fillStyle = "#000"; // a dark gap, so the coin in front is cut out from the ones behind
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 1.12, 0, Math.PI * 2);
    ctx.fill();
    const fill = ctx.createRadialGradient(c.x - c.r * 0.4, c.y - c.r * 0.45, c.r * 0.1, c.x, c.y, c.r);
    fill.addColorStop(0, grey(0.24));
    fill.addColorStop(1, grey(INSIDE));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = grey(EDGE);
    ctx.lineWidth = thick(c.r * 0.1);
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.fillStyle = tint(EDGE, c.ink); // only the mark carries the token's colour
    c.mark(ctx, c.r);
    ctx.restore();
  }
};

/** A chip with pins on every side and a padlock at its centre. */
export const drawEnclave: GlyphDraw = (ctx, w, h) => {
  const S = Math.min(w * 0.42, h * 0.54);
  const cx = w / 2;
  const cy = h / 2;
  ctx.fillStyle = grey(0.6);
  const pin = thick(S * 0.08, 6);
  for (let k = 0; k < 4; k++) {
    const t = -S * 0.3 + (k * S * 0.6) / 3;
    ctx.fillRect(cx + t - pin / 2, cy - S * 0.7, pin, S * 1.4);
    ctx.fillRect(cx - S * 0.7, cy + t - pin / 2, S * 1.4, pin);
  }
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(cx - S * 0.56, cy - S * 0.56, S * 1.12, S * 1.12, S * 0.14);
  ctx.fill();
  ctx.fillStyle = grey(INSIDE);
  ctx.strokeStyle = grey(EDGE);
  ctx.lineWidth = thick(S * 0.06);
  ctx.beginPath();
  ctx.roundRect(cx - S / 2, cy - S / 2, S, S, S * 0.12);
  ctx.fill();
  ctx.stroke();
  // padlock
  ctx.lineWidth = thick(S * 0.07, 7);
  ctx.beginPath();
  ctx.arc(cx, cy - S * 0.06, S * 0.13, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = grey(EDGE);
  ctx.beginPath();
  ctx.roundRect(cx - S * 0.21, cy - S * 0.06, S * 0.42, S * 0.3, S * 0.04);
  ctx.fill();
};

/** A speech bubble with every line left in. */
export const drawBubble: GlyphDraw = (ctx, w, h) => {
  const bh = h * 0.48;
  const bw = Math.min(w * 0.7, bh * 1.8);
  const x = (w - bw) / 2;
  const y = h * 0.2;
  ctx.fillStyle = grey(INSIDE);
  ctx.strokeStyle = grey(EDGE);
  ctx.lineWidth = thick(bh * 0.07);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + bw * 0.16, y + bh * 0.9);
  ctx.lineTo(x + bw * 0.1, y + bh * 1.36);
  ctx.lineTo(x + bw * 0.4, y + bh * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, bh * 0.2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = grey(0.85);
  const bar = thick(bh * 0.1);
  [0.72, 0.56, 0.36].forEach((len, i) => ctx.fillRect(x + bw * 0.14, y + bh * (0.25 + i * 0.22) - bar / 2, bw * len, bar));
};

/** A key, bow to the left. */
export const drawKey: GlyphDraw = (ctx, w, h) => {
  const L = Math.min(w * 0.66, h * 1.2);
  const r = L * 0.16;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.42);
  ctx.strokeStyle = grey(EDGE);
  ctx.lineWidth = thick(r * 0.5);
  ctx.beginPath();
  ctx.arc(-L * 0.32, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = grey(EDGE);
  const shaft = thick(r * 0.42);
  ctx.fillRect(-L * 0.32 + r, -shaft / 2, L * 0.74, shaft);
  ctx.fillRect(L * 0.24, 0, shaft, r * 1.05);
  ctx.fillRect(L * 0.24 + shaft * 1.9, 0, shaft, r * 0.8);
};

/** A terminal window with a prompt waiting. */
export const drawTerminal: GlyphDraw = (ctx, w, h) => {
  const th = h * 0.66;
  const tw = Math.min(w * 0.72, th * 1.7);
  const x = (w - tw) / 2;
  const y = (h - th) / 2;
  ctx.fillStyle = grey(INSIDE);
  ctx.strokeStyle = grey(EDGE);
  ctx.lineWidth = thick(th * 0.055);
  ctx.beginPath();
  ctx.roundRect(x, y, tw, th, th * 0.1);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = grey(0.6);
  ctx.fillRect(x, y + th * 0.22, tw, thick(th * 0.04, 5));
  // "> _"
  ctx.lineWidth = thick(th * 0.08);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x + tw * 0.14, y + th * 0.42);
  ctx.lineTo(x + tw * 0.27, y + th * 0.57);
  ctx.lineTo(x + tw * 0.14, y + th * 0.72);
  ctx.stroke();
  ctx.fillStyle = grey(EDGE);
  ctx.fillRect(x + tw * 0.36, y + th * 0.68, tw * 0.2, thick(th * 0.08));
};
