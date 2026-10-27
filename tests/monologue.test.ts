// The inner monologue (sim side) and the opening cutscene that uses it:
// line data lint, one-shot and cooldown rules, the three ways a line fires
// (event triggers, the `think` effect, the `think` command), the planned
// power lines as pure data rows, save/load and the v10 -> v11 migration, the
// Primer's note, and the intro script played through the real host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { THOUGHTS, type ThoughtLine } from "../src/game/content/monologue";
import { INTRO } from "../src/game/content/cutscenes";
import { FLAGS, learnedText } from "../src/game/content/flags";
import { FONT_GLYPHS, textWidth } from "../src/game/font";
import { BASE_W } from "../src/game/view/zoom";
import { MONO, MonologueLog } from "../src/game/ui/monologue";
import { beatsCrossed, controlAt, timeline, trackAt } from "../src/game/ui/cutscene";
import { CUTSCENE_CUES } from "../src/game/screens/intro";
import { THOUGHT_CONDITIONS, think, thoughtBlocked, reactToEvents, hasThought, playerThinks } from "../src/game/sim/monologue";
import { applyEffect } from "../src/game/sim/tasks";
import { readItem } from "../src/game/sim/commands";
import { insertPowerCore } from "../src/game/sim/power";
import { addItems } from "../src/game/sim/inventory";
import { createWorld, enterArea, getArea, makeActor, player, setFlag, actorById, type SimEvent } from "../src/game/world/world";
import { serialize, deserialize, migrate, SAVE_VERSION } from "../src/game/world/save";
import { registerFoundations } from "../src/game/sim/debugFoundations";
import { Game } from "../src/game/game";
import { events, frame, frames, newWorld, guardianIt, useOn, GUARDIAN } from "./helpers";

registerFoundations();
const thoughts = (evs: SimEvent[]) => evs.filter((e) => e.t === "thought").map((e) => (e as { line: string }).line);

/** Add a line for one test only: adding a line is a data row. */
function withLine<T>(id: string, line: ThoughtLine, fn: () => T): T {
  THOUGHTS[id] = line;
  try { return fn(); } finally { delete THOUGHTS[id]; }
}

// ------------------------------------------------------------------ data
test("every line is font-safe, fits the HUD, and names only known conditions", () => {
  for (const [id, l] of Object.entries(THOUGHTS)) {
    for (const ch of l.text) assert.ok(FONT_GLYPHS.has(ch), `${id}: "${ch}" is not in the bitmap font`);
    assert.ok(MONO.x + 6 + textWidth(l.text) + 4 <= BASE_W - 6, `${id} is too wide for the screen`);
    for (const c of l.if ?? []) assert.ok(THOUGHT_CONDITIONS[c], `${id}: unknown condition ${c}`);
    if (l.cooldown) assert.equal(l.once, false, `${id}: only recurring lines have a cooldown`);
    assert.ok(!l.pace || (l.pace > 0.2 && l.pace <= 2), `${id}: sane pace`);
  }
});

test("the opening's lines exist, read as the brief asks, and the script names only known lines and cues", () => {
  const said = timeline(INTRO).filter((b) => b.think).map((b) => THOUGHTS[b.think!]?.text);
  assert.deepEqual(said, ["ASSESSING...", "MILD DAMAGE DETECTED.", "MISSING LEFT ARM.", "PRIME DIRECTIVE: NONE."]);
  for (const b of INTRO.beats) for (const c of b.cues ?? []) assert.ok(CUTSCENE_CUES[c], `unknown cue ${c}`);
  const tl = timeline(INTRO);
  assert.equal(tl.filter((b) => b.control).length, 1, "exactly one hand-over");
  assert.ok(tl[tl.length - 1].control, "control is the last beat");
  for (let i = 1; i < tl.length; i++) assert.ok(tl[i].at > tl[i - 1].at, "beats strictly ordered");
});

