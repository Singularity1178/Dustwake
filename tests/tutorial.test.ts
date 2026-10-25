// The tutorial, played headlessly end to end through the sim API. This is the
// regression net for the tutorial's mechanics: requirements, item flow, world
// changes, the puzzle and the teleport.
import { hasItem, addItems } from "../src/game/sim/inventory";
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, hasFlag, setFlag } from "../src/game/world/world";
import { T, TS } from "../src/game/content/tiles";
import { FLAGS } from "../src/game/content/flags";
import { interactables, findTarget } from "../src/game/sim/interact";
import { placeGlyph } from "../src/game/sim/ritual";
import { events, find, frame, frames, newWorld, propItem, standAt, useOn, guardianIt, talkThrough } from "./helpers";
import { countItem } from "../src/game/sim/inventory";

test("start state matches the authored dungeon", () => {
  const w = newWorld();
  const a = currentArea(w), pl = player(w);
  assert.equal(a.id, "dungeon");
  assert.equal(a.w, 72); assert.equal(a.h, 56);
  assert.deepEqual([pl.x, pl.y], [9 * TS + 8, 38 * TS + 14]);
  assert.equal(a.tile(51, 5), T.LOCKED);
  assert.equal(a.tile(47, 10), T.CRACKED);
  const kinds = interactables(a).map((i) => i.kind);
  assert.equal(kinds.filter((k) => k === "door").length, 1);
  assert.equal(kinds.filter((k) => k === "cracked").length, 1, "two-tile crack anchors once");
  assert.equal(kinds.filter((k) => k === "socket").length, 4);
  const door = find(w, (i) => i.kind === "door");
  assert.deepEqual([door.x, door.y, door.r], [51 * TS - 2, 5 * TS + 10, 18]);
  const crack = find(w, (i) => i.kind === "cracked");
  assert.deepEqual([crack.x, crack.y, crack.r], [47 * TS + 8, 11 * TS, 22]);
});

test("the solution is a seeded permutation", () => {
  const s = (seed: number) => currentArea(newWorld(seed)).ritual!.solution;
  assert.deepEqual(s(7), s(7));
  assert.deepEqual([...s(7)].sort(), [0, 1, 2, 3]);
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) seen.add(s(i).join());
  assert.ok(seen.size > 5, "different sessions get different solutions");
});

test("walking moves the golem, limps, and collides with walls", () => {
  const w = newWorld();
  const pl = player(w);
  const x0 = pl.x;
  frames(w, 60, { ix: 1, iy: 0, use: false });
  assert.ok(pl.x > x0 + 10, "moved right");
  assert.equal(pl.facing, "right");
  assert.ok(events(w).some((e) => e.t === "step"));
  frames(w, 600, { ix: -1, iy: 0, use: false });
  assert.ok(pl.x > 4 * TS && pl.x < 6 * TS, "stopped at the artificery's west wall");
});

