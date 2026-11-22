// Phase 0.3 (dynamic areas) and the save changes that go with them (v20: specs, run-length grids).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, player, getArea, enterArea, createArea, hasArea } from "../src/game/world/world";
import { serialize, deserialize, SAVE_VERSION, RLE_MIN_TILES } from "../src/game/world/save";
import { buildFromSpec, linkPortalId, type AreaSpec } from "../src/game/world/areaSpec";
import { rleEncode, rleDecode } from "../src/game/world/rle";
import { simTick } from "../src/game/sim/replay";
import { T, isSolidT } from "../src/game/content/tiles";

const spec = (o: Partial<AreaSpec> = {}): AreaSpec => ({ id: "gen.floor.1", kind: "floor", seed: 5, w: 56, h: 36, parent: "dungeon", depth: 1, link: { area: "dungeon", x: 100, y: 100 }, ...o });

test("a spec builds the same area every time; another seed another; floors and caves both have a way up and stand-on ground", () => {
  const a = buildFromSpec(spec()), b = buildFromSpec(spec()), c = buildFromSpec(spec({ seed: 6 }));
  assert.deepEqual([...a.grid], [...b.grid]);
  assert.notDeepEqual([...a.grid], [...c.grid]);
  for (const d of [a, buildFromSpec(spec({ id: "gen.cave.1", kind: "cave", seed: 9 }))]) {
    const up = d.portals?.find((p) => p.id === "up");
    assert.ok(up, `${d.id} has a way up`);
    assert.equal(up!.to.portal, linkPortalId(d.id));
    const tx = Math.floor(d.start.x / 16), ty = Math.floor((d.start.y - 1) / 16);
    assert.ok(!isSolidT(d.grid[ty * d.w + tx]), `${d.id} starts on open ground`);
    assert.ok(d.w >= 48 && d.h >= 32, "at least the widest view");
  }
  assert.throws(() => buildFromSpec(spec({ kind: "nope" })), /unknown area kind/);
});

const walk = (w: ReturnType<typeof createWorld>, iy: number, until: () => boolean, max = 240) => {
  for (let i = 0; i < max && !until(); i++) simTick(w, { ix: 0, iy, use: false });
  return until();
};

test("acceptance (0.3): a generated floor is created, entered, saved, loaded and left (and entered again)", () => {
  const w = createWorld(21), pl = player(w), d = getArea(w, "dungeon");
  const link = { area: "dungeon", x: Math.round(pl.x), y: Math.round(pl.y) };
  const floor = createArea(w, { kind: "floor", seed: 99, w: 56, h: 36, parent: "dungeon", depth: 1, link, label: "Test floor" });
  assert.ok(floor.id.startsWith("gen.floor.") && hasArea(w, floor.id));
  assert.ok(d.base.portals?.some((p) => p.id === linkPortalId(floor.id)), "the parent gained its way down");
  enterArea(w, pl, floor.id, floor.base.start.x, floor.base.start.y);
  // change something, so the save carries a diff of the generated area
  const tx = Math.floor(floor.base.start.x / 16) + 2, ty = Math.floor(floor.base.start.y / 16) + 1;
  floor.setTile(tx, ty, T.RUBBLE);
  const save = serialize(w);
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.specs.length, 1);
  assert.ok(save.areas[floor.id].tiles.length >= 1);
  const w2 = deserialize(JSON.parse(JSON.stringify(save)));
  assert.equal(JSON.stringify(serialize(w2)), JSON.stringify(save), "the round trip is exact");
  const f2 = w2.areas.get(floor.id)!;
  assert.equal(f2.grid[ty * f2.w + tx], T.RUBBLE);
  assert.ok(w2.areas.get("dungeon")!.base.portals?.some((p) => p.id === linkPortalId(floor.id)), "the way down is re-attached on load");
  // leave by the stair nook: push up from where you arrived
  const p2 = player(w2);
  assert.ok(walk(w2, -1, () => p2.area === "dungeon"), "walked up and out");
  assert.ok(Math.hypot(p2.x - link.x, p2.y - link.y) < 40, "came out beside the link point");
  // and back down through the hole (a player steers onto it; here: step over it, then push down)
  p2.x = link.x; p2.y = link.y - 7; p2.vx = 0; p2.vy = 0;
  assert.ok(walk(w2, 1, () => p2.area === floor.id), "walked back down");
});

test("player-built areas keep their whole grid run-length coded; a big edit switches an authored area to the grid; both load back exactly", () => {
  const w = createWorld(22);
  const built = createArea(w, { kind: "cave", seed: 3, w: 50, h: 34, store: "grid", label: "Dug-out" });
  const s1 = serialize(w);
  assert.ok(s1.areas[built.id].gridRle && s1.areas[built.id].tiles.length === 0);
  const d = getArea(w, "dungeon");
  let n = 0;
  for (let i = 0; i < d.grid.length && n <= RLE_MIN_TILES; i++) if (d.grid[i] === T.WALL) { d.setTile(i % d.w, Math.floor(i / d.w), T.RUBBLE); n++; }
  const s2 = serialize(w);
  assert.ok(s2.areas.dungeon.gridRle, "large edits are saved as the grid");
  assert.ok(s2.areas.dungeon.gridRle!.length < 4000, `compressed to ${s2.areas.dungeon.gridRle!.length} chars`);
  const w2 = deserialize(JSON.parse(JSON.stringify(s2)));
  assert.deepEqual([...w2.areas.get("dungeon")!.grid], [...d.grid]);
  assert.deepEqual([...w2.areas.get(built.id)!.grid], [...built.grid]);
  assert.equal(JSON.stringify(serialize(w2)), JSON.stringify(s2));
});

test("run-length coding round-trips any grid and refuses a damaged one", () => {
  const g = new Uint8Array(5000);
  for (let i = 0; i < g.length; i++) g[i] = i % 977 < 600 ? 1 : (i * 7) % 5;
  assert.deepEqual([...rleDecode(rleEncode(g), g.length)], [...g]);
  assert.deepEqual([...rleDecode(rleEncode(new Uint8Array(0)))], []);
  assert.throws(() => rleDecode(rleEncode(g), g.length + 1));
});

test("a v19 save still loads (it made no areas at runtime) and plays on; ids never collide", () => {
  const s: any = serialize(createWorld(23));
  s.version = 19; delete s.specs;
  const w = deserialize(s);
  assert.equal(w.specs.size, 0);
  for (let i = 0; i < 30; i++) simTick(w);
  const a = createArea(w, { kind: "floor", seed: 1, w: 50, h: 32 }), b = createArea(w, { kind: "floor", seed: 2, w: 50, h: 32 });
  assert.notEqual(a.id, b.id);
  assert.throws(() => createArea(w, { id: "town", kind: "floor", seed: 1, w: 50, h: 32 }), /already exists/);
});
