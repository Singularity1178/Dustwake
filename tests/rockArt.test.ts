// The rock and stair retexture: the surface's rocks, iron veins, boulders and outcrops (art/rocks.ts), the one
// stair drawn in three places (art/stairs.ts: its head on the surface, the flight in the halls, its foot in the
// Vestibule) and the dig stages where the stair head's fall shows. Own file: node --test runs each file in a
// fresh process, so the sprite cache starts empty and the traces don't depend on other tests.
//
// It is art only: no prop moved, changed size, changed footprint or changed id, no tile changed, and nothing
// that is saved changed, so there is no save version bump and no migration (pinned below). What moved among the
// existing goldens is told in tests/art.test.ts (the dungeon bake) and tests/artRegistry.test.ts (the props).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { PROP_ART, propSprite } from "../src/game/art/props";
import { bakeRegion } from "../src/game/art/tiles";
import { chunk, rockForm, ROCK_SEEDS, ROCK_SIZE, STONE, IRONSTONE, ORE } from "../src/game/art/rocks";
import { stepShade, cornerShade, treadTone, flightPix, STEP, FOOT_STEPS, KERB } from "../src/game/art/stairs";
import { RCanvas } from "./support/uiSnapshot";
import { Pen, mulberry, hex, makeCanvas, type Sprite } from "../src/game/util";
import { FS, T, TS } from "../src/game/content/tiles";
import { propDef } from "../src/game/content/props";
import { HARVEST } from "../src/game/content/harvest";
import { DIG_SITES, digStage, digTotal } from "../src/game/content/digging";
import { buildSurface } from "../src/game/surface";
import { buildDungeon } from "../src/game/map";
import { GATE_STAIR } from "../src/game/content/geography";
import { SAVE_VERSION } from "../src/game/world/save";

const GOLDEN = { rocks: "9fc9a08c", stair: "e6925303" };
const KINDS = Object.keys(ROCK_SEEDS);

/** One pass of one prop sprite with real pixels (the seed is art/props.ts makeProp's). */
function raster(kind: string, v: number, alt = false, emit = false): RCanvas {
  let out!: RCanvas;
  PROP_ART[kind](v, alt, (w, h, fn) => {
    out = new RCanvas(w, h);
    fn(new Pen(out.getContext() as unknown as CanvasRenderingContext2D, emit), mulberry(kind.length * 101 + v * 13 + (alt ? 7 : 0)));
    return { a: out, e: out, w, h, ax: w >> 1, ay: h } as unknown as Sprite;
  });
  return out;
}
const key = (c: string) => hex(c).join(",");
/** The colour of an opaque pixel ("" where the sprite is clear or only shadowed). */
const at = (c: RCanvas, x: number, y: number) => { const i = (y * c.width + x) * 4; return c.data[i + 3] === 255 ? `${c.data[i]},${c.data[i + 1]},${c.data[i + 2]}` : ""; };
const lum = (c: RCanvas, x0: number, y0: number, x1: number, y1: number) => {
  let s = 0, n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * c.width + x) * 4; s += c.data[i] + c.data[i + 1] + c.data[i + 2]; n += 3; }
  return s / n;
};
/** A rock sprite read back: per pixel its tone (0 outline .. 5 ridge glint), -2 for ore, -1 for anything else. */
function tones(kind: string, v: number) {
  const c = raster(kind, v), ramp = (kind === "ironore" ? IRONSTONE : STONE).map(key), ore = ORE.map(key), t: number[] = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const k = at(c, x, y); t.push(ramp.includes(k) ? ramp.indexOf(k) : ore.includes(k) ? -2 : -1); }
  return { t, w: c.width, h: c.height };
}

test("the retextured sprites are pixel-stable", () => {
  resetTrace();
  for (const k of KINDS) for (let v = 0; v < 4; v++) for (const alt of [false, true]) propSprite(k, v, alt);
  assert.equal(traceHash(), GOLDEN.rocks);
  resetTrace();
  propSprite("stairfoot", 0, false);
  for (let v = 0; v <= 5; v++) propSprite("buriedgate", v, false);
  assert.equal(traceHash(), GOLDEN.stair);
});

