// The Ctrl+0 debug menu: the pure sim functions it calls (summon, delete, flags,
// places, teleport, kits, noclip), the screen's keys on a headless host, a text
// lint of every tab, and the real Game opening and closing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { DebugUi, DEBUG_PANEL, DEBUG_TABS } from "../src/game/screens/debug";
import { ITEM_IDS, ITEMS, maxStack } from "../src/game/content/items";
import { FLAGS, NPC_AWAKE, npcFlag } from "../src/game/content/flags";
import { RUNE_NODES } from "../src/game/content/runes";
import { TS, isSolidT } from "../src/game/content/tiles";
import { currentArea, getArea, player, setFlag, clearFlag, hasFlag } from "../src/game/world/world";
import { countItem } from "../src/game/sim/inventory";
import { wears } from "../src/game/sim/gear";
import { boxFree, actorBoxes } from "../src/game/sim/collision";
import { stepPlayer } from "../src/game/sim/step";
import {
  clearPack, debugFlags, debugPlaces, deleteItem, fillMaterials, flagOn, grantBuildKit, grantStoryKit, setAllSlots,
  summonItem, summonLoose, teleportTo, allSlotsUnlocked,
} from "../src/game/sim/debug";
import { DT, newWorld } from "./helpers";
import { screenHost, assertTextFits } from "./support/screenHost";

const looseCount = (w: ReturnType<typeof newWorld>, id: string) => currentArea(w).loose.filter((l) => !l.taken && l.item === id).reduce((n, l) => n + (l.n ?? 1), 0);

// ---------------------------------------------------------------- sim
test("every item can be summoned (the arm installs, the rest land in the pack)", () => {
  for (const id of ITEM_IDS) {
    const w = newWorld(), pl = player(w), eq = ITEMS[id].equip;
    const r = summonItem(w, pl, id, 1);
    assert.ok(r.ok, id);
    if (eq) assert.ok(hasFlag(w, eq.flag), `${id} installs`);
    else assert.equal(countItem(pl, id), 1, id);
  }
});

test("a summon too big for the pack spills onto the ground and nothing is lost", () => {
  const w = newWorld(), pl = player(w);
  const r = summonItem(w, pl, "wood", 200);
  assert.ok(r.ok);
  assert.equal(countItem(pl, "wood") + looseCount(w, "wood"), 200);
  assert.ok(looseCount(w, "wood") > 0, "the 8-slot pack (stacks of 20) cannot hold 200");
});

test("summonLoose puts stacks on the ground in front (split at the stack size); the arm cannot lie there", () => {
  const w = newWorld(), pl = player(w);
  const before = looseCount(w, "stone");
  assert.ok(summonLoose(w, pl, "stone", 35).ok);
  assert.equal(looseCount(w, "stone") - before, 35);
  assert.ok(currentArea(w).loose.filter((l) => l.dyn && l.item === "stone").every((l) => (l.n ?? 1) <= maxStack("stone")));
  assert.equal(countItem(pl, "stone"), 0, "the pack is untouched");
  assert.ok(!summonLoose(w, pl, "arm", 1).ok);
});

test("deleteItem, clearPack and fillMaterials", () => {
  const w = newWorld(), pl = player(w);
  summonItem(w, pl, "wood", 12); summonItem(w, pl, "coin", 1);
  assert.equal(deleteItem(pl, "wood", 5), 5);
  assert.equal(countItem(pl, "wood"), 7);
  assert.equal(deleteItem(pl, "wood", 50), 7, "never more than held");
  summonItem(w, pl, "key", 1);
  assert.equal(clearPack(pl), 2);
  assert.ok(pl.inventory.every((s) => !s));
  grantBuildKit(w, pl);
  fillMaterials(w, pl, 40);
  for (const id of ITEM_IDS) if (ITEMS[id].tags.includes("material")) assert.ok(countItem(pl, id) >= 40, id);
});