test("cutscene timeline: the awakening keeps its timing, diagnostics run 2-3 s, control comes after the last line", () => {
  const at = (label: string) => timeline(INTRO).find((b) => b.label === label)!.at;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert.ok(near(at("spark"), 0.8) && near(at("boot"), 1.2) && near(at("eye lit"), 3.5) && near(at("rise"), 3.6) && near(at("foot down"), 4.2));
  const diag = at("diagnostics done") - at("assessing");
  assert.ok(diag >= 2 && diag <= 3, `diagnostics last ${diag}s`);
  assert.equal(trackAt(INTRO, "core", at("assessing") + 1).mode, "diagnose");
  assert.equal(trackAt(INTRO, "core", at("diagnostics done") + 0.01).mode, "on");
  assert.ok(near(trackAt(INTRO, "body", at("rise") + 0.7).k, 0.5), "the rise ramps over its `over`");
  assert.ok(at("assessing") >= at("rise") + 1.4, "it thinks only once it has risen");
  // the last line has finished typing (at the presentation's pace) before control
  const last = timeline(INTRO).find((b) => b.think === "intro.directive")!;
  const typed = last.at + MONO.lead + THOUGHTS[last.think!].text.length / (MONO.cps * (THOUGHTS[last.think!].pace ?? 1));
  assert.ok(controlAt(INTRO) > typed + 0.3, "a held beat after the last line");
  assert.ok(controlAt(INTRO) < 13, "not slow");
  // a frame straddling a beat fires it exactly once
  assert.deepEqual(beatsCrossed(INTRO, 0.79, 0.81).map((b) => b.label), ["spark"]);
  assert.deepEqual(beatsCrossed(INTRO, 0.81, 0.83), []);
});

// ------------------------------------------------------------------ rules
test("think: emits a thought for the player, one-shot lines never repeat, other actors don't think", () => {
  const w = newWorld(), pl = player(w);
  assert.equal(think(w, pl, "intro.damage"), true);
  assert.deepEqual(thoughts(events(w)), ["intro.damage"]);
  assert.equal(think(w, pl, "intro.damage"), false);
  assert.equal(thoughtBlocked(w, pl, "intro.damage"), "said");
  assert.deepEqual(events(w), []);
  assert.equal(think(w, pl, "no.such.line"), false);
  const guardian = actorById(w, GUARDIAN)!;
  assert.equal(think(w, guardian, "intro.arm"), false, "only the player golem thinks");
  assert.ok(hasThought(w, "intro.damage") && !hasThought(w, "intro.arm"));
});

test("recurring lines respect their cooldown on sim time; `when` and `if` gate a line", () => {
  withLine("t.recur", { text: "AGAIN.", once: false, cooldown: 2 }, () => withLine("t.gated", { text: "KNOWN.", when: { flags: [FLAGS.knowBuild] } }, () => {
    const w = newWorld(), pl = player(w);
    assert.ok(think(w, pl, "t.recur"));
    assert.ok(!think(w, pl, "t.recur"), "cooling down");
    frames(w, 61); // ~1 s
    assert.equal(thoughtBlocked(w, pl, "t.recur"), "cooldown");
    frames(w, 70);
    assert.ok(think(w, pl, "t.recur"), "fires again after 2 s of sim time");
    assert.equal(thoughtBlocked(w, pl, "t.gated"), "when");
    setFlag(w, FLAGS.knowBuild);
    assert.ok(think(w, pl, "t.gated"));
  }));
});

test("event triggers: a data row with `on` fires from the matching player event, with field matching", () => {
  withLine("t.surface", { text: "OPEN SKY.", on: { event: "areaEntered", match: { area: "surface" } } }, () => {
    const w = newWorld(), pl = player(w);
    const other = makeActor("other", "worker_golem", "dungeon", pl.x + 40, pl.y);
    w.actors.push(other);
    enterArea(w, other, "surface", 100, 100);
    frame(w);
    assert.deepEqual(thoughts(events(w)), [], "another actor's event is not the golem's thought");
    enterArea(w, pl, "dungeon", pl.x, pl.y);
    frame(w);
    assert.deepEqual(thoughts(events(w)), [], "field match: the wrong area");
    enterArea(w, pl, "surface", 100, 100);
    frame(w);
    assert.deepEqual(thoughts(events(w)), ["t.surface"]);
    enterArea(w, pl, "dungeon", 100, 100); enterArea(w, pl, "surface", 100, 100);
    frame(w);
    assert.deepEqual(thoughts(events(w)), [], "one-shot");
  });
});

test("events from paused-world commands are seen when the host drains: reading the Primer", () => {
  withLine("t.learned", { text: "PATTERNS STORED.", on: { event: "learned", match: { flag: FLAGS.knowBuild } } }, () => {
    const w = newWorld(), pl = player(w);
    addItems(w, pl, "book_build", 1);
    readItem(w, pl, "book_build"); // the book screen, world paused
    reactToEvents(w); // what Game.drainEvents does first
    const evs = events(w);
    assert.deepEqual(evs.map((e) => e.t), ["learned", "thought"]);
    readItem(w, pl, "book_build"); reactToEvents(w);
    assert.deepEqual(events(w), [], "learning is once; so is the thought");
  });
});

