// Full-screen cards drawn on the UI layer: the title screen and the duskfall
// end card after the first rune jump. Pure drawing from the state passed in;
// the host keeps their update logic (screen changes, ember/mote spawning).
import { RELICS } from "../content/items";
import { FLAGS } from "../content/flags";
import { hasItem } from "../sim/inventory";
import { hasFlag, type World, type Actor } from "../world/world";
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

/** End card. `t` is the presentation clock, `et` the time since the card opened. */
export function renderEnd(ctx: CanvasRenderingContext2D, t: number, et: number, particles: readonly CardMote[], world: World, pl: Actor) {
  // sky bands, dithered
  const bands = ["#0a0c22", "#141634", "#26204a", "#43285a", "#6a3458", "#9a4a50", "#d07448", "#f0a85a"];
  const hz = 120;
  for (let y = 0; y < H; y++) {
    const f = clamp(y / hz, 0, 1) * (bands.length - 1);
    const i0 = Math.floor(f), fr = f - i0;
    for (let x = 0; x < W; x++) {
      const b = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;
      ctx.fillStyle = bands[Math.min(bands.length - 1, i0 + (fr > b ? 1 : 0))];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // stars
  for (let i = 0; i < 90; i++) {
    const x = (hash2(i, 1, 4) * W) | 0, y = (hash2(i, 2, 4) * 70) | 0;
    const tw = Math.sin(t * 2 + i) > 0.3;
    ctx.fillStyle = tw ? "#e8e8ff" : "#8a8ab0";
    ctx.fillRect(x, y, 1, 1);
  }
  // sun
  const sunY = hz + 6 - Math.min(et, 12) * 2.6;
  for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) {
    const d = x * x + y * y;
    if (d <= 196) { ctx.fillStyle = d < 120 ? "#fff0c0" : "#ffd080"; ctx.fillRect(W / 2 + 40 + x, Math.round(sunY + y), 1, 1); }
  }
  // mountains
  const ridge = (base: number, amp: number, freq: number, seed: number, col: string) => {
    ctx.fillStyle = col;
    for (let x = 0; x < W; x++) {
      const h = base - Math.abs(Math.sin(x * freq + seed)) * amp - Math.sin(x * freq * 2.7 + seed * 2) * amp * 0.3 - hash2(x >> 2, seed, 1) * 2;
      ctx.fillRect(x, Math.round(h), 1, H - Math.round(h));
    }
  };
  ridge(hz + 4, 26, 0.018, 1, "#3a2440");
  ridge(hz + 16, 18, 0.03, 4, "#24182c");
  // hill with ruins entrance
  ctx.fillStyle = "#120c16";
  for (let x = 0; x < W; x++) {
    const h = 150 - Math.max(0, 22 - Math.abs(x - 110) * 0.18) - Math.sin(x * 0.05) * 3;
    ctx.fillRect(x, Math.round(h), 1, H);
  }
  // broken pillars silhouettes
  for (const [x, h] of [[60, 18], [72, 10], [150, 14], [162, 22]] as [number, number][]) { ctx.fillStyle = "#0c080e"; ctx.fillRect(x, 150 - h - 6, 5, h + 10); ctx.fillRect(x - 1, 150 - h - 6, 7, 2); }
  // rune circle on hilltop
  const cx = 110, cy = 130;
  const glow = 0.4 + 0.3 * Math.sin(t * 2);
  ctx.fillStyle = `rgba(160,112,255,${glow * Math.max(0, 1 - et / 8)})`;
  for (let a = 0; a < Math.PI * 2; a += 0.05) ctx.fillRect(Math.round(cx + Math.cos(a) * 14), Math.round(cy + Math.sin(a) * 4), 1, 1);
  // golem looking at sunrise
  const pose: GolemPose = { facing: "up", phase: 0, moving: false, hasArm: hasFlag(world, FLAGS.golemArm), dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t, eyeFixed: hasFlag(world, FLAGS.golemEye) };
  drawGolem(new Pen(ctx, false), cx, cy, pose);
  // light motes
  for (const p of particles) { ctx.fillStyle = p.col; ctx.globalAlpha = clamp(p.life, 0, 1) * 0.7; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
  ctx.globalAlpha = 1;
  if (et > 3) {
    ctx.globalAlpha = clamp((et - 3) / 1.5, 0, 1);
    drawTextS(ctx, "DUSTWAKE", W / 2, 20, "#f0e0c8", 3, "center", "#2a1a2a");
    ctx.globalAlpha = 1;
  }
  if (et > 4.5) {
    ctx.globalAlpha = clamp((et - 4.5) / 1, 0, 1);
    const s = Math.floor(world.playTime);
    const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    const rel = RELICS.filter((r) => hasItem(pl, r)).length;
    drawTextS(ctx, `TIME ${mm}:${ss}`, W / 2, 44, "#d8c8b0", 1, "center", "#2a1a2a");
    drawTextS(ctx, `RELICS ${rel}/3`, W / 2, 52, "#d8c8b0", 1, "center", "#2a1a2a");
    ctx.globalAlpha = 1;
  }
  if (et > 6 && Math.sin(t * 3) > -0.3) drawTextS(ctx, "ANY KEY - THE SURFACE    R - WAKE AGAIN", W / 2, 168, "#c8b8a0", 1, "center", "#000");
  if (et < 1.6) { ctx.fillStyle = `rgba(235,240,255,${1 - et / 1.6})`; ctx.fillRect(0, 0, W, H); }
}
