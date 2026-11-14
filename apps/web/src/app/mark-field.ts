import { MARK_PATH } from "./mark";

/**
 * The mark as distance fields, for drawing it as a solid (mark-glyph.tsx, mascot-glyph.tsx).
 * Each field answers "how far is this point of the drawing from the edge of a shape?", negative
 * inside it. Coordinates are the mark's 512-unit drawing, centred, with y upwards.
 *
 * - `mark`: the mark itself.
 * - `body`: the mark with its hollows filled in (the keyhole, the parting below it and the gaps
 *   between the folds of the cloak) and carried on downwards, so it has no lower edge: the outline
 *   of the whole figure, standing on the ground.
 */
const N = 176; // samples across the drawing

/** Spreads distances out from a painted shape's edge in two sweeps, and returns a smooth lookup. */
function field(inside: Uint8Array) {
  const unit = 512 / N;
  const far = 1e6;
  const spread = (target: number) => {
    const d = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) d[i] = inside[i] === target ? 0 : far;
    const relax = (i: number, x: number, y: number, dx: number, dy: number, cost: number) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) return;
      const v = d[ny * N + nx]! + cost;
      if (v < d[i]!) d[i] = v;
    };
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        relax(i, x, y, -1, 0, 1);
        relax(i, x, y, 0, -1, 1);
        relax(i, x, y, -1, -1, 1.414);
        relax(i, x, y, 1, -1, 1.414);
      }
    for (let y = N - 1; y >= 0; y--)
      for (let x = N - 1; x >= 0; x--) {
        const i = y * N + x;
        relax(i, x, y, 1, 0, 1);
        relax(i, x, y, 0, 1, 1);
        relax(i, x, y, 1, 1, 1.414);
        relax(i, x, y, -1, 1, 1.414);
      }
    return d;
  };
  const toInside = spread(1);
  const toOutside = spread(0);
  const data = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) data[i] = (toInside[i]! - toOutside[i]!) * unit;
  return (x: number, y: number) => {
    const u = Math.max(0, Math.min(N - 1.001, ((x + 256) / 512) * N - 0.5));
    const v = Math.max(0, Math.min(N - 1.001, ((256 - y) / 512) * N - 0.5));
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const i = y0 * N + x0;
    const top = data[i]! * (1 - fx) + data[i + 1]! * fx;
    const bottom = data[i + N]! * (1 - fx) + data[i + N + 1]! * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

export function markFields() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(N / 512, N / 512);
  ctx.fill(new Path2D(MARK_PATH), "evenodd");
  const px = ctx.getImageData(0, 0, N, N).data;
  const inside = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) inside[i] = px[i * 4 + 3]! > 127 ? 1 : 0;

  // The body: in every row, everything between the mark's leftmost and rightmost point. Below the
  // mark's last row the widest of its bottom rows carries on to the edge of the drawing.
  const filled = new Uint8Array(N * N);
  let lastRow = 0;
  let baseLeft = N;
  let baseRight = -1;
  for (let y = 0; y < N; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < N; x++) {
      if (!inside[y * N + x]) continue;
      if (left < 0) left = x;
      right = x;
    }
    if (left < 0) continue;
    lastRow = y;
    for (let x = left; x <= right; x++) filled[y * N + x] = 1;
  }
  for (let y = Math.max(0, lastRow - 6); y <= lastRow; y++) {
    for (let x = 0; x < N; x++) {
      if (!filled[y * N + x]) continue;
      baseLeft = Math.min(baseLeft, x);
      baseRight = Math.max(baseRight, x);
    }
  }
  for (let y = lastRow - 6; y < N; y++) for (let x = baseLeft; x <= baseRight; x++) filled[y * N + x] = 1;

  return { mark: field(inside), body: field(filled) };
}
