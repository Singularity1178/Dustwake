// The background as a cache of chunk canvases (view/areaView.ts), held against the single whole-area canvas it
// replaced. On a canvas that really holds pixels (support/rasterCanvas.ts), so "identical" is compared, not argued:
//
//   - every frame the new view draws is, pixel for pixel, the frame the old one drew: anywhere on the overworld, at
//     every zoom, at the map's edges, with the camera shaken past them; after the world changes under it; after
//     chunks have been dropped and baked again;
//   - memory is bounded by the view, not the area: the cache never outgrows its capacity, canvases are reused, and
//     nothing ever asks for a canvas larger than a chunk;
//   - walking never bakes in `prepare` (no hitch): the margin ahead is ready before the camera gets there, at one
//     chunk a frame, and a zoom all the way out finds its ground baked;
//   - an area 8192 tiles a side (131072 px: far past any browser's canvas) costs what the surface costs today;
//   - the lookups that make a frame independent of the area's size (props by place, decals and lights near a rect)
//     answer exactly what walking the whole list answers, in the same order.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installRasterCanvas, canvasLog, resetCanvasLog, type RasterCanvas } from "./support/rasterCanvas";
installRasterCanvas();
import { T, TS } from "../src/game/content/tiles";
import { Area, unionRect, type TileRect } from "../src/game/world/area";
import { getArea, createWorld } from "../src/game/world/world";
import type { AreaData, DecalDef } from "../src/game/map";
import { bakeRegion } from "../src/game/art/tiles";
import { decalBounds, decalsNear } from "../src/game/art/decals";
import { makeCanvas } from "../src/game/util";
import { AHEAD, AreaView, CH } from "../src/game/view/areaView";
import { ZOOM_STEPS, viewSize } from "../src/game/view/zoom";

const CPX = CH * TS;
const px = (c: HTMLCanvasElement) => Buffer.from((c as unknown as RasterCanvas).pixels().buffer);

/** The background exactly as view/areaView.ts kept it before the chunk cache: one canvas for the whole area. */
class OldBackground {
  readonly bg: ReturnType<typeof makeCanvas>;
  private pending: TileRect | null = null;
  private baked: Uint8Array; private cw: number; private chh: number;
  constructor(private area: Area) {
    this.bg = makeCanvas(area.w * TS, area.h * TS);
    this.cw = Math.ceil(area.w / CH); this.chh = Math.ceil(area.h / CH);
    this.baked = new Uint8Array(this.cw * this.chh);
    area.onChange((r) => { this.pending = unionRect(this.pending, r); });
  }
  private bakeChunk(i: number) {
    if (this.baked[i]) return;
    this.baked[i] = 1;
    const cx = i % this.cw, cy = Math.floor(i / this.cw);
    bakeRegion(this.bg.ctx, this.area, cx * CH, cy * CH, Math.min(this.area.w, (cx + 1) * CH) - 1, Math.min(this.area.h, (cy + 1) * CH) - 1);
  }
  prepare(camX: number, camY: number, w: number, h: number) {
    const x0 = Math.max(0, Math.floor(camX / TS / CH)), x1 = Math.min(this.cw - 1, Math.floor((camX + w) / TS / CH));
    const y0 = Math.max(0, Math.floor(camY / TS / CH)), y1 = Math.min(this.chh - 1, Math.floor((camY + h) / TS / CH));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) this.bakeChunk(cy * this.cw + cx);
  }
  flush() { const r = this.pending; if (!r) return; this.pending = null; bakeRegion(this.bg.ctx, this.area, r.x0, r.y0, r.x1, r.y1); }
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, W: number, H: number) { ctx.drawImage(this.bg.c, camX, camY, W, H, 0, 0, W, H); }
}

/** One frame's background from each, onto black, as the renderer does it. Returns whether they are the same picture. */
function sameFrame(v: AreaView, old: OldBackground, camX: number, camY: number, W: number, H: number): boolean {
  const a = makeCanvas(W, H), b = makeCanvas(W, H);
  for (const t of [a, b]) { t.ctx.fillStyle = "#000"; t.ctx.fillRect(0, 0, W, H); }
  v.prepare(camX, camY, W, H); v.draw(a.ctx, camX, camY, W, H); v.idle();
  old.prepare(camX, camY, W, H); old.draw(b.ctx, camX, camY, W, H);
  return px(a.c).equals(px(b.c));
}
const overworld = () => getArea(createWorld(3), "surface");
/** A deterministic stream of numbers in [0, 1). */
const rnd = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

