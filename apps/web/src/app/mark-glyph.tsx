"use client";

import { useEffect, useRef } from "react";
import { markFields } from "./mark-field";
import s from "./mascot.module.css";

/**
 * The mark itself as a solid object drawn only in cipher glyphs: its outline pushed back into a
 * rounded slab, with a round-shafted key. (The hooded figure in the round is MascotGlyph; this is
 * the logo-shaped one, kept for places where the logo should be recognisable, such as waiting for
 * a reply or for the enclave check in Truly private mode.)
 *
 * There is no 3D library and no WebGL: for every glyph cell a ray is walked into a small scene
 * described by distance functions, and the cell gets a glyph as dense as that spot is bright.
 *
 * The first time it scrolls into view it turns to look to our right, the key travels in along its
 * line of sight, goes into the keyhole and turns, the eyes and the inside of the hood light up,
 * the key leaves and it faces us again. After that it sways slightly and blinks; hovering it plays
 * the key again. With `loop` the key comes back again and again, for a waiting state. Under
 * reduced motion it is drawn once, awake. Paused while off screen.
 */

const RAMP = ".,:;'-+/\\|!*=%#&$@";
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;
/* The glyph grid. `fine` is for small sizes (a waiting state): smaller glyphs, so the mark keeps its shape. */
const GRID = { normal: { w: 4, h: 6.5, font: `7px ${MONO}` }, fine: { w: 2.5, h: 4.1, font: `4.4px ${MONO}` } } as const;
const FPS = 30;
const PAPER = "236,231,222";
const BRASS = "200,164,106";
const EYE = "255,223,154";
const LEVELS = 8;

/* Lengths are in the mark's own 512-unit drawing space, centred on its middle, y upwards. */
const HALF = 62; // half the hood's depth
const ROUND = 20; // radius of its rounded edges
const HOLE_Y = 6; // height of the keyhole's round part
const KEY_IN = -44; // z of the key's tip when fully in: its collar then meets the hood's front
const KEY_AWAY = 980; // z of the tip when it is out of sight in front
const LOOK = 0.62; // how far it turns to our right, in radians
const CAMERA = 1750; // distance of the eye from the figure
const SPREAD = 0.158; // tangent of half the vertical field of view
const AIM_X = 70; // the view is centred a little to the figure's right, leaving room for the key

/* The show, in seconds. */
const AT = { turn: [0, 0.9], travel: [0.6, 2.0], twist: [2.1, 2.75], wake: 2.7, leave: [3.05, 3.9], back: [3.6, 4.6], end: 4.7 } as const;
const LOOP_REST = 1.6; // seconds awake between two plays when looping

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
const span = (t: number, [from, to]: readonly [number, number]) => ease(clamp01((t - from) / (to - from)));

const HOOD = 1;
const KEY = 2;
const EYES = 3;

/* The two waiting states. */
const KEY_SIZE = 0.86; // the key alone is drawn a little smaller, so it clears the frame at every angle
const KEY_FAT = 7; // and a little stouter all round, so it stays a solid thing at a small size
const KEY_MIDDLE = 232; // how far along its own length the key's middle is
const SPIN = 5.4; // radians a second
const AXIS_HOLD = 0.8; // seconds it spins about one axis
const AXIS_SHIFT = 0.7; // seconds it takes to lean over to the next one
const R2 = Math.SQRT1_2;
// The axes it spins about in turn, in the view's own directions (x right, y up, z towards us).
const AXES: readonly (readonly [number, number, number])[] = [[0, 1, 0], [1, 0, 0], [R2, R2, 0], [0, 0, 1], [0, R2, R2], [R2, 0, R2]];

/**
 * `waiting="key"`: no figure, only the brass key, spinning about one axis and then leaning over
 * smoothly to spin about another. `waiting="look"`: no key, the mark awake, looking slowly from
 * side to side. Both run for as long as they are on screen.
 */
