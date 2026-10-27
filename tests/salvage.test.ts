// Deconstructing everything buildable: every authored prop of a kind a recipe
// builds (the dungeon's braziers, banners, tables, chairs, torches and
// workbench) can be taken apart for that recipe's actual cost, crafted
// materials included; props that hold or gate tutorial progress refuse until the
// item is taken; refunds of props that already stand never change with a
// rebalance (v8 -> v9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { player, currentArea, setFlag, getArea, type World } from "../src/game/world/world";
import { serialize, deserialize, migrate } from "../src/game/world/save";
import { addItems, countItem } from "../src/game/sim/inventory";
import { orderDeconstruct } from "../src/game/sim/commands";
import { deconstructCheck, deconMessage, salvageOf, isDeconstructable } from "../src/game/sim/build";
import { RECIPES, AUTHORED_SALVAGE, type Cost } from "../src/game/content/build";
import { isCritical } from "../src/game/content/items";
import { PROPS } from "../src/game/content/props";
import { FLAGS } from "../src/game/content/flags";
import { newWorld, frame, events, useOn, propItem } from "./helpers";

const finish = (w: World) => { let g = 0; while (player(w).task && g++ < 600) frame(w); };
const counts = (w: World) => { const o: Record<string, number> = {}; for (const s of player(w).inventory) if (s) o[s.item] = (o[s.item] ?? 0) + s.n; return o; };
const asCounts = (c: Cost[]) => Object.fromEntries(c.map((x) => [x.item, x.n]));
const stand = (w: World, id: string) => { const p = currentArea(w).prop(id)!; const pl = player(w); pl.x = p.x; pl.y = p.y + 14; pl.facing = "up"; return p; };

test("audit: every authored prop of a buildable kind, in the dungeon and on the surface, is deconstructable for its recipe's cost", () => {
  const w = newWorld();
  const kinds = new Map(Object.entries(RECIPES).map(([id, r]) => [r.prop, id]));
  const found = new Map<string, number>();
  for (const area of ["dungeon", "surface"]) {
    for (const p of getArea(w, area).props) {
      const id = kinds.get(p.kind);
      if (!id) continue;
      found.set(p.kind, (found.get(p.kind) ?? 0) + 1);
      assert.ok(isDeconstructable(p), `${area} ${p.id}`);
      assert.deepEqual(salvageOf(p), RECIPES[id].cost, `${area} ${p.id}: refund is the recipe's actual cost`);
    }
  }
  // what the dungeon actually places (so the audit isn't vacuous)
  for (const k of ["torch", "brazier", "banner", "table", "chair", "workbench"]) assert.ok((found.get(k) ?? 0) > 0, `authored ${k} exists`);
  // every recipe's prop kind is a row in the salvage table; nothing else is, and non-buildable kinds stay fixed
  for (const r of Object.values(RECIPES)) assert.ok(r.prop in AUTHORED_SALVAGE, r.prop);
  for (const k of ["chains", "bookshelf", "statue", "bed", "forge", "cradle"]) assert.ok(PROPS[k] && !(k in AUTHORED_SALVAGE), k);
});

test("each authored target is taken apart through the dismantle task and refunds the recipe's materials (crafted ones too)", () => {
  const pick = (w: World, kind: string, skip: (id: string) => boolean = () => false) => currentArea(w).props.find((p) => p.kind === kind && !p.item && !skip(p.id))!;
  for (const [kind, recipe] of [["brazier", "brazier"], ["banner", "wall_banner"], ["table", "table"], ["chair", "chair"], ["torch", "wall_torch"]] as const) {
    const w = newWorld(); frame(w);
    const a = currentArea(w), pl = player(w);
    const p = pick(w, kind);
    assert.ok(p, kind);
    stand(w, p.id);
    events(w);
    assert.ok(orderDeconstruct(w, pl, p.id), kind);
    assert.equal(pl.task!.kind, "dismantle");
    assert.ok(a.prop(p.id), "takes time");
    finish(w);
    assert.equal(a.prop(p.id), undefined, kind);
    assert.deepEqual(counts(w), asCounts(RECIPES[recipe].cost), `${kind}: refund equals the recipe cost`);
    assert.ok(events(w).some((e) => e.t === "deconstructed" && e.kind === kind));
    // gone for good: saved as removed, still gone after loading
    assert.ok(serialize(w).areas.dungeon.propsRemoved.includes(p.id));
    assert.equal(currentArea(deserialize(JSON.parse(JSON.stringify(serialize(w))))).prop(p.id), undefined, kind);
  }
  // a full pack: the (crafted) refund lands on the ground
  const w = newWorld(); frame(w);
  const pl = player(w), a = currentArea(w);
  addItems(w, pl, "coin", 8);
  const t = pick(w, "table"); stand(w, t.id);
  assert.ok(orderDeconstruct(w, pl, t.id)); finish(w);
  assert.equal(a.loose.filter((l) => l.dyn && !l.taken && l.item === "planks").reduce((s, l) => s + (l.n ?? 1), 0), 4);
});

