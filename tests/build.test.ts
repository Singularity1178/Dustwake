// Building overhaul: catalog data, wall placement, gating, built-prop saves,
// the crafting bench's station path, and deconstruction (refunds, overflow,
// caches, persistence of removed authored props, refusals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { player, currentArea, setFlag, enterArea, makeActor, type World } from "../src/game/world/world";
import { serialize, deserialize, migrate, SAVE_VERSION } from "../src/game/world/save";
import { addItems, countItem, capacity } from "../src/game/sim/inventory";
import { orderBuild, orderDeconstruct } from "../src/game/sim/commands";
import { placement, siteFor, suggestTile, deconstructCheck, deconTargetAt, salvageOf, applyDeconstruct } from "../src/game/sim/build";
import { enqueueTask, applyEffect } from "../src/game/sim/tasks";
import { interactables, allInteractables } from "../src/game/sim/interact";
import { catalogEntries, queryCatalog, matchesSearch, sortEntries, entryFor, entryReason, type CatalogEntry, type CatalogQuery } from "../src/game/sim/catalog";
import { craftEntries, orderCraft } from "../src/game/sim/crafting";
import { RECIPES, AUTHORED_SALVAGE, BUILD_CATEGORIES, type Recipe } from "../src/game/content/build";
import { CRAFT_RECIPES } from "../src/game/content/crafting";
import { PROPS } from "../src/game/content/props";
import { PROP_ART } from "../src/game/art";
import { FLAGS } from "../src/game/content/flags";
import { FONT_GLYPHS } from "../src/game/font";
import { TS, T } from "../src/game/content/tiles";
import { AreaView } from "../src/game/view/areaView";
import { newWorld, frame, frames, events, useOn } from "./helpers";

// ------------------------------------------------------------------ fixtures
const finish = (w: World) => { let g = 0; while (player(w).task && g++ < 600) frame(w); };
const kit = (w: World, wood = 30, stone = 30) => { const pl = player(w); setFlag(w, FLAGS.knowBuild); addItems(w, pl, "wood", wood); addItems(w, pl, "stone", stone); };

/** In the dungeon's translocation room, below a free plain wall face on row 2. */
function atWallFace(w: World) {
  const a = currentArea(w), pl = player(w);
  frame(w);
  for (let tx = 9; tx <= 13; tx++) {
    if (a.tile(tx, 2) === T.WALL && a.tile(tx, 3) === T.FLOOR && a.tile(tx, 4) === T.FLOOR && siteFor(w, a, "wall_torch", tx, 2).ok) {
      pl.x = tx * TS + 8; pl.y = 4 * TS + 12; pl.facing = "up";
      return { a, pl, tx, ty: 2 };
    }
  }
  throw new Error("no free wall face in the translocation room");
}

/** On the surface, standing in a cleared 9x9 patch of open ground. */
function inClearing(w: World) {
  const pl = player(w);
  frame(w);
  enterArea(w, pl, "surface", 20 * TS + 8, 50 * TS + 14);
  const a = currentArea(w);
  for (let ty = 46; ty <= 54; ty++) for (let tx = 16; tx <= 24; tx++) a.setTile(tx, ty, T.FLOOR);
  for (const p of [...a.props]) if (Math.abs(p.x - pl.x) < 96 && Math.abs(p.y - pl.y) < 96) a.removeProp(p.id);
  pl.facing = "down";
  return { a, pl };
}
const roundTrip = (w: World) => deserialize(JSON.parse(JSON.stringify(serialize(w))));

