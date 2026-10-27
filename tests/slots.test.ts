// Gear slots: the full set (helm, back, two arms, core attachment, four rune
// slots), which are usable and which locked, that unlocking is a data/state
// change, the wear / take-off rules (locked slots take nothing, fit checks,
// capacity tiers), the iron arm and aether core decisions, saves, the debug kit,
// and the pack screen's navigation between the paper doll and the pack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { player, currentArea, setFlag, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { addItems, countItem, capacity } from "../src/game/sim/inventory";
import { wearFromSlot, takeOffGear } from "../src/game/sim/commands";
import { applyEffect } from "../src/game/sim/tasks";
import { stepWorld } from "../src/game/sim/step";
import { GEAR_SLOT_DEFS, GEAR_SLOTS, slotDef, slotsOfKind, RUNE_SLOTS } from "../src/game/content/gear";
import { ITEMS, type ItemId } from "../src/game/content/items";
import { FLAGS } from "../src/game/content/flags";
import { FONT_GLYPHS } from "../src/game/font";
import { usableSlots, slotUsable, lockedText, wearCheck, takeOffCheck, speedMultiplier, targetSlot, gearRefusal, ensureWorn } from "../src/game/sim/gear";
import { toggleGearKit, allSlotsUnlocked, slotUnlockFlags, GEAR_KIT } from "../src/game/sim/debug";
import { PackUi, neighbor, dollRect, packLayout } from "../src/game/screens/pack";
import { ScreenStack } from "../src/game/ui/screens";
import { newWorld, frame, frames, events } from "./helpers";

const fresh = () => { const w = newWorld(); frame(w); return { w, pl: player(w) }; };
const give = (w: World, id: ItemId, n = 1) => addItems(w, player(w), id, n);
const slotOf = (w: World, id: ItemId) => player(w).inventory.findIndex((s) => s?.item === id);

test("the golem has every slot; the sound arm, the helm, the core mount, the back and one rune slot are usable now; the rest are locked", () => {
  const { w, pl } = fresh();
  assert.deepEqual([...GEAR_SLOTS].sort(), ["armL", "armR", "back", "core", "head", "rune0", "rune1", "rune2", "rune3"]);
  assert.equal(RUNE_SLOTS.length, 4);
  assert.deepEqual(usableSlots(w, pl).sort(), ["armR", "back", "core", "head", "rune0"]);
  const locked = GEAR_SLOTS.filter((s) => !slotUsable(w, pl, s)).sort();
  assert.deepEqual(locked, ["armL", "rune1", "rune2", "rune3"]);
  // every locked slot says why; text fits the font and the description panel
  const ok = (s: string) => [...s].every((ch) => FONT_GLYPHS.has(ch));
  for (const d of GEAR_SLOT_DEFS) {
    assert.ok(ok(d.name), d.id);
    for (const t of [...(d.hint ?? []), ...(d.locked ?? []).flatMap((l) => l.text)]) assert.ok(ok(t) && t.length <= 34, `${d.id}: ${t}`);
    if (d.unlock) assert.ok(lockedText(w, pl, d).length > 0 && d.locked?.length, d.id);
    else assert.ok(d.hint && d.hint.length, d.id);
  }
});

test("which arm: the right arm is the sound one and usable; the left (the broken stub, which the iron arm replaces) is locked by its own flag, not by golem.arm", () => {
  const { w, pl } = fresh();
  assert.ok(slotUsable(w, pl, "armR") && !slotUsable(w, pl, "armL"));
  const before = lockedText(w, pl, slotDef("armL")).join(" ");
  setFlag(w, FLAGS.golemArm);
  assert.ok(!slotUsable(w, pl, "armL"), "the iron arm is a body part, not a slot item: it does not open the slot");
  const after = lockedText(w, pl, slotDef("armL")).join(" ");
  assert.notEqual(before, after);
  assert.match(after, /IRON ARM/);
  assert.equal(ITEMS.arm.wear, undefined, "the iron arm stays an equip flag");
  assert.ok(ITEMS.arm.equip);
  setFlag(w, FLAGS.slotArmLeft);
  assert.ok(slotUsable(w, pl, "armL"));
});

test("the aether core is not slot-aware: it can't be worn, stays in the pack, and the core attachment slot is a separate mount", () => {
  const { w, pl } = fresh();
  give(w, "core");
  assert.equal(ITEMS.core.wear, undefined);
  assert.equal(wearFromSlot(w, pl, slotOf(w, "core")), "notWearable");
  assert.equal(countItem(pl, "core"), 1);
  assert.equal(slotDef("core").kind, "core");
  assert.ok(slotUsable(w, pl, "core"));
});

