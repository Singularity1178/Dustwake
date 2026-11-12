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
import { stepShade, cornerShade, treadTone, flightPix, flightSteps, flightStepAt, STEP, KERB, TOP_LEVEL } from "../src/game/art/stairs";
import { RCanvas } from "./support/uiSnapshot";
import { Pen, mulberry, hex, makeCanvas, type Sprite } from "../src/game/util";
import { FS, T, TS } from "../src/game/content/tiles";
import { propDef } from "../src/game/content/props";
import { HARVEST } from "../src/game/content/harvest";
import { DIG_SITES, digStage, digTotal } from "../src/game/content/digging";
import { buildSurface } from "../src/game/surface";
import { buildDungeon } from "../src/game/map";
import { GATE_HALL, GATE_STAIR, STAIR_CHEEK } from "../src/game/content/geography";
import { SAVE_VERSION } from "../src/game/world/save";

// stair: moved deliberately when the stair below was redrawn with depth (docs/ARCHITECTURE.md: "The stair below, with
// depth"): the list it hashes lost `stairfoot` (the three steps that stood out in the Vestibule are gone) and gained
// the two `stairpost`s. The stair head's six stages in it are pixel for pixel as they were (was "e6925303").
const GOLDEN = { rocks: "9fc9a08c", stair: "5bef3221" };
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
  propSprite("stairpost", 0, false); propSprite("stairpost", 1, false);
  for (let v = 0; v <= 5; v++) propSprite("buriedgate", v, false);
  assert.equal(traceHash(), GOLDEN.stair);
});