// ------------------------------------------------------------------ data
test("catalog data: every recipe has a prop kind with art, a known category, and valid font text", () => {
  const cats = new Set(BUILD_CATEGORIES.map((c) => c.id));
  const ok = (s: string) => [...s].every((ch) => FONT_GLYPHS.has(ch));
  for (const [id, r] of Object.entries(RECIPES)) {
    assert.ok(PROPS[r.prop], `${id}: prop kind ${r.prop}`);
    assert.ok(PROP_ART[r.prop], `${id}: sprite for ${r.prop}`);
    assert.ok(cats.has(r.category), `${id}: category`);
    assert.ok(ok(r.name) && r.name.length <= 24, `${id}: name "${r.name}"`);
    assert.ok(r.desc.length <= 3 && r.desc.every((l) => ok(l) && l.length <= 34), `${id}: desc`);
    assert.ok(r.cost.length > 0 && r.cost.every((c) => c.n > 0));
  }
  for (const r of CRAFT_RECIPES) assert.ok(ok(r.name) && r.desc.every((l) => ok(l) && l.length <= 30), `craft ${r.id}`);
  // Specified costs and the shared wall-torch prop.
  assert.deepEqual(RECIPES.wall_torch.cost, [{ item: "stone", n: 2 }, { item: "wood", n: 1 }]);
  assert.deepEqual(RECIPES.torch_post.cost, [{ item: "wood", n: 2 }, { item: "stone", n: 1 }]);
  assert.equal(RECIPES.wall_torch.prop, "torch");
  assert.equal(RECIPES.wall_torch.place, "wall");
  assert.ok(PROPS.torch.wallMounted);
  // Only the dungeon's wall torch opts in among authored props.
  assert.deepEqual(Object.keys(AUTHORED_SALVAGE), ["torch"]);
});

// ------------------------------------------------------------------ wall placement
test("wall torch: valid only on a plain wall face with floor below; failing cases name the reason", () => {
  const w = newWorld(); kit(w);
  const { a, pl, tx, ty } = atWallFace(w);
  assert.deepEqual(placement(w, pl, a, "wall_torch", tx, ty), { ok: true });
  // the floor in front of the wall is not a wall
  assert.deepEqual(placement(w, pl, a, "wall_torch", tx, ty + 1), { ok: false, reason: "noWall" });
  // wall with more wall below: no visible face
  assert.equal(a.tile(tx, ty - 1), T.WALL);
  assert.deepEqual(siteFor(w, a, "wall_torch", tx, ty - 1), { ok: false, reason: "wallFace" });
  // the authored torch's face is taken (pl stands below it)
  pl.x = 7 * TS + 8;
  assert.deepEqual(placement(w, pl, a, "wall_torch", 7, 2), { ok: false, reason: "occupied" });
  // a wall face out of reach
  pl.x = tx * TS + 8; pl.y = 8 * TS + 12;
  assert.deepEqual(placement(w, pl, a, "wall_torch", tx, ty), { ok: false, reason: "reach" });
  // the tutorial's cracked wall (and doors, pillars, rubble) never count as walls
  const ca = currentArea(w);
  assert.equal(ca.tile(47, 10), T.CRACKED);
  assert.deepEqual(siteFor(w, ca, "wall_torch", 47, 10), { ok: false, reason: "noWall" });
  // the floor torch post is the opposite: never on a wall
  pl.y = 4 * TS + 12;
  assert.deepEqual(placement(w, pl, a, "torch_post", tx, ty), { ok: false, reason: "solid" });
  // the surface has no masonry walls at all: no site anywhere for a wall torch
  const { a: sa } = inClearing(w);
  let any = false;
  for (let y = 0; y < sa.h && !any; y++) for (let x = 0; x < sa.w && !any; x++) any = siteFor(w, sa, "wall_torch", x, y).ok;
  assert.equal(any, false);
});

test("the placement ghost snaps a wall torch to the nearest free wall face", () => {
  const w = newWorld(); kit(w);
  const { a, pl, tx, ty } = atWallFace(w);
  pl.facing = "down";
  const s = suggestTile(w, pl, a, "wall_torch");
  assert.ok(siteFor(w, a, "wall_torch", s.tx, s.ty).ok);
  assert.equal(s.ty, ty);
  assert.ok(Math.abs(s.tx - tx) <= 2);
});

