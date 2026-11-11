// The stone retexture: the surface's rocks and iron veins, and the stair between the halls and the surface.
// Art only: nothing here is simulated or saved, so there is no save field and no migration (pinned below).
// The golden hashes (tests/art.test.ts, tests/artRegistry.test.ts) say that pixels moved; this file says what
// the new art has to keep, on rasterised sprites (the pixel canvas the preview tools use):
//   - every rock and every vein variant is a rock of its own, faceted, on its footprint, and nothing glows;
//   - ore shows on veins and only on veins, standing or broken up; moss only on the mossed rocks;
//   - the stair is one stone wherever it is drawn: the baked flight, its foot in the Vestibule and the stair
//     head on the surface are the same pixels from the same function, and a step reads as a rise;
//   - the stair head's stone layer is the tumbled fall of the halls' rock piles, not masonry, and digging
//     through it takes stones away from the same fall and bares the top steps.
// node scripts/stonePreview.mjs renders all of it to look at.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./support/daySnapshot";
import type { RCanvas } from "./support/uiSnapshot";
installDom();
import { propSprite } from "../src/game/art/props";
import { bakeRegion } from "../src/game/art/tiles";
import { stepPix, stoneFall, STEP_PX } from "../src/game/art/stone";
import { S } from "../src/game/art/palette";
import { buildDungeon } from "../src/game/map";
import { buildSurface } from "../src/game/surface";
import { GATE_STAIR } from "../src/game/content/geography";
import { T, TS } from "../src/game/content/tiles";
import { propDef } from "../src/game/content/props";
import { DIG_SITES, digStage, digTotal } from "../src/game/content/digging";
import { SAVE_VERSION } from "../src/game/world/save";
import { hex, type Pen, type Sprite } from "../src/game/util";

type RGB = [number, number, number];
const rgbAt = (c: RCanvas, x: number, y: number): RGB | null => { const i = (y * c.width + x) * 4; return c.data[i + 3] > 0 ? [c.data[i], c.data[i + 1], c.data[i + 2]] : null; };
const albedo = (s: Sprite) => s.a as unknown as RCanvas;
const sprite = (kind: string, v: number, alt = false) => propSprite(kind, v, alt)!;
const same = (a: RGB | null, b: readonly number[]) => !!a && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
/** Every solid pixel of a sprite (its soft ground shadow is not one), as [dx, dy from the anchor at its foot, colour]. */
function solid(s: Sprite): [number, number, RGB][] {
  const out: [number, number, RGB][] = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const c = rgbAt(albedo(s), x, y); if (c && c[0] + c[1] + c[2] >= 30) out.push([x - s.ax, y - s.ay, c]); }
  return out;
}
const outline = (s: Sprite) => new Set(solid(s).map(([x, y]) => `${x},${y}`));
/** How much two outlines share, standing on the same spot: 1 the same shape, 0 nothing in common. */
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const k of a) if (b.has(k)) n++; return n / (a.size + b.size - n); };
const isRust = (c: RGB) => c[0] > c[1] + 40 && c[1] > c[2];
const isGreen = (c: RGB) => c[1] > c[0] + 15 && c[1] > c[2] + 15;
/** The catch-light on a ridge between two planes (art/stone.ts): the round stone blob never draws it. */
const RIDGE: RGB = [0xa8, 0xa1, 0xb0];
const count = (s: Sprite, f: (c: RGB, dx: number, dy: number) => boolean) => solid(s).filter(([x, y, c]) => f(c, x, y)).length;

const ROCKS = [0, 1, 2, 3], VEINS = [0, 1, 2];

test("art only: the retexture adds no save field and no migration, and the builders place what they placed", () => {
  assert.equal(SAVE_VERSION, 14);
  const s = buildSurface();
  // the shapes are keyed by the variants the builder already hands out: none had to change for the new art
  assert.deepEqual([...new Set(s.props.filter((p) => p.kind === "rock").map((p) => p.v))].sort(), ROCKS);
  assert.deepEqual([...new Set(s.props.filter((p) => p.kind === "ironore").map((p) => p.v))].sort(), VEINS);
  assert.deepEqual(propDef("rock").box, [16, 8]); assert.deepEqual(propDef("ironore").box, [16, 8]);
});