test("art only: sizes, footprints and what is harvested are as they were, and nothing saved changed", () => {
  assert.equal(SAVE_VERSION, 14, "no migration: the retexture changes no saved field");
  assert.deepEqual(ROCK_SIZE, { rock: [22, 18], ironore: [22, 18], boulder: [28, 22], outcrop: [48, 32] });
  for (const k of KINDS) {
    const s = propSprite(k, 0, false)!;
    assert.deepEqual([s.w, s.h, s.ax, s.ay], [ROCK_SIZE[k][0], ROCK_SIZE[k][1], ROCK_SIZE[k][0] >> 1, ROCK_SIZE[k][1]], `${k}: size and anchor`);
  }
  assert.deepEqual([propDef("rock").box, propDef("ironore").box, propDef("boulder").box, propDef("outcrop").box], [[16, 8], [16, 8], [22, 9], [40, 12]]);
  assert.deepEqual(Object.keys(HARVEST).sort(), ["ironore", "log", "rock", "tree"], "boulders and outcrops stay scenery");
  for (const [k, w, h] of [["stairfoot", 36, 25], ["buriedgate", 72, 58]] as const) { const s = propSprite(k, 0, false)!; assert.deepEqual([s.w, s.h], [w, h], k); }
  // every variant a builder places has a shape of its own, and the builders place what they placed
  const placed = buildSurface().props.filter((p) => KINDS.includes(p.kind));
  for (const k of KINDS) assert.ok(placed.some((p) => p.kind === k), `${k} stands on the surface`);
  for (const p of placed) assert.ok(p.v >= 0 && p.v < ROCK_SEEDS[p.kind].length, `${p.id}: variant ${p.v} has a shape`);
  assert.equal(placed.filter((p) => p.kind === "ironore").length, 12);
});

test("a rock is cut stone: every tone of the ramp, lit from above, an outline all round, and no glow", () => {
  for (const k of KINDS) ROCK_SEEDS[k].forEach((_seed, v) => {
    const { t, w, h } = tones(k, v), rows = t.map((_x, i) => Math.floor(i / w));
    const solid = t.filter((x) => x !== -1).length;
    assert.ok(solid > w * h * 0.35, `${k} ${v}: the rock fills its sprite (${solid} px)`);
    for (let tone = 0; tone <= 5; tone++) assert.ok(t.includes(tone), `${k} ${v}: tone ${tone} is used`);
    // lit from above: the upper half of the rock is lighter than the lower (a vein's ore takes the place of lit stone)
    const ys = rows.filter((_y, i) => t[i] !== -1), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    const mean = (f: (y: number) => boolean) => { const l = t.filter((x, i) => x > 0 && f(rows[i])); return l.reduce((a, b) => a + b, 0) / l.length; };
    if (k !== "ironore") assert.ok(mean((y) => y < mid) > mean((y) => y >= mid), `${k} ${v}: the top is lighter than the foot`);
    // the sprite holds all of it (no face is cut off at the sprite's edge), and the outline closes it: the body's
    // stone never touches the clear sprite, only its outline (or what grows on it) does
    const c = raster(k, v);
    let cut = 0, open = 0;
    t.forEach((x, i) => {
      if (x <= 0) return;
      const px = i % w, py = Math.floor(i / w);
      if (px === 0 || px === w - 1 || py === 0 || py === h - 1) { cut++; return; }
      if ([[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]].some(([qx, qy]) => at(c, qx, qy) === "")) open++;
    });
    assert.equal(cut, 0, `${k} ${v}: the rock stands inside its sprite`);
    assert.equal(open, 0, `${k} ${v}: the outline is closed`);
    const e = raster(k, v, false, true);
    assert.ok(e.data.every((x, i) => i % 4 === 3 || x === 0), `${k} ${v}: nothing glows`);
  });
});

test("no two rocks are the same shape, and a shape is its seed", () => {
  for (const k of KINDS) {
    const masks = ROCK_SEEDS[k].map((_s, v) => tones(k, v).t.map((x) => x !== -1));
    for (let a = 0; a < masks.length; a++) for (let b = a + 1; b < masks.length; b++) {
      const d = masks[a].filter((x, i) => x !== masks[b][i]).length;
      assert.ok(d >= 40, `${k} ${a} and ${b}: silhouettes differ (${d} px)`);
    }
    assert.equal(new Set(ROCK_SEEDS[k]).size, ROCK_SEEDS[k].length, `${k}: one seed a variant`);
  }
  // the form draws on nothing but its seed: the same chunks every time, other chunks for another seed or kind
  assert.deepEqual(rockForm("rock", 4), rockForm("rock", 4));
  assert.notDeepEqual(rockForm("rock", 4), rockForm("rock", 5));
  assert.notDeepEqual(rockForm("rock", 4), rockForm("boulder", 4));
  // kinds differ in build: a vein is three pieces (tooth, shelf, fallen piece), an outcrop four
  assert.equal(rockForm("ironore", 1).length, 3);
  assert.equal(rockForm("outcrop", 1).length, 4);
  // a chunk is planes with unit normals; the last is its top, facing the sky
  const c = chunk(mulberry(1), 10, 10, 8, 4, 9, { sides: 6, shoulders: 3 });
  assert.equal(c.n.length, 10);
  for (const n of c.n) assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-9);
  assert.ok(c.n[9][2] > 0.9);
});

