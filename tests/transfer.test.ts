// The maintainer's doubled base speed, the worker rename (and how a name reads), and the transfer screen: giving
// and taking items, equipping a rune on the worker, and the refusals in words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actorDef } from "../src/game/content/actors";
import { ManageUi } from "../src/game/screens/manage";
import { TransferUi } from "../src/game/screens/transfer";
import { actorLabel, actorSpeed, ACTOR_NAME_MAX, cleanActorName } from "../src/game/sim/actorStats";
import { equipActor, renameActor, transferWithActor, unequipActor } from "../src/game/sim/commands";
import { addItems, countItem } from "../src/game/sim/inventory";
import { serialize, deserialize } from "../src/game/world/save";
import { createWorld, player, setFlag } from "../src/game/world/world";
import type { World } from "../src/game/world/world";
import { screenHost, assertTextFits, type ScreenHost } from "./support/screenHost";
import { beside, fixture } from "./support/workerFixture";

const roundTrip = (w: World) => deserialize(JSON.parse(JSON.stringify(serialize(w))));
const typeInto = (sh: ScreenHost, ...chars: string[]) => { sh.host.typed = chars; sh.press(); sh.host.typed = []; };

function open() {
  const f = fixture(), sh = screenHost(f.w), manage = new ManageUi(sh.host);
  const transfer = new TransferUi(sh.host, (id) => manage.open(id));
  manage.openTransfer = (id) => transfer.open(id);
  manage.open(f.worker.id);
  return { ...f, sh, manage, transfer };
}

test("the maintainer's base speed is doubled (48, 60 with the iron arm); other bodies are unchanged", () => {
  const w = createWorld(5), pl = player(w);
  assert.equal(actorDef(pl).speed, 48);
  assert.equal(actorSpeed(w, pl), 48);
  setFlag(w, "golem.arm");
  assert.equal(actorSpeed(w, pl), 60);
  assert.equal(actorDef({ definition: "worker_golem" }).speed, 16);
});

test("a name reads in front of the kind: BOB - WORKER GOLEM; empty clears it; it is saved", () => {
  const { w, pl, worker: wk } = fixture();
  assert.equal(actorLabel(wk), "WORKER GOLEM");
  assert.ok(renameActor(w, pl, wk.id, "  bob ").ok);
  assert.equal(wk.name, "BOB"); assert.equal(actorLabel(wk), "BOB - WORKER GOLEM");
  assert.equal(roundTrip(w).actors.find((a) => a.id === wk.id)!.name, "BOB");
  assert.equal(cleanActorName("a".repeat(40)).length, ACTOR_NAME_MAX);
  assert.ok(renameActor(w, pl, wk.id, "   ").ok);
  assert.equal(wk.name, undefined); assert.equal(actorLabel(wk), "WORKER GOLEM");
  pl.x += 200;
  assert.ok(!renameActor(w, pl, wk.id, "far").ok, "out of reach refuses");
  assert.equal(wk.name, undefined);
});

test("the management screen renames through its keys and shows the full name", () => {
  const { sh, manage, worker: wk } = open();
  const row = manage.menu.findIndex((r) => r.label.startsWith("RENAME"));
  assert.ok(row > 0);
  for (let i = 0; i < row; i++) sh.press("s");
  sh.press("e"); assert.ok(manage.nameField.active);
  typeInto(sh, "b", "o", "b");
  sh.press("enter");
  assert.ok(!manage.nameField.active); assert.equal(wk.name, "BOB");
  const b = sh.draw(); assertTextFits("manage renamed", b); sh.save(".test-out/shots/manage-renamed.png");
  assert.ok(b.map((x) => x.text).includes("BOB - WORKER GOLEM"));
  // R from the list, Esc cancels and keeps the old name
  sh.press("r"); assert.ok(manage.nameField.active); assert.equal(manage.nameField.value, "BOB");
  typeInto(sh, "x"); sh.press("escape");
  assert.ok(sh.host.screens.is("manage")); assert.equal(wk.name, "BOB");
});

test("transfer: give and take stacks and single items through the sim", () => {
  const { w, pl, worker: wk } = fixture();
  addItems(w, pl, "wood", 7);
  const slot = pl.inventory.findIndex((s) => s?.item === "wood");
  assert.equal(transferWithActor(w, pl, wk.id, "give", slot, Infinity).moved, 7);
  assert.equal(countItem(wk, "wood"), 7); assert.equal(countItem(pl, "wood"), 0);
  const at = wk.inventory.findIndex((s) => s?.item === "wood");
  assert.equal(transferWithActor(w, pl, wk.id, "take", at, 1).moved, 1);
  assert.equal(countItem(pl, "wood"), 1); assert.equal(countItem(wk, "wood"), 6);
  assert.equal(transferWithActor(w, pl, wk.id, "give", 7, 1).text, "NOTHING THERE TO MOVE");
  pl.x += 200;
  assert.equal(transferWithActor(w, pl, wk.id, "take", at, 1).text, "STEP UP TO THE WORKER");
  assert.equal(countItem(wk, "wood"), 6);
});