test("rocks and veins: every variant is a rock of its own, faceted and standing on its footprint; nothing glows", () => {
  for (const [kind, vs] of [["rock", ROCKS], ["ironore", VEINS]] as const) {
    const shapes = vs.map((v) => outline(sprite(kind, v)));
    for (let a = 0; a < vs.length; a++) for (let b = a + 1; b < vs.length; b++) {
      const o = overlap(shapes[a], shapes[b]);
      assert.ok(o < 0.8, `${kind} ${vs[a]} and ${vs[b]} are different rocks, not one shape nudged (share ${o.toFixed(2)})`);
    }
    for (const v of vs) {
      const s = sprite(kind, v), px = solid(s), xs = px.map((p) => p[0]);
      assert.deepEqual([s.ax, s.ay], [Math.floor(s.w / 2), s.h], "anchored at its foot");
      assert.ok(s.w <= 24 && Math.min(...xs) <= -7 && Math.max(...xs) >= 6, `${kind} ${v} covers its 16 px footprint and no more than a tile and a half`);
      assert.ok(count(s, (c) => same(c, RIDGE)) >= 3, `${kind} ${v} is faceted: planes meet at a lit ridge`);
      for (const alt of [false, true]) {
        const e = sprite(kind, v, alt).e as unknown as RCanvas;
        for (let i = 0; i < e.data.length; i += 4) assert.equal(e.data[i] + e.data[i + 1] + e.data[i + 2], 0, `${kind} ${v} does not glow`);
      }
    }
  }
  // the scenery stays the round, water-worn stone: what can be broken is told from it by its shape
  for (const v of [0, 1, 2]) assert.equal(count(sprite("boulder", v), (c) => same(c, RIDGE)), 0, "boulders are not faceted");
});

test("ore shows on veins and only on veins, standing or broken up; moss only on the mossed rocks", () => {
  for (const v of VEINS) {
    assert.ok(count(sprite("ironore", v), isRust) >= 12, `vein ${v} is seamed with ore`);
    assert.ok(count(sprite("ironore", v, true), isRust) >= 2, `vein ${v}, broken up, leaves rust-streaked pieces`);
  }
  for (const v of ROCKS) {
    assert.equal(count(sprite("rock", v), isRust), 0, `rock ${v} has no ore in it`);
    assert.equal(count(sprite("rock", v, true), isRust), 0);
    // grass stands at the foot of every rock; moss is what grows higher up
    const moss = count(sprite("rock", v), (c, _dx, dy) => isGreen(c) && dy < -5);
    if (v >= 2) assert.ok(moss >= 8, `rock ${v} is mossed`); else assert.equal(moss, 0, `rock ${v} is bare`);
  }
});

// ------------------------------------------------------------------ the stair
const step = (u: number, wid: number, s: number, h: number, id: number) => stepPix(u, wid, s, h, id);
/** The open stair head's well in its sprite (art/propsSurface.ts: buriedgate): x 6..65, y 14..57, and the steps' heights from the lip down. */
const WELL = { x0: 6, x1: 66, y1: 58 }, HEAD_STEPS = [8, 7, 6, 5, 4, 3];
const OPEN = digStage(DIG_SITES.buriedgate, digTotal(DIG_SITES.buriedgate), true);