test("the chunked background is the old single canvas, pixel for pixel: anywhere, at every zoom, at and past the edges", () => {
  const a = overworld(), aw = a.w * TS, ah = a.h * TS, r = rnd(7);
  resetCanvasLog();
  const v = new AreaView(a);
  const made = canvasLog.made;
  const old = new OldBackground(a);
  let frames = 0;
  for (const z of ZOOM_STEPS) {
    const { w, h } = viewSize(z);
    const cams: [number, number][] = [
      [0, 0], [aw - w, 0], [0, ah - h], [aw - w, ah - h],
      // the camera shaken past each edge (view/camera.ts adds the shake after clamping)
      [-5, -7], [aw - w + 6, ah - h + 4], [-3, ah - h + 9], [aw - w + 2, -8],
      // on chunk lines, and one pixel either side of them
      [CPX * 9, CPX * 3], [CPX * 9 - 1, CPX * 3 - 1], [CPX * 9 + 1, CPX * 3 + 1],
    ];
    // west along the road from the ruins to Westwake's far wall, at a stride that lines up with nothing
    for (let x = aw - w, y = 300; x > 0; x -= 197, y = (y + 61) % (ah - h)) cams.push([x, y]);
    for (let i = 0; i < 12; i++) cams.push([Math.floor(r() * (aw - w)), Math.floor(r() * (ah - h))]);
    for (const [x, y] of cams) { frames++; assert.ok(sameFrame(v, old, x, y, w, h), `the frame at ${x},${y} (${w}x${h})`); }
  }
  assert.ok(frames > 90);
  // the view's canvases are chunks, reused as the camera moves on: far fewer than were baked, fewer than the area has
  assert.ok(v.stats.chunksEvicted > 0 && v.stats.canvases * 2 < v.stats.chunksBaked && v.stats.canvases < Math.ceil(a.w / CH) * Math.ceil(a.h / CH), `${v.stats.canvases} chunk canvases for ${v.stats.chunksBaked} bakes`);
  assert.ok(canvasLog.made - made > frames * 2);
});

test("the world changing under the view: only what a change touches is baked again, and the picture is still the old one", () => {
  const a = overworld(), aw = a.w * TS;
  const v = new AreaView(a), old = new OldBackground(a);
  const { w, h } = viewSize(1), camX = aw - 900, camY = 400;
  assert.ok(sameFrame(v, old, camX, camY, w, h));
  while (v.idle()) { /* the margin around the view */ }
  const tuft = a.decals.find((d) => d.kind === "tuft") ?? a.decals[0];
  const decal = (x: number, y: number): DecalDef => ({ ...tuft, x, y });
  const tile = (x: number, y: number) => ({ tx: Math.floor(x / TS), ty: Math.floor(y / TS) });
  const both = () => { const f = v.flush(); old.flush(); return f; };
  // in view, on the corner where four chunks meet (its dirty rect reaches into all four)
  const c = { tx: Math.ceil((camX + 150) / CPX) * CH, ty: Math.ceil((camY + 60) / CPX) * CH };
  let baked = v.stats.chunksBaked;
  a.setTile(c.tx, c.ty, T.WALL); a.setTile(c.tx - 1, c.ty - 1, T.RUBBLE); a.addDecal(decal(c.tx * TS + 1, c.ty * TS - 2));
  assert.ok(both());
  assert.equal(v.stats.chunksBaked, baked, "no chunk is baked whole for a change: the touched part of each is");
  assert.ok(sameFrame(v, old, camX, camY, w, h), "a change in view");
  // in the margin: held, not in view. Seen right when the camera gets there.
  const m = tile(camX - 200, camY + 40);
  assert.ok(v.hasChunkAt(m.tx, m.ty));
  a.setTile(m.tx, m.ty, T.WALL); a.addDecal(decal(camX - 190, camY + 70));
  both();
  assert.ok(sameFrame(v, old, camX - 260, camY, w, h), "a change in the margin");
  // far away, where no chunk is held: it costs nothing now, and is there when the camera comes
  const far = tile(600, 500);
  assert.ok(!v.hasChunkAt(far.tx, far.ty));
  baked = v.stats.chunksBaked;
  a.setTile(far.tx, far.ty, T.WALL); a.addDecal(decal(610, 520));
  both();
  assert.equal(v.stats.chunksBaked, baked);
  assert.ok(sameFrame(v, old, 600 - 160, 500 - 90, w, h), "a change made where nothing was held");
  // two changes a long way apart in one frame. The old view baked everything between them again (one rect around
  // both); here each costs its own few tiles. Same picture either way.
  assert.ok(sameFrame(v, old, camX, camY, w, h));
  baked = v.stats.chunksBaked;
  a.setTile(c.tx + 3, c.ty + 2, T.WALL); a.setTile(8, 40, T.WALL);
  both();
  assert.equal(v.stats.chunksBaked, baked);
  for (const [x, y] of [[camX, camY], [0, 40 * TS - 90], [aw / 2, 300]]) assert.ok(sameFrame(v, old, x, y, w, h), `after changes far apart, at ${x},${y}`);
  // a flood of changes in one frame (more than are worth baking piece by piece): still the same picture
  for (let i = 0; i < 100; i++) a.setTile(c.tx - 10 + (i % 20), c.ty - 4 + Math.floor(i / 20), i % 3 ? T.FLOOR : T.WALL);
  both();
  assert.ok(sameFrame(v, old, camX, camY, w, h), "after a flood of changes");
  assert.ok(sameFrame(v, old, camX - 300, camY + 100, w, h));
});

