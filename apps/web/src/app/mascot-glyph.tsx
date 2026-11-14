"use client";

import { useEffect, useRef } from "react";
import { markFields } from "./mark-field";
import s from "./mascot.module.css";

/**
 * The mascot in the round, drawn only in cipher glyphs like the backdrop's figure. There is no 3D
 * library and no WebGL: for every glyph cell a ray is walked into a small scene described by
 * distance functions, and the cell gets a glyph as dense as that spot is bright.
 *
 * The figure is the mark given a body. Its outline, hollows filled in, swells into a rounded form
 * that is deepest in the middle and thins to its edges, with a solid back. The mark's own hollows
 * (the keyhole, the parting below it, the gaps between the folds of the cloak) are then cut into
 * the front of it. Seen from the front it is exactly the mark; as it turns, the hood shows its
 * side and back and the flares of the cloak stand off like arms. Glyphs drift slowly down the
 * cloth, fixed to the figure, so they turn with it.
 *
 * The first time it scrolls into view it turns to our left, the key travels in along its line of
 * sight, goes into the keyhole and turns, the eyes and the inside of the hood light up, the key
 * leaves and it faces us again. After that it looks slowly from side to side and blinks; hovering
 * it plays the key again. Under reduced motion it is drawn once, awake. Paused while off screen.
 * (mark-glyph.tsx is the earlier, flat-sided version of the same thing.)
 */

const RAMP = ".,:;'-+/\\|!*=%#&$@";
const CELL_W = 4;
const CELL_H = 6.5;
const FONT = `7px ui-monospace, "SF Mono", Menlo, monospace`;
const FRAME_MS = 1000 / 60;
const PAPER = "236,231,222";
const BRASS = "200,164,106";
const EYE = "255,223,154";
const LEVELS = 10;

/* Lengths are in the mark's own 512-unit drawing space, centred on its middle, y upwards, z
   towards the figure's front. */
const GROUND = -176; // where it stands: the mark's lowest point
const SWELL = { reach: 96, depth: 90 }; // the body is `depth` thick (each way) once `reach` in from its outline
const CARVE = 10; // the hollows are cut in from the front down to this z; behind it the body is solid
const HOLE = { y: 6, z: 42 }; // the keyhole's round part, where the eyes are
const MIDDLE = { y: 0, r: 300 }; // a ball that holds the whole figure
const KEY_SCALE = 1;
const KEY_IN = -30; // z of the key's tip when fully in: its collar then meets the front of the hood
const KEY_AWAY = 1020; // z of the tip when it is out of sight in front
const LOOK = -0.8; // how far it turns, in radians: negative is to our left, so the key comes in from the left
const CAMERA = 1750; // distance of the eye from the figure
const SPREAD = 0.15; // tangent of half the vertical field of view
const AIM_X = 0; // the figure stands in the exact middle; the canvas is wide enough to leave the key room
const FLOW = 24; // how fast the glyphs drift down the cloth, units a second

/* The show, in seconds. */
const AT = { turn: [0, 1.4], travel: [1.0, 2.9], twist: [3.0, 3.8], wake: 3.75, leave: [4.2, 5.3], back: [5.0, 6.4], end: 6.5 } as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
const span = (t: number, [from, to]: readonly [number, number]) => ease(clamp01((t - from) / (to - from)));

/* Distance functions. Each returns how far a point is from a shape (negative inside). */
const tube = (cx: number, cy: number, z: number, r: number, z0: number, z1: number) => {
  const a = Math.hypot(cx, cy) - r;
  const b = Math.max(z0 - z, z - z1);
  return Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0));
};
const block = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
  const a = Math.abs(x) - hx;
  const b = Math.abs(y) - hy;
  const c = Math.abs(z) - hz;
  return Math.min(Math.max(a, b, c), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(c, 0));
};

/** Smooth noise in space, 0..1: the pattern the drifting glyphs follow. */
const grain = (x: number, y: number, z: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const at = (i: number, j: number, k: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return mix(
    mix(mix(at(xi, yi, zi), at(xi + 1, yi, zi), sx), mix(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), sx), sy),
    mix(mix(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), sx), mix(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), sx), sy),
    sz,
  );
};

const CLOTH = 1;
const HOLLOW = 2; // the inside of the hood and of the parted cloak
const KEY = 3;
const EYES = 4;