test("a step reads as a rise: a bright nosing, the tread falling into the shadow of the step above, a kerb block at each end", () => {
  const wid = GATE_STAIR.w * TS;
  for (const id of [0, 1, 7, 100, 101]) {
    const row = Array.from({ length: STEP_PX }, (_, s) => { let t = 0, n = 0; for (let u = 4; u < wid - 4; u++) { t += step(u, wid, s, STEP_PX, id)[0]; n++; } return t / n; });
    for (let s = 1; s < STEP_PX; s++) assert.ok(row[s] <= row[s - 1] + 1.5, `step ${id}: row ${s} is no brighter than the one before it (${row.map((v) => v.toFixed(0))})`);
    assert.ok(row[0] - row[STEP_PX - 1] >= 70, "from nosing to shadow");
    assert.ok(row[1] > row[3] + 6 && row[3] > row[5] + 8 && row[5] > row[6] + 8 && row[6] > row[7] + 15, "a gradient over the tread, not a line at its end");
    // the kerb: a dark joint against the tread at both ends, its block lit along the top
    for (const u of [2, wid - 3]) for (let s = 1; s < STEP_PX - 1; s++) assert.ok(step(u, wid, s, STEP_PX, id)[0] < step(wid >> 1, wid, 3, STEP_PX, id)[0] - 30);
    for (const u of [0, 1, wid - 2, wid - 1]) assert.ok(step(u, wid, 0, STEP_PX, id)[0] > step(u, wid, STEP_PX - 1, STEP_PX, id)[0] + 50);
  }
  // whole pixel values, so the bake (which rounds) and a sprite's pen (which truncates) paint the same thing
  for (let u = 0; u < wid; u++) for (let s = 0; s < STEP_PX; s++) for (const c of step(u, wid, s, STEP_PX, 3)) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255);
});

test("the stair is one stone at both ends: the baked flight, its foot in the Vestibule and the stair head above are the same steps", () => {
  // below: the flight as built (open, nothing lying on it), baked
  const d = buildDungeon(), grid = d.grid.slice(), G = GATE_STAIR;
  for (let y = G.y; y < G.y + G.h; y++) for (let x = G.x; x < G.x + G.w; x++) grid[y * d.w + x] = T.FLOOR;
  const c = (globalThis as unknown as { document: { createElement(k: string): RCanvas } }).document.createElement("canvas");
  c.width = d.w * TS; c.height = d.h * TS;
  bakeRegion(c.getContext() as unknown as CanvasRenderingContext2D, { ...d, grid, decals: [] }, G.x, G.y, G.x + G.w - 1, G.y + G.h - 1);
  const wid = G.w * TS;
  let baked = 0;
  for (let wy = G.y * TS; wy < (G.y + G.h) * TS; wy++) for (let u = 2; u < wid - 2; u++) {   // (the outer two pixels carry the walls' shade)
    assert.deepEqual(rgbAt(c, G.x * TS + u, wy), step(u, wid, wy % STEP_PX, STEP_PX, Math.floor(wy / STEP_PX)), `flight pixel ${u},${wy}`);
    baked++;
  }
  assert.equal(baked, (wid - 4) * G.h * TS);
  assert.equal((G.y * TS) % STEP_PX, 0, "the flight begins on a nosing");

  // its foot: three more of the same steps, in step with the flight they lead to
  const foot = sprite("stairfoot", 0), fp = d.props.find((p) => p.id === "stairfoot")!;
  assert.deepEqual([foot.w, foot.h], [36, 3 * STEP_PX + 1]);
  assert.equal(fp.y % STEP_PX, 0, "the foot ends where the flight's first step begins");
  for (let y = 0; y < 3 * STEP_PX; y++) for (let x = 0; x < foot.w; x++) assert.deepEqual(rgbAt(albedo(foot), x, y + 1), step(x, foot.w, y % STEP_PX, STEP_PX, 40 + Math.floor(y / STEP_PX)));

  // above: the stair head's top step is that step again, at the lip; a little earth lies on it
  const head = sprite("buriedgate", OPEN), W = WELL.x1 - WELL.x0;
  let off = 0;
  for (let s = 0; s < STEP_PX; s++) for (let u = 0; u < W; u++) if (!same(rgbAt(albedo(head), WELL.x0 + u, WELL.y1 - STEP_PX + s), step(u, W, s, STEP_PX, 60))) off++;
  assert.ok(off <= 6, `the top step is the flight's stone, pixel for pixel (${off} pixels of earth on it)`);
  // and each step below it is shorter, narrower and darker: it goes down, away under the lintel
  let y1 = WELL.y1; const lit: number[] = [];
  HEAD_STEPS.forEach((h, j) => {
    const y0 = y1 - h; let t = 0, n = 0;
    for (let x = WELL.x0 + j + 4; x < WELL.x1 - j - 4; x++) { t += rgbAt(albedo(head), x, y0)![0]; n++; }
    lit.push(t / n); y1 = y0;
  });
  for (let j = 1; j < lit.length; j++) assert.ok(lit[j] < lit[j - 1] - 8, `step ${j} down is darker than the one above it (${lit.map((v) => v.toFixed(0))})`);
  assert.ok(HEAD_STEPS.every((h, j) => j === 0 || h < HEAD_STEPS[j - 1]) && HEAD_STEPS[0] === STEP_PX);
  // the same stone means the same colour: the mean of the top step above against the mean of the flight below
  const mean = (get: (u: number, s: number) => RGB | null, w: number) => { const m = [0, 0, 0]; let n = 0; for (let s = 0; s < STEP_PX; s++) for (let u = 4; u < w - 4; u++) { const p = get(u, s)!; m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; n++; } return m.map((v) => v / n); };
  const above = mean((u, s) => rgbAt(albedo(head), WELL.x0 + u, WELL.y1 - STEP_PX + s), W), below = mean((u, s) => rgbAt(c, G.x * TS + u, (G.y + 2) * TS + s), wid);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(above[k] - below[k]) < 6, `one stone: ${above.map((v) => v.toFixed(0))} above, ${below.map((v) => v.toFixed(0))} below`);
});