test("art only: sizes, footprints and what is harvested are as they were, and nothing saved changed", () => {
  assert.equal(SAVE_VERSION, 18, "the retexture changed no saved field (v15 is the stair's cheek walls, v16 raises its newel posts: tests/entrance.test.ts; v17 is routes: tests/routes.test.ts; v18 is townsfolk: tests/folk.test.ts)");
  assert.deepEqual(ROCK_SIZE, { rock: [22, 18], ironore: [22, 18], boulder: [28, 22], outcrop: [48, 32] });
  for (const k of KINDS) {
    const s = propSprite(k, 0, false)!;
    assert.deepEqual([s.w, s.h, s.ax, s.ay], [ROCK_SIZE[k][0], ROCK_SIZE[k][1], ROCK_SIZE[k][0] >> 1, ROCK_SIZE[k][1]], `${k}: size and anchor`);
  }
  assert.deepEqual([propDef("rock").box, propDef("ironore").box, propDef("boulder").box, propDef("outcrop").box], [[16, 8], [16, 8], [22, 9], [40, 12]]);
  assert.deepEqual(Object.keys(HARVEST).sort(), ["ironore", "log", "rock", "tree"], "boulders and outcrops stay scenery");
  for (const [k, w, h] of [["stairpost", 12, 19], ["buriedgate", 72, 58]] as const) { const s = propSprite(k, 0, false)!; assert.deepEqual([s.w, s.h], [w, h], k); }
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

test("the flight has depth: each step up is deeper, wider and lighter, between a coping and a wall face each side; toothed corners, wear down the middle, one stone to a step", () => {
  const W = 64, H = 64, L = flightSteps(H), px = (x: number, y: number) => flightPix(x, y, W, H)[0];
  const med = (v: number[]) => [...v].sort((p, q) => p - q)[v.length >> 1], mean = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length;
  const cols = (x0: number, x1: number, y: number) => Array.from({ length: x1 - x0 }, (_, i) => px(x0 + i, y));
  // the layout: nine steps in the halls' four tiles, end to end; the lowest five rows deep and narrowest, each one
  // up no shallower and a pixel wider each side, to the top one, which runs from coping to coping
  assert.equal(L.length, 9);
  assert.equal(L[0].y0, 0); assert.equal(L[8].y0 + L[8].pitch, H);
  L.forEach((st, i) => {
    if (i) { const lo = L[i - 1]; assert.equal(st.y0, lo.y0 + lo.pitch); assert.ok(st.pitch >= lo.pitch, `step ${i} is no shallower`); assert.equal(st.inset, lo.inset - 1); assert.ok(st.level > lo.level); }
    assert.equal(flightStepAt(st.y0, H), st); assert.equal(flightStepAt(st.y0 + st.pitch - 1, H), st);
  });
  assert.deepEqual([L[0].pitch, L[0].inset, L[0].level], [5, KERB + 8, 1]);
  assert.ok(L[8].pitch >= L[0].pitch + 4, "the top step is nearly twice as deep as the lowest");
  assert.deepEqual([L[8].inset, L[8].level], [KERB, TOP_LEVEL], "the top step is the one the head on the surface starts from");
  // a run of any length is the whole stair, foot to top
  for (const h of [16, 32, 48, 64, 96]) {
    const l = flightSteps(h), last = l[l.length - 1];
    assert.equal(last.y0 + last.pitch, h); assert.equal(last.level, TOP_LEVEL); assert.equal(last.inset, KERB);
    assert.ok(l.every((st, i) => st.pitch >= 4 && (!i || st.pitch >= l[i - 1].pitch)), `${h} rows`);
  }
  const cracks = (st: (typeof L)[number]) => {
    const dark = (x: number, r: number) => px(x, r) < px(x - 2, r) - 7 && px(x, r) < px(x + 2, r) - 7, out: number[] = [];
    for (let x = st.inset + 7; x < W - st.inset - 7; x++) if (dark(x, st.y0 + 1) && dark(x + 1, st.y0 + st.pitch - 2)) out.push(x);
    return out;
  };
  let cracked = 0;
  L.forEach((st, i) => {
    const y = st.y0, last = y + st.pitch - 1;
    // the lip is the lightest row of the tread and the row under the next lip the darkest
    assert.ok(px(24, y) > px(24, y + (st.pitch >> 1)) && px(24, y + (st.pitch >> 1)) > px(24, last), `step ${i}: lip, tread, shadow`);
    // the corner against each wall: lit at the lip, a wedge of shadow by the foot of the next step, and it ends
    for (const x of [st.inset + 3, W - 2 - st.inset]) assert.ok(px(x, y) - px(x, last) > 60 && px(x, last) < px(24, last) + 8, `step ${i}: toothed at x ${x}`);
    assert.ok(px(st.inset + 8, last - 1) > px(st.inset + 1, last - 1) + 15, `step ${i}: the wedge ends`);
    // the walls beside it: the east face catches the light, the west is in its own shade, and both are darker than
    // the tread they stand on; a bed joint runs along the foot of each course
    if (st.inset > KERB + 1) {
      const face = (east: boolean) => { const v: number[] = []; for (let r = y; r < last; r++) for (let k = KERB; k < st.inset; k++) v.push(px(east ? W - 1 - k : k, r)); return mean(v); };
      assert.ok(face(true) > face(false) + 15, `step ${i}: east face lit, west shaded (${face(true) | 0} / ${face(false) | 0})`);
      assert.ok(face(true) < px(24, y + 1) - 10 && face(false) > 20, `step ${i}: faces darker than the tread, and not black`);
    }
    if (st.inset > KERB) assert.ok(px(W - 1 - KERB, last) < px(W - 1 - KERB, last - 1) - 8, `step ${i}: a bed joint`);
    else assert.ok(Math.max(...cols(W - 8 - KERB, W - 1 - KERB, y)) > treadTone(st.level) + 20, `step ${i}: no face left, the tread's lip runs to the coping`);
    // a tread is one stone: at most one crack through it, and never over the crack of the step below
    const c = cracks(st);
    assert.ok(c.length <= 1, `step ${i}: ${c.length} joints`);
    if (i) assert.ok(!c.some((x) => cracks(L[i - 1]).includes(x)), `step ${i}: no joint over a joint`);
    cracked += c.length;
    // each step up is lighter (the lip's row, its median: a chip is not the stone's tone)
    if (i) assert.ok(med(cols(22, 42, y)) > med(cols(22, 42, L[i - 1].y0)) + 2, `step ${i} is lighter than step ${i - 1}`);
  });
  assert.ok(med(cols(22, 42, L[8].y0)) > med(cols(22, 42, 0)) + 30, "the top of the flight is well lighter than its foot");
  assert.ok(cracked >= 1 && cracked <= 6, `${cracked} cracked treads in nine`);
  // worn pale down the middle of the flight (not of each tile): the first tread row, averaged over the steps
  const worn = (x0: number, x1: number) => mean(L.map((st) => mean(cols(x0, x1, st.y0 + 1))));
  assert.ok(worn(26, 38) > worn(16, 21) + 2 && worn(26, 38) > worn(43, 48) + 2);
  // the coping does not step: its rows differ only at its own joints, which sit between the treads' lips; it is
  // lit along its inner edge the whole way, and climbs into the light with the flight
  assert.ok(Math.abs(px(KERB - 1, 1) - px(KERB - 1, 2)) < 8);
  assert.ok(px(KERB - 1, 4) < px(KERB - 1, 3) - 15, "the coping's joint is not on a lip");
  for (let y = 0; y < H; y++) for (const [edge, out] of [[KERB - 1, 0], [W - KERB, W - 1]]) assert.ok(px(edge, y) > px(out, y) + 20, `coping lit at row ${y}`);
  assert.ok(px(KERB - 1, H - 2) > px(KERB - 1, 1) + 25);
});

test("one stair in the halls: a baked run is the flight's own pixels, nothing of it stands out in the Vestibule, and it ends in two newel posts", () => {
  // the flight in a bake: a run four tiles wide and four long in a wall, as in the halls. Its steps are laid over
  // the run's whole length and its walls lie at the run's edges and nowhere between.
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
    const e = flightPix((tx - 2) * TS + lx, (ty - 1) * TS + ly, 4 * TS, 4 * TS).map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
    assert.deepEqual(baked(tx * TS + lx, ty * TS + ly), e, `tile ${tx},${ty} pixel ${lx},${ly}`);
  }
  // and the halls' stair is such a run: stair tiles from wall to wall, choked (rubble) as built, at the end of a
  // flagged hall; no step is drawn anywhere else (the three that stood out in the Vestibule are gone)
  const d = buildDungeon();
  for (let y = GATE_STAIR.y; y < GATE_STAIR.y + GATE_STAIR.h; y++) for (let x = GATE_STAIR.x; x < GATE_STAIR.x + GATE_STAIR.w; x++) assert.equal(d.style[y * d.w + x], FS.STAIR);
  for (let y = GATE_HALL.y; y < GATE_HALL.y + GATE_HALL.h; y++) for (let x = GATE_HALL.x; x < GATE_HALL.x + GATE_HALL.w; x++) assert.equal(d.style[y * d.w + x], FS.FLAG);
  assert.equal(GATE_STAIR.h * TS, 64, "the length the flight's nine steps are laid out for");
  assert.ok(!("stairfoot" in PROP_ART) && !d.props.some((p) => p.kind === "stairfoot"));
  // the newel posts: the stair's stone, standing (a lit top over a darker south face); the whole one fills its
  // sprite, the east one is broken off short; each is as wide as the wall face it ends, and emits nothing
  const whole = raster("stairpost", 0), broken = raster("stairpost", 1);
  const topRow = (s: RCanvas) => { for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (at(s, x, y)) return y; return -1; };
  assert.deepEqual([whole.width, whole.height, broken.width, broken.height], [STAIR_CHEEK.post.w, 19, STAIR_CHEEK.post.w, 19]);
  assert.equal(topRow(whole), 0); assert.ok(topRow(broken) >= 5, "broken off below the capstone");
  assert.ok(lum(whole, 1, 1, 10, 5) > lum(whole, 3, 9, 8, 16) + 30, "top lit, face in shade");
  for (const s of [whole, broken]) for (let x = 2; x < 10; x++) assert.ok(at(s, x, 18), "it stands on the floor");
  for (const v of [0, 1]) { const e = raster("stairpost", v, false, true); assert.ok(e.data.every((x, i) => i % 4 === 3 || x === 0), "no glow"); }
  assert.equal(STAIR_CHEEK.post.w, flightSteps(GATE_STAIR.h * TS)[0].inset + 1, "a post covers the face beside the lowest step, and its edge");
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