test("an iron vein is dark ironstone with the ore in it; no other rock has any", () => {
  STONE.forEach((c, i) => { if (i > 0) assert.ok(hex(IRONSTONE[i]).reduce((a, b) => a + b) < hex(c).reduce((a, b) => a + b), `ironstone tone ${i} is darker than stone`); });
  ROCK_SEEDS.ironore.forEach((_s, v) => {
    const c = raster("ironore", v), { t } = tones("ironore", v), ore = t.filter((x) => x === -2).length, solid = t.filter((x) => x !== -1).length;
    assert.ok(ore / solid > 0.08 && ore / solid < 0.28, `vein ${v}: ore is ${Math.round((ore / solid) * 100)}% of the rock: seams in stone, not a lump of it`);
    // a seam cuts lit and shaded faces alike, so it shows in more than one of its colours; the stain is below ore
    const seen = new Set<string>();
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) seen.add(at(c, x, y));
    assert.ok([ORE[0], ORE[1], ORE[2]].filter((o) => seen.has(key(o))).length >= 2, `vein ${v}: the seam is shaded with the face it crosses`);
    for (let y = 1; y < c.height; y++) for (let x = 0; x < c.width; x++) if (at(c, x, y) === key(ORE[4])) assert.ok(ORE.slice(0, 4).map(key).includes(at(c, x, y - 1)), `vein ${v}: rust at ${x},${y} runs down from ore`);
  });
  for (const k of ["rock", "boulder", "outcrop"]) ROCK_SEEDS[k].forEach((_s, v) => assert.ok(!tones(k, v).t.includes(-2), `${k} ${v}: no ore`));
  // broken up, a vein leaves chips flecked with ore and a rock leaves plain ones
  const chips = (kind: string) => { const c = raster(kind, 0, true); let n = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (ORE.map(key).includes(at(c, x, y))) n++; return n; };
  assert.ok(chips("ironore") > 0);
  assert.equal(chips("rock"), 0);
});

test("a step is a solid: a lit lip, then a steady fall into the shadow of the step above", () => {
  assert.equal(STEP, TS / 2, "two steps to a tile");
  for (let pitch = 3; pitch <= STEP; pitch++) {
    const rows = Array.from({ length: pitch }, (_x, s) => stepShade(s, pitch));
    assert.equal(rows[0], stepShade(0, STEP), `pitch ${pitch}: the same lip`);
    assert.equal(rows[pitch - 1], stepShade(STEP - 1, STEP), `pitch ${pitch}: the same deepest shadow`);
    for (let s = 1; s < pitch; s++) assert.ok(rows[s] <= rows[s - 1], `pitch ${pitch}: row ${s} is no lighter than the row before`);
    assert.ok(rows[0] > 0 && rows[pitch - 1] < -40);
    // the corner's wedge of shadow widens toward the foot of the step above
    for (let s = 1; s < pitch; s++) assert.ok(cornerShade(s, pitch) >= cornerShade(s - 1, pitch));
    assert.equal(cornerShade(0, pitch), 0);
    assert.ok(cornerShade(pitch - 1, pitch) >= 2, `pitch ${pitch}: the wedge is there on the shallowest step`);
  }
  for (let l = 1; l < 20; l++) assert.ok(treadTone(l) > treadTone(l - 1), "each step lighter than the one below");
});