test("a built wall torch is the authored torch prop: lit, same kind, light reconciled, mounted at the wall anchor", () => {
  const w = newWorld(); kit(w, 1, 2);
  const { a, pl, tx, ty } = atWallFace(w);
  const view = new AreaView(a);
  assert.ok(orderBuild(w, pl, "wall_torch", tx, ty));
  finish(w);
  const p = a.props.find((q) => q.dyn && q.kind === "torch")!;
  assert.ok(p && p.lit && p.recipe === "wall_torch");
  assert.deepEqual([p.x, p.y], [tx * TS + 8, ty * TS + 16], "same anchor the dungeon builder uses");
  assert.equal(countItem(pl, "wood"), 0); assert.equal(countItem(pl, "stone"), 0);
  view.flush();
  assert.ok(view.lights.has("prop:" + p.id));
  // the face is now taken
  assert.deepEqual(siteFor(w, a, "wall_torch", tx, ty), { ok: false, reason: "occupied" });
});

// ------------------------------------------------------------------ gating
test("cost and knowledge gating for the new recipes (and the catalog's locked entries)", () => {
  const w = newWorld(); const { a, pl } = inClearing(w);
  const tx = 20, ty = 52;
  for (const id of ["wall_torch", "craftbench", "barricade", "table", "chair", "wall_banner", "brazier"])
    assert.equal(entryFor(w, pl, id)!.status, "unknown", id);
  assert.deepEqual(placement(w, pl, a, "craftbench", tx, ty), { ok: false, reason: "unknown" });
  setFlag(w, FLAGS.knowBuild);
  assert.deepEqual(placement(w, pl, a, "craftbench", tx, ty), { ok: false, reason: "cost" });
  addItems(w, pl, "wood", 5); addItems(w, pl, "stone", 2);
  assert.deepEqual(placement(w, pl, a, "craftbench", tx, ty), { ok: false, reason: "cost" }, "6 wood needed");
  const e = entryFor(w, pl, "craftbench")!;
  assert.equal(e.status, "cost");
  assert.equal(entryReason(e), "NEED 1 WOOD MORE");
  addItems(w, pl, "wood", 1);
  assert.deepEqual(placement(w, pl, a, "craftbench", tx, ty), { ok: true });
  // the brazier needs masonry on top of know.build: listed, but locked
  addItems(w, pl, "stone", 6);
  assert.equal(entryFor(w, pl, "brazier")!.status, "unknown");
  assert.equal(entryReason(entryFor(w, pl, "brazier")!), "UNKNOWN RECIPE - NOT YET LEARNED");
  assert.deepEqual(placement(w, pl, a, "brazier", tx, ty), { ok: false, reason: "unknown" });
  setFlag(w, FLAGS.knowMasonry);
  assert.deepEqual(placement(w, pl, a, "brazier", tx, ty), { ok: true });
  // a hidden-until-known recipe is not listed at all until learned
  const secret: Record<string, Recipe> = { ...RECIPES, secret: { ...RECIPES.chair, name: "SECRET", requires: { flags: ["know.secret"] }, unknown: "hidden" } };
  assert.ok(!catalogEntries(w, pl, secret).some((x) => x.id === "secret"));
  setFlag(w, "know.secret");
  assert.ok(catalogEntries(w, pl, secret).some((x) => x.id === "secret"));
});

test("floor footprints: wide props need every tile of their box clear", () => {
  const w = newWorld(); kit(w);
  const { a, pl } = inClearing(w);
  const tx = 20, ty = 52;
  assert.deepEqual(placement(w, pl, a, "table", tx, ty), { ok: true });
  a.setTile(tx + 1, ty, T.RUBBLE);
  assert.deepEqual(placement(w, pl, a, "table", tx, ty), { ok: false, reason: "solid" }, "the table spills into the next tile");
  assert.deepEqual(placement(w, pl, a, "chair", tx, ty), { ok: true }, "a chair fits in one tile");
  a.setTile(tx + 1, ty, T.FLOOR);
  // the builder's own tile is occupied
  assert.deepEqual(placement(w, pl, a, "barricade", 20, 50), { ok: false, reason: "occupied" });
});