test("the stair head's stone layer is the halls' tumbled fall, not masonry; digging takes stones from the same fall and bares the top steps", () => {
  // the fall is the stone blob's boulders and nothing else, packed over the whole rect
  const rec = () => { const m = new Map<string, string>(); return { m, pen: { p: (x: number, y: number, col: string) => { m.set(`${x},${y}`, col); } } as unknown as Pen }; };
  const all = rec(), some = rec(), again = rec();
  stoneFall(all.pen, 0, 0, 60, 35);
  stoneFall(again.pen, 0, 0, 60, 35);
  stoneFall(some.pen, 0, 0, 60, 35, (_fx, fy) => fy < 0.5);
  assert.deepEqual([...all.m], [...again.m], "always the same fall");
  const ramp = new Set([S.o, S.d, S.m, S.l, S.h]);
  for (const col of all.m.values()) assert.ok(ramp.has(col), "the stone blob's ramp");
  assert.ok(all.m.size > 60 * 35 * 0.8, "packed: earth only shows in the gaps");
  assert.ok(some.m.size < all.m.size * 0.7 && some.m.size > 0);
  for (const k of some.m.keys()) assert.ok(all.m.has(k), "a stone that is still there lies where it lay");
  for (const k of all.m.keys()) { const [x, y] = k.split(",").map(Number); assert.ok(x >= 0 && x < 60 && y >= 0 && y < 35, "nothing rolls out of the well"); }

  // on the sprite: round stone has no long straight run of lit face, as a course of dressed blocks has
  const lit = [hex(S.l), hex(S.h)], stage = (dmg: number) => sprite("buriedgate", digStage(DIG_SITES.buriedgate, dmg, false));
  const earth = DIG_SITES.buriedgate.layers[0].work;
  for (const dmg of [earth, earth + 5]) {
    const s = stage(dmg);
    let longest = 0;
    for (let y = 24; y < WELL.y1; y++) for (let x = WELL.x0, run = 0; x < WELL.x1; x++) { const p = rgbAt(albedo(s), x, y); run = lit.some((l) => same(p, l)) ? run + 1 : 0; longest = Math.max(longest, run); }
    assert.ok(longest >= 3 && longest < 9, `boulders, not brickwork (longest lit run ${longest})`);
  }
  // the top step under the fall: hidden while the stone is whole, bare once it is broken through
  const bare = (s: Sprite) => { let n = 0; const W = WELL.x1 - WELL.x0; for (let r = 0; r < STEP_PX; r++) for (let u = 0; u < W; u++) if (same(rgbAt(albedo(s), WELL.x0 + u, WELL.y1 - STEP_PX + r), step(u, W, r, STEP_PX, 60))) n++; return n / (W * STEP_PX); };
  assert.ok(bare(stage(earth)) < 0.02, "whole: no step shows");
  assert.ok(bare(stage(earth + 5)) > 0.4, "broken through: the stair's own top step shows under what is left");
  assert.ok(bare(sprite("buriedgate", OPEN)) > 0.95);
});