test("the flight: kerbs both sides, toothed corners, worn down the middle, and one stone to a step (no courses)", () => {
  const W = 64, px = (x: number, y: number) => flightPix(x, y, W, FOOT_STEPS)[0];
  for (let step = 0; step < 12; step++) {
    const y = step * STEP;
    // the lip is the lightest row of the tread and the row under the next lip the darkest
    assert.ok(px(20, y) > px(20, y + 3) && px(20, y + 3) > px(20, y + 7), `step ${step}: lip, tread, shadow`);
    // the corner against each kerb: lit at the lip, a wedge of shadow by the foot of the next step
    for (const x of [KERB + 1, W - KERB - 2]) assert.ok(px(x, y) - px(x, y + 7) > 60 && px(x, y + 7) < px(20, y + 7) + 8, `step ${step}: toothed at x ${x}`);
    assert.ok(px(KERB + 3, y + 5) > px(KERB, y + 5) + 20, `step ${step}: the wedge ends`);
    // a tread is one stone: at most one crack through it, and never a joint in line with the step below's
    // (a crack runs the depth of the tread and jogs a pixel aside halfway; a pit is one row deep)
    const dark = (x: number, r: number) => px(x, r) < px(x - 2, r) - 7 && px(x, r) < px(x + 2, r) - 7;
    const cracks = (s: number) => { const out: number[] = []; for (let x = KERB + 5; x < W - KERB - 5; x++) if (dark(x, s * STEP + 2) && dark(x, s * STEP + 3) && dark(x + 1, s * STEP + 5)) out.push(x); return out; };
    assert.ok(cracks(step).length <= 1, `step ${step}: ${cracks(step).length} joints`);
    if (step) assert.ok(!cracks(step).some((x) => cracks(step - 1).includes(x)), `step ${step}: no joint over a joint`);
  }
  // worn pale down the middle of the flight (not of each tile): averaged over the treads, the centre is lighter
  const mean = (x0: number, x1: number) => { let s = 0, n = 0; for (let y = 0; y < 96; y++) if (y % STEP > 1 && y % STEP < 5) for (let x = x0; x < x1; x++) { s += px(x, y); n++; } return s / n; };
  assert.ok(mean(26, 38) > mean(8, 20) + 2 && mean(26, 38) > mean(44, 56) + 2);
  // the kerb does not step: its rows differ only at its own joints, which sit between the treads' lips
  assert.ok(Math.abs(px(KERB - 1, 1) - px(KERB - 1, 2)) < 8);
  assert.ok(px(KERB - 1, 4) < px(KERB - 1, 3) - 15, "the kerb's joint is half a step off the lip");
  // each step up is lighter (a tread's row, averaged across the flight)
  const tread = (step: number) => { let s = 0; for (let x = 8; x < 56; x++) s += px(x, step * STEP + 3); return s / 48; };
  for (let step = 1; step < 12; step++) assert.ok(tread(step) > tread(step - 1) + 1, `step ${step} is lighter than step ${step - 1}`);
  assert.ok(tread(11) > tread(0) + 25, "the top of the flight is well lighter than its foot");
  // somewhere a stone has cracked, or the test above proves nothing
  let cracked = 0;
  for (let step = 0; step < 12; step++) for (let x = KERB + 5; x < W - KERB - 5; x++) if (px(x, step * STEP + 2) < px(x - 2, step * STEP + 2) - 7 && px(x, step * STEP + 3) < px(x + 2, step * STEP + 3) - 7 && px(x + 1, step * STEP + 5) < px(x - 1, step * STEP + 5) - 7) cracked++;
  assert.ok(cracked >= 1 && cracked <= 8, `${cracked} cracked treads in twelve`);
});

test("the three places are one stair: the foot and the baked flight are the flight's own pixels", () => {
  // the foot: its three steps are the flight's first three, between their own kerbs
  const foot = raster("stairfoot", 0);
  assert.equal(foot.height, FOOT_STEPS * STEP + 1);
  for (let y = 0; y < FOOT_STEPS * STEP; y++) for (let x = 0; x < 36; x++) {
    const c = flightPix(x, y, 36, 0, 1);
    assert.equal(at(foot, x, y + 1), `${c[0] | 0},${c[1] | 0},${c[2] | 0}`, `foot ${x},${y}`);
  }
  // the flight in a bake: a run four tiles wide in a wall, as in the halls. Its steps are numbered on from the
  // foot, its kerbs lie at the run's edges and nowhere between (the old tile had a worn stripe to every tile).
  const w = 8, h = 6, grid = new Uint8Array(w * h).fill(T.WALL), style = new Uint8Array(w * h);
  for (let y = 1; y <= 4; y++) for (let x = 2; x <= 5; x++) { grid[y * w + x] = y === 3 ? T.RUBBLE : T.FLOOR; style[y * w + x] = FS.STAIR; }
  const c = makeCanvas(w * TS, h * TS);
  let img: { data: Uint8ClampedArray; width: number } | null = null;
  (c.ctx as unknown as { putImageData: (i: { data: Uint8ClampedArray; width: number }) => void }).putImageData = (i) => { img = i; };
  bakeRegion(c.ctx, { w, h, grid, style, decals: [] }, 0, 0, w - 1, h - 1);
  const baked = (x: number, y: number) => { const i = (y * img!.width + x) * 4; return [img!.data[i], img!.data[i + 1], img!.data[i + 2]]; };
  for (let ty = 2; ty <= 4; ty++) for (let tx = 2; tx <= 5; tx++) for (let ly = 0; ly < TS; ly++) for (let lx = 0; lx < TS; lx++) {
    if ((tx === 2 && lx < 2) || (tx === 5 && lx > 13)) continue;                  // the wall's shade on the floor beside it
    const f = ty === 3 ? 0.7 : 1;                                                  // a fall lying on a step darkens it and does not end the run
    const e = flightPix((tx - 2) * TS + lx, (ty - 1) * TS + ly, 4 * TS, FOOT_STEPS).map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
    assert.deepEqual(baked(tx * TS + lx, ty * TS + ly), e, `tile ${tx},${ty} pixel ${lx},${ly}`);
  }
  // and the halls' stair is such a run: stair tiles from wall to wall, choked (rubble) as built
  const d = buildDungeon();
  for (let y = GATE_STAIR.y; y < GATE_STAIR.y + GATE_STAIR.h; y++) for (let x = GATE_STAIR.x; x < GATE_STAIR.x + GATE_STAIR.w; x++) assert.equal(d.style[y * d.w + x], FS.STAIR);
});