test("transfer: a full worker pack refuses and says so, changing nothing", () => {
  const { w, pl, worker: wk } = fixture();
  wk.inventory = Array.from({ length: 8 }, () => ({ item: "stone" as const, n: 20 }));
  addItems(w, pl, "wood", 3);
  const r = transferWithActor(w, pl, wk.id, "give", pl.inventory.findIndex((s) => s?.item === "wood"), Infinity);
  assert.deepEqual([r.ok, r.moved, r.text], [false, 0, "ITS PACK IS FULL"]);
  assert.equal(countItem(pl, "wood"), 3);
});

test("equip: a rune from your pack goes onto the worker, comes off into its pack, and a non-wearable is refused", () => {
  const { w, pl, worker: wk } = fixture();
  addItems(w, pl, "rune_swift", 1); addItems(w, pl, "wood", 2);
  const slot = pl.inventory.findIndex((s) => s?.item === "rune_swift");
  assert.equal(equipActor(w, pl, wk.id, "pack", pl.inventory.findIndex((s) => s?.item === "wood")).text, "IT CAN'T WEAR THAT");
  assert.equal(countItem(pl, "wood"), 2);
  assert.ok(equipActor(w, pl, wk.id, "pack", slot).ok);
  assert.equal(wk.gear.rune0, "rune_swift"); assert.equal(countItem(pl, "rune_swift"), 0); assert.equal(countItem(wk, "rune_swift"), 0);
  assert.ok(actorSpeed(w, wk) > actorDef(wk).speed, "the rune speeds the worker");
  // a second rune with the slot taken swaps: the first goes to its pack
  addItems(w, pl, "rune_glow", 1);
  assert.ok(equipActor(w, pl, wk.id, "pack", pl.inventory.findIndex((s) => s?.item === "rune_glow")).ok);
  assert.equal(wk.gear.rune0, "rune_glow"); assert.equal(countItem(wk, "rune_swift"), 1);
  assert.ok(unequipActor(w, pl, wk.id, "rune0").ok);
  assert.equal(wk.gear.rune0, undefined); assert.equal(countItem(wk, "rune_glow"), 1);
  assert.equal(unequipActor(w, pl, wk.id, "rune0").text, "NOTHING WORN THERE");
  // equipping from its own pack
  assert.ok(equipActor(w, pl, wk.id, "carry", wk.inventory.findIndex((s) => s?.item === "rune_swift")).ok);
  assert.equal(wk.gear.rune0, "rune_swift");
  assert.equal(roundTrip(w).actors.find((a) => a.id === wk.id)!.gear.rune0, "rune_swift");
});

test("the transfer screen through the keys: row on the management screen, cursor, give, equip, take off, Esc back", () => {
  const { w, pl, worker: wk, sh, manage, transfer } = open();
  addItems(w, pl, "wood", 5); addItems(w, pl, "rune_glow", 1);
  const row = manage.menu.findIndex((r) => r.label.startsWith("TRANSFER"));
  for (let i = 0; i < row; i++) sh.press("s");
  sh.press("e");
  assert.ok(sh.host.screens.is("transfer")); assert.ok(!sh.host.screens.has("manage"), "the management screen steps aside");
  assertTextFits("transfer", sh.draw()); sh.save(".test-out/shots/transfer0.png");
  assert.equal(transfer.pane, "pack");
  // slot 0 holds the first thing in the pack; find wood with the cursor
  const wood = pl.inventory.findIndex((s) => s?.item === "wood");
  for (let i = 0; i < wood; i++) sh.press("d");
  sh.press("e");
  assert.equal(countItem(wk, "wood"), 5);
  // the rune: cursor onto it, F equips
  const rune = pl.inventory.findIndex((s) => s?.item === "rune_glow");
  transfer.cursors.pack = rune; sh.press("f");
  assert.equal(wk.gear.rune0, "rune_glow");
  const b = sh.draw(); assertTextFits("transfer worn", b); sh.save(".test-out/shots/transfer.png");
  // go to the worn slot (carry pane, then down off its last row) and take it off
  transfer.pane = "carry"; transfer.cursors.carry = 4; sh.press("s");
  assert.equal(transfer.pane, "worn");
  sh.press("e"); assert.equal(wk.gear.rune0, undefined); assert.equal(countItem(wk, "rune_glow"), 1);
  sh.press("escape");
  assert.ok(sh.host.screens.is("manage"), "Esc goes back to the worker's screen");
  sh.press("escape"); assert.ok(sh.host.screens.is("play"));
  beside(w, wk);
});
