// Gear: the basket is picked up like any item, worn in the golem's back slot
// from the pack (capacity 48), and taken off only if everything, the basket
// included, still fits. Headless, through the sim commands the pack screen uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, enterArea, setFlag, makeActor, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { capacity, addItems, countItem, hasItem } from "../src/game/sim/inventory";
import { wearFromSlot, takeOffGear, dropFromSlot } from "../src/game/sim/commands";
import { ensureWorn, wornIn, takeOffCheck } from "../src/game/sim/gear";
import { enqueueTask } from "../src/game/sim/tasks";
import { FLAGS } from "../src/game/content/flags";
import type { ItemId } from "../src/game/content/items";
import { events, find, frames, newWorld, propItem, useOn } from "./helpers";

const slotOf = (w: World, id: ItemId) => player(w).inventory.findIndex((s) => s?.item === id);
const onGround = (w: World) => [...w.areas.values()].flatMap((a) => a.loose.filter((l) => l.dyn && !l.taken));
/** Everything the golem owns, by item: pack plus worn gear. */
function owned(w: World) {
  const pl = player(w), m: Record<string, number> = {};
  for (const s of pl.inventory) if (s) m[s.item] = (m[s.item] ?? 0) + s.n;
  for (const id of Object.values(pl.gear)) if (id) m[id] = (m[id] ?? 0) + 1;
  return m;
}
/** A golem with the iron arm (16 slots) that has picked up the surface basket. */
function withBasket() {
  const w = newWorld(), pl = player(w);
  setFlag(w, FLAGS.golemArm);
  enterArea(w, pl, "surface", 100, 100);
  useOn(w, find(w, (i) => i.looseId === "basket"));
  events(w);
  return { w, pl };
}

test("picking up the basket stores it like any item: no attach animation, no equip ceremony", () => {
  const w = newWorld(), pl = player(w);
  enterArea(w, pl, "surface", 100, 100);
  events(w);
  useOn(w, find(w, (i) => i.looseId === "basket"));
  const ev = events(w);
  assert.ok(hasItem(pl, "basket"), "in the pack");
  assert.ok(currentArea(w).looseItem("basket")!.taken);
  assert.ok(ev.some((e) => e.t === "itemGained" && e.item === "basket" && e.stored), "ordinary pickup feedback");
  assert.ok(!ev.some((e) => e.t === "equipped" || e.t === "gearOn"), "nothing installed or worn");
  assert.ok(!ev.some((e) => e.t === "taskTick" && e.task.kind === "attach"), "no attach task");
  assert.equal(wornIn(pl, "back"), undefined);
  assert.equal(capacity(w, pl), 8, "carrying it grants nothing");
});

test("the iron arm's pickup is unchanged: attached with the ceremony, never stored", () => {
  const w = newWorld(), pl = player(w);
  useOn(w, propItem(w, "limbrack@65.5,3"));
  const ev = events(w);
  assert.ok(ev.some((e) => e.t === "taskTick" && e.task.kind === "attach"));
  assert.ok(ev.some((e) => e.t === "equipped" && e.item === "arm"));
  assert.ok(w.flags.has(FLAGS.golemArm) && !hasItem(pl, "arm"));
});

test("wearing the basket moves it to the back slot and raises capacity; taking it off lowers it again", () => {
  const { w, pl } = withBasket();
  assert.equal(capacity(w, pl), 16);
  assert.equal(wearFromSlot(w, pl, slotOf(w, "basket")), "ok");
  assert.equal(wornIn(pl, "back"), "basket");
  assert.ok(!hasItem(pl, "basket"), "out of the pack");
  assert.equal(capacity(w, pl), 48);
  assert.equal(pl.inventory.length, 48, "the new slots appear at once (the pack is open, the world paused)");
  let ev = events(w);
  assert.ok(ev.some((e) => e.t === "gearOn" && e.item === "basket" && e.slot === "back"));
  assert.ok(!ev.some((e) => e.t === "equipped" || e.t === "taskTick"), "no iron-arm ceremony");
  assert.equal(takeOffGear(w, pl, "back"), "ok");
  assert.equal(wornIn(pl, "back"), undefined);
  assert.ok(hasItem(pl, "basket"), "back in the pack");
  assert.equal(capacity(w, pl), 16);
  assert.equal(pl.inventory.length, 16);
  ev = events(w);
  assert.ok(ev.some((e) => e.t === "gearOff" && e.item === "basket"));
  addItems(w, pl, "coin", 1);
  assert.equal(wearFromSlot(w, pl, slotOf(w, "coin")), "notWearable");
  assert.equal(takeOffGear(w, pl, "back"), "empty", "nothing worn");
  assert.equal(onGround(w).length, 0);
});