test("kits: the story kit gives each piece once, the build kit teaches building and wears the basket, slots toggle", () => {
  const w = newWorld(), pl = player(w);
  const first = grantStoryKit(w, pl);
  assert.ok(first >= 7, "four glyphs, core, chisel, schematic");
  assert.equal(grantStoryKit(w, pl), 0, "nothing given twice");
  grantBuildKit(w, pl);
  assert.ok(hasFlag(w, FLAGS.knowBuild) && hasFlag(w, FLAGS.knowMasonry));
  assert.ok(wears(pl, "basket"));
  assert.ok(!allSlotsUnlocked(w, pl));
  setAllSlots(w, pl, true); assert.ok(allSlotsUnlocked(w, pl));
  setAllSlots(w, pl, false); assert.ok(!allSlotsUnlocked(w, pl));
});

test("the flag list covers the FLAGS table, rune sites, plans and NPC states, once each, and toggling round-trips", () => {
  const w = newWorld();
  const list = debugFlags(w), names = list.map((f) => f.flag);
  assert.equal(new Set(names).size, names.length, "no duplicates");
  for (const f of Object.values(FLAGS)) assert.ok(names.includes(f), f);
  for (const n of Object.values(RUNE_NODES)) assert.ok(names.includes(n.flag), n.flag);
  assert.ok(names.includes(npcFlag("npc.guardian", NPC_AWAKE)), "the guardian's awake state");
  assert.ok(list.some((f) => f.group === "PLANS"), "analysis plans");
  const f = FLAGS.knowRepair;
  assert.ok(!flagOn(w, f)); setFlag(w, f); assert.ok(flagOn(w, f)); clearFlag(w, f); assert.ok(!flagOn(w, f));
  const arm = FLAGS.golemArm; setFlag(w, arm); assert.ok(flagOn(w, arm), "body flags read from the actor");
  for (const x of list) assert.ok(/^[A-Z0-9 .,:\-/'()+=?!<>#^*]*$/.test(x.label), `label font check: ${x.label}`);
});

test("places: reading them changes nothing; every one is reachable by teleport and lands on free ground", () => {
  const w = newWorld(), pl = player(w);
  const areasBefore = w.areas.size;
  const places = debugPlaces(w);
  assert.equal(w.areas.size, areasBefore, "listing instantiates nothing");
  assert.ok(places.some((p) => p.area === "dungeon" && p.label.includes("THRONE HALL")));
  assert.ok(places.some((p) => p.area === "surface"), "an unvisited area offers its start");
  assert.ok(places.some((p) => p.label.includes("GUARDIAN")), "NPCs are listed");
  for (const p of places.filter((q) => q.area === "dungeon")) {
    assert.ok(teleportTo(w, pl, p.area, p.x, p.y), p.label);
    const area = currentArea(w);
    assert.ok(boxFree(area, pl.x, pl.y, actorBoxes(w, area.id, pl.id)), `${p.label}: on free ground`);
  }
});

test("teleport crosses into an unvisited area and the player arrives there", () => {
  const w = newWorld(), pl = player(w);
  assert.ok(!w.areas.has("surface"));
  const s = debugPlaces(w).find((p) => p.area === "surface")!;
  assert.ok(teleportTo(w, pl, s.area, s.x, s.y));
  assert.equal(pl.area, "surface"); assert.ok(w.areas.has("surface"));
  assert.ok(boxFree(getArea(w, "surface"), pl.x, pl.y, actorBoxes(w, "surface", pl.id)));
  assert.ok(!teleportTo(w, pl, "nowhere", 0, 0), "an unknown area is refused");
});

test("noclip walks through a wall that blocks a normal walk", () => {
  const find = () => {
    const a = currentArea(newWorld());
    for (let ty = 3; ty < a.h - 3; ty++) for (let tx = 3; tx < a.w - 4; tx++) {
      if (!isSolidT(a.tile(tx, ty)) && isSolidT(a.tile(tx + 1, ty)) && !isSolidT(a.tile(tx + 3, ty)) && !isSolidT(a.tile(tx, ty - 1)) && !isSolidT(a.tile(tx, ty + 1))) return { tx, ty };
    }
    throw new Error("no wall");
  };
  const { tx, ty } = find();
  const run = (noclip: boolean) => {
    const w = newWorld(), pl = player(w);
    pl.x = tx * TS + 8; pl.y = ty * TS + 12;
    for (let i = 0; i < 120; i++) stepPlayer(w, DT, { ix: 1, iy: 0, use: false, speed: 3, noclip });
    return pl.x;
  };
  assert.ok(run(false) < (tx + 1) * TS, "blocked by the wall");
  assert.ok(run(true) > (tx + 1) * TS + 4, "walked through it");
});

// ---------------------------------------------------------------- screen
function menu() {
  const w = newWorld(), sh = screenHost(w), pl = player(w);
  const st = { speed: false, mult: 3, noclip: false, hud: false, zoom: 1, tele: [] as string[], saved: 0 };
  Object.defineProperties(sh.host, {
    debugSpeed: { get: () => st.speed, set: (v: boolean) => { st.speed = v; } },
    debugSpeedMult: { get: () => st.mult, set: (v: number) => { st.mult = v; } },
    debugNoclip: { get: () => st.noclip, set: (v: boolean) => { st.noclip = v; } },
    debugHud: { get: () => st.hud, set: (v: boolean) => { st.hud = v; } },
    zoom: { get: () => st.zoom },
    hasArm: { get: () => hasFlag(w, FLAGS.golemArm) },
  });
  Object.assign(sh.host, {
    has: () => false,
    debugSetFlag: (f: string, on: boolean) => { if (on) setFlag(w, f); else clearFlag(w, f); },
    debugTeleport: (p: { label: string; area: string; x: number; y: number }) => { st.tele.push(p.label); return teleportTo(w, pl, p.area, p.x, p.y); },
    debugNewGame() {}, debugFoundations() {}, debugZoom: () => { st.zoom = 1.5; },
    saveGame: () => { st.saved++; }, loadGame: () => false,
  });
  const ui = new DebugUi(sh.host);
  ui.toggle();
  return { w, pl, sh, ui, st };
}
const type = (sh: ReturnType<typeof menu>["sh"], ...chars: string[]) => { sh.host.typed = chars; sh.press(); sh.host.typed = []; };

test("opens on the play screen only, and the toggle closes it", () => {
  const { sh, ui } = menu();
  assert.ok(sh.host.screens.is("debug"));
  ui.toggle(); assert.ok(sh.host.screens.is("play"));
  ui.toggle(); sh.press("escape"); assert.ok(sh.host.screens.is("play"), "Esc closes");
  ui.toggle(); assert.ok(sh.host.screens.is("debug")); sh.press("tab"); assert.ok(sh.host.screens.is("play"), "Tab closes");
});

test("ITEMS: quantity with A / D (Shift x10), E gives, G drops on the ground, X deletes, F wears", () => {
  const { w, pl, sh, ui } = menu();
  assert.ok(ui.select("item", "wood"));
  for (let i = 0; i < 4; i++) sh.press("d");
  assert.equal(ui.qty, 5);
  sh.press("a"); assert.equal(ui.qty, 4);
  sh.press("m"); assert.equal(ui.qty, maxStack("wood"));
  sh.press("e"); assert.equal(countItem(pl, "wood"), maxStack("wood"));
  sh.press("x"); assert.equal(countItem(pl, "wood"), 0);
  sh.press("g"); assert.equal(looseCount(w, "wood"), maxStack("wood"));
});

test("ITEMS: F wears the basket and a rune once their slots can take them", () => {
  const { pl, sh, ui } = menu();
  assert.ok(ui.select("item", "basket")); sh.press("f");
  assert.ok(wears(pl, "basket"));
  assert.ok(ui.select("item", "coin")); sh.press("f");
  assert.match(ui.status!.text, /NOT WEARABLE/);
});

test("ITEMS: search filters by name and tag; Esc clears the search before it closes the menu", () => {
  const { sh, ui } = menu();
  const all = ui.rows.length;
  assert.equal(all, ITEM_IDS.length);
  sh.press("/"); assert.ok(ui.search.active);
  type(sh, "R", "u", "n", "e");
  assert.ok(ui.rows.length > 0 && ui.rows.length < all);
  assert.ok(ui.rows.every((r) => /RUNE/.test(`${r.label} ${ITEMS[r.item!].tags.join(" ").toUpperCase()}`)));
  sh.press("enter"); assert.ok(!ui.search.active);
  sh.press("escape"); assert.equal(ui.rows.length, all); assert.ok(sh.host.screens.is("debug"));
  sh.press("escape"); assert.ok(sh.host.screens.is("play"));
});

test("typing in the search field never fires commands (W A S D E G X are letters there)", () => {
  const { pl, sh, ui } = menu();
  sh.press("/");
  type(sh, "w", "a", "s", "d", "e", "g", "x", "f");
  assert.equal(ui.search.value, "WASDEGXF");
  assert.equal(pl.inventory.filter(Boolean).length, 0);
});

test("tabs: Q / R step (wrapping), 1-5 jump", () => {
  const { sh, ui } = menu();
  sh.press("r"); assert.equal(ui.tab, 1);
  sh.press("q"); sh.press("q"); assert.equal(ui.tab, DEBUG_TABS.length - 1);
  sh.press("3"); assert.equal(ui.tab, 2);
  sh.press("1"); assert.equal(ui.tab, 0);
});

test("PLAYER: arm, eye, noclip, slots, speed cycling both ways, kits and pack tools", () => {
  const { w, pl, sh, ui, st } = menu();
  sh.press("2");
  assert.ok(ui.select("arm")); sh.press("e"); assert.ok(hasFlag(w, FLAGS.golemArm)); sh.press("e"); assert.ok(!hasFlag(w, FLAGS.golemArm));
  assert.ok(ui.select("eye")); sh.press("e"); assert.ok(hasFlag(w, FLAGS.golemEye));
  assert.ok(ui.select("noclip")); sh.press("e"); assert.ok(st.noclip); sh.press("e"); assert.ok(!st.noclip);
  assert.ok(ui.select("speed"));
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) { sh.press("d"); seen.push(st.speed ? st.mult : 1); }
  assert.deepEqual(seen, [3, 6, 12, 1]);
  sh.press("a"); assert.equal(st.mult, 12, "A steps back from off to the top");
  assert.ok(ui.select("slots")); sh.press("e"); assert.ok(allSlotsUnlocked(w, pl));
  assert.ok(ui.select("buildkit")); sh.press("e"); assert.equal(countItem(pl, "planks") > 0, true);
  assert.ok(ui.select("storykit")); sh.press("e"); assert.equal(countItem(pl, "core"), 1);
  assert.ok(ui.select("clear")); sh.press("e"); assert.ok(pl.inventory.every((s) => !s));
});

test("FLAGS: E toggles the flag under the cursor; the list can be searched", () => {
  const { w, sh, ui } = menu();
  sh.press("3");
  assert.ok(ui.select("flag", FLAGS.knowRepair));
  sh.press("e"); assert.ok(hasFlag(w, FLAGS.knowRepair));
  sh.press("e"); assert.ok(!hasFlag(w, FLAGS.knowRepair));
  sh.press("/"); type(sh, "g", "u", "a", "r", "d");
  assert.ok(ui.rows.length >= 1 && ui.rows.every((r) => r.label.includes("GUARDIAN")));
});

test("TELEPORT: E on a place moves the golem and closes the menu", () => {
  const { w, pl, sh, ui, st } = menu();
  sh.press("4");
  assert.ok(ui.select("go", "DUNGEON: GREAT HALL"));
  const before = { x: pl.x, y: pl.y };
  sh.press("e");
  assert.deepEqual(st.tele, ["DUNGEON: GREAT HALL"]);
  assert.ok(pl.x !== before.x || pl.y !== before.y);
  assert.ok(sh.host.screens.is("play"));
  const room = currentArea(w).rooms.find((r) => r.name === "GREAT HALL")!;
  assert.ok(pl.x > room.x * TS && pl.x < (room.x + room.w) * TS);
});

test("WORLD: HUD, zoom and save call through", () => {
  const { sh, ui, st } = menu();
  sh.press("5");
  assert.ok(ui.select("hud")); sh.press("e"); assert.ok(st.hud);
  assert.ok(ui.select("zoom")); sh.press("e"); assert.equal(st.zoom, 1.5);
  assert.ok(ui.select("save")); sh.press("e"); assert.equal(st.saved, 1);
  assert.ok(ui.select("unlock")); sh.press("e");
  assert.match(ui.status!.text, /UNLOCKED/);
});

test("every tab draws only font glyphs, inside the panel, with no overlapping text", () => {
  const { w, sh, ui } = menu();
  for (let t = 0; t < DEBUG_TABS.length; t++) {
    ui.setTab(t);
    assertTextFits(`debug tab ${DEBUG_TABS[t].name}`, sh.draw(), DEBUG_PANEL);
    // every row's detail on the longer lists
    const n = ui.rows.length;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 12))) {
      sh.press("s");
      assertTextFits(`debug tab ${DEBUG_TABS[t].name} row ${i}`, sh.draw(), DEBUG_PANEL);
    }
  }
  // each item's detail panel, with a long status line
  ui.setTab(0);
  for (const id of ITEM_IDS) { ui.select("item", id); assertTextFits(`item ${id}`, sh.draw(), DEBUG_PANEL); }
  ui.select("item", "wood"); sh.press("e");
  setFlag(w, FLAGS.golemArm);
  assertTextFits("with a status", sh.draw(), DEBUG_PANEL);
});