test("runes go in the first free usable rune slot; with one slot the next swaps the first back into the pack", () => {
  const { w, pl } = fresh();
  give(w, "rune_swift"); give(w, "rune_glow");
  assert.equal(targetSlot(w, pl, "rune_swift"), "rune0");
  assert.equal(wearFromSlot(w, pl, slotOf(w, "rune_swift")), "ok");
  assert.equal(pl.gear.rune0, "rune_swift");
  assert.equal(countItem(pl, "rune_swift"), 0, "worn, not in the pack");
  assert.equal(wearFromSlot(w, pl, slotOf(w, "rune_glow")), "ok");
  assert.deepEqual([pl.gear.rune0, countItem(pl, "rune_swift")], ["rune_glow", 1], "swapped: the first is back in the pack");
  assert.equal(pl.gear.rune1, undefined, "locked slots take nothing");
  assert.equal(wearCheck(w, pl, slotOf(w, "rune_swift"), "rune1").ok, false, "explicitly into a locked slot is refused");
  assert.equal((wearCheck(w, pl, slotOf(w, "rune_swift"), "rune1") as { reason: string }).reason, "noSlot");
  // unlocking is just setting a flag: the same runes now fill the next slot
  setFlag(w, FLAGS.slotRune1);
  assert.equal(wearFromSlot(w, pl, slotOf(w, "rune_swift")), "ok");
  assert.deepEqual([pl.gear.rune0, pl.gear.rune1], ["rune_glow", "rune_swift"]);
  assert.equal(takeOffGear(w, pl, "rune0"), "ok");
  assert.equal(pl.gear.rune0, undefined); assert.equal(countItem(pl, "rune_glow"), 1);
});

test("a future slot unlock is a data change: a new item for a locked arm slot needs no code", () => {
  const { w, pl } = fresh();
  const items = ITEMS as unknown as Record<string, unknown>;
  items.test_gauntlet = { name: "TEST GAUNTLET", tags: [], wear: { kind: "arm" } };
  items.test_left_only = { name: "TEST LEFT", tags: [], wear: { kind: "arm", slot: "armL" } };
  try {
    give(w, "test_gauntlet" as ItemId); give(w, "test_left_only" as ItemId);
    assert.equal(wearFromSlot(w, pl, slotOf(w, "test_left_only" as ItemId)), "noSlot", "a left-only item can't use a locked left arm");
    assert.equal(wearFromSlot(w, pl, slotOf(w, "test_gauntlet" as ItemId)), "ok");
    assert.equal(pl.gear.armR, "test_gauntlet");
    setFlag(w, FLAGS.slotArmLeft);
    assert.equal(wearFromSlot(w, pl, slotOf(w, "test_left_only" as ItemId)), "ok");
    assert.equal(pl.gear.armL, "test_left_only");
  } finally { delete items.test_gauntlet; delete items.test_left_only; }
});

test("relocking a slot returns what it held to the pack; nothing is deleted and its effect stops", () => {
  const { w, pl } = fresh();
  setFlag(w, FLAGS.slotRune1);
  give(w, "rune_swift"); give(w, "rune_glow");
  wearFromSlot(w, pl, slotOf(w, "rune_glow")); wearFromSlot(w, pl, slotOf(w, "rune_swift"));
  assert.deepEqual([pl.gear.rune0, pl.gear.rune1], ["rune_glow", "rune_swift"]);
  assert.equal(speedMultiplier(w, pl), 1 + ITEMS.rune_swift.worn!.speed!);
  w.flags.delete(FLAGS.slotRune1);
  assert.equal(speedMultiplier(w, pl), 1, "a locked slot's item has no effect even before it is put away");
  events(w);
  frames(w, 2);
  assert.equal(pl.gear.rune1, undefined); assert.equal(countItem(pl, "rune_swift"), 1);
  assert.equal(pl.gear.rune0, "rune_glow");
});

test("take-off fit rules: refused with nothing changed when the pack is full, and capacity tiers still follow the worn basket", () => {
  const { w, pl } = fresh();
  give(w, "rune_swift");
  wearFromSlot(w, pl, slotOf(w, "rune_swift"));
  assert.equal(capacity(w, pl), 8, "a rune grants no pack slots");
  pl.inventory = pl.inventory.map(() => ({ item: "coin", n: 1 }));
  const snap = JSON.stringify([pl.inventory, pl.gear]);
  const chk = takeOffCheck(w, pl, "rune0");
  assert.ok(!chk.ok && chk.reason === "noRoom" && chk.over === 1 && chk.item === "rune_swift");
  events(w);
  assert.equal(takeOffGear(w, pl, "rune0"), "noRoom");
  assert.equal(JSON.stringify([pl.inventory, pl.gear]), snap, "nothing changed, nothing dropped");
  assert.match((events(w)[0] as { text: string }).text, /NO ROOM IN THE PACK FOR THE RUNE OF SWIFT/);
  assert.match(gearRefusal(chk), /FREE 1 SLOT$/);
  pl.inventory[3] = null;
  assert.equal(takeOffGear(w, pl, "rune0"), "ok");
  assert.equal(pl.inventory.map((x) => x?.item)[3], "rune_swift");
  // basket: worn it grants the 48-slot tier (any slot kind counts as worn), and the shrink check still applies
  const { w: w2, pl: p2 } = fresh();
  assert.ok(ensureWorn(w2, p2, "basket"));
  assert.equal(capacity(w2, p2), 48); assert.equal(p2.gear.back, "basket");
  for (let i = 0; i < 9; i++) addItems(w2, p2, "coin", 1);
  const off = takeOffCheck(w2, p2, "back");
  assert.ok(!off.ok && off.reason === "noRoom" && off.shrinks);
  assert.match(gearRefusal(off), /TOO MUCH TO CARRY WITHOUT THE WOVEN BASKET/);
});