// ------------------------------------------------------------------ saves
test("every new buildable builds through the task path and round-trips through save/load", () => {
  const w = newWorld(); kit(w, 60, 60); setFlag(w, FLAGS.knowMasonry); setFlag(w, FLAGS.golemBasket);
  const { a, pl } = inClearing(w);
  frame(w);
  const spots: [string, number, number][] = [["craftbench", 18, 48], ["table", 22, 48], ["chair", 18, 52], ["barricade", 22, 52], ["brazier", 20, 52], ["torch_post", 21, 49]];
  for (const [id, tx, ty] of spots) {
    assert.deepEqual(placement(w, pl, a, id, tx, ty), { ok: true }, id);
    assert.ok(orderBuild(w, pl, id, tx, ty), id);
    finish(w);
  }
  const built = a.props.filter((p) => p.dyn);
  assert.deepEqual(built.map((p) => p.recipe).sort(), spots.map((s) => s[0]).sort());
  assert.ok(built.find((p) => p.kind === "brazier")!.lit);
  const w2 = roundTrip(w);
  assert.deepEqual(serialize(w2), serialize(w));
  const a2 = currentArea(w2);
  for (const p of built) {
    const q = a2.prop(p.id)!;
    assert.ok(q && q.dyn, p.id);
    assert.deepEqual([q.kind, q.x, q.y, q.recipe, !!q.lit, q.box], [p.kind, p.x, p.y, p.recipe, !!p.lit, p.box]);
  }
  const v = new AreaView(a2); v.flush();
  assert.ok(v.lights.has("prop:" + built.find((p) => p.kind === "brazier")!.id));
});

test("v5 -> v6 migration: areas gain propsRemoved, pending 'torch' build work becomes 'torch_post'", () => {
  const w = newWorld();
  const s: any = serialize(w);
  s.version = 5;
  for (const d of Object.values(s.areas) as any[]) delete d.propsRemoved;
  s.actors[0].task = { kind: "reach", dur: 0.7, t: 0.1, fired: false, effect: { op: "build", recipe: "torch", tx: 3, ty: 4 }, area: "dungeon" };
  const m: any = migrate(s);
  assert.equal(m.version, SAVE_VERSION);
  assert.equal(m.actors[0].task.effect.recipe, "torch_post");
  for (const d of Object.values(m.areas) as any[]) assert.deepEqual(d.propsRemoved, []);
  assert.ok(deserialize(s));
});

// ------------------------------------------------------------------ crafting bench
test("the crafting bench is interactable and opens its UI through the normal rule + task path", () => {
  const w = newWorld(); kit(w);
  const { a, pl } = inClearing(w);
  assert.ok(orderBuild(w, pl, "craftbench", 20, 52)); finish(w);
  const bench = a.props.find((p) => p.kind === "craftbench")!;
  const it = interactables(a).find((i) => i.propId === bench.id)!;
  assert.equal(it.kind, "station");
  events(w);
  useOn(w, it);
  const ev = events(w).find((e) => e.t === "openStation");
  assert.deepEqual(ev, { t: "openStation", actor: pl.id, prop: bench.id, station: "crafting" });
  // the shell: entries list the placeholder, and the CRAFT command changes nothing
  const before = JSON.stringify(pl.inventory);
  const list = craftEntries(w, pl, "crafting");
  assert.ok(list.length >= 1 && list[0].recipe.placeholder && list[0].status === "placeholder");
  assert.equal(orderCraft(w, pl, "crafting", list[0].recipe.id), false);
  assert.equal(JSON.stringify(pl.inventory), before);
  // the authored workbench (holding the chisel) is not a station
  const dg = w.areas.get("dungeon")!;
  assert.ok(!interactables(dg).some((i) => i.kind === "station"));
});

