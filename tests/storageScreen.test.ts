// The storage screen (screens/storage.ts) and its command (commands.ts:
// moveStorageSlot): opened on the chest, moves both ways, as much as fits,
// refusals with a message, the cursor crossing between the panes, closing, a
// save with items in the chest, and a text lint of what it draws.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StorageUi, gridLayout } from "../src/game/screens/storage";
import { moveStorageSlot, STORE_TEXT } from "../src/game/sim/commands";
import { ITEMS, ITEM_NAMES, maxStack, type ItemId } from "../src/game/content/items";
import { getArea, player, type Slot, type World } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { capacity } from "../src/game/sim/inventory";
import { countItem } from "../src/game/sim/inventoryOps";
import { FONT_GLYPHS } from "../src/game/font";
import { frame } from "./helpers";
import { screenHost, assertTextFits } from "./support/screenHost";
import { CHEST, besideChest, chestCount, chestProp, fixture } from "./support/workerFixture";

const roundTrip = (w: World) => deserialize(JSON.parse(JSON.stringify(serialize(w))));
const setChest = (w: World, slots: Slot[]) => getArea(w, CHEST.area).setInventory(CHEST.prop, slots);
const slotOf = (w: World, item: ItemId) => player(w).inventory.findIndex((s) => s?.item === item);

function open() {
  const f = fixture(), sh = screenHost(f.w), ui = new StorageUi(sh.host);
  besideChest(f.w);
  ui.open(CHEST.prop);
  return { ...f, sh, ui };
}
const last = (a: string[]) => a[a.length - 1];

test("opens on the pack with the cursor on the first slot; the pack is the tier's size and the chest has 32", () => {
  const { sh, ui, w } = open();
  assert.ok(sh.host.screens.is("storage"));
  assert.equal(ui.pane, "pack"); assert.equal(ui.cursor, 0);
  assert.equal(ui.slots("pack").cap, capacity(w, player(w)));
  assert.equal(ui.slots("chest").cap, 32);
  assert.deepEqual([gridLayout(8, "pack").cols, gridLayout(16, "pack").cols, gridLayout(48, "pack").cols, gridLayout(32, "chest").cols], [4, 4, 8, 8]);
});

test("E moves the whole stack into the chest and back; Q moves one", () => {
  const { w, pl, sh, ui } = open();
  const planks = slotOf(w, "planks");
  ui.cursors.pack = planks;
  sh.press("e");
  assert.equal(chestCount(w, "planks"), 8); assert.equal(countItem(pl, "planks"), 0);
  assert.equal(last(sh.notes), "STORED 8 PLANKS");
  // across to the chest (D off the pack's last column) and take one, then the rest
  ui.cursors.pack = 3; sh.press("d");
  assert.equal(ui.pane, "chest"); assert.equal(ui.cursor, 0);
  sh.press("q");
  assert.equal(countItem(pl, "planks"), 1); assert.equal(chestCount(w, "planks"), 7); assert.equal(last(sh.notes), "TOOK 1 PLANKS");
  sh.press("e");
  assert.equal(countItem(pl, "planks"), 8); assert.equal(chestCount(w, "planks"), 0);
  assert.equal(last(sh.notes), "TOOK 7 PLANKS");
  // Q on the pack side stores one
  ui.pane = "pack"; ui.cursors.pack = slotOf(w, "planks");
  sh.press("q");
  assert.equal(chestCount(w, "planks"), 1); assert.equal(countItem(pl, "planks"), 7);
  assert.equal(chestProp(w).inventory!.filter(Boolean).length, 1);
});