test("taking it off is refused when the basket itself would need a 17th slot; nothing changes; one free slot is enough", () => {
  const { w, pl } = withBasket();
  wearFromSlot(w, pl, slotOf(w, "basket"));
  for (let i = 0; i < 13; i++) addItems(w, pl, "stone", 20);
  for (const id of ["coin", "crown", "goblet"] as ItemId[]) addItems(w, pl, id, 1);
  assert.equal(pl.inventory.filter(Boolean).length, 16, "exactly what 16 slots hold");
  events(w);
  const before = JSON.stringify([pl.inventory, pl.gear]);
  assert.equal(takeOffCheck(w, pl, "back").ok, false);
  assert.equal(takeOffGear(w, pl, "back"), "noRoom");
  assert.equal(JSON.stringify([pl.inventory, pl.gear]), before, "nothing changed");
  assert.equal(capacity(w, pl), 48);
  const msg = events(w).find((e) => e.t === "message");
  assert.ok(msg?.t === "message" && /TOO MUCH TO CARRY WITHOUT THE WOVEN BASKET - FREE 1 SLOT$/.test(msg.text), "a clear refusal");
  frames(w, 5);
  assert.equal(onGround(w).length, 0, "nothing dropped");
  // Drop one relic: 15 slots plus the basket fill the 16 exactly.
  assert.equal(dropFromSlot(w, pl, slotOf(w, "goblet")), "ok");
  const own = owned(w), ground = onGround(w).length;
  assert.equal(takeOffGear(w, pl, "back"), "ok");
  assert.deepEqual(owned(w), own, "nothing lost");
  assert.equal(pl.inventory.filter(Boolean).length, 16, "the basket took the last slot");
  frames(w, 5);
  assert.equal(onGround(w).length, ground, "nothing dropped");
});

test("the fit check counts stacking: half stacks that merge make room, and repacking loses nothing", () => {
  const { w, pl } = withBasket();
  wearFromSlot(w, pl, slotOf(w, "basket"));
  const fill = (woodB: number) => {
    pl.inventory.fill(null);
    pl.inventory[0] = { item: "wood", n: 10 };
    pl.inventory[1] = { item: "wood", n: woodB };
    for (let i = 0; i < 12; i++) pl.inventory[2 + i] = { item: "stone", n: 20 };
    pl.inventory[30] = { item: "coin", n: 1 };
    pl.inventory[47] = { item: "crown", n: 1 };
  };
  // 15 slots in use, but 10 + 11 wood needs two slots: with the basket that is 17.
  fill(11);
  const before = JSON.stringify(pl.inventory);
  assert.equal(takeOffGear(w, pl, "back"), "noRoom");
  assert.equal(JSON.stringify(pl.inventory), before);
  // 10 + 10 wood merge into one stack: 16 exactly, items far beyond slot 16 included.
  fill(10);
  const own = owned(w);
  assert.equal(takeOffGear(w, pl, "back"), "ok");
  assert.deepEqual(owned(w), own, "nothing lost");
  assert.equal(pl.inventory.length, 16);
  assert.equal(countItem(pl, "wood"), 20);
  assert.ok(hasItem(pl, "coin") && hasItem(pl, "crown") && hasItem(pl, "basket"));
  frames(w, 5);
  assert.equal(onGround(w).length, 0);
});

test("taking it off keeps the pack's order where it can: only items beyond the smaller pack move", () => {
  const { w, pl } = withBasket();
  wearFromSlot(w, pl, slotOf(w, "basket"));
  pl.inventory.fill(null);
  pl.inventory[0] = { item: "wood", n: 5 };
  pl.inventory[3] = { item: "crown", n: 1 };
  pl.inventory[20] = { item: "wood", n: 7 };
  pl.inventory[40] = { item: "goblet", n: 1 };
  assert.equal(takeOffGear(w, pl, "back"), "ok");
  assert.deepEqual(pl.inventory.slice(0, 5), [{ item: "wood", n: 12 }, { item: "goblet", n: 1 }, { item: "basket", n: 1 }, { item: "crown", n: 1 }, null]);
});