test("the head goes down into the dark, and the fall above is the fall below: boulders, never courses", () => {
  const site = DIG_SITES.buriedgate, total = digTotal(site);
  assert.deepEqual([0, 2, 6, 8, 13].map((dmg) => digStage(site, dmg, false)).concat(digStage(site, total, true)), [0, 1, 2, 3, 4, 5], "the stages are as they were");
  // open: the top step in daylight, each lower one darker, lost under the lintel
  const open = raster("buriedgate", 5);
  const near = lum(open, 10, 50, 61, 57), mid = lum(open, 10, 34, 61, 42), far = lum(open, 10, 15, 61, 22);
  assert.ok(near > mid * 1.5 && mid > far * 2 && far < 25, `near ${near | 0}, mid ${mid | 0}, far ${far | 0}`);
  // its top step is a step of the flight below: the same lip over the same tread, a little lighter than the halls' last
  const topStep = (y: number) => lum(open, 16, y, 24, y);
  assert.ok(topStep(50) > topStep(53) && topStep(53) > topStep(57), "lip, tread, shadow");
  // the well narrows as it goes down: the lit tread of a lower step is shorter than the top one's
  const litW = (y: number) => { let n = 0; for (let x = 6; x < 66; x++) if (open.data[(y * open.width + x) * 4] > 60) n++; return n; };
  assert.ok(litW(51) > litW(37) + 4, `${litW(51)} px wide at the top step, ${litW(37)} three steps down`);
  // the glyph on the lintel wakes only when the stair is open
  const glow = (v: number) => { const e = raster("buriedgate", v, false, true); let n = 0; for (let i = 0; i < e.data.length; i += 4) if (e.data[i] + e.data[i + 1] + e.data[i + 2] > 0) n++; return n; };
  assert.deepEqual([0, 1, 2, 3, 4].map(glow), [0, 0, 0, 0, 0]);
  assert.ok(glow(5) > 0);

  // the fall: stone in the halls' ramp, heaped. A wall has courses, and a course is a joint running the width of
  // the pit (the old sprite's did, every seventh row); no row of a heap is all joint.
  const stone = STONE.slice(1, 5).map(key), line = key(STONE[0]);
  const read = (v: number) => {
    const c = raster("buriedgate", v); let n = 0, worst = 0;
    for (let y = 22; y < 58; y++) { let o = 0; for (let x = 7; x < 65; x++) { const k = at(c, x, y); if (stone.includes(k)) n++; if (k === line) o++; } worst = Math.max(worst, o / 58); }
    return { stone: n, worst };
  };
  const laid = read(3), broken = read(4), clear = read(5);
  assert.ok(laid.stone > 800, `the fall fills the pit (${laid.stone} px of stone)`);
  assert.ok(laid.worst < 0.8 && broken.worst < 0.8, `no course: at most ${Math.round(Math.max(laid.worst, broken.worst) * 100)}% of a row is outline`);
  assert.ok(broken.stone < laid.stone - 80 && broken.stone > laid.stone * 0.6, "broken through: a breach, most of the fall still there");
  assert.equal(clear.stone, 0, "open: the fall is gone");
  // through the breach the stair shows: the breach's rows carry the open well's steps, dimmed
  const br = raster("buriedgate", 4);
  assert.ok(lum(br, 30, 40, 44, 46) > 20 && lum(br, 30, 40, 44, 46) < lum(open, 30, 40, 44, 46), "steps in the breach, darker than by day");
});
