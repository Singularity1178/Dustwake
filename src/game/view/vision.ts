// The golem's vision mode ("scan mode", Z): a diagnostic overlay seen through
// its eye. Presentation only. The sim owns the mode, classification and
// analysis (sim/analysis.ts: visionTargets); this file reads them and draws.
//
// - Toggling on sends a scanner sweep out from the golem to the edge of its
//   sight (its core light's radius and line of sight, the same `vis` grid the
//   lighting traces). The world desaturates and dims behind the front, and each
//   detected thing pings in as the front reaches it.
// - Highlights are holograms built from the sprite's own pixels: they follow
//   the silhouette and the texture's internal edges. Each category has its own
//   colour (unchanged) and its own treatment (content/vision.ts: HoloEffect).
// - Analysis state: anything with a plan still to read is fully animated and
//   carries a pulsing diamond; once read, it settles into a dim, still outline
//   with a check mark. The change plays the moment the scan's effect fires.
// - Toggling off collapses the holograms to a line and pulls the sight ring
//   back into the eye: about a sixth of a second. Nothing ever waits on it.
//
// Holograms are cached per (sprite composite, category, state); NPCs, whose
// art is procedural and animated, are re-traced each frame (there are few).
import { VISION_CATEGORIES, SCAN_DURATION, type Highlight, type HoloEffect } from "../content/vision";
import { TASK_KINDS } from "../content/tasks";
import { TS } from "../content/tiles";
import { propDef } from "../content/props";
import { visionTargets, type AnalysisState, type VisionTarget } from "../sim/analysis";
import { areaOf, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import type { Light } from "../light";
import { propSprite } from "../art/props";
import { itemIcon } from "../art/items";
import { rubbleSprite, doorSprite } from "../art/tiles";
import { T } from "../content/tiles";
import { ITEMS } from "../content/items";
import { drawActor } from "./actors";
import { drawText } from "../font";
import { makeCanvas, hex, clamp, Pen } from "../util";
import { drawGolem, type GolemPose } from "../golem";

// ---------------------------------------------------------------- tuning
/** Seconds for the switch-on sweep to reach the edge of sight. */
const SWEEP = 0.3;
/** Fade in / out of the whole overlay, seconds. Off is the faster of the two: getting out of the way matters most. */
const FADE_IN = 0.12, FADE_OUT = 0.16;
/** Quiet ambient re-scan ping while the mode is held. */
const PULSE_EVERY = 3.6, PULSE_DUR = 1.0;
/** Scene treatment: how much colour drains, and the dim inside / outside the sight radius. */
const DESAT = 0.6, DIM_IN = 0.3, DIM_OUT = 0.58;
const DIM_RGB = [3, 7, 16] as const;
/** The scanner itself (sweep, sight ring, beam): the golem's eye colour pushed toward white. */
const SCANNER = "#bff4ff";
const PAD = 2;

type RGB = readonly [number, number, number];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const WHITE: RGB = [255, 255, 255];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
const smooth = (x: number) => x * x * (3 - 2 * x);

interface Palette { c: RGB; light: RGB; deep: RGB }
const PALETTES = Object.fromEntries(Object.entries(VISION_CATEGORIES).map(([k, v]) => {
  const c = hex(v.color) as RGB;
  return [k, { c, light: mix(c, WHITE, 0.55), deep: mul(c, 0.5) }];
})) as Record<Highlight, Palette>;
/** Animation frames baked per effect (live state; an analyzed hologram is a single still frame). */
const FRAMES: Record<HoloEffect, number> = { radiant: 3, wireframe: 1, signal: 1, blueprint: 4 };
/** Frames per second of those baked frames. */
const FPS: Record<HoloEffect, number> = { radiant: 9, wireframe: 1, signal: 1, blueprint: 7 };

// ---------------------------------------------------------------- stamps: a target's art
type Canvas = HTMLCanvasElement;
/** One piece of a target's art at a world position (top-left). */
export interface Stamp { src: Canvas; x: number; y: number }
interface StampSet { list: Stamp[]; dynamic: boolean; sway?: { o: number; cut: number } }

/** What the host knows that the art lookup needs. */
export interface VisionArt {
  t: number;
  npcLook: (a: Actor) => { awake: number; eye: number; flare: number; reach: number };
  /** Rune circles have no sprite: their carved lines (CircleArt.glow/glowGap, CR px from the centre). */
  circle: { lines: Canvas[]; r: number };
  /** The player golem as last drawn (world px of its feet), outlined so it stays findable under highlights. */
  self?: () => { pose: GolemPose; x: number; y: number } | null;
}

let actorScratch: { sc: ReturnType<typeof makeCanvas>; ec: ReturnType<typeof makeCanvas> } | null = null;
const ACTOR_BOX = { w: 56, h: 64, fx: 28, fy: 58 };

function stampsFor(t: VisionTarget, w: World, area: Area, art: VisionArt): StampSet | null {
  if (t.source === "prop") {
    const p = area.prop(t.id);
    if (!p) return null;
    const def = propDef(p.kind);
    if (def.rune) return { list: art.circle.lines.map((src) => ({ src, x: p.x - art.circle.r, y: p.y - art.circle.r })), dynamic: false };
    const alt = def.alt === "lit" ? !!p.lit : def.alt === "taken" ? p.taken : p.open;
    const s = propSprite(p.kind, p.v, alt);
    if (!s) return null;
    const list: Stamp[] = [{ src: s.a, x: Math.round(p.x - s.ax), y: Math.round(p.y - s.ay) }];
    if (p.item && !p.container && !p.taken && ITEMS[p.item].showOnProp !== false) {
      const ic = itemIcon(p.item);
      list.push({ src: ic.a, x: Math.round(p.x + (def.itemDx ?? 0) - ic.ax), y: Math.round(p.y - (p.itemZ ?? 8) - ic.ay) });
    }
    let sway: StampSet["sway"];
    if (def.sway && !alt) {
      // the same wind the renderer applies (game.ts: drawSwaying), so the hologram stays on the leaves
      const wv = Math.sin(art.t * 1.6 + p.x * 0.031 + p.y * 0.017) + 0.4 * Math.sin(art.t * 3.7 + p.x * 0.11);
      sway = { o: Math.round(wv * 0.75), cut: Math.floor(s.h * 0.55) };
    }
    return { list, dynamic: false, sway };
  }
  if (t.source === "loose") {
    const l = area.looseItem(t.id);
    if (!l) return null;
    const ic = itemIcon(l.item);
    return { list: [{ src: ic.a, x: Math.round(l.x - ic.ax), y: Math.round(l.y + 2 - ic.ay) }], dynamic: false };
  }
  if (t.source === "tile") {
    const tx = Math.floor(t.x / TS), ty = Math.floor((t.y - 1) / TS), k = area.tile(tx, ty);
    const s = k === T.LOCKED ? doorSprite() : k === T.CRACKED ? rubbleSprite(0, true) : null;
    return s ? { list: [{ src: s.a, x: Math.round(t.x - s.ax), y: Math.round(t.y - s.ay) }], dynamic: false } : null;
  }
  const a = w.actors.find((x) => x.id === t.id);
  if (!a) return null;
  // Procedural and animated: trace this frame's drawing.
  actorScratch ??= { sc: makeCanvas(ACTOR_BOX.w, ACTOR_BOX.h), ec: makeCanvas(ACTOR_BOX.w, ACTOR_BOX.h) };
  const { sc, ec } = actorScratch;
  sc.ctx.clearRect(0, 0, ACTOR_BOX.w, ACTOR_BOX.h);
  drawActor(sc.ctx, ec.ctx, w, a, Math.round(a.x) - ACTOR_BOX.fx, Math.round(a.y) - ACTOR_BOX.fy, art.t, art.npcLook(a));
  return { list: [{ src: sc.c, x: Math.round(a.x) - ACTOR_BOX.fx, y: Math.round(a.y) - ACTOR_BOX.fy }], dynamic: true };
}

// ---------------------------------------------------------------- holograms
interface Holo {
  /** Offset of the hologram's top-left from the first stamp's position. */
  ox: number; oy: number; w: number; h: number; frames: number;
  glow: Canvas; line: Canvas; solid: Canvas;
  /** Silhouette bounds inside the hologram. */
  left: number; top: number; right: number; bottom: number;
  /** Row (hologram px) where the swaying part of a sprite ends. */
  swayCut: number;
}

const canvasIds = new WeakMap<object, number>();
let nextCanvasId = 1;
const idOf = (c: object) => { let n = canvasIds.get(c); if (!n) { n = nextCanvasId++; canvasIds.set(c, n); } return n; };
const holoCache = new Map<string, Holo>();
let traceCanvas: ReturnType<typeof makeCanvas> | null = null;

function holoKey(set: StampSet, cat: Highlight, state: "live" | "done") {
  const s0 = set.list[0];
  let k = `${cat}|${state}`;
  for (const s of set.list) k += `|${idOf(s.src)}@${s.x - s0.x},${s.y - s0.y}`;
  return k;
}

/** Reusable canvas pair for one dynamic (re-traced each frame) hologram. */
interface DynSlot { glow: ReturnType<typeof makeCanvas>; line: ReturnType<typeof makeCanvas>; solid: ReturnType<typeof makeCanvas> }

function buildHolo(set: StampSet, cat: Highlight, state: "live" | "done", reuse?: DynSlot): Holo | null {
  const s0 = set.list[0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of set.list) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.src.width); y1 = Math.max(y1, s.y + s.src.height); }
  const w = x1 - x0 + PAD * 2, h = y1 - y0 + PAD * 2;
  if (w <= PAD * 2 || h <= PAD * 2 || w > 400 || h > 400) return null;
  if (!traceCanvas || traceCanvas.c.width < w || traceCanvas.c.height < h) traceCanvas = makeCanvas(Math.max(w, traceCanvas?.c.width ?? 0), Math.max(h, traceCanvas?.c.height ?? 0));
  const tc = traceCanvas.ctx;
  tc.clearRect(0, 0, w, h);
  for (const s of set.list) tc.drawImage(s.src, s.x - x0 + PAD, s.y - y0 + PAD);
  const src = tc.getImageData(0, 0, w, h).data;
  const n = w * h, mask = new Uint8Array(n), lum = new Float32Array(n);
  let lo = 1, hi = 0, left = w, top = h, right = -1, bottom = -1;
  for (let i = 0; i < n; i++) {
    if (src[i * 4 + 3] < 150) continue; // drop soft shadows
    mask[i] = 1;
    const l = (src[i * 4] * 0.3 + src[i * 4 + 1] * 0.55 + src[i * 4 + 2] * 0.15) / 255;
    lum[i] = l; if (l < lo) lo = l; if (l > hi) hi = l;
    const x = i % w, y = (i / w) | 0;
    if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y;
  }
  if (right < 0) return null;
  const span = Math.max(0.08, hi - lo);
  for (let i = 0; i < n; i++) if (mask[i]) lum[i] = (lum[i] - lo) / span;
  const ins = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  const effect = VISION_CATEGORIES[cat].effect, P = PALETTES[cat];
  const frames = state === "done" ? 1 : FRAMES[effect];
  const mk = (cw: number, slot?: ReturnType<typeof makeCanvas>) => {
    if (slot && slot.c.width === cw && slot.c.height === h) { slot.ctx.clearRect(0, 0, cw, h); return slot; }
    if (slot) { slot.c.width = cw; slot.c.height = h; slot.ctx.imageSmoothingEnabled = false; return slot; }
    return makeCanvas(cw, h);
  };
  const glowC = mk(w * frames, reuse?.glow), lineC = mk(w * frames, reuse?.line), solidC = mk(w, reuse?.solid);
  const gImg = glowC.ctx.createImageData(w * frames, h), lImg = lineC.ctx.createImageData(w * frames, h), sImg = solidC.ctx.createImageData(w, h);
  const G = gImg.data, L = lImg.data, S = sImg.data, rw = w * frames;
  const put = (D: Uint8ClampedArray, x: number, y: number, c: RGB, a = 1) => {
    const o = (y * rw + x) * 4; D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255 * a;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, inside = mask[i] === 1;
    const n4 = ins(x - 1, y) || ins(x + 1, y) || ins(x, y - 1) || ins(x, y + 1);
    const halo = !inside && n4;
    const edge = inside && !(ins(x - 1, y) && ins(x + 1, y) && ins(x, y - 1) && ins(x, y + 1));
    // internal texture edges: where the sprite's own shading changes sharply
    const detail = inside && !edge && ((ins(x + 1, y) && Math.abs(lum[i] - lum[i + 1]) > 0.22) || (ins(x, y + 1) && Math.abs(lum[i] - lum[i + w]) > 0.22));
    if (inside) { const o = (y * w + x) * 4; S[o] = P.light[0]; S[o + 1] = P.light[1]; S[o + 2] = P.light[2]; S[o + 3] = 255; }
    if (!inside && !halo) continue;
    for (let f = 0; f < frames; f++) {
      const fx = f * w + x;
      if (state === "done") {
        // Analyzed: a calm, still trace. Same silhouette and identity, no fill, no motion.
        if (halo && (effect !== "blueprint" || ((x + y) & 3) < 2)) put(L, fx, y, P.deep, 0.85);
        if (detail) put(G, fx, y, mul(P.c, 0.2));
        continue;
      }
      const t = lum[i];
      switch (effect) {
        case "radiant":
          if (halo) put(L, fx, y, P.c);
          else if (edge) put(L, fx, y, P.light);
          else put(G, fx, y, (y + f) % 3 === 0 ? mix(P.c, P.light, 0.5 + 0.3 * t) : mul(P.c, 0.28 + 0.5 * t));
          break;
        case "wireframe":
          // the quietest treatment: interactables are the most numerous (a forest is all trees)
          if (halo) put(L, fx, y, P.c, 0.8);
          else if (edge) put(G, fx, y, mul(P.c, 0.22));
          else put(G, fx, y, detail ? mul(P.c, 0.38) : mul(P.c, 0.03 + 0.05 * t));
          break;
        case "signal":
          if (halo) put(L, fx, y, P.c);
          else if (edge) put(G, fx, y, mul(P.light, 0.6));
          else put(G, fx, y, y % 2 === 0 ? mul(P.c, 0.24 + 0.5 * t) : mul(P.c, 0.05));
          break;
        case "blueprint":
          if (halo) { if (((x + y + f) & 3) < 2) put(L, fx, y, P.c); else put(L, fx, y, P.deep, 0.7); }
          else if (x % 3 === 1 && y % 3 === 1) put(G, fx, y, mul(P.c, 0.75));
          else put(G, fx, y, detail ? mul(P.c, 0.42) : mul(P.c, 0.07));
          break;
      }
    }
  }
  glowC.ctx.putImageData(gImg, 0, 0); lineC.ctx.putImageData(lImg, 0, 0); solidC.ctx.putImageData(sImg, 0, 0);
  const swayCut = set.sway ? s0.y - y0 + PAD + set.sway.cut : 0;
  return { ox: x0 - PAD - s0.x, oy: y0 - PAD - s0.y, w, h, frames, glow: glowC.c, line: lineC.c, solid: solidC.c, left, top, right, bottom, swayCut };
}

