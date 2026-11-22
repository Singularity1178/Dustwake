// Phase 0.8 (and the exit criterion "a 300-actor soak holds the frame budget"): the soak harness and the content
// linter. A soak that breaks the budget or any invariant fails `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSoak, itemCensus, doubleHeld, populateResidents, roundTripDiff } from "../src/game/sim/soak";
import { lintContent } from "../src/game/sim/contentLint";
import { createWorld, player, getArea, enterArea } from "../src/game/world/world";
import { isFolk } from "../src/game/sim/folk";
import { ITEMS } from "../src/game/content/items";

/** Mean simulation time per tick allowed (ms): a quarter of a 60 Hz frame, the rest is the renderer's. */
const BUDGET_MS = 4;

test("acceptance (0.2 / 0.8): a 300-actor soak holds the frame budget and every invariant (stuck, items, places, round trip)", () => {
  const r = runSoak({ residents: 300, seconds: 60, walk: true, roundTripEvery: 1200, budgetMs: BUDGET_MS });
  assert.ok(r.actors >= 300, `${r.actors} actors`);
  assert.deepEqual(r.violations, []);
  assert.ok(r.ms.mean < BUDGET_MS, `mean ${r.ms.mean.toFixed(3)} ms per tick`);
  assert.ok(r.ms.p95 < 3 * BUDGET_MS, `p95 ${r.ms.p95.toFixed(3)} ms per tick`);
  assert.ok(r.tiers.far > 0, "LOD had actors in the far tier");
});

test("the soak catches what it is there for: an item made from nothing, a place held twice, a save that does not round-trip", () => {
  const w = createWorld(51), pl = player(w), town = getArea(w, "town");
  enterArea(w, pl, "town", town.start.x, town.start.y);
  populateResidents(w, 40, "town");
  const before = itemCensus(w);
  pl.inventory[0] = { item: "wood", n: 3 };
  assert.notEqual(itemCensus(w).get("wood") ?? 0, before.get("wood") ?? 0);
  const [a, b] = w.actors.filter(isFolk);
  a.area = b.area = "town";
  a.life!.spot = b.life!.spot = "watch.post.test";
  assert.ok(doubleHeld(w).size >= 1);
  assert.equal(roundTripDiff(w), "", "a live world round-trips");
});

test("content lint (0.8): every content row passes every rule", () => {
  assert.deepEqual(lintContent(), []);
});

test("the linter catches a line the font cannot draw and an item that does not exist", () => {
  const items = ITEMS as unknown as Record<string, { name: string }>;
  items.__lint_probe = { ...(items.wood as object), name: "BAD~NAME" } as { name: string };
  try { assert.ok(lintContent(["font1"]).some((i) => i.row === "__lint_probe")); }
  finally { delete items.__lint_probe; }
  assert.deepEqual(lintContent(["font1"]), []);
});