test("the `think` effect op: interaction rules, schedules and beats can fire lines as data", () => {
  const w = newWorld(), pl = player(w);
  assert.equal(applyEffect(w, pl, { op: "think", line: "intro.arm" }), true);
  assert.deepEqual(thoughts(events(w)), ["intro.arm"]);
  assert.equal(applyEffect(w, pl, { op: "think", line: "intro.arm" }), false);
});

test("golem vision: analyzing a buildable thinks OBJECT ANALYZED. once per analysis", () => {
  const w = createWorld(12), area = getArea(w, "debug_workshop"), pl = player(w), chest = area.prop("chest.fixture")!;
  enterArea(w, pl, area.id, chest.x, chest.y + 11); pl.facing = "up";
  setFlag(w, FLAGS.knowBuild);
  events(w);
  frame(w, { ix: 0, iy: 0, use: true, toggleScan: true });
  frames(w, 90);
  const evs = events(w);
  assert.ok(evs.some((e) => e.t === "analyzed"));
  assert.deepEqual(thoughts(evs), ["vision.analyzed"]);
  assert.equal(THOUGHTS["vision.analyzed"].text, "OBJECT ANALYZED.");
});

test("planned lines are plain data rows: a dormant golem missing its core, a guardian given a core too weak for it", () => {
  const dormant: ThoughtLine = { text: "INTEGRITY INTACT, MISSING POWER SOURCE.", on: { event: "manageActor" }, if: ["subjectNoPower"], once: false, cooldown: 2 };
  const weak: ThoughtLine = { text: "INSUFFICIENT POWER SOURCE.", on: [{ event: "manageActor" }, { event: "dialogue" }], if: ["subjectWeakPower"], once: false, cooldown: 2 };
  withLine("golem.dormant", dormant, () => withLine("golem.underpowered", weak, () => {
    // a lesser golem without a core: walking up to it and pressing E
    const w = createWorld(12), area = getArea(w, "debug_workshop"), pl = player(w);
    enterArea(w, pl, area.id, 120, 120); pl.facing = "up";
    const worker = makeActor("lesser", "worker_golem", area.id, 120, 104);
    w.actors.push(worker);
    events(w);
    frame(w, { ix: 0, iy: 0, use: true }); frames(w, 40);
    assert.deepEqual(thoughts(events(w)), ["golem.dormant"]);
    // powered, it is just a worker: nothing to think
    addItems(w, pl, "ruby_core", 1);
    assert.ok(insertPowerCore(w, pl, worker, "ruby_core"));
    events(w); frames(w, 130);
    frame(w, { ix: 0, iy: 0, use: true }); frames(w, 40);
    assert.deepEqual(thoughts(events(w)), []);

    // the guardian takes a ruby core (it fits) but its body needs more; then talking to it
    const v = newWorld(), gp = player(v), it = guardianIt(v), guardian = actorById(v, GUARDIAN)!;
    gp.x = it.x; gp.y = it.y + 9; gp.facing = "up";
    addItems(v, gp, "ruby_core", 1);
    assert.ok(insertPowerCore(v, gp, guardian, "ruby_core"));
    events(v);
    useOn(v, it);
    assert.deepEqual(thoughts(events(v)), ["golem.underpowered"]);
  }));
});

// ------------------------------------------------------------------ saves
test("monologue state saves and loads: one-shot lines stay said, cooldowns carry over, worlds stay identical", () => {
  withLine("t.recur", { text: "AGAIN.", once: false, cooldown: 5 }, () => {
    const w = newWorld(), pl = player(w);
    think(w, pl, "intro.assessing"); think(w, pl, "t.recur");
    frames(w, 30);
    const s = serialize(w);
    assert.deepEqual(s.monologue.said, ["intro.assessing"]);
    const w2 = deserialize(JSON.parse(JSON.stringify(s)));
    assert.deepEqual(serialize(w2), s, "round trip");
    assert.equal(think(w2, player(w2), "intro.assessing"), false, "a one-shot line doesn't repeat after load");
    assert.equal(thoughtBlocked(w2, player(w2), "t.recur"), "cooldown", "the cooldown survives");
    // same inputs after the load give the same world
    frames(w, 400); frames(w2, 400);
    assert.equal(think(w, player(w), "t.recur"), think(w2, player(w2), "t.recur"));
    assert.deepEqual(serialize(w2), serialize(w));
  });
});