test("a partly fitting stack moves as much as fits and says so; a full chest refuses; items are never lost", () => {
  const { w, pl, sh, ui } = open();
  const full: Slot[] = Array.from({ length: 32 }, () => ({ item: "stone" as ItemId, n: 20 }));
  full[31] = { item: "planks", n: 17 }; // room for three more planks, nowhere else
  setChest(w, full);
  const total = () => chestCount(w, "planks") + countItem(pl, "planks");
  const before = total();
  ui.cursors.pack = slotOf(w, "planks");
  sh.press("e");
  assert.equal(chestCount(w, "planks"), 20); assert.equal(countItem(pl, "planks"), 5);
  assert.equal(last(sh.notes), "STORED 3 OF 8 PLANKS. THE STORAGE IS FULL");
  sh.press("e");
  assert.equal(last(sh.notes), STORE_TEXT.chestFull); assert.equal(countItem(pl, "planks"), 5);
  sh.press("q");
  assert.equal(last(sh.notes), STORE_TEXT.chestFull);
  assert.equal(total(), before, "nothing created or destroyed");
  // taking into a full pack
  const f2 = open(); // fresh world
  f2.pl.inventory = Array.from({ length: 8 }, () => ({ item: "wood" as ItemId, n: 20 }));
  setChest(f2.w, [{ item: "stone", n: 4 }, ...Array(31).fill(null)]);
  f2.ui.pane = "chest"; f2.ui.cursors.chest = 0;
  f2.sh.press("e");
  assert.equal(last(f2.sh.notes), STORE_TEXT.packFull); assert.equal(chestCount(f2.w, "stone"), 4);
  // partial take: one slot of room (a stack of stone is 20, so 3 of 9 fit beside 17)
  f2.pl.inventory[7] = { item: "stone", n: 17 };
  setChest(f2.w, [{ item: "stone", n: 9 }, ...Array(31).fill(null)]);
  f2.sh.press("e");
  assert.equal(last(f2.sh.notes), "TOOK 3 OF 9 STONE. YOUR PACK IS FULL"); assert.equal(chestCount(f2.w, "stone"), 6); assert.equal(countItem(f2.pl, "stone"), 20);
});

test("an empty slot says so; the tutorial's undroppable items are never stored", () => {
  const { w, pl, sh, ui } = open();
  ui.cursors.pack = 7;
  sh.press("e"); assert.equal(last(sh.notes), STORE_TEXT.empty);
  ui.pane = "chest"; ui.cursors.chest = 5;
  sh.press("q"); assert.equal(last(sh.notes), STORE_TEXT.empty);
  ui.pane = "pack"; ui.cursors.pack = slotOf(w, "chisel");
  sh.press("e");
  assert.equal(last(sh.notes), STORE_TEXT.critical); assert.equal(countItem(pl, "chisel"), 1); assert.equal(chestCount(w, "chisel"), 0);
  assert.equal(ITEMS.chisel.droppable, false);
});

test("the cursor crosses between the panes on the same row, and stays inside the grids", () => {
  const { w, pl, sh, ui } = open();
  // 8-slot pack: 4 columns, 2 rows. D x3 along row 0, then across.
  sh.press("d"); sh.press("d"); sh.press("d");
  assert.deepEqual([ui.pane, ui.cursor], ["pack", 3]);
  sh.press("d"); assert.deepEqual([ui.pane, ui.cursor], ["chest", 0]);
  sh.press("a"); assert.deepEqual([ui.pane, ui.cursor], ["pack", 3], "A off the chest's first column comes back to the pack's last");
  sh.press("s"); sh.press("s"); assert.equal(ui.cursor, 7, "stops at the last row");
  sh.press("d"); assert.deepEqual([ui.pane, ui.cursor], ["chest", 8], "same row on the other side");
  sh.press("w"); sh.press("w"); sh.press("w"); assert.equal(ui.cursor, 0);
  sh.press("arrowleft"); assert.equal(ui.pane, "pack");
  sh.press("a"); sh.press("a"); sh.press("a"); sh.press("a"); assert.deepEqual([ui.pane, ui.cursor], ["pack", 0], "the pack's own left edge holds");
  // the basket: 48 slots, 8 columns, six rows; the chest only has four
  pl.gear.back = "basket"; frame(w);
  assert.equal(capacity(w, pl), 48);
  ui.cursors.pack = 40;
  for (let i = 0; i < 7; i++) sh.press("d");
  assert.equal(ui.cursor, 47);
  sh.press("d"); assert.deepEqual([ui.pane, ui.cursor], ["chest", 24], "row 5 of the pack lands on the chest's last row");
  sh.press("a"); assert.deepEqual([ui.pane, ui.cursor], ["pack", 31]);
  ui.pane = "chest"; ui.cursors.chest = 31; sh.press("d"); sh.press("s");
  assert.equal(ui.cursor, 31, "the chest's right and bottom edges hold");
});