export function MascotGlyph({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const styles = (rgb: string) => Array.from({ length: LEVELS }, (_, i) => `rgba(${rgb},${(0.34 + (0.66 * (i + 1)) / LEVELS).toFixed(2)})`);
    const ink = { [CLOTH]: styles(PAPER), [HOLLOW]: styles(BRASS), [KEY]: styles(BRASS), [EYES]: styles(EYE) } as Record<number, string[]>;

    // What the scene looks like right now (set by pose()).
    let keyZ = KEY_AWAY;
    let keyCos = 1;
    let keySin = 0;
    let keyShown = false;
    let lit = 0;
    let eyeOpen = 1;
    let kind = 0; // which thing the last call to scene() was nearest to

    const fields = markFields();
    /** The figure: the mark's outline swollen into a body, with the mark's hollows cut into its front. */
    const figure = (x: number, y: number, z: number) => {
      const edge = fields.body(x, y); // how far outside the figure's outline (negative inside)
      let d: number;
      if (edge >= 0) d = Math.hypot(edge, z);
      else {
        // Thicker the further in from the outline, levelling off: a dome over every part of it.
        const u = Math.min(-edge / SWELL.reach, 1);
        const thick = SWELL.depth * (2 * u - u * u);
        const slope = ((2 * SWELL.depth) / SWELL.reach) * (1 - u);
        d = (Math.abs(z) - thick) / Math.sqrt(1 + slope * slope);
      }
      d = Math.max(d, GROUND - y); // it stands on the ground
      kind = CLOTH;
      // The mark's hollows: inside the figure's outline but not part of the mark, from the front.
      const hollow = -Math.max(edge, -fields.mark(x, y), CARVE - z);
      if (hollow > d) {
        d = hollow;
        kind = HOLLOW;
      }
      return d;
    };
    /** The key, around its own tip, pointing away from the figure. */
    const keyAt = (x: number, y: number, z: number) => {
      const reach = Math.hypot(x, y);
      // Far from it, the distance to a tube around the whole key is close enough, and cheap.
      const out = Math.hypot(Math.max(reach - 112, 0), Math.max(-12 - z, z - 500, 0));
      if (out > 24) return out;
      const cx = x * keyCos + y * keySin; // undo the key's turn about its own shaft
      const cy = -x * keySin + y * keyCos;
      let d = tube(cx, cy, z, 44, 4, 318) - 4; // shaft, slightly rounded
      d = Math.min(d, tube(cx, cy, z, 62, 121, 139) - 3); // collar
      d = Math.min(d, block(cx, cy + 52, z - 52, 12, 31, 37)); // the bit
      d = Math.min(d, block(cx, cy + 96, z - 27, 12, 15, 12)); // its two teeth
      d = Math.min(d, block(cx, cy + 92, z - 76, 12, 10, 11));
      d = Math.min(d, Math.hypot(Math.hypot(cy, z - 386) - 78, cx) - 22); // the ring
      return d;
    };
    /** Distance from a point to the nearest surface of the whole scene, in the figure's own space. */
    const scene = (x: number, y: number, z: number) => {
      let d: number;
      const away = Math.hypot(x, y - MIDDLE.y, z);
      if (away > MIDDLE.r + 40) {
        d = away - MIDDLE.r; // far away: the ball around the figure will do
        kind = CLOTH;
      } else d = figure(x, y, z);
      if (keyShown) {
        const k = keyAt(x / KEY_SCALE, (y - HOLE.y) / KEY_SCALE, (z - keyZ) / KEY_SCALE) * KEY_SCALE;
        if (k < d) {
          d = k;
          kind = KEY;
        }
      }
      if (lit > 0) {
        // An eye is a flattened ball; scaled by its thinnest radius the distance never overshoots.
        const e = (Math.hypot((Math.abs(x) - 28) / 22, (y - HOLE.y - 6) / (12 * eyeOpen), (z - HOLE.z + 12) / 8) - 1) * 8 * Math.min(1, eyeOpen + 0.2);
        if (e < d) {
          d = e;
          kind = EYES;
        }
      }
      return d;
    };

    let cols = 0;
    let rows = 0;
    let dpr = 1;
    let padX = 0;
    let padY = 0;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      const w = Math.round(box.width);
      const h = Math.round(box.height);
      if (!w || !h) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      cols = Math.floor(w / CELL_W);
      rows = Math.floor(h / CELL_H);
      padX = (w - cols * CELL_W) / 2;
      padY = (h - rows * CELL_H) / 2;
    };

    // Turn of the figure, as the rows of the matrix that takes a view direction into its own space.
    const m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    /** Sets everything for `t` seconds into the show and `idle` seconds since it ended. Returns how solid the key is. */
    const pose = (t: number, idle: number) => {
      const turned = span(t, AT.turn) - span(t, AT.back);
      // Awake, it looks slowly from side to side; the sway eases in from nothing.
      const sway = clamp01(idle / 2.5);
      const ry = turned * LOOK + sway * Math.sin(idle * 0.42) * 0.5;
      const rx = turned * 0.04 + sway * Math.sin(idle * 0.3) * 0.035;
      const cy = Math.cos(ry);
      const sy = Math.sin(ry);
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      // The inverse (transpose) of "turn about x, then about y".
      m[0] = cy;
      m[1] = 0;
      m[2] = -sy;
      m[3] = sx * sy;
      m[4] = cx;
      m[5] = sx * cy;
      m[6] = cx * sy;
      m[7] = -sx;
      m[8] = cx * cy;

      const travelled = span(t, AT.travel);
      const left = span(t, AT.leave);
      keyShown = t > AT.travel[0] && left < 1;
      keyZ = KEY_AWAY + (KEY_IN - KEY_AWAY) * travelled + (620 - KEY_IN) * left;
      // A quarter turn clockwise, as seen by whoever holds the key (negative about the shaft, which points at us).
      const twist = (-span(t, AT.twist) * Math.PI) / 2;
      keyCos = Math.cos(twist);
      keySin = Math.sin(twist);

      lit = clamp01((t - AT.wake) / 0.4);
      // A blink: closed for a moment every six seconds.
      eyeOpen = idle > 0 && idle % 6 > 5.86 ? 0.12 : 1;
      return clamp01((t - AT.travel[0]) / 0.5) * (1 - left);
    };

    const draw = (t: number, idle: number, clock: number) => {
      const keyFade = pose(t, idle);
      const drift = clock * FLOW;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const aspect = w / h;
      // The eye's position and the light's direction, taken into the figure's space once.
      const ex = AIM_X;
      const ey = MIDDLE.y + 4;
      const ox = m[0]! * ex + m[1]! * ey + m[2]! * CAMERA;
      const oy = m[3]! * ex + m[4]! * ey + m[5]! * CAMERA;
      const oz = m[6]! * ex + m[7]! * ey + m[8]! * CAMERA;
      const sun = [-0.5, 0.6, 0.62];
      const lx = m[0]! * sun[0]! + m[1]! * sun[1]! + m[2]! * sun[2]!;
      const ly = m[3]! * sun[0]! + m[4]! * sun[1]! + m[5]! * sun[2]!;
      const lz = m[6]! * sun[0]! + m[7]! * sun[1]! + m[8]! * sun[2]!;
      const far = CAMERA + 560;
      // Where the eye is relative to the ball that holds the figure, for a quick miss test.
      const bx = ox;
      const by = oy - MIDDLE.y;
      const bz = oz;
      const ballTerm = bx * bx + by * by + bz * bz - MIDDLE.r * MIDDLE.r;
      for (let r = 0; r < rows; r++) {
        const vy = (1 - ((r + 0.5) / rows) * 2) * SPREAD;
        for (let c = 0; c < cols; c++) {
          const vx = (((c + 0.5) / cols) * 2 - 1) * SPREAD * aspect;
          const inv = 1 / Math.hypot(vx, vy, 1);
          const wx = vx * inv;
          const wy = vy * inv;
          const wz = -inv;
          const dx = m[0]! * wx + m[1]! * wy + m[2]! * wz;
          const dy = m[3]! * wx + m[4]! * wy + m[5]! * wz;
          const dz = m[6]! * wx + m[7]! * wy + m[8]! * wz;
          let at = 120;
          if (!keyShown) {
            // Only the figure is there: a ray that misses its ball hits nothing, and one that
            // meets it can start walking from where it goes in.
            const along = bx * dx + by * dy + bz * dz;
            const inside = along * along - ballTerm;
            if (inside < 0) continue;
            at = -along - Math.sqrt(inside);
          }
          // Walk along the ray by the distance to the nearest surface each time, until one is reached.
          let hit = 0;
          for (let step = 0; step < 110 && at < far; step++) {
            const d = scene(ox + dx * at, oy + dy * at, oz + dz * at);
            if (d < 1.1) {
              hit = kind;
              break;
            }
            at += d * 0.86; // the swell's distances are estimates, so step a little short
          }
          if (!hit) continue;
          const px = ox + dx * at;
          const py = oy + dy * at;
          const pz = oz + dz * at;
          let light: number;
          let tone = ink[hit]!;
          if (hit === EYES) light = lit;
          else {
            // Which way the surface faces, from how the distance changes around the point.
            const e = 2.4;
            const a = scene(px + e, py - e, pz - e);
            const b = scene(px - e, py - e, pz + e);
            const cc = scene(px - e, py + e, pz - e);
            const dd = scene(px + e, py + e, pz + e);
            let nx = a - b - cc + dd;
            let ny = -a - b + cc + dd;
            let nz = -a + b - cc + dd;
            const n = 1 / (Math.hypot(nx, ny, nz) || 1);
            nx *= n;
            ny *= n;
            nz *= n;
            const facing = Math.max(0, nx * lx + ny * ly + nz * lz);
            const edge = Math.pow(1 - Math.max(0, -(nx * dx + ny * dy + nz * dz)), 2.4); // brighter where it turns away
            if (hit === KEY) {
              // A highlight where the light bounces straight to the eye makes it read as metal.
              const hx = lx - dx;
              const hy = ly - dy;
              const hz = lz - dz;
              const shine = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / Math.hypot(hx, hy, hz)), 22);
              light = (0.34 + 0.5 * facing + 0.7 * shine + 0.3 * edge) * keyFade;
            } else if (hit === HOLLOW) {
              // Dark until it wakes, then lit from within.
              light = lit * 0.4 * Math.max(0, 1 - Math.hypot(px, py - HOLE.y, pz - HOLE.z) / 104); // only round the keyhole; the other hollows stay dark
            } else {
              light = 0.27 + 0.8 * facing + 0.5 * Math.pow(edge, 0.8);
            }
          }
          // The drifting pattern: fixed to the figure, sliding down it, so it turns with the cloth.
          const pattern = hit === KEY ? grain(px * 0.05, py * 0.05, (pz - keyZ) * 0.05 + drift * 0.02) : grain(px * 0.034, (py + drift) * 0.034, pz * 0.034);
          light = clamp01(light * (0.84 + 0.3 * pattern));
          if (light < 0.05) continue;
          const glyph = Math.max(0, Math.min(RAMP.length - 1, Math.floor(light * RAMP.length + (pattern - 0.5) * 3)));
          ctx.fillStyle = tone[Math.min(LEVELS - 1, Math.floor(light * LEVELS))]!;
          ctx.fillText(RAMP[glyph]!, padX + c * CELL_W + CELL_W / 2, padY + r * CELL_H + CELL_H / 2);
        }
      }
    };

    let visible = false;
    let frame = 0;
    let last = 0;
    let startedAt: number | null = null; // when the show began; null until it has
    let awakeAt = 0;
    const tick = (ms: number) => {
      frame = 0;
      if (ms - last >= FRAME_MS - 2) {
        last = ms;
        const now = ms / 1000;
        const t = startedAt === null ? 0 : now - startedAt;
        if (startedAt !== null && t >= AT.end && !awakeAt) awakeAt = now;
        draw(t, awakeAt ? now - awakeAt + 0.001 : 0, now);
      }
      if (visible) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      startedAt = performance.now() / 1000;
      awakeAt = 0;
      if (!frame) frame = requestAnimationFrame(tick);
    };

    resize();
    draw(still ? AT.end + 1 : 0, 0, 0);
    const resized = new ResizeObserver(() => {
      resize();
      if (still || !frame) draw(still || startedAt !== null ? AT.end + 1 : 0, 0, 0);
    });
    resized.observe(canvas);
    const watch = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (still || !visible) return;
        if (startedAt === null && entry!.intersectionRatio >= 0.75) play();
        else if (!frame) frame = requestAnimationFrame(tick); // even asleep, the glyphs drift
      },
      { threshold: [0, 0.75] },
    );
    watch.observe(canvas);
    const replay = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && !still && awakeAt) play();
    };
    canvas.addEventListener("pointerenter", replay);

    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      resized.disconnect();
      canvas.removeEventListener("pointerenter", replay);
    };
  }, []);

  return <canvas ref={ref} className={[s.glyphMascot, className ?? ""].filter(Boolean).join(" ")} aria-hidden />;
}
