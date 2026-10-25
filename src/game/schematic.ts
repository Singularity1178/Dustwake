import { MapData, T, TS } from "./map";
import { drawText, textWidth } from "./font";
import { makeCanvas, hash2 } from "./util";
import { GLYPHS } from "./art";

const BG = "#173465";
const INK = "#e4ecff";
const INK2 = "#9db6e4";
const HATCH = "#5f80bc";
export const PLAN_X = 14, PLAN_Y = 26, PLAN_S = 2;

function circlePx(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string, dashFrom?: number, dashTo?: number) {
  ctx.fillStyle = col;
  const seen = new Set<number>();
  for (let a = 0; a < Math.PI * 2; a += 0.4 / r) {
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    const k = y * 1000 + x;
    if (seen.has(k)) continue;
    seen.add(k);
    if (dashFrom !== undefined && dashTo !== undefined && a >= dashFrom && a <= dashTo) {
      if (seen.size % 3 === 0) continue;
      ctx.fillStyle = INK2;
      ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = col;
      continue;
    }
    ctx.fillRect(x, y, 1, 1);
  }
}
function lineD(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, dash = 0) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.fillStyle = col;
  for (let i = 0; i <= n; i++) {
    if (dash && Math.floor(i / dash) % 2 === 1) continue;
    ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / (n || 1)), Math.round(y0 + ((y1 - y0) * i) / (n || 1)), 1, 1);
  }
}
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
}
function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, col = INK, align: "left" | "center" | "right" = "left") {
  const w = textWidth(s);
  const lx = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  ctx.fillStyle = BG;
  ctx.fillRect(Math.round(lx) - 1, y - 1, w + 2, 7);
  drawText(ctx, s, x, y, col, 1, align);
}