test("Esc, I and Tab close it, and the world's state is whatever the moves left", () => {
  for (const key of ["escape", "i", "tab"]) {
    const { sh } = open();
    sh.press(key);
    assert.ok(sh.host.screens.is("play"), key);
  }
  const { sh, ui, w } = open();
  const at = slotOf(w, "planks");
  ui.cursors.pack = at; sh.press("e"); sh.press("escape");
  assert.equal(chestCount(w, "planks"), 8);
  ui.open(CHEST.prop); assert.deepEqual([ui.pane, ui.cursors.pack], ["pack", at], "reopens with the cursor where it was, on the pack");
});

test("a chest that is gone or out of reach changes nothing and the screen closes itself", () => {
  const { w, pl, sh, ui } = open();
  ui.cursors.pack = slotOf(w, "planks");
  pl.x += 80;
  assert.deepEqual({ ...moveStorageSlot(w, pl, CHEST.prop, "store", ui.cursor, 5), text: undefined }, { result: "far", moved: 0, text: undefined });
  sh.press("e"); assert.equal(last(sh.notes), STORE_TEXT.far); assert.equal(countItem(pl, "planks"), 8);
  besideChest(w);
  getArea(w, CHEST.area).removeProp(CHEST.prop);
  assert.equal(moveStorageSlot(w, pl, CHEST.prop, "store", ui.cursor, 5).result, "gone");
  sh.press("w");
  assert.ok(sh.host.screens.is("play")); assert.equal(last(sh.notes), STORE_TEXT.gone);
});

test("moves are saved: items in the chest survive a save and load, and replaying the keys gives identical worlds", () => {
  const run = () => {
    const { w, sh, ui } = open();
    ui.cursors.pack = slotOf(w, "planks"); sh.press("e");
    ui.pane = "pack"; ui.cursors.pack = slotOf(w, "crown"); sh.press("q");
    return w;
  };
  const a = run(), b = run();
  assert.deepEqual(serialize(a), serialize(b), "deterministic");
  const loaded = roundTrip(a);
  assert.equal(chestCount(loaded, "planks"), 8); assert.equal(chestCount(loaded, "crown"), 1);
  assert.deepEqual(chestProp(loaded).inventory, chestProp(a).inventory);
  assert.deepEqual(serialize(loaded), serialize(a));
  // and the reloaded chest gives them back
  besideChest(loaded);
  assert.equal(moveStorageSlot(loaded, player(loaded), CHEST.prop, "take", chestProp(loaded).inventory!.findIndex((s) => s?.item === "planks"), 99).moved, 8);
  assert.equal(countItem(player(loaded), "planks"), 8);
});

test("the screen draws only font glyphs, inside its panel, with no text over text: every item, both panes, every pack tier", () => {
  const { w, pl, sh, ui } = open();
  assertTextFits("storage (fresh)", sh.draw());
  sh.save(".test-out/shots/storage-fresh.png");
  // every item in the description panel, from either pane
  for (const id of Object.keys(ITEMS) as ItemId[]) {
    const n = Math.min(maxStack(id), 12);
    pl.inventory[0] = { item: id, n }; setChest(w, [{ item: id, n }, ...Array(31).fill(null)]);
    for (const pane of ["pack", "chest"] as const) { ui.pane = pane; ui.cursors[pane] = 0; assertTextFits(`storage ${id} ${pane}`, sh.draw()); }
  }
  // tiers, full and empty, with the cursor in the far corners
  pl.gear.back = "basket"; frame(w);
  pl.inventory = Array.from({ length: 48 }, (_, i) => ({ item: (["wood", "stone", "planks", "cut_stone"] as ItemId[])[i % 4], n: 1 + (i % 19) }));
  setChest(w, Array.from({ length: 32 }, (_, i) => ({ item: "stone" as ItemId, n: 1 + (i % 19) })));
  ui.pane = "pack"; ui.cursors.pack = 47; assertTextFits("storage 48 full", sh.draw());
  sh.save(".test-out/shots/storage-full.png");
  ui.pane = "chest"; ui.cursors.chest = 31; assertTextFits("storage chest full", sh.draw());
  delete pl.gear.back; pl.upgrades.push("golem.arm"); frame(w);
  assert.equal(capacity(w, pl), 16);
  ui.pane = "pack"; ui.cursors.pack = 15; assertTextFits("storage 16", sh.draw());
  for (const text of Object.values(STORE_TEXT)) assert.ok([...text].every((c) => FONT_GLYPHS.has(c)) && text.length <= 78, text);
  for (const id of Object.keys(ITEMS) as ItemId[]) assert.ok(ITEM_NAMES[id].length <= 24);
});