test("v10 -> v11: the migration adds an empty monologue; a migrated save plays on", () => {
  assert.equal(SAVE_VERSION, 11);
  const w = newWorld();
  const s: any = serialize(w);
  s.version = 10; delete s.monologue;
  const m: any = migrate(s);
  assert.equal(m.version, 11);
  assert.deepEqual(m.monologue, { said: [], ready: {} });
  const w2 = deserialize(s);
  assert.deepEqual(serialize(w2), serialize(w));
  assert.ok(playerThinks(w2, "intro.arm"));
});

// ------------------------------------------------------------------ the Primer
test("the Builder's Primer: the learned event brings YOU LEARNED TO BUILD., once", () => {
  assert.equal(learnedText(FLAGS.knowBuild), "YOU LEARNED TO BUILD.");
  const w = newWorld(), pl = player(w);
  addItems(w, pl, "book_build", 1);
  readItem(w, pl, "book_build"); readItem(w, pl, "book_build");
  assert.deepEqual(events(w).filter((e) => e.t === "learned"), [{ t: "learned", flag: FLAGS.knowBuild }]);
});

// ------------------------------------------------------------------ the opening, through the host
const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const DT = 1 / 60;

function playIntro(g: Game) {
  g.keyDown("x"); g.update(DT); g.keyUp("x");
  assert.ok(g.screens.is("intro"));
  const start = g.pl.x;
  let t = 0, handed = -1;
  const order: string[] = [];
  g.keyDown("d"); // held the whole time: it must not move the golem before control
  while (t < 20) {
    g.update(DT); t += DT;
    for (const id of g.world.monologue.said) if (!order.includes(id)) order.push(id);
    if (g.screens.is("play")) { handed = t; break; }
    assert.equal(g.pl.x, start, "no control during the cutscene");
  }
  g.keyUp("d");
  return { handed, order };
}

test("the opening plays its lines in order and hands control over at the control beat; R replays it, loading doesn't", () => {
  const g = new Game(canvas(), canvas());
  const { handed, order } = playIntro(g);
  assert.ok(Math.abs(handed - controlAt(INTRO)) < 2 * DT, `control at ${handed}`);
  assert.deepEqual(order, ["intro.assessing", "intro.damage", "intro.arm", "intro.directive"]);
  assert.deepEqual(g.monologue.lines.map((l) => l.text), ["ASSESSING...", "MILD DAMAGE DETECTED.", "MISSING LEFT ARM.", "PRIME DIRECTIVE: NONE."], "the list is still up as control is handed over");
  assert.ok(g.monologue.lines.every((l) => l.done), "fully typed");
  assert.equal(g.monologue.pinned, false, "and now free to fade");
  for (let i = 0; i < 60 * 12; i++) g.update(DT);
  assert.equal(g.monologue.lines.length, 0, "the list fades in play");
  // control: the golem moves
  const x0 = g.pl.x;
  g.keyDown("d"); for (let i = 0; i < 30; i++) g.update(DT); g.keyUp("d");
  assert.ok(g.pl.x > x0);

  // Wake again (R on the end card): a fresh world, the whole opening again
  const s = (g as unknown as { S: Record<string, unknown> }).S;
  g.screens.set(s.end as never);
  for (let i = 0; i < 60 * 6; i++) g.update(DT);
  g.keyDown("r"); g.update(DT); g.keyUp("r");
  assert.ok(g.screens.is("intro"));
  g.screens.set(s.title as never);
  const again = playIntro(g);
  assert.deepEqual(again.order, order);

  // a loaded save resumes straight into play: no cutscene, no opening thoughts
  const saved = serialize(g.world);
  const h = new Game(canvas(), canvas());
  h.resume(deserialize(saved));
  assert.ok(h.screens.is("play"));
  for (let i = 0; i < 60 * 3; i++) h.update(DT);
  assert.ok(h.screens.is("play"));
  assert.equal(h.monologue.lines.length, 0);
});

test("presentation model: lines type one at a time, hold while pinned, and fade once released", () => {
  const log = new MonologueLog();
  log.pinned = true;
  log.push("intro.damage"); log.push("intro.arm");
  for (let i = 0; i < 20; i++) log.update(DT);
  assert.equal(log.lines.length, 1, "the second waits for the first");
  for (let i = 0; i < 300; i++) log.update(DT);
  assert.equal(log.lines.length, 2);
  for (let i = 0; i < 1200; i++) log.update(DT);
  assert.equal(log.lines.length, 2, "pinned lines hold");
  log.release();
  for (let i = 0; i < 1200; i++) log.update(DT);
  assert.equal(log.lines.length, 0);
});

