// Cards drawn on the UI layer: the title screen, and the two the crossing
// uses (screens/crossing.ts): the transit, a cross-section of the golem's
// climb from the halls to the surface, and the chapter card laid over the
// living world at its end. Pure drawing from the state passed in.

import { relicCount } from "../sim/discovery";
import type { World, Actor } from "../world/world";
import { drawGolem, type GolemPose } from "../golem";
import { drawText, drawTextS } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { Pen, hash2, clamp } from "../util";

/** What the cards read of a particle (screen-space motes and embers). */
export interface CardMote { x: number; y: number; life: number; col: string }

/** Title card. `t` is the presentation clock. */
export function renderTitle(ctx: CanvasRenderingContext2D, t: number, particles: readonly CardMote[]) {
  ctx.fillStyle = "#060508"; ctx.fillRect(0, 0, W, H);
  // dithered vignette glow
  for (let y = 0; y < H; y += 1) for (let x = (y & 1); x < W; x += 2) {
    const d = Math.hypot((x - W / 2) / W, (y - 70) / H);
    if (hash2(x, y, 1) > d * 2.2) { ctx.fillStyle = "#120e16"; ctx.fillRect(x, y, 1, 1); }
  }
  for (const p of particles) { ctx.fillStyle = p.col; ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
  ctx.globalAlpha = 1;
  const ty = 46;
  drawText(ctx, "DUSTWAKE", W / 2 + 2, ty + 2, "#000", 5, "center");
  drawText(ctx, "DUSTWAKE", W / 2, ty, "#4b4552", 5, "center");
  drawText(ctx, "DUSTWAKE", W / 2, ty - 1, "#8a8392", 5, "center");
  ctx.fillStyle = "#4b4552";
  for (let i = 0; i < 40; i++) { const x = W / 2 - 78 + ((hash2(i, 3, 3) * 156) | 0), y = ty - 1 + ((hash2(i, 4, 3) * 25) | 0); ctx.fillRect(x, y, 1, 1); }
  // eye
  const blink = Math.sin(t * 1.7) > -0.95;
  if (blink) { ctx.fillStyle = "#7fe8ff"; ctx.fillRect(W / 2 - 3, ty + 34, 6, 1); ctx.fillStyle = "#2a6a7a"; ctx.fillRect(W / 2 - 5, ty + 34, 2, 1); ctx.fillRect(W / 2 + 3, ty + 34, 2, 1); }
  // controls
  const key = (x: number, y: number, s: string, w = 9) => {
    ctx.fillStyle = "#08070a"; ctx.fillRect(x - 1, y - 1, w + 2, 11);
    ctx.fillStyle = "#3a3540"; ctx.fillRect(x, y, w, 9);
    ctx.fillStyle = "#4e4856"; ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = "#1a171e"; ctx.fillRect(x, y + 8, w, 1);
    drawText(ctx, s, x + w / 2, y + 2, "#c8c0b0", 1, "center");
  };
  const cy = 112;
  key(90, cy, "W"); key(80, cy + 11, "A"); key(90, cy + 11, "S"); key(100, cy + 11, "D");
  drawText(ctx, "MOVE", 95, cy + 25, "#6a6372", 1, "center");
  key(150, cy + 11, "E");
  drawText(ctx, "USE", 155, cy + 25, "#6a6372", 1, "center");
  key(200, cy + 11, "I"); key(212, cy + 11, "TAB", 17);
  drawText(ctx, "PACK", 213, cy + 25, "#6a6372", 1, "center");
  if (Math.sin(t * 3) > -0.3) drawText(ctx, "PRESS ANY KEY", W / 2, 164, "#8a8392", 1, "center");
}

/** What the transit card needs of the crossing's clock and of the golem (screens/crossing.ts). */
export interface TransitView {
  /** Seconds since the transit began. */
  et: number;
  /** When the climb stalls under the surface, when the rewrite begins, and when the card cuts to the world. */
  stallAt: number; rewriteAt: number; endAt: number;
  /** The white of the jump clears over this long. */
  whiteOut: number;
  hasArm: boolean; eyeFixed: boolean;
}

/** The climb: how deep it starts (px below the grass), where it stalls, the golem's row on screen, the room's height. */
export const TRANSIT = { deep: 640, hold: 30, gy: 112, room: 72 } as const;

/**
 * The golem's depth below the grass (px) for a transit clock. It stands a moment in the room it is leaving, then
 * climbs, fast at first and slowing all the way to the stall, so each layer of the earth is on screen long enough
 * to be read: the keep's masonry, the rock with the upper halls fallen into it, clay and roots, topsoil.
 */
export function transitDepth(v: Pick<TransitView, "et" | "stallAt">): number {
  const k = clamp((v.et - 0.5) / (v.stallAt - 0.5), 0, 1);
  return TRANSIT.deep + (TRANSIT.hold - TRANSIT.deep) * (1 - (1 - k) ** 1.7);
}

/** How much of the far ring has been written back (0..1) at a transit clock. */
export const transitRewrite = (v: Pick<TransitView, "et" | "rewriteAt" | "endAt">) => clamp((v.et - v.rewriteAt) / Math.max(0.1, v.endAt - v.rewriteAt - 0.4), 0, 1);

/** The forest's edge against the sky, px above the grass at column x (low over the clearing the rune lies in). */
const treeLine = (x: number) => {
  const h = 9 + 17 * Math.abs(Math.sin(x * 0.045 + 1.3)) * (0.6 + 0.4 * Math.sin(x * 0.21)) + hash2(x >> 2, 3, 44) * 7;
  return Math.abs(x - W / 2) < 62 ? h * 0.12 : h;
};

/**
 * The transit: a cross-section of the earth, scrolling down past the golem as
 * it rises in the rune's column of light. From the bottom up: the translocation
 * room it left (its circle still lit), the keep's masonry, rock with the fallen
 * upper halls in it, clay, roots, topsoil, grass, and the last of the night
 * over the forest. It stalls just under the grass, where the rune it is bound
 * for shows as a broken ring; the rewrite draws the ring whole. `t` is the
 * presentation clock.
 */
export function renderTransit(ctx: CanvasRenderingContext2D, t: number, v: TransitView) {
  const T = TRANSIT, depth = transitDepth(v), stalled = v.et >= v.stallAt, p = transitRewrite(v);
  const jolt = stalled && v.et < v.stallAt + 0.45 ? Math.round(Math.sin(t * 90) * 2) : 0;
  const cx = W / 2 + jolt, roomTop = T.deep - T.room;
  // ---- the earth, in 2px rows. Textures are hashed on world rows, so they scroll with the climb.
  for (let sy = 0; sy < H; sy += 2) {
    const d = depth + (sy - T.gy), wy = Math.floor(d / 2);
    if (d < 0) {
      const h = -d;
      ctx.fillStyle = h > 64 ? "#0a0c22" : h > 30 ? "#10132c" : "#181a38";
      ctx.fillRect(0, sy, W, 2);
      for (let i = 0; i < 2; i++) if (hash2(wy, i, 41) < 0.55) { ctx.fillStyle = hash2(wy, i, 42) < 0.3 ? "#e8e8ff" : "#7a7aa8"; ctx.fillRect((hash2(wy, i, 43) * W) | 0, sy, 1, 1); }
      if (h < 36) { ctx.fillStyle = "#06070d"; for (let sx = 0; sx < W; sx += 2) if (treeLine(sx) > h) ctx.fillRect(sx, sy, 2, 2); }
      continue;
    }
    const masonry = d >= roomTop - 44;
    let base: string, fleck: string, stone: string, pf: number, ps: number;
    if (d < 3) { base = "#27421f"; fleck = "#35562a"; stone = fleck; pf = 0.3; ps = 0; }
    else if (d < 46) { base = "#231a12"; fleck = "#30241a"; stone = "#4a4038"; pf = 0.2; ps = 0.012; }
    else if (d < 210) { base = "#1b1613"; fleck = "#251e19"; stone = "#3a3530"; pf = 0.16; ps = 0.02; }
    else if (!masonry) { base = "#15141b"; fleck = "#1e1d27"; stone = "#2c2a36"; pf = 0.14; ps = 0.03; }
    else { base = wy % 4 === 0 ? "#0f0e14" : "#1a1822"; fleck = "#211f2a"; stone = base; pf = 0.1; ps = 0; }
    ctx.fillStyle = base; ctx.fillRect(0, sy, W, 2);
    for (let sx = 0; sx < W; sx += 2) {
      const r = hash2(sx >> 1, wy, 45);
      if (r < pf) { ctx.fillStyle = fleck; ctx.fillRect(sx, sy, 2, 2); }
      else if (r > 1 - ps) { ctx.fillStyle = stone; ctx.fillRect(sx, sy, 4, 2); }
      // the keep's courses: staggered joints
      if (masonry && wy % 4 !== 0 && ((sx >> 1) + ((wy >> 2) & 1) * 6) % 12 === 0) { ctx.fillStyle = "#0f0e14"; ctx.fillRect(sx, sy, 2, 2); }
    }
    // the upper halls, fallen in and buried: dressed blocks adrift in the rock
    if (!masonry && d > 250) for (let bx = 0; bx < W; bx += 16) if (hash2(bx >> 4, wy >> 2, 46) > 0.87) { ctx.fillStyle = (wy & 3) === 0 ? "#3a3745" : "#2a2733"; ctx.fillRect(bx + 1, sy, 14, 2); }
    // roots, reaching down from the forest
    if (d < 150) for (let rx = 6; rx < W; rx += 14) {
      if (hash2(rx, 2, 47) > 0.7 || d > 30 + hash2(rx, 1, 47) * 110) continue;
      ctx.fillStyle = d < 46 ? "#4a3826" : "#3a2c1e";
      ctx.fillRect(rx + Math.round(Math.sin(d * 0.16 + rx) * 2 + hash2(rx, 3, 47) * 8), sy, d < 20 ? 2 : 1, 2);
    }
    // the translocation room: where the climb began
    if (d >= roomTop && d < T.deep) {
      ctx.fillStyle = "#0c0b11"; ctx.fillRect(cx - 96, sy, 192, 2);
      ctx.fillStyle = "#24212c"; ctx.fillRect(cx - 75, sy, 6, 2); ctx.fillRect(cx + 69, sy, 6, 2);
    }
  }
  const ring = (y: number, rx: number, ry: number, n: number, draw: (i: number, a: number, x: number, y: number) => void) => {
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; draw(i, a, Math.round(cx + Math.cos(a) * rx), Math.round(y + Math.sin(a) * ry)); }
  };
  // ---- the circle it left by, on the room's floor: whole, and lit
  const floorY = T.gy + (T.deep - depth);
  if (floorY < H + 12) {
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 5);
    ctx.fillStyle = "#a070ff"; ring(floorY, 56, 8, 64, (_i, _a, x, y) => ctx.fillRect(x, y, 2, 1));
    ctx.fillStyle = "#c8b0ff"; ring(floorY, 36, 5, 40, (_i, _a, x, y) => ctx.fillRect(x, y, 2, 1));
    ctx.globalAlpha = 1;
  }
  // ---- the rune it is bound for, under the grass: what erosion left of it, and what the rewrite writes back
  const grassY = T.gy - depth;
  if (grassY > -12) ring(grassY + 3, 56, 7, 64, (i, a, x, y) => {
    const survives = hash2(i, 7, 48) < 0.24, key = Math.abs(Math.atan2(Math.cos(a), -Math.sin(a))) / Math.PI;
    const written = p > 0 && key <= p;
    if (written) { ctx.globalAlpha = 1; ctx.fillStyle = p - key < 0.07 && p < 1 ? "#ffffff" : "#c8b0ff"; ctx.fillRect(x, y, 3, 1); }
    else if (survives) { ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 6 + i); ctx.fillStyle = "#9a78e0"; ctx.fillRect(x, y, 3, 1); }
    else if (i & 1) { ctx.globalAlpha = 0.9; ctx.fillStyle = "#3e3560"; ctx.fillRect(x, y, 1, 1); }
  });
  ctx.globalAlpha = 1;
  // ---- the rune's column of light. It runs clean below the golem; ahead of it, it gutters while the far end is broken.
  const flick = 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.1), headY = T.gy - 26;
  const ahead = !stalled ? 1 : p > 0 ? 0.35 + 0.65 * p : Math.sin(t * 37) > 0.3 ? 0.5 : 0.08;
  for (const [y0, y1, k] of [[0, headY, ahead], [headY, H, 1]] as const) {
    ctx.globalAlpha = 0.15 * flick * k; ctx.fillStyle = "#9a70ff"; ctx.fillRect(cx - 13, y0, 26, y1 - y0);
    ctx.globalAlpha = 0.2 * flick * k; ctx.fillStyle = "#c0a0ff"; ctx.fillRect(cx - 6, y0, 12, y1 - y0);
    ctx.globalAlpha = 0.5 * flick * k; ctx.fillStyle = "#e8e0ff"; ctx.fillRect(cx - 1, y0, 2, y1 - y0);
  }
  // ---- motes streaming past: long streaks at speed, drifting specks at the stall
  const run = T.deep - depth, speed = clamp((depth - T.hold) / 200, 0, 1);
  for (let i = 0; i < 44; i++) {
    const x = cx + Math.round((hash2(i, 1, 49) - 0.5) * 96), sp = 1.4 + hash2(i, 2, 49) * 2;
    const y = Math.floor((hash2(i, 3, 49) * H + run * sp + (stalled ? t * (3 + sp * 2) : 0)) % H);
    ctx.globalAlpha = 0.25 + 0.5 * hash2(i, 4, 49);
    ctx.fillStyle = i % 3 ? "#c0a0ff" : "#80e0ff";
    ctx.fillRect(x, y, 1, 1 + Math.round(11 * speed));
  }
  // ---- the golem, carried
  const bob = stalled ? Math.round(Math.sin(t * 2.2) * 1.5) : Math.round(Math.sin(t * 9));
  ctx.globalAlpha = 0.22; ctx.fillStyle = "#9a70ff"; ctx.fillRect(cx - 11, T.gy - 27 + bob, 22, 30);
  ctx.globalAlpha = 1;
  const pose: GolemPose = { facing: "down", phase: 0, moving: false, hasArm: v.hasArm, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t, eyeFixed: v.eyeFixed };
  drawGolem(new Pen(ctx, false), cx, T.gy + bob, pose);
  // ---- the dark closing in at the sides, the white of the jump clearing, the fault, the cut
  ctx.fillStyle = "#000";
  for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.6 * (1 - i / 6) ** 1.5; ctx.fillRect(i * 12, 0, 12, H); ctx.fillRect(W - (i + 1) * 12, 0, 12, H); }
  ctx.globalAlpha = 1;
  if (stalled && v.et < v.stallAt + 0.4) { ctx.fillStyle = `rgba(255,90,120,${0.22 * (1 - (v.et - v.stallAt) / 0.4)})`; ctx.fillRect(0, 0, W, H); }
  if (v.et < v.whiteOut) { ctx.fillStyle = `rgba(235,240,255,${1 - v.et / v.whiteOut})`; ctx.fillRect(0, 0, W, H); }
  if (v.et > v.endAt - 0.45) { ctx.fillStyle = `rgba(0,0,0,${clamp((v.et - (v.endAt - 0.45)) / 0.4, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
}

/**
 * The chapter card, laid over the living world as the crossing ends: the title,
 * the run so far, and how to go on. `ct` is seconds since it appeared; keys are
 * taken from `promptAfter` (screens/crossing.ts).
 */
export function renderChapter(ctx: CanvasRenderingContext2D, t: number, ct: number, promptAfter: number, world: World, pl: Actor) {
  ctx.globalAlpha = clamp(ct / 1.4, 0, 1);
  drawTextS(ctx, "DUSTWAKE", W / 2, 112, "#f0e0c8", 3, "center", "#2a1a2a");
  if (ct > 0.9) {
    ctx.globalAlpha = clamp(ct - 0.9, 0, 1);
    const s = Math.floor(world.playTime);
    const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    drawTextS(ctx, `TIME ${mm}:${ss}`, W / 2, 136, "#d8c8b0", 1, "center", "#2a1a2a");
    drawTextS(ctx, `RELICS ${relicCount(world, pl)}/3`, W / 2, 144, "#d8c8b0", 1, "center", "#2a1a2a");
  }
  ctx.globalAlpha = 1;
  if (ct > promptAfter && Math.sin(t * 3) > -0.3) drawText(ctx, "ANY KEY - WALK ON    R - WAKE AGAIN", W / 2, H - 9, "#c8b8a0", 1, "center");
}