test("memory is the view's, not the area's: the cache keeps to its capacity across a walk of the whole land and back", () => {
  const a = overworld(), aw = a.w * TS, total = Math.ceil(a.w / CH) * Math.ceil(a.h / CH);
  const v = new AreaView(a), old = new OldBackground(a);
  const { w, h } = viewSize(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  let most = 0, cap = 0;
  const step = (x: number, y: number) => { v.prepare(x, y, w, h); v.idle(); most = Math.max(most, v.chunkCount); cap = Math.max(cap, v.capacity); assert.ok(v.chunkCount <= v.capacity + 1, `${v.chunkCount} held, capacity ${v.capacity}`); };
  for (let x = aw - w; x >= 0; x -= 7) step(x, 380);
  for (let x = 0; x <= aw - w; x += 7) step(x, 380);
  assert.ok(most < total, `${most} of the area's ${total} chunks at most`);
  assert.ok(v.stats.chunksEvicted > 0 && v.stats.canvases <= cap + 8, `${v.stats.canvases} canvases ever made for ${v.stats.chunksBaked} bakes`);
  // and what was dropped and baked again is the same ground
  for (const x of [aw - w, aw - w - 333, 1000, 0]) assert.ok(sameFrame(v, old, x, 380, w, h));
  // a short walk there and back bakes nothing twice: the cache has slack, and what was just left is the last to go
  const settle = (x: number) => { v.prepare(x, 380, w, h); while (v.idle()) { /* the margin */ } };
  settle(0);
  const baked = v.stats.chunksBaked;
  for (let x = 0; x <= 300; x += 5) settle(x);
  const there = v.stats.chunksBaked;
  for (let x = 300; x >= 0; x -= 5) step(x, 380);
  assert.ok(there > baked && v.stats.chunksBaked === there, "coming straight back bakes nothing");
});

test("no hitch: walking never bakes in prepare, the margin ahead is ready first; a zoom all the way out finds its ground baked", () => {
  const a = overworld(), aw = a.w * TS;
  for (const z of ZOOM_STEPS) {
    const { w, h } = viewSize(z);
    const v = new AreaView(a);
    let x = aw - w - 40, y = 500;
    v.prepare(x, y, w, h);
    while (v.idle()) { /* standing: the margin fills, one chunk a frame, then the work stops */ }
    const ready = v.stats.chunksBaked;
    assert.ok(ready <= (Math.ceil(w / CPX) + 1 + 2 * AHEAD) * (Math.ceil(h / CPX) + 1 + 2 * AHEAD), `standing still bakes the view and its margin and no more (${ready})`);
    // west, then diagonally, then back east, then up: 4 px a frame is a run, and quicker than the camera's ease lets it go
    const legs: [number, number, number][] = [[-4, 0, 300], [-3, -2, 120], [4, 1, 200], [0, -4, 60], [-4, 3, 100]];
    let frames = 0;
    for (const [dx, dy, n] of legs) for (let i = 0; i < n; i++) {
      x = Math.max(0, Math.min(aw - w, x + dx)); y = Math.max(0, Math.min(a.h * TS - h, y + dy));
      const before = v.stats.chunksBaked;
      v.prepare(x, y, w, h);
      assert.equal(v.stats.chunksBaked, before, `frame ${frames} at ${x},${y} (${z}x): prepare had to bake`);
      v.idle();
      assert.ok(v.stats.chunksBaked - before <= 1, "at most one chunk a frame, in idle time");
      frames++;
    }
  }
  // zooming out from the closest view to the widest, standing still: the wider view lies inside the margin
  const near = viewSize(ZOOM_STEPS[0]), wide = viewSize(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  assert.ok((wide.w - near.w) / 2 <= AHEAD * CPX && (wide.h - near.h) / 2 <= AHEAD * CPX);
  const v = new AreaView(a), cx = aw - 700, cy = 560;
  v.prepare(cx - near.w / 2, cy - near.h / 2, near.w, near.h);
  while (v.idle()) { /* settle */ }
  const before = v.stats.chunksBaked;
  v.prepare(cx - wide.w / 2, cy - wide.h / 2, wide.w, wide.h);
  assert.equal(v.stats.chunksBaked, before, "zooming out bakes nothing");
});

test("an area 8192 tiles a side costs what the surface costs: no large canvas, the same work a frame, the right ground", () => {
  const N = 8192, real = overworld();
  const grid = new Uint8Array(N * N).fill(T.FLOOR), zero = new Uint8Array(N * N);
  // a patch of walls and rubble by each place the camera will go, so the ground is not all one tile
  const spots: [number, number][] = [[40, 30], [N - 60, N - 50], [N / 2, N / 2 + 3], [N - 30, 20]];
  for (const [tx, ty] of spots) for (let i = 0; i < 40; i++) grid[(ty + (i * 7) % 11) * N + tx + (i * 5) % 17] = i % 4 === 0 ? T.RUBBLE : T.WALL;
  const tuft = real.decals.find((d) => d.kind === "tuft") ?? real.decals[0], tree = real.props.find((p) => p.kind === "tree")!;
  const decals: DecalDef[] = [], props: AreaData["props"] = [], lights: AreaData["lights"] = [];
  spots.forEach(([tx, ty], i) => {
    for (let k = 0; k < 30; k++) decals.push({ ...tuft, x: tx * TS + ((k * 37) % 300) - 100, y: ty * TS + ((k * 53) % 200) - 60 });
    for (let k = 0; k < 20; k++) props.push({ id: `tree${i}.${k}`, kind: tree.kind, v: tree.v, x: tx * TS + ((k * 41) % 400) - 150, y: ty * TS + ((k * 29) % 240) - 80 });
    lights.push({ x: tx * TS + 20, y: ty * TS + 30, rad: 80, col: [1, 0.8, 0.5], int: 1, flick: 0.1 });
  });
  const base: AreaData = { id: "vast", w: N, h: N, grid, plan: zero, style: zero, tvar: zero, rooms: [], props, decals, lights, loose: [], start: { x: 700, y: 500 }, exits: [], drips: [] };
  const area = new Area(base);
  resetCanvasLog();
  const v = new AreaView(area), small = new AreaView(real);
  const { w, h } = viewSize(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  for (const [tx, ty] of spots) {
    const camX = Math.min(N * TS - w, Math.max(0, tx * TS - w / 2 + 13)), camY = Math.min(N * TS - h, Math.max(0, ty * TS - h / 2 + 7));
    const out = makeCanvas(w, h), ref = makeCanvas(w, h);
    v.prepare(camX, camY, w, h); v.draw(out.ctx, camX, camY, w, h);
    while (v.idle()) { /* its margin */ }
    // the same ground baked straight into a view-sized canvas (there is no whole-area canvas to compare with: that is the point)
    bakeRegion(ref.ctx, area, Math.floor(camX / TS), Math.floor(camY / TS), Math.floor((camX + w) / TS), Math.floor((camY + h) / TS), camX, camY);
    assert.ok(px(out.c).equals(px(ref.c)), `the frame at tile ${tx},${ty}`);
    assert.equal(v.lightsNear(camX, camY, camX + w, camY + h).length, 1, "one light reaches this view, of the four the area holds");
    assert.equal(area.propsIn(camX - 48, camY - 16, camX + w + 48, camY + h + 60).length, area.props.filter((p) => p.x >= camX - 48 && p.x <= camX + w + 48 && p.y >= camY - 16 && p.y <= camY + h + 60).length);
  }
  assert.ok(canvasLog.maxW <= Math.max(w, CPX) && canvasLog.maxH <= Math.max(h, CPX), `no canvas wider than the view was ever asked for (largest ${canvasLog.maxW}x${canvasLog.maxH}; the area is ${N * TS} px a side)`);
  // the cache is as large as it would be on the surface for the same view, though this area has over a million chunks
  // (it may run over its capacity by the margin `idle` fills, until the next prepare)
  assert.ok(v.chunkCount <= v.capacity * 1.5, `${v.chunkCount} chunks held, capacity ${v.capacity}`);
  const [sx, sy] = spots[0];
  v.prepare(sx * TS - w / 2, sy * TS - h / 2, w, h); small.prepare(sx * TS - w / 2, sy * TS - h / 2, w, h);
  assert.equal(v.capacity, small.capacity);
  assert.ok(v.chunkCount <= v.capacity);
  assert.equal(v.stats.visTraced, spots.length, "lights are traced as they come into view, never all of them");
  // a change at the far corner while the camera is at the near one: nothing to do; and one in view: its few tiles
  const [tx, ty] = spots[0];
  v.prepare(tx * TS - w / 2, ty * TS - h / 2, w, h);
  const baked = v.stats.chunksBaked;
  area.setTile(N - 5, N - 5, T.WALL); area.setTile(tx, ty, T.RUBBLE);
  assert.ok(v.flush());
  assert.equal(v.stats.chunksBaked, baked);
});

test("props by place, decals near a rect: what walking the whole list would answer, in the same order, as things come and go", () => {
  const a = overworld(), r = rnd(11), aw = a.w * TS, ah = a.h * TS;
  const brute = (x0: number, y0: number, x1: number, y1: number) => a.props.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
  const check = (n: number) => {
    for (let i = 0; i < n; i++) {
      const x0 = r() * (aw + 200) - 100, y0 = r() * (ah + 200) - 100, x1 = x0 + r() * 800, y1 = y0 + r() * 500;
      assert.deepEqual(a.propsIn(x0, y0, x1, y1).map((p) => p.id), brute(x0, y0, x1, y1).map((p) => p.id));
    }
  };
  check(300);
  assert.deepEqual(a.propsIn(-1e6, -1e6, 1e6, 1e6).map((p) => p.id), a.props.map((p) => p.id), "the whole area, in the area's order");
  for (const kind of ["tree", "runecircle", "nothing-of-this-kind"]) assert.deepEqual(a.propsOfKind(kind), a.props.filter((p) => p.kind === kind));
  // built and taken apart
  const gone = a.props.filter((_, i) => i % 9 === 0).slice(0, 60);
  for (const p of gone) a.removeProp(p.id);
  for (let i = 0; i < 40; i++) a.addProp("torch", Math.floor(r() * aw), Math.floor(r() * ah));
  check(300);
  assert.deepEqual(a.propsOfKind("torch"), a.props.filter((p) => p.kind === "torch"));
  assert.deepEqual(a.propsOfKind("tree"), a.props.filter((p) => p.kind === "tree"));

  const near = (x0: number, y0: number, x1: number, y1: number) => {
    const b = decalBounds(a.decals), out: number[] = [];
    for (let i = 0, k = 0; i < a.decals.length; i++, k += 4) if (!(b[k + 2] < x0 || b[k] > x1 || b[k + 3] < y0 || b[k + 1] > y1)) out.push(i);
    return out;
  };
  const decals = (n: number) => {
    for (let i = 0; i < n; i++) {
      const x0 = Math.floor(r() * aw), y0 = Math.floor(r() * ah), x1 = x0 + Math.floor(r() * 400), y1 = y0 + Math.floor(r() * 300);
      assert.deepEqual(decalsNear(a.decals, x0, y0, x1, y1), near(x0, y0, x1, y1));
    }
  };
  decals(200);
  const d0 = a.decals[0];
  for (let i = 0; i < 50; i++) a.addDecal({ ...d0, x: Math.floor(r() * aw), y: Math.floor(r() * ah) });
  decals(200);
});