function holoFor(set: StampSet, cat: Highlight, state: "live" | "done", slot: () => DynSlot): Holo | null {
  if (set.dynamic) return buildHolo(set, cat, state, slot());
  const key = holoKey(set, cat, state);
  let h = holoCache.get(key);
  if (h === undefined) {
    if (holoCache.size > 600) holoCache.clear(); // bounded: every entry rebuilds on demand
    h = buildHolo(set, cat, state) ?? undefined;
    if (h) holoCache.set(key, h);
  }
  return h ?? null;
}

// ---------------------------------------------------------------- the sight mask
const maskCache = new Map<number, Canvas>();
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Dim inside / outside the sight radius, with an ordered-dither falloff (the lighting's own pixel language). */
function sightMask(R: number): Canvas {
  let c = maskCache.get(R);
  if (c) return c;
  const s = R * 2 + 2, m = makeCanvas(s, s), img = m.ctx.createImageData(s, s), d = img.data, band = 14;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dist = Math.hypot(x + 0.5 - s / 2, y + 0.5 - s / 2);
    const k = clamp((dist - (R - band)) / band, 0, 1);
    const a = k * k > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 ? DIM_OUT : DIM_IN;
    const o = (y * s + x) * 4; d[o] = DIM_RGB[0]; d[o + 1] = DIM_RGB[1]; d[o + 2] = DIM_RGB[2]; d[o + 3] = a * 255;
  }
  m.ctx.putImageData(img, 0, 0);
  maskCache.set(R, m.c);
  return m.c;
}