export function buildSchematic(m: MapData, solution: number[]): HTMLCanvasElement {
  const MW = m.w, MH = m.h;
  const { c, ctx } = makeCanvas(320, 180);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, 320, 180);
  // grid
  for (let x = 0; x < 320; x += 4) for (let y = 0; y < 180; y++) {
    if (x % 16 === 0) { ctx.fillStyle = "#1f3f78"; ctx.fillRect(x, y, 1, 1); }
    else if (y % 2 === 0) { ctx.fillStyle = "#1a3a6e"; ctx.fillRect(x, y, 1, 1); }
  }
  for (let y = 0; y < 180; y += 4) for (let x = 0; x < 320; x++) {
    if (y % 16 === 0) { ctx.fillStyle = "#1f3f78"; ctx.fillRect(x, y, 1, 1); }
    else if (x % 2 === 0) { ctx.fillStyle = "#1a3a6e"; ctx.fillRect(x, y, 1, 1); }
  }
  // borders
  box(ctx, 3, 3, 314, 174, INK);
  box(ctx, 5, 5, 310, 170, INK2);
  // header
  drawText(ctx, "SANCTUM OF VEYRHOLD - PLAN OF THE LOWER FLOOR", 10, 9, INK);
  drawText(ctx, "DWG. 7-B", 310, 9, INK2, 1, "right");
  ctx.fillStyle = INK2; ctx.fillRect(8, 16, 304, 1);

  // ---- plan ----
  const P = m.plan;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= MW || y >= MH ? T.WALL : P[y * MW + x]);
  const isW = (x: number, y: number) => at(x, y) === T.WALL;
  for (let ty = 0; ty < MH; ty++)
    for (let tx = 0; tx < MW; tx++) {
      const sx = PLAN_X + tx * PLAN_S, sy = PLAN_Y + ty * PLAN_S;
      if (isW(tx, ty)) {
        let near = false;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!isW(tx + i, ty + j)) near = true;
        if (!near) continue;
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          ctx.fillStyle = (sx + i + sy + j) % 3 === 0 ? HATCH : "#24467f";
          ctx.fillRect(sx + i, sy + j, 1, 1);
        }
      } else {
        ctx.fillStyle = BG; ctx.fillRect(sx, sy, 2, 2);
      }
    }
  for (let ty = 0; ty < MH; ty++)
    for (let tx = 0; tx < MW; tx++) {
      if (isW(tx, ty)) continue;
      const sx = PLAN_X + tx * PLAN_S, sy = PLAN_Y + ty * PLAN_S;
      ctx.fillStyle = INK;
      if (isW(tx - 1, ty)) ctx.fillRect(sx, sy, 1, 2);
      if (isW(tx + 1, ty)) ctx.fillRect(sx + 1, sy, 1, 2);
      if (isW(tx, ty - 1)) ctx.fillRect(sx, sy, 2, 1);
      if (isW(tx, ty + 1)) ctx.fillRect(sx, sy + 1, 2, 1);
      const t = at(tx, ty);
      if (t === T.PILLAR) { ctx.fillStyle = INK; ctx.fillRect(sx, sy, 2, 2); }
      if (t === T.BARS) { ctx.fillStyle = INK2; ctx.fillRect(sx, sy + (ty % 2), 2, 1); }
      if (t === T.LOCKED) { ctx.fillStyle = INK; ctx.fillRect(sx, sy - 1, 1, 4); ctx.fillStyle = INK2; ctx.fillRect(sx + 1, sy - 1, 2, 1); }
    }
  // thresholds on the original plan (doorways marked by short ticks)
  // rune circle on plan
  const rcx = PLAN_X + (m.ritual!.x / TS) * PLAN_S, rcy = PLAN_Y + (m.ritual!.y / TS) * PLAN_S;
  circlePx(ctx, rcx, rcy, 7, INK, 0.26, 1.31);
  circlePx(ctx, rcx, rcy, 4, INK2);
  ctx.fillStyle = INK; ctx.fillRect(Math.round(rcx), Math.round(rcy), 1, 1);
  // furniture hints
  const thr = { x: PLAN_X + 35.5 * PLAN_S, y: PLAN_Y + 3 * PLAN_S };
  ctx.fillStyle = INK; ctx.fillRect(Math.round(thr.x) - 2, Math.round(thr.y), 5, 3); ctx.fillStyle = BG; ctx.fillRect(Math.round(thr.x) - 1, Math.round(thr.y) + 1, 3, 1);
  // carpet line down hall
  lineD(ctx, PLAN_X + 36 * PLAN_S, PLAN_Y + 5 * PLAN_S, PLAN_X + 36 * PLAN_S, PLAN_Y + 41 * PLAN_S, INK2, 2);

  // room numbers
  for (const r of m.rooms) {
    let cx = PLAN_X + (r.x + r.w / 2) * PLAN_S, cy = PLAN_Y + (r.y + r.h / 2) * PLAN_S - 2;
    if (r.num === 3) { cx = PLAN_X + (r.x + 2.5) * PLAN_S; cy = PLAN_Y + (r.y + 1.5) * PLAN_S; }
    if (r.num === 1) cy += 6;
    const s = String(r.num);
    const w = textWidth(s);
    ctx.fillStyle = BG; ctx.fillRect(Math.round(cx - w / 2) - 2, cy - 2, w + 4, 9);
    box(ctx, Math.round(cx - w / 2) - 2, cy - 2, w + 4, 9, INK2);
    drawText(ctx, s, cx, cy, INK, 1, "center");
  }
  // exits
  for (const e of m.exits) {
    const ex = PLAN_X + e.x * PLAN_S, ey = PLAN_Y + e.y * PLAN_S;
    ctx.fillStyle = INK;
    if (e.dir === "n") {
      lineD(ctx, ex, ey + 2, ex, PLAN_Y - 6, INK);
      ctx.fillRect(ex - 1, PLAN_Y - 5, 3, 1); ctx.fillRect(ex - 2, PLAN_Y - 4, 5, 1);
      label(ctx, e.label, ex + 4, PLAN_Y - 8, INK2);
    } else if (e.dir === "s") {
      lineD(ctx, ex, ey - 2, ex, PLAN_Y + MH * PLAN_S + 3, INK);
      ctx.fillRect(ex - 2, PLAN_Y + MH * PLAN_S + 1, 5, 1); ctx.fillRect(ex - 1, PLAN_Y + MH * PLAN_S + 2, 3, 1);
      label(ctx, e.label, ex + 5, PLAN_Y + MH * PLAN_S - 3, INK2);
    } else {
      lineD(ctx, ex - 2, ey, ex + 6, ey, INK);
      ctx.fillRect(ex + 5, ey - 1, 1, 3); ctx.fillRect(ex + 4, ey - 2, 1, 5);
      label(ctx, e.label, ex + 6, ey + 10, INK2, "right");
    }
  }
  // callout to detail A
  const dax = 168;
  lineD(ctx, rcx + 6, rcy - 6, rcx + 14, PLAN_Y - 1, INK2, 2);
  lineD(ctx, rcx + 14, PLAN_Y - 1, dax - 2, PLAN_Y - 1, INK2, 2);
  ctx.fillStyle = BG; ctx.fillRect(rcx + 12, PLAN_Y - 5, 9, 9);
  circlePx(ctx, rcx + 16, PLAN_Y - 1, 4, INK);
  drawText(ctx, "A", rcx + 15, PLAN_Y - 3, INK);

  // dimension line
  const dy = PLAN_Y + MH * PLAN_S + 8;
  lineD(ctx, PLAN_X, dy, PLAN_X + 60, dy, INK2);
  ctx.fillStyle = INK2; ctx.fillRect(PLAN_X, dy - 2, 1, 5); ctx.fillRect(PLAN_X + 60, dy - 2, 1, 5);
  label(ctx, "90 FT", PLAN_X + 30, dy - 2, INK2, "center");

  // compass + scale bar + note
  const ccx = 22, ccy = 162;
  circlePx(ctx, ccx, ccy, 6, INK2);
  ctx.fillStyle = INK; for (let i = 0; i < 7; i++) ctx.fillRect(ccx - Math.floor(i / 3), ccy - 7 + i, 1 + 2 * Math.floor(i / 3), 1);
  ctx.fillStyle = INK2; for (let i = 0; i < 5; i++) ctx.fillRect(ccx - Math.floor((4 - i) / 2), ccy + i + 1, 1 + 2 * Math.floor((4 - i) / 2), 1);
  drawText(ctx, "N", ccx, ccy - 14, INK, 1, "center");
  const sbx = 36, sby = 160;
  for (let i = 0; i < 4; i++) {
    box(ctx, sbx + i * 10, sby, 10, 4, INK);
    if (i % 2 === 0) { ctx.fillStyle = INK; ctx.fillRect(sbx + i * 10, sby, 10, 4); }
  }
  drawText(ctx, "0", sbx, sby + 6, INK2, 1, "center");
  drawText(ctx, "20", sbx + 20, sby + 6, INK2, 1, "center");
  drawText(ctx, "40", sbx + 40, sby + 6, INK2, 1, "center");
  drawText(ctx, "FT", sbx, sby - 7, INK2);
  drawText(ctx, "ARRAY SEG. IV UNCUT.", 84, 154, INK2);
  drawText(ctx, "CUT PER DETAIL A,", 84, 161, INK2);
  drawText(ctx, "SET GLYPHS + CORE.", 84, 168, INK2);

  // ---- Detail A ----
  box(ctx, 164, 20, 84, 96, INK);
  drawText(ctx, "DEST: SURFACE", 167, 23, INK2);
  const cx = 206, cy = 62, R = 30;
  circlePx(ctx, cx, cy, R, INK, 0.26, 1.31);
  circlePx(ctx, cx, cy, R - 2, INK, 0.26, 1.31);
  circlePx(ctx, cx, cy, 23, INK, 0.26, 1.31);
  circlePx(ctx, cx, cy, 9, INK);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const gap = a >= 0.26 && a <= 1.31;
    lineD(ctx, cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, cx + Math.cos(a) * 23, cy + Math.sin(a) * 23, gap ? INK2 : INK, gap ? 1 : 0);
  }
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + Math.PI / 24;
    const gap = a >= 0.26 && a <= 1.31;
    ctx.fillStyle = gap ? INK2 : INK;
    ctx.fillRect(Math.round(cx + Math.cos(a) * 25.5), Math.round(cy + Math.sin(a) * 25.5), 1, 1);
  }
  const sp = [[0, -26], [26, 0], [0, 26], [-26, 0]];
  for (let i = 0; i < 4; i++) {
    const a = sp[i], b = sp[(i + 1) % 4];
    lineD(ctx, cx + a[0] * 0.8 + b[0] * 0.2, cy + a[1] * 0.8 + b[1] * 0.2, cx + b[0] * 0.8 + a[0] * 0.2, cy + b[1] * 0.8 + a[1] * 0.2, i === 1 ? INK2 : INK, i === 1 ? 1 : 0);
  }
  for (let i = 0; i < 4; i++) {
    const sx = cx + sp[i][0] - 5, sy = cy + sp[i][1] - 5;
    ctx.fillStyle = BG; ctx.fillRect(sx, sy, 11, 11);
    box(ctx, sx, sy, 11, 11, INK);
    const pat = GLYPHS[solution[i]].pat;
    ctx.fillStyle = INK;
    for (let j = 0; j < 7; j++) for (let k = 0; k < 7; k++) if (pat[j][k] === "#") ctx.fillRect(sx + 2 + k, sy + 2 + j, 1, 1);
  }
  // core
  ctx.fillStyle = INK;
  for (let i = 0; i < 4; i++) { ctx.fillRect(cx - i, cy - 3 + i, 1 + 2 * i, 1); ctx.fillRect(cx - i, cy + 3 - i, 1 + 2 * i, 1); }
  ctx.fillStyle = BG; ctx.fillRect(cx, cy - 1, 1, 3);
  // segment IV callout
  lineD(ctx, cx + 20, cy + 18, cx + 30, cy + 26, INK2);
  label(ctx, "IV", cx + 31, cy + 25, INK);
  lineD(ctx, cx - 24, cy - 24, cx - 34, cy - 30, INK2);
  drawText(ctx, "I", cx - 28, cy - 34, INK2);
  drawText(ctx, "CORE", 168, cy + 26, INK2);
  lineD(ctx, 180, cy + 25, cx - 3, cy + 3, INK2, 1);
  ctx.fillStyle = INK2; ctx.fillRect(166, 98, 80, 1);
  drawText(ctx, "DETAIL A", 206, 101, INK, 1, "center");
  drawText(ctx, "TRANSLOCATION ARRAY", 206, 108, INK2, 1, "center");

  // ---- Room schedule ----
  drawText(ctx, "ROOM SCHEDULE", 252, 22, INK);
  ctx.fillStyle = INK2; ctx.fillRect(252, 28, 60, 1);
  m.rooms.forEach((r, i) => drawText(ctx, `${r.num} ${r.name}`, 252, 31 + i * 7, INK2));

  // ---- Title block ----
  const tx = 164, ty = 119;
  box(ctx, tx, ty, 150, 54, INK);
  ctx.fillStyle = INK2;
  [ty + 11, ty + 21, ty + 31, ty + 42].forEach((y) => ctx.fillRect(tx, y, 150, 1));
  ctx.fillRect(tx + 82, ty + 21, 1, 21);
  drawText(ctx, "SANCTUM OF VEYRHOLD", tx + 3, ty + 3, INK);
  drawText(ctx, "LOWER FLOOR - GEN. PLAN", tx + 3, ty + 14, INK2);
  drawText(ctx, "DRAWN M. OSSEN", tx + 3, ty + 24, INK2);
  drawText(ctx, "SHEET 2/5", tx + 85, ty + 24, INK2);
  drawText(ctx, "SCALE 1:96", tx + 3, ty + 34, INK2);
  drawText(ctx, "REV. C", tx + 85, ty + 34, INK2);
  drawText(ctx, "BY ORDER OF THE THRONE", tx + 3, ty + 45, INK2);
  // seal
  circlePx(ctx, tx + 136, ty + 33, 8, "#c88c8c");
  circlePx(ctx, tx + 136, ty + 33, 6, "#c88c8c");
  ctx.fillStyle = "#c88c8c";
  ctx.fillRect(tx + 135, ty + 30, 3, 1); ctx.fillRect(tx + 134, ty + 31, 5, 1); ctx.fillRect(tx + 133, ty + 32, 7, 1);
  ctx.fillRect(tx + 135, ty + 34, 3, 1);

  // aging: fold lines, specks, stains
  for (let y = 6; y < 174; y++) if (hash2(1, y, 5) < 0.7) { ctx.fillStyle = "rgba(200,220,255,0.10)"; ctx.fillRect(160, y, 1, 1); }
  for (let x = 6; x < 314; x++) if (hash2(x, 1, 6) < 0.7) { ctx.fillStyle = "rgba(200,220,255,0.10)"; ctx.fillRect(x, 90, 1, 1); }
  for (let i = 0; i < 260; i++) {
    const x = (hash2(i, 0, 11) * 320) | 0, y = (hash2(i, 1, 11) * 180) | 0;
    ctx.fillStyle = hash2(i, 2, 11) < 0.5 ? "rgba(255,255,255,0.12)" : "rgba(0,0,30,0.25)";
    ctx.fillRect(x, y, 1, 1);
  }
  for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
    const e = Math.min(x, y, 319 - x, 179 - y);
    if (e < 6 && hash2(x, y, 12) < (6 - e) / 8) { ctx.fillStyle = "rgba(5,12,30,0.5)"; ctx.fillRect(x, y, 1, 1); }
  }
  // stain
  for (let j = -9; j <= 9; j++) for (let i = -14; i <= 14; i++) {
    const v = (i * i) / 196 + (j * j) / 81;
    if (v < 1 && v > 0.75 && hash2(i, j, 13) < 0.6) { ctx.fillStyle = "rgba(10,20,50,0.35)"; ctx.fillRect(288 + i, 150 + j, 1, 1); }
  }
  return c;
}