test("worn gear in every slot round-trips through save/load, with the unlock flags", () => {
  const { w, pl } = fresh();
  toggleGearKit(w, pl);
  ensureWorn(w, pl, "rune_swift");
  wearFromSlot(w, pl, slotOf(w, "rune_glow"));
  const w2 = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.deepEqual(serialize(w2), serialize(w));
  const p2 = player(w2);
  assert.deepEqual([p2.gear.back, p2.gear.rune0, p2.gear.rune1], ["basket", "rune_swift", "rune_glow"]);
  assert.ok(allSlotsUnlocked(w2));
  assert.equal(usableSlots(w2, p2).length, GEAR_SLOTS.length);
});

test("debug kit (Ctrl+6): grants the materials and both runes, unlocks every locked slot, and toggles back", () => {
  const { w, pl } = fresh();
  assert.deepEqual(slotUnlockFlags().sort(), [FLAGS.slotArmLeft, FLAGS.slotRune1, FLAGS.slotRune2, FLAGS.slotRune3].sort());
  assert.equal(toggleGearKit(w, pl), true);
  assert.ok(allSlotsUnlocked(w));
  assert.deepEqual(usableSlots(w, pl).sort(), [...GEAR_SLOTS].sort());
  assert.equal(pl.gear.back, "basket");
  for (const [item, n] of GEAR_KIT) assert.ok(countItem(pl, item) >= n, item);
  assert.ok(countItem(pl, "planks") >= 40 && countItem(pl, "cut_stone") >= 40);
  assert.equal(countItem(pl, "rune_swift"), 1); assert.equal(countItem(pl, "rune_glow"), 1);
  assert.ok(w.flags.has(FLAGS.knowBuild));
  // wear a rune in the slot that will lock again, and one in the slot that stays open
  wearFromSlot(w, pl, slotOf(w, "rune_swift")); wearFromSlot(w, pl, slotOf(w, "rune_glow"));
  assert.deepEqual([pl.gear.rune0, pl.gear.rune1], ["rune_swift", "rune_glow"]);
  assert.equal(toggleGearKit(w, pl), false);
  assert.deepEqual(usableSlots(w, pl).sort(), ["armR", "back", "core", "head", "rune0"]);
  assert.equal(pl.gear.rune0, "rune_swift"); assert.equal(pl.gear.rune1, undefined);
  assert.equal(countItem(pl, "rune_glow"), 1, "the rune from the relocked slot is back in the pack");
  // on again: topped up, never a third rune
  assert.equal(toggleGearKit(w, pl), true);
  assert.equal(countItem(pl, "rune_swift") + (pl.gear.rune0 === "rune_swift" ? 1 : 0), 1);
  assert.equal(countItem(pl, "rune_glow"), 1);
  assert.ok(countItem(pl, "wood") <= 40 && countItem(pl, "planks") <= 40, "a second press tops up, it doesn't pile on");
});

// ------------------------------------------------------------------ the pack screen
function packHost(w: World) {
  const ctx = (globalThis as any).document.createElement("canvas").getContext("2d");
  const keys: string[] = [], said: string[] = [];
  const host: any = {
    ctx, wctx: ctx, world: w, get pl() { return player(w); }, get area() { return currentArea(w); },
    t: 0.1, cam: { x: 0, y: 0 }, vw: 320, vh: 180, screens: new ScreenStack(), typed: [],
    sfx: new Proxy({}, { get: () => () => {} }), hit: (...k: string[]) => k.some((x) => keys.includes(x)),
    say: (s: string) => said.push(s), renderNote: () => {}, read: () => {},
    drainEvents: () => { for (const e of w.events) if (e.t === "message") said.push(e.text); w.events = []; },
  };
  host.screens.set({ id: "play", opaque: true, t: 0, update() {}, render() {} });
  const ui = new PackUi(host);
  const tap = (...k: string[]) => { keys.splice(0, keys.length, ...k); host.screens.update(1 / 60); keys.length = 0; };
  return { ui, tap, said, host };
}

