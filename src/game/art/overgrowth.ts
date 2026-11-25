// Overgrowth helpers shared by the surface sprites (trees, stumps, rocks, logs, ruins). Presentation only.
import { hash2 } from "../util";
import type { Pen, Rng } from "../util";

export const MOSS = ["#2e4a22", "#3e5e2a", "#527636", "#6e8e34"];
/** Moss speckled over a rect (the upper faces of stone or wood), thinning toward the bottom. */
export function mossOver(p: Pen, r: Rng, x: number, y: number, w: number, h: number, dens: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (r() > dens * (1 - j / (h + 1)) * (hash2(x + i >> 1, y + j >> 1, 140) * 0.8 + 0.4)) continue;
    p.p(x + i, y + j, MOSS[(r() * 4) | 0]);
  }
}
/** A strand of ivy hanging down from (x, y), with leaves. */
export function ivyOn(p: Pen, r: Rng, x: number, y: number, len: number) {
  let vx = x;
  for (let j = 0; j < len; j++) {
    p.p(vx, y + j, "#2e3e1c");
    if (j % 2 === 0) p.p(vx + (j % 4 === 0 ? 1 : -1), y + j, r() < 0.5 ? "#4e7a34" : "#3a6228");
    if (r() < 0.2) vx += r() < 0.5 ? -1 : 1;
  }
}
/** A row of grass blades along a base line. */
export function tufts(p: Pen, r: Rng, x: number, y: number, w: number, k: number) {
  const cols = ["#4e7a3a", "#628e44", "#3a5e2c"];
  for (let i = 0; i < k; i++) { const bx = x + ((r() * w) | 0), h = 1 + ((r() * 3) | 0); p.r(bx, y - h, 1, h, cols[(r() * 3) | 0]); }
}
export function fernTuft(p: Pen, r: Rng, x: number, y: number) {
  for (let f = -2; f <= 2; f++) { let fx = x, fy = y; for (let s = 0; s < 4; s++) { fx += f * 0.6; fy -= 1; p.p(Math.round(fx), Math.round(fy), r() < 0.5 ? "#3e6a3a" : "#5a8a4e"); } }
}
export function leafBlob(p: Pen, r: Rng, cx: number, cy: number, rr: number, leaf: string[]) {
  for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
    const d = (x * x + y * y) / (rr * rr);
    if (d > 1 || (d > 0.75 && r() < 0.35)) continue;
    let c = d > 0.75 ? leaf[0] : x + y < -rr * 0.5 ? leaf[3] : x + y < 0 ? leaf[2] : leaf[1];
    if (r() < 0.1) c = leaf[0];
    p.p(cx + x, cy + y, c);
  }
}