export function MarkGlyph({
  className,
  loop = false,
  fine = false,
  waiting,
}: {
  className?: string;
  loop?: boolean;
  fine?: boolean;
  waiting?: "key" | "look";
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const { w: CELL_W, h: CELL_H, font: FONT } = fine ? GRID.fine : GRID.normal;
    const aimX = waiting ? 0 : AIM_X;
    const spread = waiting === "key" ? 0.132 : SPREAD; // the key alone is seen a little closer
    const fps = waiting ? 60 : FPS;
    const born = performance.now() / 1000;
    // The key's own turn while it waits: a quaternion (w, x, y, z), starting with the key lying across the view.
    const spin = [R2, 0, R2, 0];
    let spunAt = 0;
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const outline = markFields().mark;
    const styles = (rgb: string) => Array.from({ length: LEVELS }, (_, i) => `rgba(${rgb},${(0.3 + (0.7 * (i + 1)) / LEVELS).toFixed(2)})`);
    const ink = { [HOOD]: styles(PAPER), [KEY]: styles(BRASS), [EYES]: styles(EYE) } as Record<number, string[]>;

    // What the scene looks like right now (set by pose()).
    let keyZ = KEY_AWAY;
    let keyCos = 1;
    let keySin = 0;
    let keyShown = false;
    let lit = 0;
    let eyeOpen = 1;
    let kind = 0; // which thing the last call to scene() was nearest to

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
    /** Distance to the key. Its tip is at (0, HOLE_Y, keyZ) and it points away from the figure. */
    const keyDist = (x: number, y: number, z: number) => {
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
      const r2 = x * x + y * y + z * z;
      if (waiting === "key") {
        kind = KEY;
        if (r2 > 300 * 300) return Math.sqrt(r2) - 262;
        return keyDist(x / KEY_SIZE, y / KEY_SIZE, z / KEY_SIZE + KEY_MIDDLE) * KEY_SIZE - KEY_FAT;
      }
      if (r2 > 330 * 330) d = Math.sqrt(r2) - 300; // far away: a ball around the hood will do
      else {
        const a = outline(x, y) + ROUND;
        const b = Math.abs(z) - (HALF - ROUND);
        d = Math.min(Math.max(a, b), 0) + Math.hypot(Math.max(a, 0), Math.max(b, 0)) - ROUND;
      }
      kind = HOOD;
      if (keyShown) {
        const k = keyDist(x, y - HOLE_Y, z - keyZ);
        if (k < d) {
          d = k;
          kind = KEY;
        }
      }
      if (lit > 0) {
        for (const side of [-1, 1]) {
          // An eye is a flattened ball; scaled by its thinnest radius the distance never overshoots.
          const e = (Math.hypot((x - side * 28) / 22, (y - 12) / (12 * eyeOpen), (z + 6) / 8) - 1) * 8 * Math.min(1, eyeOpen + 0.2);
          if (e < d) {
            d = e;
            kind = EYES;
          }
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
    const pose = (t: number, sway: number) => {
      if (waiting === "key") {
        const clock = still ? 0.6 : performance.now() / 1000 - born;
        const step = Math.min(0.05, Math.max(0, clock - spunAt));
        spunAt = clock;
        // Which axis: hold one, then lean over to the next.
        const stretch = AXIS_HOLD + AXIS_SHIFT;
        const turn = Math.floor(clock / stretch);
        const lean = ease(clamp01((clock - turn * stretch - AXIS_HOLD) / AXIS_SHIFT));
        const from = AXES[turn % AXES.length]!;
        const to = AXES[(turn + 1) % AXES.length]!;
        let ax = from[0] + (to[0] - from[0]) * lean;
        let ay = from[1] + (to[1] - from[1]) * lean;
        let az = from[2] + (to[2] - from[2]) * lean;
        const len = 1 / (Math.hypot(ax, ay, az) || 1);
        ax *= len;
        ay *= len;
        az *= len;
        // Turn a little further about it (a small rotation applied in front of the turn so far).
        const half = (SPIN * step) / 2;
        const sn = Math.sin(half);
        const [qw, qx, qy, qz] = spin as [number, number, number, number];
        const dw = Math.cos(half);
        const dx = ax * sn;
        const dy = ay * sn;
        const dz = az * sn;
        let w = dw * qw - dx * qx - dy * qy - dz * qz;
        let x = dw * qx + dx * qw + dy * qz - dz * qy;
        let y = dw * qy - dx * qz + dy * qw + dz * qx;
        let z = dw * qz + dx * qy - dy * qx + dz * qw;
        const n = 1 / Math.hypot(w, x, y, z);
        w *= n;
        x *= n;
        y *= n;
        z *= n;
        spin[0] = w;
        spin[1] = x;
        spin[2] = y;
        spin[3] = z;
        // The matrix that takes a view direction into the key's own space: the turn, transposed.
        m[0] = 1 - 2 * (y * y + z * z);
        m[1] = 2 * (x * y + w * z);
        m[2] = 2 * (x * z - w * y);
        m[3] = 2 * (x * y - w * z);
        m[4] = 1 - 2 * (x * x + z * z);
        m[5] = 2 * (y * z + w * x);
        m[6] = 2 * (x * z + w * y);
        m[7] = 2 * (y * z - w * x);
        m[8] = 1 - 2 * (x * x + y * y);
        keyShown = true;
        keyCos = 1;
        keySin = 0;
        lit = 0;
        return 1;
      }
      const looking = waiting === "look";
      const clock = looking ? (still ? 0 : performance.now() / 1000 - born) : 0;
      const turned = span(t, AT.turn) - span(t, AT.back);
      // Looking: a slow, even turn from one side to the other and back.
      const ry = looking ? Math.sin(clock * 1.15) * 0.78 : turned * LOOK + Math.sin(sway * 0.7) * 0.11;
      const rx = looking ? Math.sin(clock * 0.6) * 0.04 : turned * 0.05 + Math.sin(sway * 0.5) * 0.03;
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
      keyZ = KEY_AWAY + (KEY_IN - KEY_AWAY) * travelled + (560 - KEY_IN) * left;
      const twist = (span(t, AT.twist) * Math.PI) / 2;
      keyCos = Math.cos(twist);
      keySin = Math.sin(twist);
      const keyFade = clamp01((t - AT.travel[0]) / 0.4) * (1 - left);

      lit = clamp01((t - AT.wake) / 0.3);
      // A blink: closed for a moment every five and a half seconds.
      eyeOpen = sway > 0 && sway % 5.5 > 5.36 ? 0.12 : 1;
      if (looking) {
        keyShown = false;
        lit = 1;
        eyeOpen = clock % 4.6 > 4.46 ? 0.12 : 1;
      }
      return keyFade;
    };

    const draw = (t: number, sway: number) => {
      const keyFade = pose(t, sway);
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const aspect = w / h;
      // The eye's position and the light's direction, taken into the figure's space once.
      const ox = m[0]! * aimX + m[2]! * CAMERA;
      const oy = m[3]! * aimX + m[5]! * CAMERA;
      const oz = m[6]! * aimX + m[8]! * CAMERA;
      const sun = [-0.48, 0.62, 0.62];
      const lx = m[0]! * sun[0]! + m[1]! * sun[1]! + m[2]! * sun[2]!;
      const ly = m[3]! * sun[0]! + m[4]! * sun[1]! + m[5]! * sun[2]!;
      const lz = m[6]! * sun[0]! + m[7]! * sun[1]! + m[8]! * sun[2]!;
      const far = CAMERA + 520;
      for (let r = 0; r < rows; r++) {
        const vy = (1 - ((r + 0.5) / rows) * 2) * spread;
        for (let c = 0; c < cols; c++) {
          const vx = (((c + 0.5) / cols) * 2 - 1) * spread * aspect;
          const inv = 1 / Math.hypot(vx, vy, 1);
          const wx = vx * inv;
          const wy = vy * inv;
          const wz = -inv;
          const dx = m[0]! * wx + m[1]! * wy + m[2]! * wz;
          const dy = m[3]! * wx + m[4]! * wy + m[5]! * wz;
          const dz = m[6]! * wx + m[7]! * wy + m[8]! * wz;
          // Walk along the ray by the distance to the nearest surface each time, until one is reached.
          let at = 120;
          let hit = 0;
          for (let step = 0; step < 72 && at < far; step++) {
            const d = scene(ox + dx * at, oy + dy * at, oz + dz * at);
            if (d < 1.1) {
              hit = kind;
              break;
            }
            at += d;
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
              // On its own the key gets more light on its shadow side: at a small size a dim side
              // drops out and the key reads as a thin line instead of the stout thing it is.
              light = waiting === "key" ? 0.56 + 0.4 * facing + 0.6 * shine + 0.2 * edge : (0.34 + 0.5 * facing + 0.7 * shine + 0.3 * edge) * keyFade;
            } else {
              light = 0.3 + 0.62 * facing + 0.36 * edge;
              // Once awake, the inside of the keyhole is lit from within.
              const glow = lit * Math.max(0, 1 - Math.hypot(px, py - HOLE_Y, pz - 10) / 135);
              if (glow > 0.12) {
                light += glow * 0.7;
                tone = ink[KEY]!;
              }
            }
          }
          light = clamp01(light);
          if (light < 0.04) continue;
          // One cell in five takes a glyph a step denser or lighter, fixed per cell, so an evenly lit
          // face is a texture of mixed glyphs and not a hatch of one.
          const mix = ((Math.imul(c, 73856093) ^ Math.imul(r, 19349663)) >>> 0) % 10;
          const step = mix === 0 ? -2 : mix === 1 ? 2 : mix === 2 ? -1 : mix === 3 ? 1 : 0;
          const glyph = Math.max(0, Math.min(RAMP.length - 1, Math.floor(light * RAMP.length) + step));
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
      if (ms - last >= 1000 / fps - 1) {
        last = ms;
        const now = ms / 1000;
        let t = startedAt === null ? 0 : now - startedAt;
        if (loop && t >= AT.end + LOOP_REST) {
          startedAt = now; // waiting: send the key in again
          awakeAt = 0;
          t = 0;
        }
        if (startedAt !== null && t >= AT.end && !awakeAt) awakeAt = now;
        draw(t, awakeAt ? now - awakeAt + 0.001 : 0);
      }
      if (visible && startedAt !== null) frame = requestAnimationFrame(tick);
    };
    const play = () => {
      startedAt = performance.now() / 1000;
      awakeAt = 0;
      if (!frame) frame = requestAnimationFrame(tick);
    };

    resize();
    if (still) draw(AT.end + 1, 0);
    else draw(0, 0); // asleep, facing us, until it is properly on screen
    const resized = new ResizeObserver(() => {
      resize();
      if (still) draw(AT.end + 1, 0);
      else if (!frame) draw(startedAt === null ? 0 : AT.end + 1, 0);
    });
    resized.observe(canvas);
    const watch = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (still || !visible) return;
        if (startedAt === null) {
          if (waiting || entry!.intersectionRatio >= 0.8) play();
        } else if (!frame) frame = requestAnimationFrame(tick);
      },
      { threshold: [0, 0.8] },
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
  }, [loop, fine, waiting]);

  return <canvas ref={ref} className={[s.glyphMascot, className ?? ""].filter(Boolean).join(" ")} aria-hidden />;
}