// ---------------------------------------------------------------- the real host
test("Ctrl+0 on the real Game opens the menu over the play screen, Ctrl+0 again closes it, and it works from the menu's keys", () => {
  const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
  const g = new Game(canvas(), canvas());
  const w = newWorld(); g.resume(w);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.update(1 / 60); };
  const press = (k: string) => { g.keyDown(k); tick(); g.keyUp(k); };
  tick(2);
  g.debugKey(0);
  assert.ok(g.screens.is("debug"));
  const t0 = w.time;
  tick(30);
  assert.equal(w.time, t0, "the world is paused behind the menu");
  press("e"); // ITEMS tab, first item: the rune chisel
  assert.equal(countItem(player(w), "chisel"), 1);
  press("2"); press("s"); press("s"); press("s"); // noclip row
  press("e");
  assert.equal(g.debugNoclip, true);
  press("5");
  press("e"); // HUD
  assert.equal(g.debugHud, true);
  g.debugKey(0);
  assert.ok(g.screens.is("play"));
  // Ctrl+0 does nothing off the play screen
  g.screens.set((g as unknown as { S: Record<string, never> }).S.title);
  g.debugKey(0);
  assert.ok(!g.screens.is("debug"));
});

test("Game: the debug menu's flag, teleport, zoom and new-game hooks", () => {
  const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
  const g = new Game(canvas(), canvas());
  const w = newWorld(); g.resume(w);
  g.debugSetFlag(FLAGS.golemEye, true);
  assert.ok(hasFlag(w, FLAGS.golemEye));
  g.debugSetFlag(FLAGS.golemEye, false);
  assert.ok(!hasFlag(w, FLAGS.golemEye));
  const surface = debugPlaces(w).find((p) => p.area === "surface")!;
  assert.ok(g.debugTeleport(surface));
  assert.equal(g.area.id, "surface");
  assert.equal(g.view.area, g.area, "the view follows the player at once");
  g.update(1 / 60); g.render();
  const z = g.zoom; g.debugZoom(); g.update(1); assert.notEqual(g.zoom, z);
  g.debugNewGame();
  assert.ok(g.screens.is("play"));
  assert.notEqual(g.world, w);
  g.debugFoundations();
  assert.ok(g.screens.is("play"));
  assert.equal(g.pl.area, "debug_workshop");
});