test("pack screen: spatial navigation between the paper doll and the pack, wear / take off from either side, locked slots refuse", () => {
  const { w, pl } = fresh();
  setFlag(w, FLAGS.golemArm);
  give(w, "rune_swift"); give(w, "coin");
  const { ui, tap, said } = packHost(w);
  ui.open("view");
  assert.equal(ui.slot, null);
  tap("a"); assert.equal(ui.slot, "core", "left from the pack's first row lands on the doll's right-hand edge, level with it");
  ui.slot = null; ui.cursor = 3 * packLayout(ui.cap).cols; tap("a"); assert.ok(["armL", "rune3"].includes(ui.slot!), "lower rows reach the lower slots");
  ui.slot = "core";
  tap("d");
  assert.equal(ui.slot, null, "right off the doll's right-hand column goes back to the pack");
  assert.equal(ui.cursor % packLayout(ui.cap).cols, 0);
  // inside the doll: the nearest slot that way
  ui.slot = "armR";
  tap("w"); assert.equal(ui.slot, "back");
  tap("w"); assert.equal(ui.slot, "head", "nothing straight above the back slot but the helm, up and to the right");
  ui.slot = "armL"; tap("w"); assert.equal(ui.slot, "core");
  ui.slot = "armR"; tap("d"); assert.equal(ui.slot, "armL");
  // E on a pack rune: worn, and the cursor follows it to the slot
  ui.slot = null; ui.cursor = slotOf(w, "rune_swift");
  tap("e");
  assert.equal(pl.gear.rune0, "rune_swift"); assert.equal(ui.slot, "rune0");
  // E on the worn slot takes it off; the cursor goes to it in the pack
  tap("e");
  assert.equal(pl.gear.rune0, undefined); assert.equal(ui.slot, null); assert.equal(pl.inventory[ui.cursor]?.item, "rune_swift");
  // a locked slot: E only thuds; nothing changes; wearing never targets it
  ui.slot = "rune2";
  const snap = JSON.stringify([pl.inventory, pl.gear]);
  tap("e");
  assert.equal(JSON.stringify([pl.inventory, pl.gear]), snap);
  // Q drops in the pack only
  ui.slot = null; ui.cursor = slotOf(w, "coin");
  tap("q");
  assert.equal(countItem(pl, "coin"), 0);
  tap("escape"); assert.ok(!said.length || said.every((s) => typeof s === "string"));
});

test("pack screen: renders every slot state (empty, filled, locked, selected) and every capacity tier", () => {
  const { w, pl } = fresh();
  const { ui } = packHost(w);
  const draw = () => { resetTrace(); ui.screen.render(); return traceHash(); };
  ui.open("view");
  draw(); // (the first draw builds the icons' sprites)
  const bare = draw();
  assert.equal(bare, draw(), "deterministic");
  ui.slot = "armL"; const lockedSel = draw();
  ui.slot = "armR"; const emptySel = draw();
  assert.notEqual(lockedSel, emptySel);
  toggleGearKit(w, pl);
  ui.slot = "armL";
  assert.notEqual(draw(), lockedSel, "unlocking changes how the slot is drawn");
  ensureWorn(w, pl, "rune_swift");
  ui.slot = "rune0"; draw();
  w.flags.delete(FLAGS.knowBuild);
  for (const n of [8, 16, 48]) { const L = packLayout(n); assert.ok(L.gx >= 156 && L.gx + L.gw <= 308 && L.gy + L.gh <= 134, `tier ${n} fits beside the doll`); }
  // the doll never overlaps itself or the pack column
  const rs = GEAR_SLOTS.map((s) => dollRect(s));
  for (let i = 0; i < rs.length; i++) {
    assert.ok(rs[i].x + rs[i].w < 156);
    for (let j = i + 1; j < rs.length; j++) assert.ok(rs[i].x + rs[i].w <= rs[j].x || rs[j].x + rs[j].w <= rs[i].x || rs[i].y + rs[i].h <= rs[j].y || rs[j].y + rs[j].h <= rs[i].y, `${i}/${j}`);
  }
  assert.equal(neighbor({ x: 0, y: 0, w: 10, h: 10 }, "right", [{ r: { x: 50, y: 0, w: 10, h: 10 } }, { r: { x: 20, y: 40, w: 10, h: 10 } }])!.r.x, 50, "lined up beats nearer but off-line");
  assert.equal(neighbor({ x: 0, y: 0, w: 10, h: 10 }, "left", [{ r: { x: 50, y: 0, w: 10, h: 10 } }]), undefined);
  void slotsOfKind; void stepWorld; void applyEffect;
});
