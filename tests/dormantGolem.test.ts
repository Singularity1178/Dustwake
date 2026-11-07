// The dormant worker golem's shut screen (opens only once a core has been slotted
// in, and stays open after the core comes out) and storage chest names (the
// orders' own labels by default, renamable from the storage screen, saved).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ARTIFICERY_WORKER } from "../src/game/map";
import { THOUGHTS } from "../src/game/content/monologue";
import { CORE_SEATED, npcFlag } from "../src/game/content/flags";
import { actorById, currentArea, getArea, player, type SimEvent, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { addItems } from "../src/game/sim/inventory";
import { canManage } from "../src/game/sim/power";
import { npcInteractables } from "../src/game/sim/interact";
import { renameStorage } from "../src/game/sim/commands";
import { PROP_NAME_MAX, cleanPropName, propName, storageOptions } from "../src/game/sim/orders";
import { StorageUi } from "../src/game/screens/storage";
import { events, frame, frames, newWorld, useOn } from "./helpers";
import { screenHost, assertTextFits } from "./support/screenHost";
import { CHEST, besideChest, chestProp, fixture } from "./support/workerFixture";

const WORKER = ARTIFICERY_WORKER.id;
const thoughts = (evs: SimEvent[]) => evs.filter((e) => e.t === "thought").map((e) => (e as { line: string }).line);
const roundTrip = (w: World) => deserialize(JSON.parse(JSON.stringify(serialize(w))));
const coreKey = (w: World) => { frame(w, { ix: 0, iy: 0, use: false, core: true }); frames(w, 150); };

// ------------------------------------------------------------------ the golem
test("a worker that never had a core: E shuts, thinks the dormant line; slot a core in and out, and the screen opens, silently", () => {
  const w = newWorld(), pl = player(w), wk = actorById(w, WORKER)!;
  const it = () => npcInteractables(w, currentArea(w)).find((i) => i.actorId === WORKER)!;
  assert.equal(canManage(w, wk), false);
  events(w); useOn(w, it());
  let evs = events(w);
  assert.ok(evs.some((e) => e.t === "dormantTouched")); assert.ok(!evs.some((e) => e.t === "manageActor"));
  assert.deepEqual(thoughts(evs), ["golem.dormant"]);
  // the first time a core goes in: powered, screen open, no dormant line, and the seated flag is set
  addItems(w, pl, "ruby_core", 1);
  coreKey(w);
  assert.equal(wk.powerCore, "ruby_core"); assert.ok(w.flags.has(npcFlag(WORKER, CORE_SEATED)));
  assert.ok(!thoughts(events(w)).includes("golem.dormant"), "slotting it in is not 'missing power source'");
  useOn(w, it());
  evs = events(w);
  assert.ok(evs.some((e) => e.t === "manageActor")); assert.deepEqual(thoughts(evs), []);
  // core out again: the screen still opens, and the golem says nothing about it
  coreKey(w); events(w);
  assert.equal(wk.powerCore, null); assert.equal(canManage(w, wk), true);
  useOn(w, it());
  evs = events(w);
  assert.ok(evs.some((e) => e.t === "manageActor")); assert.ok(!evs.some((e) => e.t === "dormantTouched"));
  assert.deepEqual(thoughts(evs), []);
  // and that survives a save
  const loaded = roundTrip(w);
  assert.equal(canManage(loaded, actorById(loaded, WORKER)!), true);
});

test("the dormant line fires every time until the first core, and a body that needs no power is never locked", () => {
  assert.deepEqual([THOUGHTS["golem.dormant"].once, THOUGHTS["golem.dormant"].cooldown], [false, 2]);
  const w = newWorld(), pl = player(w);
  assert.equal(canManage(w, pl), true, "the maintainer has no power socket to wait on");
});

// ------------------------------------------------------------------ chest names
function addChest(w: World) {
  const area = getArea(w, CHEST.area);
  return area.addProp("storage_chest", 11 * 16 + 8, 8 * 16 + 14);
}

test("a chest goes by the name the orders give it: area, kind, and a number once there are several", () => {
  const { w, pl } = fixture(), area = getArea(w, CHEST.area);
  assert.equal(propName(area, chestProp(w)), "DEBUG WORKSHOP CHEST");
  const second = addChest(w);
  const names = storageOptions(w, pl).filter((o) => o.area === CHEST.area);
  assert.deepEqual(names.map((o) => o.label), ["DEBUG WORKSHOP CHEST 1", "DEBUG WORKSHOP CHEST 2"].sort());
  for (const o of names) assert.equal(o.label, propName(area, area.prop(o.ref.prop)!), "the screen and the orders agree");
  assert.ok(second.id);
});

test("renaming: the storage screen's R, typed letters, Enter; the orders and the save follow; empty goes back to the default", () => {
  const { w, pl } = fixture(), sh = screenHost(w), ui = new StorageUi(sh.host), area = getArea(w, CHEST.area);
  besideChest(w); ui.open(CHEST.prop);
  const type = (...ch: string[]) => { sh.host.typed = ch; sh.press(); sh.host.typed = []; };
  sh.press("r");
  assert.ok(ui.nameField.active); assert.equal(ui.nameField.value, "DEBUG WORKSHOP CHEST", "starts from the current name");
  // typing "e", "q", "w" must not move the cursor, move items or close the screen
  const cursor = ui.cursor;
  for (let i = 0; i < 25; i++) type("\b");
  type("w", "o", "o", "d", " ", "s", "t", "o", "r", "e");
  sh.press("q", "e", "w", "i"); // command keys while typing: nothing happens
  assert.equal(ui.nameField.value, "WOOD STORE"); assert.equal(ui.cursor, cursor); assert.ok(sh.host.screens.is("storage"));
  assertTextFits("storage rename", sh.draw()); sh.save(".test-out/shots/storage-rename.png");
  sh.press("enter");
  assert.ok(!ui.nameField.active); assert.equal(chestProp(w).name, "WOOD STORE");
  assert.equal(propName(area, chestProp(w)), "WOOD STORE");
  assert.deepEqual(storageOptions(w, pl).map((o) => o.label), ["WOOD STORE"], "an order's chest list uses it");
  assertTextFits("storage renamed", sh.draw()); sh.save(".test-out/shots/storage-renamed.png");
  // it is saved with the chest
  const loaded = roundTrip(w);
  assert.equal(getArea(loaded, CHEST.area).prop(CHEST.prop)!.name, "WOOD STORE");
  assert.deepEqual(serialize(loaded), serialize(w));
  // Esc cancels, leaving the name
  sh.press("r"); type("\b", "\b"); sh.press("escape");
  assert.ok(!ui.nameField.active && sh.host.screens.is("storage")); assert.equal(chestProp(w).name, "WOOD STORE");
  // an empty name is the default again
  sh.press("r"); for (let i = 0; i < 25; i++) type("\b"); sh.press("enter");
  assert.equal(chestProp(w).name, undefined); assert.equal(propName(area, chestProp(w)), "DEBUG WORKSHOP CHEST");
  assert.ok(!("name" in (serialize(w).areas[CHEST.area].props[CHEST.prop] ?? {})));
});

test("names are cleaned, bounded, need the golem beside the chest, and a built chest keeps its name through a save", () => {
  assert.equal(cleanPropName("  my   chest  "), "MY CHEST");
  assert.equal(cleanPropName("x".repeat(40)).length, PROP_NAME_MAX);
  const { w, pl } = fixture(), built = addChest(w);
  besideChest(w);
  assert.equal(renameStorage(w, pl, CHEST.prop, "  iron  ore ").ok, true); assert.equal(chestProp(w).name, "IRON ORE");
  pl.x += 120;
  assert.equal(renameStorage(w, pl, CHEST.prop, "NOPE").ok, false); assert.equal(chestProp(w).name, "IRON ORE");
  pl.x = built.x; pl.y = built.y + 9;
  assert.equal(renameStorage(w, pl, built.id, "spare").ok, true);
  const loaded = roundTrip(w), area = getArea(loaded, CHEST.area);
  assert.equal(area.prop(built.id)!.name, "SPARE"); assert.equal(area.prop(CHEST.prop)!.name, "IRON ORE");
  assert.deepEqual(serialize(loaded), serialize(w));
});
