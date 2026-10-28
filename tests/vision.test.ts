// Vision mode: the analysis state the overlay reads from the sim, and the host
// overlay's cues (switch on/off, the live lock-in when a scan completes). The
// host runs on the fake canvas: update() only, no render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { player, currentArea } from "../src/game/world/world";
import { visionTargets, analysisState } from "../src/game/sim/analysis";
import { analysisFlag, VISION_CATEGORIES } from "../src/game/content/vision";
import { T } from "../src/game/content/tiles";
import { newWorld } from "./helpers";
import { beginTask } from "../src/game/sim/tasks";
import type { VisionCue } from "../src/game/view/vision";

test("vision targets carry analysis state: pending until every plan is read, absent when there is nothing to read", () => {
  const w = newWorld(), area = currentArea(w);
  const brazier = visionTargets(w, area).find((t) => t.id === "brazier@33,23")!;
  assert.equal(brazier.category, "buildable");
  assert.equal(brazier.analysis, "pending");
  for (const t of visionTargets(w, area)) if (t.source !== "prop") assert.equal(t.analysis, undefined, `${t.id} has nothing to analyze`);
  // one plan covers every brazier: reading it flips them all at once
  w.flags.add(analysisFlag("brazier"));
  for (const t of visionTargets(w, area).filter((t) => t.id.startsWith("brazier@"))) assert.equal(t.analysis, "done");
  assert.equal(analysisState(w, area.prop("brazier@33,23")!), "done");
});

test("the four category colours are unchanged, and each category has its own hologram effect", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(VISION_CATEGORIES).map(([k, v]) => [k, v.color])),
    { important: "#ffd27a", interactable: "#74dce2", npc: "#c5a0ff", buildable: "#97d38a" });
  assert.equal(new Set(Object.values(VISION_CATEGORIES).map((v) => v.effect)).size, 4);
});

test("interactive tile targets are cached but follow tile changes", () => {
  const w = newWorld(), area = currentArea(w);
  const tiles = () => visionTargets(w, area).filter((t) => t.source === "tile").map((t) => t.id);
  const before = tiles();
  assert.ok(before.length > 0);
  const [tx, ty] = before[0].slice(5).split(",").map(Number);
  area.setTile(tx, ty, T.FLOOR);
  assert.ok(!tiles().includes(before[0]), "a broken wall leaves the projection");
});

function hostAt(x: number, y: number, facing: "down" | "up") {
  const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
  const g = new Game(canvas(), canvas());
  const w = newWorld();
  g.resume(w);
  const pl = player(w); pl.x = x; pl.y = y; pl.facing = facing;
  const cues: VisionCue["t"][] = [];
  const host = g as unknown as { onVisionCue(c: VisionCue): void };
  const orig = host.onVisionCue.bind(g);
  host.onVisionCue = (c) => { cues.push(c.t); orig(c); };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) g.update(1 / 60); };
  const press = (k: string) => { g.keyDown(k); tick(); g.keyUp(k); };
  tick(5);
  return { g, w, pl, cues, tick, press };
}

test("host vision overlay: Z switches it on and off with a cue each way, and the sweep pings what is in sight", () => {
  const { g, cues, tick, press } = hostAt(576, 352, "down");
  press("z");
  assert.equal(g.vision.on, true);
  tick(30);
  assert.equal(g.vision.k, 1);
  assert.ok(cues.includes("on") && cues.includes("ping"));
  assert.ok(g.vision.tracks.has("brazier@33,23"), "a brazier within sight is tracked");
  assert.ok(!g.vision.tracks.has("brazier@33,39"), "one far out of sight is not");
  assert.equal(g.vision.counts.pending > 0, true);
  press("z");
  tick(20);
  assert.ok(cues.includes("off"));
  assert.equal(g.vision.k, 0);
  assert.equal(g.vision.tracks.size, 0);
});

test("host vision overlay: finishing a scan locks the target in live, from pending to done", () => {
  const { g, w, pl, cues, tick, press } = hostAt(536, 366, "down");
  press("z"); tick(30);
  assert.equal(g.vision.tracks.get("brazier@33,23")!.state, "pending");
  const pendingBefore = g.vision.counts.pending;
  press("e");
  assert.equal(pl.task?.kind, "scan");
  tick(60);
  assert.ok(w.flags.has(analysisFlag("brazier")));
  assert.equal(g.vision.tracks.get("brazier@33,23")!.state, "done");
  assert.ok(cues.includes("lock"));
  assert.ok(g.vision.counts.pending < pendingBefore, "the readout counts one fewer plan to read");
});

test("vision targets carry a kind, so copies of one thing share it", () => {
  const w = newWorld(), area = currentArea(w);
  const ts = visionTargets(w, area).filter((t) => t.source === "prop");
  const braziers = ts.filter((t) => t.id.startsWith("brazier@"));
  assert.ok(braziers.length > 1);
  assert.equal(new Set(braziers.map((t) => t.kind)).size, 1);
});

test("the readout counts kinds of thing, not copies", () => {
  const { g, w } = hostAt(536, 366, "down");
  g.keyDown("z"); g.update(1 / 60); g.keyUp("z");
  for (let i = 0; i < 40; i++) g.update(1 / 60);
  const seen = [...g.vision.tracks.values()].filter((t) => t.seen > 0.5).map((t) => t.target);
  const kinds = (st: string) => new Set(seen.filter((t) => t.analysis === st).map((t) => t.kind)).size;
  assert.equal(g.vision.counts.pending, kinds("pending"));
  assert.equal(g.vision.counts.done, kinds("done"));
  assert.ok(seen.filter((t) => t.analysis === "pending").length >= g.vision.counts.pending);
  void w;
});

test("vision turns itself off when a rune jump or a conversation begins", () => {
  const w = newWorld(), pl = player(w);
  pl.mode = "scan";
  beginTask(pl, { kind: "talk", dur: 0.3, effect: { op: "talk" } });
  assert.equal(pl.mode, "normal");
  pl.mode = "scan"; pl.task = null;
  beginTask(pl, { kind: "channel", dur: 2.2, effect: { op: "travel" } });
  assert.equal(pl.mode, "normal");
  pl.mode = "scan"; pl.task = null;
  beginTask(pl, { kind: "scan", dur: 0.9, effect: { op: "analyze" } });
  assert.equal(pl.mode, "scan", "scanning itself keeps vision on");
});