/** Pixels of a circle (or dashed arc set) as one path: one fill call, however many pixels. */
function ringPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, step = 1, dash = 0, gap = 0, phase = 0) {
  if (r < 1) return;
  const n = Math.max(8, Math.ceil((Math.PI * 2 * r) / step));
  const period = dash + gap;
  for (let i = 0; i < n; i++) {
    if (period) { const s = (((i * step + phase) % period) + period) % period; if (s >= dash) continue; }
    const a = (i / n) * Math.PI * 2;
    ctx.rect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}

// ---------------------------------------------------------------- the view
interface Track {
  /** 0..1 visibility (in sight and swept). */
  seen: number;
  /** Seconds since it pinged in; since its analysis completed. */
  ping: number; lock: number;
  pinged: boolean;
  state?: AnalysisState;
  target: VisionTarget;
  holo: Holo | null; hx: number; hy: number;
  sway?: StampSet["sway"];
  dyn?: DynSlot;
  visited: boolean;
}

export type VisionCue =
  | { t: "on" } | { t: "off" }
  | { t: "ping"; category: Highlight; pending: boolean; n: number }
  | { t: "lock"; target: VisionTarget; x: number; y: number; w: number; h: number };

export class VisionView {
  /** Presence 0..1 of the whole overlay. */
  k = 0;
  on = false;
  /** Seconds since the last switch-on (drives the sweep and the ambient pulse). */
  sinceOn = 99;
  sinceOff = 99;
  ringR = 0;
  R = 108;
  /** Light centre (world px), refreshed each update. */
  cx = 0; cy = 0;
  tracks = new Map<string, Track>();
  focusId: string | null = null;
  focusT = 0;
  counts = { pending: 0, done: 0 };
  private pings = 0;
  private art: VisionArt | null = null;
  private selfTrace: { src: ReturnType<typeof makeCanvas>; out: ReturnType<typeof makeCanvas> } | null = null;

  /** Snap to a mode without transitions or cues (a freshly loaded world). */
  reset(on: boolean) {
    this.on = on; this.k = on ? 1 : 0; this.sinceOn = 99; this.sinceOff = 99; // already settled: no sweep, no cues
    this.tracks.clear(); this.focusId = null;
  }

  /** Advance animation and (re)build holograms as targets come into sight. Returns presentation cues (sound, particles) for the host. */
  update(dt: number, w: World, pl: Actor, light: Light, focusId: string | null, art: VisionArt): VisionCue[] {
    const cues: VisionCue[] = [];
    this.art = art;
    const on = pl.mode === "scan";
    if (on !== this.on) {
      this.on = on;
      if (on) { this.sinceOn = 0; this.pings = 0; for (const tr of this.tracks.values()) tr.pinged = false; cues.push({ t: "on" }); }
      else { this.sinceOff = 0; cues.push({ t: "off" }); }
    }
    this.sinceOn += dt; this.sinceOff += dt;
    this.k = clamp(this.k + (on ? dt / FADE_IN : -dt / FADE_OUT), 0, 1);
    this.R = light.rad; this.cx = pl.x; this.cy = pl.y - 6;
    this.ringR = on ? this.R * easeOut(Math.min(1, this.sinceOn / SWEEP)) : this.R * smooth(this.k);
    if (focusId !== this.focusId) { this.focusId = focusId; this.focusT = 0; } else this.focusT += dt;
    this.counts.pending = 0; this.counts.done = 0;
    // The readout counts kinds of thing, not copies: five wall torches in sight are one kind.
    const pendingKinds = new Set<string>(), doneKinds = new Set<string>();
    if (this.k <= 0 && !on) { this.tracks.clear(); return cues; }

    const area = areaOf(w, pl);
    for (const tr of this.tracks.values()) tr.visited = false;
    const sweeping = this.sinceOn < SWEEP + 0.05;
    for (const t of visionTargets(w, area)) {
      const dx = t.x - this.cx, dy = t.y - 4 - this.cy, d = Math.hypot(dx, dy);
      const tp = t.source === "prop" ? area.prop(t.id) : undefined, wall = !!tp && !!propDef(tp.kind).wallMounted;
      const inSight = d <= this.R && inLineOfSight(light, t.x, t.y, wall);
      let tr = this.tracks.get(t.id);
      if (!tr && !inSight) continue;
      if (!tr) { tr = { seen: 0, ping: 99, lock: 99, pinged: false, state: t.analysis, target: t, holo: null, hx: 0, hy: 0, visited: true }; this.tracks.set(t.id, tr); }
      tr.visited = true; tr.target = t;
      tr.ping += dt; tr.lock += dt;
      if (on && inSight && d <= this.ringR) {
        if (!tr.pinged) {
          tr.pinged = true; tr.ping = 0;
          if (sweeping) cues.push({ t: "ping", category: t.category, pending: t.analysis === "pending", n: this.pings++ });
        }
        tr.seen = Math.min(1, tr.seen + dt * 10);
      } else tr.seen = Math.max(0, tr.seen - dt * (on ? 5 : 0));
      if (tr.state === "pending" && t.analysis === "done") tr.lock = 0;
      const locked = tr.state === "pending" && t.analysis === "done";
      tr.state = t.analysis;
      // art and hologram (cached unless dynamic)
      if (tr.seen > 0 || tr.lock < 1) {
        const set = stampsFor(t, w, area, art);
        if (set) {
          const trk = tr;
          tr.holo = holoFor(set, t.category, t.analysis === "done" ? "done" : "live", () => (trk.dyn ??= { glow: makeCanvas(1, 1), line: makeCanvas(1, 1), solid: makeCanvas(1, 1) }));
          tr.hx = set.list[0].x + (tr.holo?.ox ?? 0); tr.hy = set.list[0].y + (tr.holo?.oy ?? 0); tr.sway = set.sway;
        } else tr.holo = null;
      }
      if (locked) {
        const h = tr.holo;
        cues.push({ t: "lock", target: t, x: h ? tr.hx + h.left : t.x - 6, y: h ? tr.hy + h.top : t.y - t.height, w: h ? h.right - h.left + 1 : 12, h: h ? h.bottom - h.top + 1 : t.height });
      }
      if (tr.seen > 0.5) { if (t.analysis === "pending") pendingKinds.add(t.kind); else if (t.analysis === "done") doneKinds.add(t.kind); }
    }
    this.counts.pending = pendingKinds.size; this.counts.done = doneKinds.size;
    for (const [id, tr] of this.tracks) if (!tr.visited || (tr.seen <= 0 && tr.lock > 1 && !on)) this.tracks.delete(id);
    return cues;
  }

  /** Draw over the lit world (view-sized world canvas, world px). */
  draw(ctx: CanvasRenderingContext2D, pl: Actor, camX: number, camY: number, W: number, H: number, t: number, eye: { x: number; y: number; w: number; show: boolean } | null) {
    if (this.k <= 0.001) return;
    const e = smooth(this.k);
    const cx = Math.round(this.cx - camX), cy = Math.round(this.cy - camY);
    ctx.save();
    // 1. the world loses its colour, then dims: lightly inside sight, heavily outside it
    ctx.globalCompositeOperation = "saturation";
    ctx.globalAlpha = DESAT * e; ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = e;
    const r = Math.round(this.ringR);
    ctx.fillStyle = css(DIM_RGB as unknown as RGB, DIM_OUT);
    if (r < 3) ctx.fillRect(0, 0, W, H);
    else {
      const m = sightMask(this.R), ds = Math.round(m.width * (r / this.R)), x0 = cx - (ds >> 1), y0 = cy - (ds >> 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(m, x0, y0, ds, ds);
      if (y0 > 0) ctx.fillRect(0, 0, W, y0);
      if (y0 + ds < H) ctx.fillRect(0, y0 + ds, W, H - y0 - ds);
      if (x0 > 0) ctx.fillRect(0, Math.max(0, y0), x0, Math.min(H, y0 + ds) - Math.max(0, y0));
      if (x0 + ds < W) ctx.fillRect(x0 + ds, Math.max(0, y0), W - x0 - ds, Math.min(H, y0 + ds) - Math.max(0, y0));
    }
    // 2. the scanner: the sweep front, then a quiet dashed ring at the edge of sight
    ctx.fillStyle = SCANNER;
    const sweepK = this.sinceOn / SWEEP;
    if (this.on && sweepK < 1.25) {
      const fade = 1 - clamp((sweepK - 0.75) / 0.5, 0, 1);
      ctx.globalAlpha = 0.95 * fade; ctx.beginPath(); ringPath(ctx, cx, cy, this.ringR); ctx.fill();
      ctx.globalAlpha = 0.4 * fade; ctx.beginPath(); ringPath(ctx, cx, cy, this.ringR - 2, 2); ctx.fill();
      ctx.globalAlpha = 0.18 * fade; ctx.beginPath(); ringPath(ctx, cx, cy, this.ringR - 5, 3); ctx.fill();
    }
    if (!this.on) {
      // collapsing back into the eye
      ctx.globalAlpha = 0.6 * e; ctx.beginPath(); ringPath(ctx, cx, cy, this.ringR); ctx.fill();
    } else {
      const settle = clamp((sweepK - 0.8) / 0.6, 0, 1);
      if (settle > 0) {
        ctx.globalAlpha = 0.3 * settle * e; ctx.beginPath(); ringPath(ctx, cx, cy, this.R, 1, 4, 5, t * 7); ctx.fill();
        // four reticle ticks drifting the other way
        ctx.globalAlpha = 0.5 * settle * e; ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4 - t * 0.12;
          for (let j = 0; j < 4; j++) ctx.rect(Math.round(cx + Math.cos(a) * (this.R - 1 - j)), Math.round(cy + Math.sin(a) * (this.R - 1 - j)), 1, 1);
        }
        ctx.fill();
      }
      // a soft re-scan ping now and then, so the mode reads as live
      const since = this.sinceOn - SWEEP - 0.6;
      if (since > 0) {
        const pk = (since % PULSE_EVERY) / PULSE_DUR;
        if (pk < 1) { ctx.globalAlpha = 0.16 * (1 - pk) * e; ctx.beginPath(); ringPath(ctx, cx, cy, this.R * easeOut(pk), 2); ctx.fill(); }
      }
    }
    // 3. holograms
    const pulseR = this.on && this.sinceOn > SWEEP + 0.6 ? (((this.sinceOn - SWEEP - 0.6) % PULSE_EVERY) / PULSE_DUR) : 2;
    const list = [...this.tracks.values()].filter((tr) => tr.holo && (tr.seen > 0 || tr.lock < 0.6)).sort((a, b) => a.target.y - b.target.y);
    const squash = this.on ? 1 : smooth(this.k);
    for (const tr of list) this.drawHolo(ctx, tr, camX, camY, t, e, squash, pulseR);
    const self = this.art?.self?.();
    if (self) this.drawSelf(ctx, self, camX, camY, e);
    // 4. scan in progress: a beam reads the target top to bottom, data streams back to the eye
    const task = pl.task;
    if (task?.kind === "scan" && task.target?.propId) {
      const tr = this.tracks.get(task.target.propId);
      if (tr?.holo && eye) this.drawScanning(ctx, tr, camX, camY, t, e, Math.min(1, task.t / TASK_KINDS.scan.fire(task.dur || SCAN_DURATION)), eye);
    }
    // 5. markers, and the lock-on reticle round what E would act on
    for (const tr of list) this.drawMarker(ctx, tr, camX, camY, t, e * squash);
    const ft = this.focusId ? this.tracks.get(this.focusId) : undefined;
    if (ft?.holo && ft.seen > 0) this.drawFocus(ctx, ft, camX, camY, t, e * ft.seen * squash);
    // 6. the eye: a bright glint on switching on, then it burns scanner-bright while the mode holds
    if (eye) {
      const ex = Math.round(eye.x - camX), ey = Math.round(eye.y - camY);
      ctx.globalCompositeOperation = "lighter";
      const g = this.on ? clamp(1 - this.sinceOn / 0.22, 0, 1) : 0;
      if (g > 0) {
        ctx.globalAlpha = g; ctx.fillStyle = SCANNER;
        const len = 1 + Math.round(4 * g);
        ctx.fillRect(ex - len, ey, len * 2 + 2, 1); ctx.fillRect(ex, ey - len, 2, len * 2 + 1);
      }
      if (eye.show) { ctx.globalAlpha = 0.85 * e; ctx.fillStyle = "#7fe8ff"; ctx.fillRect(ex - (eye.w / 2 - 1), ey, eye.w, 1); }
    }
    ctx.restore();
  }

  private drawHolo(ctx: CanvasRenderingContext2D, tr: Track, camX: number, camY: number, t: number, e: number, squash: number, pulseR: number) {
    const h = tr.holo!, cat = tr.target.category, effect = VISION_CATEGORIES[cat].effect, done = tr.state === "done";
    const x = Math.round(tr.hx - camX), y = Math.round(tr.hy - camY);
    if (x > ctx.canvas.width + 4 || y > ctx.canvas.height + 4 || x + h.w < -4 || y + h.h < -4) return;
    const focus = tr.target.id === this.focusId ? 1 : 0;
    // scanner falloff: full strength near the golem, gentler toward the edge of sight
    const dr = Math.hypot(tr.target.x - this.cx, tr.target.y - 4 - this.cy) / this.R;
    const fall = focus ? 1 : 1 - 0.45 * Math.pow(clamp((dr - 0.45) / 0.55, 0, 1), 1.5);
    // x-ray courtesy: something standing in front of the golem fades so the golem stays readable
    const px = this.cx, py = this.cy + 6;
    const front = tr.target.y > py && tr.hx + h.left <= px + 6 && tr.hx + h.right >= px - 6 && tr.hy + h.top <= py && tr.hy + h.bottom >= py - 24;
    const a = tr.seen * e * fall * (front ? 0.35 : 1), seed = hashId(tr.target.id);
    const frame = h.frames > 1 ? Math.floor(t * FPS[effect] + seed * 7) % h.frames : 0;
    // the ambient pulse brightens what it passes over
    const d = Math.hypot(tr.target.x - this.cx, tr.target.y - this.cy) / this.R;
    const pulse = pulseR <= 1 ? Math.max(0, 1 - Math.abs(d - pulseR) * 8) : 0;
    const breathe = done ? 1 : effect === "radiant" ? 0.82 + 0.18 * Math.sin(t * 3.2 + seed * 6) : tr.state === "pending" ? 0.85 + 0.15 * Math.sin(t * 4 + seed * 6) : 1;
    const glowA = clamp((done ? 0.9 : 0.8) * breathe + focus * 0.25 + pulse * 0.35, 0, 1) * a;
    const lineA = clamp((done ? 0.75 : 1) + focus * 0.2, 0, 1) * a;
    const dh = squash < 1 ? Math.max(1, Math.round(h.h * squash)) : h.h, dy = y + ((h.h - dh) >> 1);
    const sway = squash >= 1 && tr.sway?.o ? tr.sway.o : 0;
    // signal: now and then a slice of the image slips sideways
    const glitch = effect === "signal" && !done && ((t * 1.3 + seed * 5) % 2.1) < 0.12;
    const blit = (src: Canvas, sx: number) => {
      if (sway) {
        const cut = clamp(h.swayCut, 0, h.h);
        ctx.drawImage(src, sx, 0, h.w, cut, x + sway, y, h.w, cut);
        ctx.drawImage(src, sx, cut, h.w, h.h - cut, x, y + cut, h.w, h.h - cut);
      } else if (glitch) {
        const gy = Math.floor(((t * 37 + seed * 50) % 1) * Math.max(1, h.h - 6)), gh = 2 + (seed * 4 | 0), off = Math.sin(t * 90) > 0 ? 2 : -2;
        ctx.drawImage(src, sx, 0, h.w, gy, x, y, h.w, gy);
        ctx.drawImage(src, sx, gy, h.w, gh, x + off, y + gy, h.w, gh);
        ctx.drawImage(src, sx, gy + gh, h.w, h.h - gy - gh, x, y + gy + gh, h.w, h.h - gy - gh);
      } else ctx.drawImage(src, sx, 0, h.w, h.h, x, dy, h.w, dh);
    };
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = glowA; blit(h.glow, frame * h.w);
    // per-effect live accents, drawn from the silhouette
    if (!done && squash >= 1) {
      const H = h.bottom - h.top + 1;
      if (effect === "wireframe" || effect === "signal") {
        // a thin bright line rolls down through the shape (CRT roll / scan shimmer), out of step per object
        const period = effect === "signal" ? 1.6 : 3.2, k = ((t + seed * period) % period) / (period * 0.6);
        if (k < 1) { const ry = h.top + Math.floor(k * H); ctx.globalAlpha = (effect === "signal" ? 0.4 : 0.2) * a; ctx.drawImage(h.solid, 0, ry, h.w, effect === "signal" ? 2 : 1, x + sway * (ry < h.swayCut ? 1 : 0), y + ry, h.w, effect === "signal" ? 2 : 1); }
      }
    }
    if (tr.ping < 0.3) { const p = 1 - tr.ping / 0.3; ctx.globalAlpha = p * p * 0.9 * e; blit(h.solid, 0); }
    if (tr.lock < 0.5) { const p = 1 - tr.lock / 0.5; ctx.globalAlpha = p * p * e; blit(h.solid, 0); }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = lineA; blit(h.line, frame * h.w);
    if (tr.lock < 0.5) {
      // the outline echoes outward as the reading locks in
      const p = tr.lock / 0.5, o = 1 + Math.floor(p * 5);
      ctx.globalAlpha = (1 - p) * 0.7 * e;
      for (const [ox, oy] of [[o, 0], [-o, 0], [0, o], [0, -o]]) ctx.drawImage(h.line, 0, 0, h.w, h.h, x + ox, y + oy, h.w, h.h);
    }
  }

  /** A thin scanner-coloured outline round the golem itself, re-traced from this frame's pose. */
  private drawSelf(ctx: CanvasRenderingContext2D, self: { pose: GolemPose; x: number; y: number }, camX: number, camY: number, e: number) {
    const S = 48, FX = 24, FY = 42;
    this.selfTrace ??= { src: makeCanvas(S, S), out: makeCanvas(S, S) };
    const { src, out } = this.selfTrace;
    src.ctx.clearRect(0, 0, S, S);
    drawGolem(new Pen(src.ctx, false), FX, FY, self.pose);
    const d = src.ctx.getImageData(0, 0, S, S).data, img = out.ctx.createImageData(S, S), o = img.data, c = hex(SCANNER);
    const ins = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && d[(y * S + x) * 4 + 3] >= 150;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (ins(x, y) || !(ins(x - 1, y) || ins(x + 1, y) || ins(x, y - 1) || ins(x, y + 1))) continue;
      const i = (y * S + x) * 4; o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2]; o[i + 3] = 255;
    }
    out.ctx.putImageData(img, 0, 0);
    ctx.globalAlpha = 0.45 * e;
    ctx.drawImage(out.c, Math.round(self.x - camX) - FX, Math.round(self.y - camY) - FY);
  }

  private drawScanning(ctx: CanvasRenderingContext2D, tr: Track, camX: number, camY: number, t: number, e: number, k: number, eye: { x: number; y: number }) {
    const h = tr.holo!, P = PALETTES[tr.target.category];
    const x = Math.round(tr.hx - camX), y = Math.round(tr.hy - camY);
    const H = h.bottom - h.top + 1, ly = h.top + Math.min(H, Math.floor(H * k));
    ctx.globalCompositeOperation = "lighter";
    // what has been read so far glows solid behind the beam
    if (ly > h.top) { ctx.globalAlpha = 0.42 * e; ctx.drawImage(h.solid, 0, h.top, h.w, ly - h.top, x, y + h.top, h.w, ly - h.top); }
    ctx.globalAlpha = 0.95 * e; ctx.fillStyle = SCANNER;
    ctx.fillRect(x + h.left - 3, y + ly, h.right - h.left + 7, 1);
    ctx.globalAlpha = 0.35 * e; ctx.fillRect(x + h.left - 1, y + ly - 1, h.right - h.left + 3, 1);
    // data streaming home along a dotted line to the eye
    const sx = x + ((h.left + h.right) >> 1), sy = y + ly, ex = Math.round(eye.x - camX), ey = Math.round(eye.y - camY);
    const len = Math.hypot(ex - sx, ey - sy);
    if (len > 6) {
      ctx.fillStyle = css(P.light); ctx.beginPath();
      const ph = (t * 30) % 4;
      for (let s = ph; s < len - 2; s += 4) ctx.rect(Math.round(sx + (ex - sx) * s / len), Math.round(sy + (ey - sy) * s / len), 1, 1);
      ctx.globalAlpha = 0.55 * e; ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawMarker(ctx: CanvasRenderingContext2D, tr: Track, camX: number, camY: number, t: number, e: number) {
    if (!tr.state || !tr.holo) return;
    const h = tr.holo, P = PALETTES[tr.target.category];
    const mx = Math.round(tr.hx - camX + (h.left + h.right) / 2), top = Math.round(tr.hy - camY + h.top);
    const a = tr.seen * e;
    if (tr.state === "pending") {
      // still something to learn: a diamond that pulses and bobs above it
      const seed = hashId(tr.target.id), bob = Math.round(Math.sin(t * 3 + seed * 6) * 1);
      const y = top - 6 + bob, beat = 0.5 + 0.5 * Math.sin(t * 5 + seed * 6);
      ctx.globalAlpha = a; ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(mx - 2, y - 1, 5, 5); // a dark key so it reads on anything
      ctx.fillStyle = css(P.light);
      ctx.fillRect(mx, y - 2, 1, 1); ctx.fillRect(mx - 1, y - 1, 1, 1); ctx.fillRect(mx + 1, y - 1, 1, 1);
      ctx.fillRect(mx - 2, y, 1, 1); ctx.fillRect(mx + 2, y, 1, 1);
      ctx.fillRect(mx - 1, y + 1, 1, 1); ctx.fillRect(mx + 1, y + 1, 1, 1); ctx.fillRect(mx, y + 2, 1, 1);
      ctx.globalAlpha = a * (0.35 + 0.65 * beat); ctx.fillStyle = "#ffffff"; ctx.fillRect(mx, y, 1, 1);
    } else {
      // read: a small still check mark, the hologram's own colour dimmed
      const y = top - 5, p = tr.lock < 0.5 ? 1 - tr.lock / 0.5 : 0;
      ctx.globalAlpha = a; ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(mx - 3, y - 2, 7, 6);
      ctx.fillStyle = p > 0 ? "#ffffff" : css(mix(P.c, P.deep, 0.3));
      ctx.globalAlpha = a * (p > 0 ? 1 : 0.9);
      ctx.fillRect(mx - 2, y + 1, 1, 1); ctx.fillRect(mx - 1, y + 2, 1, 1); ctx.fillRect(mx, y + 1, 1, 1); ctx.fillRect(mx + 1, y, 1, 1); ctx.fillRect(mx + 2, y - 1, 1, 1);
    }
  }

  private drawFocus(ctx: CanvasRenderingContext2D, tr: Track, camX: number, camY: number, t: number, a: number) {
    const h = tr.holo!, P = PALETTES[tr.target.category];
    const k = easeOut(Math.min(1, this.focusT / 0.16)), o = Math.round((1 - k) * 6) + 2 + (Math.sin(t * 6) > 0.6 ? 1 : 0);
    const x0 = Math.round(tr.hx - camX) + h.left - o, y0 = Math.round(tr.hy - camY) + h.top - o;
    const x1 = Math.round(tr.hx - camX) + h.right + o, y1 = Math.round(tr.hy - camY) + h.bottom + o;
    ctx.globalAlpha = a * k; ctx.fillStyle = css(tr.state === "done" ? P.c : P.light);
    const L = 3;
    ctx.fillRect(x0, y0, L, 1); ctx.fillRect(x0, y0, 1, L);
    ctx.fillRect(x1 - L + 1, y0, L, 1); ctx.fillRect(x1, y0, 1, L);
    ctx.fillRect(x0, y1, L, 1); ctx.fillRect(x0, y1 - L + 1, 1, L);
    ctx.fillRect(x1 - L + 1, y1, L, 1); ctx.fillRect(x1, y1 - L + 1, 1, L);
  }

  /** A compact readout on the UI layer: kinds of thing with plans still to read, and kinds already read, within sight. */
  drawHud(ctx: CanvasRenderingContext2D, W: number) {
    const e = smooth(this.k);
    if (e <= 0.01 || (!this.counts.pending && !this.counts.done)) return;
    ctx.save();
    ctx.globalAlpha = e;
    const P = PALETTES.buildable, y = 7;
    let x = W - 6;
    const item = (n: number, icon: (x: number) => void, col: string) => {
      const s = String(n);
      drawText(ctx, s, x + 1, y + 1, "#000", 1, "right"); drawText(ctx, s, x, y, col, 1, "right");
      x -= s.length * 4 + 6; icon(x); x -= 6;
    };
    if (this.counts.done) item(this.counts.done, (ix) => {
      ctx.fillStyle = css(P.deep);
      ctx.fillRect(ix - 2, y + 2, 1, 1); ctx.fillRect(ix - 1, y + 3, 1, 1); ctx.fillRect(ix, y + 2, 1, 1); ctx.fillRect(ix + 1, y + 1, 1, 1); ctx.fillRect(ix + 2, y, 1, 1);
    }, css(mix(P.c, P.deep, 0.4)));
    if (this.counts.pending) item(this.counts.pending, (ix) => {
      ctx.fillStyle = css(P.light);
      ctx.fillRect(ix, y, 1, 1); ctx.fillRect(ix - 1, y + 1, 1, 1); ctx.fillRect(ix + 1, y + 1, 1, 1); ctx.fillRect(ix - 2, y + 2, 1, 1);
      ctx.fillRect(ix + 2, y + 2, 1, 1); ctx.fillRect(ix - 1, y + 3, 1, 1); ctx.fillRect(ix + 1, y + 3, 1, 1); ctx.fillRect(ix, y + 4, 1, 1);
    }, css(P.light));
    ctx.restore();
  }
}

/**
 * Line of sight from the golem's light: its traced visibility grid (light.ts:
 * computeVis), at the target's tile or the one above it. Wall-mounted props sit
 * on an opaque wall tile, so the floor in front of the wall counts for them.
 */
function inLineOfSight(L: Light, x: number, y: number, wallMounted = false) {
  if (!L.n) return false;
  const tx = Math.floor(x / TS) - L.ox;
  for (const yy of wallMounted ? [y - 1, y + TS / 2] : [y - 1, y - 1 - TS]) {
    const ty = Math.floor(yy / TS) - L.oy;
    if (tx >= 0 && ty >= 0 && tx < L.n && ty < L.n && L.vis[ty * L.n + tx] > 0) return true;
  }
  return false;
}

function hashId(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}