// ------------------------------------------------------------------ deconstruction
test("deconstructing a built prop refunds 100% of its recipe and clears it from interactables and saves", () => {
  const w = newWorld(); kit(w, 10, 10);
  const { a, pl } = inClearing(w);
  assert.ok(orderBuild(w, pl, "craftbench", 20, 52)); finish(w);
  const bench = a.props.find((p) => p.kind === "craftbench")!;
  assert.equal(countItem(pl, "wood"), 4); assert.equal(countItem(pl, "stone"), 8);
  assert.ok(interactables(a).some((i) => i.propId === bench.id));
  assert.equal(deconTargetAt(a, 20, 52)?.id, bench.id);
  assert.ok(orderDeconstruct(w, pl, bench.id));
  assert.equal(pl.task!.kind, "dismantle");
  assert.ok(a.prop(bench.id), "takes time: nothing happens until the task fires");
  events(w); finish(w);
  assert.equal(a.prop(bench.id), undefined);
  assert.equal(countItem(pl, "wood"), 10); assert.equal(countItem(pl, "stone"), 10);
  assert.ok(events(w).some((e) => e.t === "deconstructed"));
  assert.ok(!interactables(a).some((i) => i.propId === bench.id), "interactable cache follows revision");
  const s = serialize(w);
  assert.ok(!s.areas.surface.propsAdded.some((p) => p.id === bench.id));
  assert.ok(!currentArea(roundTrip(w)).prop(bench.id));
});

test("deconstructing the dungeon's authored wall torch: full wall-torch refund, light gone, stays gone after save/load", () => {
  const w = newWorld(); frame(w);
  const a = currentArea(w), pl = player(w);
  const id = "torch@7,2", torch = a.prop(id)!;
  assert.ok(torch && torch.lit && !torch.dyn);
  const li = a.lights.findIndex((l) => l.owner === id);
  assert.ok(li >= 0);
  const view = new AreaView(a); view.flush();
  assert.ok(view.lights.has("area" + li));
  const interBefore = interactables(a).map((i) => `${i.kind}:${i.propId ?? i.looseId ?? i.socket ?? i.tx}`);
  pl.x = 7 * TS + 8; pl.y = 4 * TS + 12; pl.facing = "up";
  assert.deepEqual(salvageOf(torch), RECIPES.wall_torch.cost);
  assert.equal(deconTargetAt(a, 7, 2)?.id, id);
  assert.ok(orderDeconstruct(w, pl, id)); finish(w);
  assert.equal(a.prop(id), undefined);
  assert.equal(countItem(pl, "stone"), 2); assert.equal(countItem(pl, "wood"), 1);
  view.flush();
  assert.ok(!view.lights.has("area" + li), "the owned light goes with its prop");
  // no tutorial logic hangs off torches: everything else interactable is unchanged
  assert.deepEqual(interactables(a).map((i) => `${i.kind}:${i.propId ?? i.looseId ?? i.socket ?? i.tx}`), interBefore);
  const s = serialize(w);
  assert.deepEqual(s.areas.dungeon.propsRemoved, [id]);
  const w2 = roundTrip(w), a2 = currentArea(w2);
  assert.equal(a2.prop(id), undefined, "loading must not bring it back");
  assert.deepEqual(serialize(w2), s);
  const v2 = new AreaView(a2); v2.flush();
  assert.ok(!v2.lights.has("area" + li));
  // and a built wall torch can go back on the same face
  setFlag(w2, FLAGS.knowBuild);
  assert.deepEqual(placement(w2, player(w2), a2, "wall_torch", 7, 2), { ok: true });
});