test("the worn basket survives save/load; v7 saves with it installed migrate to wearing it", () => {
  const { w, pl } = withBasket();
  wearFromSlot(w, pl, slotOf(w, "basket"));
  addItems(w, pl, "wood", 300);
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.equal(wornIn(player(w2), "back"), "basket");
  assert.equal(capacity(w2, player(w2)), 48);
  assert.deepEqual(serialize(w2), serialize(w));
  // v7: the installed basket was the world flag golem.basket, and actors had no gear.
  const s: any = serialize(w);
  const v7 = { ...s, version: 7, flags: [...s.flags, "golem.basket"], actors: s.actors.map(({ gear: _g, ...a }: any) => a) };
  const w3 = deserialize(v7), p3 = player(w3);
  assert.equal(wornIn(p3, "back"), "basket");
  assert.ok(!w3.flags.has("golem.basket"), "the flag is retired");
  assert.equal(capacity(w3, p3), 48, "same capacity");
  assert.deepEqual(p3.inventory, pl.inventory, "the pack is untouched");
  for (const a of w3.actors) assert.deepEqual(a.gear, a.id === p3.id ? { back: "basket" } : {}, a.id);
  frames(w3, 5);
  assert.equal(countItem(p3, "wood"), 300);
  assert.equal(onGround(w3).length, 0, "no overflow");
  // A v7 save made mid-attach (picked up, still attaching) ends worn, with no stale task left to fire.
  const s7: any = serialize(newWorld());
  s7.version = 7;
  s7.actors = s7.actors.map(({ gear: _g, ...a }: any) => (a.id === s7.playerId ? { ...a, task: { kind: "attach", dur: 1.2, t: 0.3, fired: false, effect: { op: "equip", item: "basket" }, area: a.area } } : a));
  const w5 = deserialize(s7), p5 = player(w5);
  assert.equal(wornIn(p5, "back"), "basket");
  assert.equal(p5.task, null);
  assert.equal(capacity(w5, p5), 48);
  // A v7 save without it: nobody wears anything.
  const s8: any = serialize(newWorld());
  const w6 = deserialize({ ...s8, version: 7, actors: s8.actors.map(({ gear: _g, ...a }: any) => a) });
  assert.ok(w6.actors.every((a) => Object.keys(a.gear).length === 0));
});

test("Ctrl+4's kit leaves the golem wearing the basket: the pack's one if it has it, else a new one, never two", () => {
  const { w, pl } = withBasket();
  assert.ok(ensureWorn(w, pl, "basket"));
  assert.equal(wornIn(pl, "back"), "basket");
  assert.ok(!hasItem(pl, "basket"), "the pack's basket was put on");
  assert.ok(ensureWorn(w, pl, "basket"));
  assert.equal(owned(w).basket, 1, "already worn: nothing added");
  const w2 = newWorld(), p2 = player(w2);
  assert.ok(ensureWorn(w2, p2, "basket"));
  assert.equal(wornIn(p2, "back"), "basket");
  assert.equal(capacity(w2, p2), 48);
  assert.equal(p2.inventory.length, 48);
});

test("gear is actor state, not a world flag: another actor can wear a basket through its task queue", () => {
  const w = newWorld(), pl = player(w);
  const other = makeActor("golem2", "golem", "dungeon", pl.x + 24, pl.y);
  w.actors.push(other);
  addItems(w, other, "basket", 1);
  enqueueTask(other, { kind: "reach", dur: 0.3, effect: { op: "wear", slot: 0 } });
  frames(w, 30);
  assert.equal(wornIn(other, "back"), "basket");
  assert.equal(capacity(w, other), 48);
  assert.equal(wornIn(pl, "back"), undefined);
  assert.equal(capacity(w, pl), 8, "the player's pack is unaffected");
  assert.ok(![...w.flags].some((f) => f.includes("basket")), "no world flag");
});