test("tutorial-critical props: the workbench holds the chisel and the library table holds the Builder's Primer, so both refuse until the item is taken", () => {
  const w = newWorld(); frame(w);
  const a = currentArea(w), pl = player(w);
  // the general rule: no authored prop that is deconstructable may be dismantled while it holds a critical item
  let held = 0;
  for (const p of a.props) {
    if (!p.item || p.taken || !isCritical(p.item) || !isDeconstructable(p)) continue;
    held++;
    stand(w, p.id);
    const c = deconstructCheck(w, pl, a, p.id);
    assert.ok(!c.ok && c.reason === "holds" && c.item === p.item, p.id);
  }
  assert.equal(held, 2, "exactly the workbench (chisel) and the table (primer)");
  const bench = "workbench@13.5,37", table = "table@11,29";
  stand(w, bench);
  events(w);
  assert.equal(orderDeconstruct(w, pl, bench), false);
  assert.deepEqual(events(w), [{ t: "message", text: "TAKE THE RUNE CHISEL FIRST" }]);
  assert.ok(a.prop(bench) && a.prop(bench)!.item === "chisel" && !a.prop(bench)!.taken, "nothing changed");
  // the effect refuses too, even when forced
  const c = deconstructCheck(w, pl, a, bench);
  assert.equal(c.ok ? "" : deconMessage(c), "TAKE THE RUNE CHISEL FIRST");
  // take the chisel (the tutorial's normal path): now the bench goes, the chisel stays in the pack
  useOn(w, propItem(w, bench));
  assert.equal(countItem(pl, "chisel"), 1);
  stand(w, bench);
  assert.ok(orderDeconstruct(w, pl, bench)); finish(w);
  assert.equal(a.prop(bench), undefined);
  assert.equal(countItem(pl, "chisel"), 1, "the chisel is never lost");
  assert.deepEqual({ wood: countItem(pl, "wood"), stone: countItem(pl, "stone") }, { wood: 6, stone: 2 }, "a raw bench refunds raw materials, so it can always be rebuilt");
  // the table and its primer
  stand(w, table);
  assert.equal(orderDeconstruct(w, pl, table), false);
  setFlag(w, FLAGS.knowBuild); // (reading the primer teaches this; the book stays obtainable either way)
  useOn(w, propItem(w, table));
  assert.equal(countItem(pl, "book_build"), 1);
  stand(w, table);
  assert.ok(orderDeconstruct(w, pl, table)); finish(w);
  assert.equal(a.prop(table), undefined);
  assert.equal(countItem(pl, "book_build"), 1);
  assert.equal(countItem(pl, "planks"), RECIPES.table.cost[0].n);
});

test("non-critical contents still spill to the ground when their prop is taken apart", () => {
  const w = newWorld(); frame(w);
  const a = currentArea(w), pl = player(w);
  const t = a.props.find((p) => p.kind === "chair" && !p.item)!;
  a.setPropState(t.id, { item: "coin" });
  stand(w, t.id);
  assert.ok(orderDeconstruct(w, pl, t.id)); finish(w);
  assert.ok(a.loose.some((l) => l.item === "coin" && !l.taken));
});

test("a rebalance never changes what a standing prop refunds: built props record their cost, and v8 saves are stamped with the old one", () => {
  const w = newWorld(); frame(w);
  const a = currentArea(w), pl = player(w);
  // a prop built under yesterday's costs: old save shape (no refund recorded), built from the table recipe
  a.addProp("table", pl.x, pl.y - 40, { recipe: "table", v: 0 }, "table#b0");
  a.propSeq = 1;
  const s: any = serialize(w);
  s.version = 8;
  delete s.areas.dungeon.propsAdded[0].refund;
  const m: any = migrate(s);
  assert.deepEqual(m.areas.dungeon.propsAdded[0].refund, [{ item: "wood", n: 4 }]);
  const w2 = deserialize(s);
  const t = currentArea(w2).prop("table#b0")!;
  assert.deepEqual(salvageOf(t), [{ item: "wood", n: 4 }], "it was built for 4 wood: it gives 4 wood back, not 4 planks");
  // props without a recorded recipe (older saves) are matched by kind; unchanged recipes are left alone
  const s2: any = serialize(w);
  s2.version = 8;
  delete s2.areas.dungeon.propsAdded[0].refund; delete s2.areas.dungeon.propsAdded[0].recipe;
  assert.deepEqual((migrate(s2) as any).areas.dungeon.propsAdded[0].refund, [{ item: "wood", n: 4 }]);
  const s3: any = serialize(w);
  s3.version = 8;
  s3.areas.dungeon.propsAdded[0] = { ...s3.areas.dungeon.propsAdded[0], kind: "barricade", recipe: "barricade" }; delete s3.areas.dungeon.propsAdded[0].refund;
  assert.equal((migrate(s3) as any).areas.dungeon.propsAdded[0].refund, undefined);
  // and the refund of the old table really is what comes back
  const pl2 = player(w2);
  pl2.x = t.x; pl2.y = t.y + 14;
  assert.ok(orderDeconstruct(w2, pl2, t.id)); finish(w2);
  assert.equal(countItem(pl2, "wood"), 4); assert.equal(countItem(pl2, "planks"), 0);
});