test("refund overflow lands on the ground when the pack is full; nothing is deleted", () => {
  const w = newWorld(); frame(w);
  const a = currentArea(w), pl = player(w);
  addItems(w, pl, "coin", capacity(w, pl));
  assert.ok(pl.inventory.every((s) => s));
  pl.x = 7 * TS + 8; pl.y = 4 * TS + 12;
  events(w);
  assert.ok(orderDeconstruct(w, pl, "torch@7,2")); finish(w);
  const ev = events(w);
  const ground = a.loose.filter((l) => l.dyn && !l.taken);
  assert.deepEqual(ground.map((l) => [l.item, l.n ?? 1]).sort(), [["stone", 2], ["wood", 1]]);
  assert.equal(ev.filter((e) => e.t === "itemDropped" && e.reason === "full").length, 2);
});

test("deconstruction is refused on authored props that haven't opted in, and re-validates when it fires", () => {
  const w = newWorld(); frame(w);
  const a = currentArea(w), pl = player(w);
  for (const id of ["brazier@33,12", "banner@27,1", "chains@55,27", "table@11,29", "workbench@13.5,37"]) {
    const p = a.prop(id);
    assert.ok(p, id);
    pl.x = p!.x; pl.y = p!.y + 20;
    assert.equal(salvageOf(p!), null, id);
    const c = deconstructCheck(w, pl, a, id);
    assert.ok(!c.ok && c.reason === "fixed", id);
    assert.equal(orderDeconstruct(w, pl, id), false);
    // even forced through the effect, the prop stays
    applyEffect(w, pl, { op: "deconstruct" }, { kind: "deconstruct", x: p!.x, y: p!.y, propId: id });
    assert.ok(a.prop(id), id);
  }
  assert.ok(events(w).some((e) => e.t === "message" && e.text === "THAT CAN'T BE TAKEN APART"));
  // ordered in reach, then the golem is moved away before the blow lands
  pl.x = 7 * TS + 8; pl.y = 4 * TS + 12;
  assert.ok(orderDeconstruct(w, pl, "torch@7,2"));
  pl.x = 30 * TS; pl.y = 30 * TS;
  finish(w);
  assert.ok(a.prop("torch@7,2"), "re-validated: too far away when it fired");
  assert.equal(countItem(pl, "stone"), 0);
});

test("contents spill on deconstruction; any actor can deconstruct through its task queue", () => {
  const w = newWorld(); kit(w);
  const { a, pl } = inClearing(w);
  assert.ok(orderBuild(w, pl, "table", 20, 52)); finish(w);
  const table = a.props.find((p) => p.kind === "table")!;
  a.setPropState(table.id, { item: "coin" });
  const helper = makeActor("helper", "fixture", a.id, table.x, table.y + 20);
  w.actors.push(helper);
  helper.inventory = new Array(8).fill(null);
  enqueueTask(helper, { kind: "dismantle", dur: 0.9, effect: { op: "deconstruct" } }, { kind: "deconstruct", x: table.x, y: table.y, propId: table.id });
  frames(w, 90);
  assert.equal(a.prop(table.id), undefined);
  assert.equal(countItem(helper, "wood"), 4, "the helper gets the refund");
  assert.ok(a.loose.some((l) => l.item === "coin" && !l.taken), "what rested on it spills to the ground");
  assert.ok(allInteractables(w, a).some((i) => i.kind === "item"));
  // direct call on a missing prop is a polite no-op
  applyDeconstruct(w, pl, a, table.id);
  assert.ok(events(w).some((e) => e.t === "message" && e.text === "NOTHING TO TAKE APART HERE"));
});

// ------------------------------------------------------------------ catalog queries (pure)
function synth(n: number): CatalogEntry[] {
  const cats = BUILD_CATEGORIES.map((c) => c.id);
  const out: CatalogEntry[] = [];
  for (let i = 0; i < n; i++) {
    const r: Recipe = {
      name: `ITEM ${String(n - i).padStart(3, "0")}`, category: cats[i % cats.length], desc: [], prop: "chair",
      cost: [{ item: i % 2 ? "stone" : "wood", n: 1 + (i % 7) }], requires: {}, order: i % 3,
    };
    out.push({ id: `r${i}`, recipe: r, status: i % 4 === 0 ? "ok" : i % 4 === 1 ? "cost" : i % 4 === 2 ? "ok" : "unknown", lines: [] });
  }
  return out;
}
const Q = (o: Partial<CatalogQuery>): CatalogQuery => ({ tab: "all", search: "", sort: "category", affordableOnly: false, favorites: new Set(), ...o });