test("full tutorial playthrough", () => {
  const w = newWorld(99);
  const pl = player(w), area = currentArea(w), r = area.ritual!;

  // Without the arm the cracked wall only shudders.
  useOn(w, find(w, (i) => i.kind === "cracked"));
  assert.ok(events(w).some((e) => e.t === "cue" && e.cue === "push"));
  assert.equal(area.tile(47, 10), T.CRACKED);

  // Arm: taken from the rack and attached, not stored.
  useOn(w, propItem(w, "limbrack@65.5,3"));
  assert.ok(hasFlag(w, FLAGS.golemArm));
  assert.ok(!hasItem(pl, "arm"));
  let ev = events(w);
  assert.ok(ev.some((e) => e.t === "itemGained" && e.item === "arm" && !e.stored));
  assert.ok(ev.some((e) => e.t === "equipped"));

  // Now the wall breaks: both tiles open, debris decals appear, interactable disappears.
  const decals0 = area.decals.length, rev0 = area.revision;
  useOn(w, find(w, (i) => i.kind === "cracked"));
  assert.equal(area.tile(47, 10), T.FLOOR);
  assert.equal(area.tile(47, 11), T.FLOOR);
  assert.equal(area.decals.length, decals0 + 26);
  assert.ok(area.revision > rev0);
  assert.ok(!interactables(area).some((i) => i.kind === "cracked"));

  // Door needs the key; the key is in a skeleton (container -> delayed grant).
  useOn(w, find(w, (i) => i.kind === "door"));
  assert.ok(events(w).some((e) => e.t === "cue" && e.cue === "clank"));
  useOn(w, propItem(w, "skeleton@66,32"));
  assert.ok(hasItem(pl, "key"));
  useOn(w, find(w, (i) => i.kind === "door"));
  assert.equal(area.tile(51, 5), T.FLOOR);
  assert.ok(!hasItem(pl, "key"), "key consumed");
  assert.equal(area.decals[area.decals.length - 1].kind, "door_open");

  // The treasury was looted long ago: its chest is open and empty. The core
  // comes from the Treasury Guardian, who wakes, mends the eye and hands it over.
  assert.ok(!interactables(area).some((i) => i.propId === "chest@57,4"));
  assert.deepEqual(talkThrough(w, guardianIt(w)), ["intro", "repair", "core", "farewell"]);
  assert.ok(hasFlag(w, FLAGS.golemEye));
  assert.equal(countItem(pl, "core"), 1);

  // Collect everything else.
  useOn(w, propItem(w, "workbench@13.5,37"));
  useOn(w, propItem(w, "maptable@39.5,5"));
  useOn(w, propItem(w, "hearth@60.5,43"));
  useOn(w, propItem(w, "lectern@5,29"));
  useOn(w, propItem(w, "footlocker@63,21"));
  useOn(w, propItem(w, "altar@26,48"));
  useOn(w, find(w, (i) => i.looseId === "crown"));
  useOn(w, find(w, (i) => i.looseId === "coin"));
  useOn(w, propItem(w, "longtable@59.5,47"));
  for (const id of ["core", "chisel", "schematic", "glyph0", "glyph1", "glyph2", "glyph3", "crown", "coin", "goblet"] as const)
    assert.ok(hasItem(pl, id), id);

  // Carving needs the schematic to have been read (the UI sets this flag on opening it).
  useOn(w, find(w, (i) => i.kind === "gap"));
  assert.equal(r.carved, false);
  setFlag(w, FLAGS.knowSchematic);
  useOn(w, find(w, (i) => i.kind === "gap"));
  assert.equal(r.carved, true);
  useOn(w, find(w, (i) => i.kind === "center"));
  assert.equal(r.core, true);
  assert.ok(!hasItem(pl, "core"));

  // Seat glyphs in a wrong order -> fizzle and mark wrong sockets.
  const wrong = [r.solution[1], r.solution[0], r.solution[2], r.solution[3]];
  events(w);
  wrong.forEach((g, s) => { placeGlyph(w, pl, area, s, g); while (pl.task) frame(w); });
  assert.equal(r.active, false);
  assert.ok(events(w).some((e) => e.t === "runeFizzled"));
  assert.deepEqual(r.wrong, [true, true, false, false]);

  // Take the two wrong glyphs back (via the socket interaction) and seat them correctly.
  for (const s of [0, 1]) useOn(w, find(w, (i) => i.kind === "socket" && i.socket === s));
  for (const s of [0, 1]) { placeGlyph(w, pl, area, s, r.solution[s]); while (pl.task) frame(w); }
  assert.equal(r.active, true);
  assert.ok(events(w).some((e) => e.t === "runeActivated"));

  // Teleport only after the circle has charged for 3s and the golem stands on it.
  const c = area.ritualPos;
  pl.x = c.x; pl.y = c.y + 2;
  frame(w);
  assert.ok(!events(w).some((e) => e.t === "teleport"), "not yet charged");
  frames(w, 200);
  assert.ok(events(w).some((e) => e.t === "teleport"));
  assert.ok(w.playTime > 0);
});

test("an empty socket with glyphs in the pack asks the UI for a choice", () => {
  const w = newWorld();
  const pl = player(w);
  addItems(w, pl, "glyph2", 1);
  const sock = find(w, (i) => i.kind === "socket" && i.socket === 3);
  standAt(w, sock);
  assert.equal(findTarget(currentArea(w), pl)?.socket, 3);
  const res = frame(w, { ix: 0, iy: 0, use: true });
  assert.deepEqual(res.ui, { ui: "selectGlyph", socket: 3 });
  assert.equal(pl.task, null);
});
