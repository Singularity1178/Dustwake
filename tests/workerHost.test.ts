// The real host (Game, on the fake canvas, driven by key presses) with the
// storage and management screens: E opens the right screen from the play
// screen, the keys do what the screens say, the core swap hands the golem its
// reach and brings the screen back, and a worker's events (or a player event
// from the wrong screen) can never open or replace the player's screens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { type SimEvent } from "../src/game/world/world";
import { gatherOrder, setWorkerOrder } from "../src/game/sim/jobs";
import { removePowerCore } from "../src/game/sim/power";
import { powered } from "../src/game/sim/actorStats";
import { countItem } from "../src/game/sim/inventoryOps";
import { VISION_OFF_OPS } from "../src/game/content/vision";
import { fixture, beside, besideChest, chestCount, CHEST, worker } from "./support/workerFixture";

const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const tick = (g: Game, n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) g.update(dt); };
const press = (g: Game, key: string) => { g.keyDown(key); tick(g); g.keyUp(key); };
function host() {
  const f = fixture(), g = new Game(canvas(), canvas());
  g.resume(f.w);
  return { ...f, g };
}

test("E on the chest opens the storage screen, E on the worker the management screen; each closes with Esc", () => {
  const { g, w, pl, worker: wk } = host();
  besideChest(w); tick(g); press(g, "e"); tick(g, 30);
  assert.ok(g.screens.is("storage"), "the chest");
  press(g, "escape"); assert.ok(g.screens.is("play"));
  tick(g, 30); // the golem's reach finishes under the play screen
  beside(w, wk); tick(g); press(g, "e"); tick(g, 30);
  assert.ok(g.screens.is("manage"), "the worker");
  press(g, "tab"); assert.ok(g.screens.is("play"));
  tick(g, 30); assert.equal(pl.task, null);
  assert.ok(VISION_OFF_OPS.includes("manageActor") && VISION_OFF_OPS.includes("useStorage"), "both still turn the scan off");
});

test("storage through the keys: the cursor, E and Q, crossing panes, the host's note, and the saved result", () => {
  const { g, w, pl } = host();
  besideChest(w); tick(g); press(g, "e"); tick(g, 30);
  press(g, "e"); assert.equal(g.note?.text, "TOO IMPORTANT TO STORE", "the chisel stays");
  press(g, "d"); press(g, "d"); press(g, "e");
  assert.equal(chestCount(w, "planks"), 8); assert.equal(g.note?.text, "STORED 8 PLANKS");
  press(g, "d"); press(g, "d"); assert.equal(g.storageUi.pane, "chest");
  press(g, "q"); assert.equal(countItem(pl, "planks"), 1); assert.equal(g.note?.text, "TOOK 1 PLANKS");
  press(g, "i"); assert.ok(g.screens.is("play"));
  g.render(); // draws the world, nothing throws
  tick(g, 30); press(g, "i"); assert.ok(g.screens.is("inv"), "the pack still opens normally");
  press(g, "escape");
});

test("management through the keys: a gather order from the form, then the worker gets on with it under the play screen", () => {
  const { g, w, worker: wk } = host();
  beside(w, wk); tick(g); press(g, "e"); tick(g, 30);
  assert.ok(g.screens.is("manage"));
  for (const k of ["s", "e", "s", "s", "s", "d", "s", "e"]) press(g, k); // GATHER, to AMOUNT (6), ISSUE
  assert.equal(g.note?.text, "ORDER GIVEN");
  assert.deepEqual(wk.job && [wk.job.kind, wk.job.args.resource, wk.job.args.amount], ["gatherDeposit", "wood", 6]);
  const twin = fixture();
  assert.ok(setWorkerOrder(twin.w, twin.pl, twin.worker.id, gatherOrder("wood", "debug_yard", { ...CHEST }, 6)));
  assert.deepEqual(wk.job, twin.worker.job, "the order the builder makes");
  press(g, "escape"); assert.ok(g.screens.is("play"));
  for (let i = 0; i < 6000 && wk.job?.status !== "done"; i++) g.update(0.05);
  assert.equal(wk.job?.status, "done"); assert.equal(chestCount(w, "wood"), 6);
  assert.ok(g.screens.is("play"), "the worker working never opened or closed a screen");
});

test("the core row hands the golem its reach, the world runs, and the screen comes back with the worker powered", () => {
  const { g, w, pl, worker: wk } = host();
  removePowerCore(w, pl, wk); w.events = [];
  beside(w, wk); tick(g); press(g, "e"); tick(g, 30);
  assert.ok(g.screens.is("manage") && !powered(wk));
  press(g, "e"); // SLOT IN RUBY GOLEM CORE
  assert.ok(g.screens.is("play") && g.manageUi.pending, "the screen steps aside while the golem works");
  tick(g, 30); assert.ok(g.screens.is("play"), "still reaching");
  tick(g, 60);
  assert.ok(powered(wk)); assert.equal(g.note?.text, "RUBY GOLEM CORE SLOTTED - IT POWERS ON");
  assert.ok(g.screens.is("manage") && !g.manageUi.pending, "and back");
  press(g, "e"); tick(g, 90); // TAKE OUT
  assert.ok(!powered(wk)); assert.equal(countItem(pl, "ruby_core"), 1); assert.ok(g.screens.is("manage"));
  // the same through C inside the screen
  press(g, "c"); tick(g, 90);
  assert.ok(powered(wk) && g.screens.is("manage"));
  press(g, "escape"); assert.ok(g.screens.is("play"));
});

test("a worker's events cannot open, replace or close the player's screens; neither can the player's from the wrong screen", () => {
  const { g, w, pl, worker: wk } = host();
  const forged = (actor: string): SimEvent[] => [
    { t: "openStorage", actor, prop: CHEST.prop }, { t: "manageActor", actor, target: wk.id },
    { t: "jobChanged", actor, status: "blocked", reason: "storageFull" },
    { t: "coreSlotted", actor, target: wk.id, item: "ruby_core", inserted: false, powered: false },
    { t: "message", text: "FORGED", actor }, { t: "itemGained", actor, item: "wood", n: 1, stored: true },
  ];
  w.events.push(...forged(wk.id)); tick(g, 2);
  assert.ok(g.screens.is("play"), "play stays play");
  assert.notEqual(g.note?.text, "FORGED");
  // the player's own event, but from a screen that is not play
  press(g, "i"); assert.ok(g.screens.is("inv"));
  w.events.push(...forged(pl.id).slice(0, 2)); tick(g, 2);
  assert.ok(g.screens.is("inv"), "the pack is not replaced");
  press(g, "escape");
  // and with the storage screen open, a worker's events leave it alone
  besideChest(w); tick(g); press(g, "e"); tick(g, 30); assert.ok(g.screens.is("storage"));
  w.events.push(...forged(wk.id)); tick(g, 2);
  assert.ok(g.screens.is("storage") && g.storageUi.propId === CHEST.prop);
  press(g, "escape");
  // while the worker is mid-order in another area, the player's screens are theirs alone
  beside(w, wk); tick(g); press(g, "e"); tick(g, 30); assert.ok(g.screens.is("manage"));
  w.events.push({ t: "openStorage", actor: wk.id, prop: CHEST.prop }); tick(g, 2);
  assert.ok(g.screens.is("manage"));
  press(g, "escape");
  assert.equal(worker(w), wk);
});