test("catalog search matches name, category and material words, case-insensitively", () => {
  const list = synth(200);
  assert.equal(queryCatalog(list, Q({})).length, 200);
  assert.equal(queryCatalog(list, Q({ search: "item 007" })).length, 1);
  const stone = queryCatalog(list, Q({ search: "stone" }));
  assert.equal(stone.length, 100);
  assert.ok(stone.every((e) => e.recipe.cost[0].item === "stone"));
  assert.equal(queryCatalog(list, Q({ search: "  light   stone " })).length, list.filter((e) => e.recipe.category === "light" && e.recipe.cost[0].item === "stone").length);
  assert.equal(queryCatalog(list, Q({ search: "nothing like this" })).length, 0);
  assert.ok(matchesSearch(list[0], ""));
});

test("catalog sort is total and stable for name, cost and category", () => {
  const list = synth(120);
  const byName = sortEntries(list, "name").map((e) => e.recipe.name);
  assert.deepEqual(byName, [...byName].sort());
  const byCost = sortEntries(list, "cost");
  for (let i = 1; i < byCost.length; i++) {
    const a = byCost[i - 1].recipe, b = byCost[i].recipe;
    const ca = a.cost[0].n, cb = b.cost[0].n;
    assert.ok(ca < cb || (ca === cb && a.name <= b.name));
  }
  const byCat = sortEntries(list, "category");
  const ci = (e: CatalogEntry) => BUILD_CATEGORIES.findIndex((c) => c.id === e.recipe.category);
  for (let i = 1; i < byCat.length; i++) assert.ok(ci(byCat[i - 1]) <= ci(byCat[i]));
  assert.deepEqual(sortEntries([...list].reverse(), "category").map((e) => e.id), byCat.map((e) => e.id), "input order doesn't matter");
});

test("catalog filters: tabs, favorites and can-build-only compose", () => {
  const list = synth(60);
  const light = queryCatalog(list, Q({ tab: "light" }));
  assert.ok(light.length > 0 && light.every((e) => e.recipe.category === "light"));
  assert.deepEqual(queryCatalog(list, Q({ tab: "fav", favorites: new Set(["r3", "r10"]) })).map((e) => e.id).sort(), ["r10", "r3"]);
  assert.equal(queryCatalog(list, Q({ tab: "fav" })).length, 0);
  const afford = queryCatalog(list, Q({ affordableOnly: true }));
  assert.ok(afford.length === 30 && afford.every((e) => e.status === "ok"));
  const combo = queryCatalog(list, Q({ tab: "craft", affordableOnly: true, search: "wood", sort: "name" }));
  assert.ok(combo.every((e) => e.recipe.category === "craft" && e.status === "ok" && e.recipe.cost[0].item === "wood"));
});

test("the real catalog lists all recipes for a builder and reflects carried materials", () => {
  const w = newWorld(); const pl = player(w); frame(w);
  setFlag(w, FLAGS.knowBuild); addItems(w, pl, "wood", 2);
  const list = catalogEntries(w, pl);
  assert.equal(list.length, Object.keys(RECIPES).length);
  const chair = list.find((e) => e.id === "chair")!;
  assert.equal(chair.status, "ok");
  assert.deepEqual(chair.lines, [{ item: "wood", need: 2, have: 2 }]);
  assert.equal(list.find((e) => e.id === "wall_torch")!.status, "cost");
  assert.deepEqual(queryCatalog(list, Q({ affordableOnly: true })).map((e) => e.id).sort(), ["barricade", "chair"].filter((id) => RECIPES[id].cost.every((c) => c.item === "wood" && c.n <= 2)).sort());
});
