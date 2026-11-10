// The day/night cycle and the two cutscenes that can be skipped.
//
// Sim side (no DOM): the cycle's maths (content/daycycle.ts), the calendar
// clock (sim/daytime.ts), who tends which light, the first crossing setting the
// hour, the save format (v13) and the golem's line at its first dusk.
// Host side (the real Game on the fake canvas, driven by key presses): the
// opening skipped with Esc, the first jump played right through the crossing,
// the crossing skipped at every stage (and the world left the same as when it
// is watched), R at the chapter card, and the town's lamps following the hour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import {
  DAY_HOURS, DAY_SECONDS, FIRST_ARRIVAL_HOUR, FIRST_MORNING_HOUR, START_HOUR, SKY,
  ambientAt, clockText, hourOf, lampGain, litLevel, phaseAt, skyLight, sunLevel, type RGB,
} from "../src/game/content/daycycle";
import { advanceDayTo, advanceDayUpTo, worldHour, worldPhase } from "../src/game/sim/daytime";
import { stepWorld } from "../src/game/sim/step";
import { travel } from "../src/game/sim/runes";
import { beginTask } from "../src/game/sim/tasks";
import { RULES } from "../src/game/content/interactions";
import { RUNE_NODES } from "../src/game/content/runes";
import { FLAGS } from "../src/game/content/flags";
import { THOUGHTS } from "../src/game/content/monologue";
import { ARRIVE, CROSSING, INTRO } from "../src/game/content/cutscenes";
import { CROSSING_CUES } from "../src/game/screens/crossing";
import { controlAt, timeline } from "../src/game/ui/cutscene";
import { propDef } from "../src/game/content/props";
import { AREAS } from "../src/game/world/areas";
import { currentArea, emit, enterArea, getArea, hasFlag, player, setFlag, type World } from "../src/game/world/world";
import { SAVE_VERSION, deserialize, migrate, serialize } from "../src/game/world/save";
import { newWorld } from "./helpers";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const NIGHT: RGB = [0.32, 0.31, 0.42];

// ------------------------------------------------------------------ the cycle's maths
test("the day has four parts, and the sun eases up through dawn and down through dusk", () => {
  assert.equal(phaseAt(0), "night"); assert.equal(phaseAt(4.99), "night");
  assert.equal(phaseAt(DAY_HOURS.dawn), "dawn"); assert.equal(phaseAt(6.99), "dawn");
  assert.equal(phaseAt(DAY_HOURS.sunrise), "day"); assert.equal(phaseAt(12), "day");
  assert.equal(phaseAt(DAY_HOURS.dusk), "dusk"); assert.equal(phaseAt(DAY_HOURS.nightfall), "night");
  assert.equal(phaseAt(24 + 12), "day", "hours wrap");
  assert.equal(sunLevel(0), 0); assert.equal(sunLevel(12), 1); assert.equal(sunLevel(23), 0);
  for (let h = 5; h < 7; h += 0.05) assert.ok(sunLevel(h + 0.05) >= sunLevel(h), "dawn only brightens");
  for (let h = 19; h < 21; h += 0.05) assert.ok(sunLevel(h + 0.05) <= sunLevel(h), "dusk only darkens");
  assert.ok(near(sunLevel(6), 0.5), "half up at the middle of dawn");
  assert.equal(hourOf(0.5), 12); assert.ok(near(hourOf(3.25), 6)); assert.equal(clockText(6.69), "06:40"); assert.equal(clockText(23.99), "23:50");
});

test("ambient light: an area's own ambient is its night; the sun adds the day; buried areas never change", () => {
  assert.deepEqual(ambientAt(NIGHT, 0, "outdoor"), NIGHT, "night is the authored look, untouched");
  assert.deepEqual(ambientAt(NIGHT, 12, "outdoor"), [...SKY.day]);
  const dawn = ambientAt(NIGHT, 6, "outdoor"), dusk = ambientAt(NIGHT, 20, "outdoor");
  assert.ok(dawn[0] > dawn[2] && dusk[0] > dusk[2], "the twilights are warm");
  assert.ok(dawn[0] > NIGHT[0] && dawn[0] < 1);
  const dark: RGB = [0.05, 0.045, 0.065];
  for (const h of [0, 6, 12, 20]) { assert.equal(ambientAt(dark, h, "buried"), dark); assert.equal(lampGain(h, "buried"), 1); }
  const room: RGB = [0.3, 0.25, 0.22], noon = ambientAt(room, 12, "interior");
  assert.ok(noon[0] > room[0] && noon[0] < SKY.day[0], "a room is lit by day, but less than the street");
  assert.equal(lampGain(0, "outdoor"), 1);
  assert.ok(near(lampGain(12, "outdoor"), SKY.lampInSun), "a lamp at noon counts for little");
  assert.ok(lampGain(12, "interior") > lampGain(12, "outdoor"));
  const moon: RGB = [0.55, 0.68, 1];
  assert.deepEqual(skyLight(moon, 0).col, moon, "sky light keeps its authored colour by night");
  const beam = skyLight(moon, 12);
  assert.ok(beam.col[0] > beam.col[2] && beam.gain > 1, "and is a sunbeam by day");
});

// ------------------------------------------------------------------ the clock
test("the calendar clock runs with world time, forward only, and says so once when the day turns", () => {
  const w = newWorld();
  assert.ok(near(worldHour(w), START_HOUR), "the golem wakes in the night");
  assert.equal(worldPhase(w), "night");
  stepWorld(w, DAY_SECONDS / 24);
  assert.ok(near(worldHour(w), START_HOUR + 1, 1e-6), "an hour of the day is DAY_SECONDS / 24 of world time");
  advanceDayTo(w, 4.9);
  const day = w.day;
  w.events = [];
  for (let i = 0; i < 60; i++) stepWorld(w, 0.2); // 12 s: 0.4 h, across 05:00
  const turns = w.events.filter((e) => e.t === "dayPhase");
  assert.deepEqual(turns.map((e) => e.t === "dayPhase" && e.phase), ["dawn"], "one event at the boundary");
  assert.ok(w.day > day);
  // advanceDayTo: the next time it is that hour (tomorrow if it has passed)
  const before = w.day;
  advanceDayTo(w, 4);
  assert.ok(near(worldHour(w), 4) && w.day > before && w.day - before > 0.9, "04:00 has passed today: tomorrow's");
  // advanceDayUpTo: only if still ahead today; never back, never round the clock
  const d0 = w.day;
  advanceDayUpTo(w, 3); assert.equal(w.day, d0, "an hour behind is left alone");
  advanceDayUpTo(w, 6.6); assert.ok(near(worldHour(w), 6.6));
  const d1 = w.day;
  advanceDayUpTo(w, 6.6); advanceDayUpTo(w, 6.5); assert.equal(w.day, d1, "safe to call again");
});

test("the first crossing lands in the last dark before dawn; later hops take no time", () => {
  const w = newWorld(), pl = player(w);
  for (let i = 0; i < 40; i++) stepWorld(w, 5); // some time in the halls: the hour could be anything
  setFlag(w, RUNE_NODES.dungeon.flag);
  const before = w.day;
  assert.ok(travel(w, pl, currentArea(w), "rune.dungeon"));
  assert.equal(pl.area, "surface"); assert.ok(hasFlag(w, FLAGS.tutorialDone));
  assert.ok(near(worldHour(w), FIRST_ARRIVAL_HOUR) && w.day > before, "forward to 04:00");
  assert.equal(worldPhase(w), "night");
  const d = w.day;
  assert.ok(travel(w, pl, currentArea(w), "rune.surface")); assert.equal(pl.area, "dungeon");
  assert.equal(w.day, d, "a hop back takes no time");
});

// ------------------------------------------------------------------ who tends which light
const town = () => AREAS.town();
const tended = (habit: string) => town().props.filter((p) => propDef(p.kind).habit === habit).map((p) => p.id!);

test("only the town is tended, and its lights have their habits (the charter stone's rune never sleeps)", () => {
  assert.equal(town().tended, true);
  assert.ok(!AREAS.surface().tended && !AREAS.dungeon().tended, "the wild and the halls keep no hours");
  assert.ok(!AREAS.town_tavern().tended, "a room keeps its own lamps lit");
  assert.equal(propDef("rune_lamp").habit, "rune"); assert.equal(propDef("rune_sconce").habit, "rune");
  for (const k of ["lantern", "torch", "torch_post", "brazier"]) assert.equal(propDef(k).habit, "fire", k);
  for (const k of ["winglow", "winglow_rune", "winglow_up"]) assert.equal(propDef(k).habit, "window", k);
  assert.equal(propDef("marketcross").habit, undefined, "THE LIGHT RUNE AT ITS HEAD HAS NEVER GONE OUT");
  assert.ok(propDef("marketcross").light);
  assert.ok(tended("rune").length > 20 && tended("fire").length > 15 && tended("window").length > 40);
});

test("the town puts its lights out in the morning and lights them at dusk, each kind in its own way", () => {
  const runes = tended("rune"), fires = tended("fire"), wins = tended("window");
  const lit = (ids: string[], habit: "rune" | "fire" | "window", h: number) => ids.filter((id) => litLevel(habit, id, h) > 0.5).length;
  // broad day: everything tended is out
  for (const h of [8, 12, 16, 18.5]) {
    assert.equal(lit(runes, "rune", h), 0, `runes asleep at ${h}`);
    assert.equal(lit(fires, "fire", h), 0, `fires out at ${h}`);
    assert.equal(lit(wins, "window", h), 0, `windows dark at ${h}`);
  }
  // deep night: every street light burns, every house is asleep
  for (const h of [23, 1, 3]) { assert.equal(lit(runes, "rune", h), runes.length); assert.equal(lit(fires, "fire", h), fires.length); }
  assert.equal(lit(wins, "window", 3), 0, "the whole town is in bed at three");
  assert.ok(lit(wins, "window", 21.5) > wins.length * 0.8, "and nearly all of it is up at half past nine");
  const early = lit(wins, "window", 5.9);
  assert.ok(early > 0 && early < wins.length * 0.6, "a few are up before dawn");
  // runes answer the dark together (a ripple); fires wait for a hand (spread over an hour or more)
  const firstOn = (habit: "rune" | "fire", id: string) => { for (let h = 19; h < 21.5; h += 0.01) if (litLevel(habit, id, h) > 0.5) return h; return NaN; };
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const runeOn = runes.map((id) => firstOn("rune", id)), fireOn = fires.map((id) => firstOn("fire", id));
  assert.ok(runeOn.every((h) => h > 19 && h < 20.6) && spread(runeOn) < 0.4, `runes wake within minutes of each other (${spread(runeOn).toFixed(2)} h)`);
  assert.ok(spread(fireOn) > 0.6 && fireOn.every((h) => h >= 19.5), `fires are lit one by one (${spread(fireOn).toFixed(2)} h)`);
  // morning: all of it out by a little after sunrise, and not all at once
  assert.equal(lit(runes, "rune", 6.6) + lit(fires, "fire", 7.3) + lit(wins, "window", 7.3), 0);
  assert.ok(lit(fires, "fire", 6.5) > 0 && lit(fires, "fire", 6.5) < fires.length, "some fires doused, some still burning at half past six");
  // the same lamp keeps the same hours
  assert.equal(litLevel("fire", fires[0], 20.1), litLevel("fire", fires[0], 20.1 + 24));
});

// ------------------------------------------------------------------ saving
test("save v13: the clock is saved; an older save resumes at night in the halls, at its first morning on the surface", () => {
  assert.equal(SAVE_VERSION, 13);
  const w = newWorld();
  advanceDayTo(w, 15.25);
  const s = serialize(w);
  assert.equal(s.day, w.day);
  assert.equal(deserialize(JSON.parse(JSON.stringify(s))).day, w.day);
  const old = (surface: boolean) => {
    const o = serialize(newWorld()) as unknown as Record<string, unknown> & { flags: string[] };
    o.version = 12; delete o.day;
    if (surface) o.flags.push(FLAGS.tutorialDone);
    return o;
  };
  const halls = migrate(old(false)) as { version: number; day: number }, up = migrate(old(true)) as { version: number; day: number };
  assert.equal(halls.version, 13); assert.ok(near(hourOf(halls.day), START_HOUR));
  assert.ok(near(hourOf(up.day), FIRST_MORNING_HOUR));
  const loaded = deserialize(old(true));
  for (let i = 0; i < 30; i++) stepWorld(loaded, 1 / 60);
  assert.ok(loaded.day > up.day, "and the clock runs on");
});

// ------------------------------------------------------------------ the golem's line at dusk
test("the golem remarks on its first dusk under the open sky, once, and not from the halls", () => {
  const dusk = (w: World) => { advanceDayTo(w, 18.95); stepWorld(w, 3); return w.monologue.said.includes("sky.dusk"); };
  const under = newWorld();
  assert.equal(dusk(under), false, "nothing to see from the halls");
  const w = newWorld(), s = getArea(w, "surface").start;
  enterArea(w, player(w), "surface", s.x, s.y);
  assert.equal(dusk(w), true);
  assert.equal(dusk(w), true);
  assert.equal(w.monologue.said.filter((id) => id === "sky.dusk").length, 1, "once");
});

// ------------------------------------------------------------------ the crossing's script
test("the crossing script: ordered beats, one hand-over, known cues and lines, and the act marks the screen needs", () => {
  const tl = timeline(CROSSING), at = (label: string) => tl.find((b) => b.label === label)!.at;
  for (let i = 1; i < tl.length; i++) assert.ok(tl[i].at > tl[i - 1].at, "beats strictly ordered");
  assert.equal(tl.filter((b) => b.control).length, 1); assert.ok(tl[tl.length - 1].control, "control is the last beat");
  for (const b of tl) {
    for (const c of b.cues ?? []) assert.ok(CROSSING_CUES[c], `unknown cue ${c}`);
    if (b.think) assert.ok(THOUGHTS[b.think], `unknown line ${b.think}`);
  }
  assert.deepEqual(tl.filter((b) => b.think).map((b) => b.think), ["cross.transit", "cross.anchor", "cross.rewrite", "cross.arrived", "cross.observed", "cross.light"]);
  assert.ok(at("stall") < at("rewrite") && at("rewrite") < at("surface"), "the transit: climb, stall, rewrite, then the world");
  assert.ok(near(at("landed"), at("surface") + ARRIVE.FLASH + ARRIVE.FALL), "the land cue is the moment the fall ends");
  assert.ok(at("arrived") > at("landed") && at("first light") > at("observed"));
  assert.ok(at("chapter") > at("first light") + CROSSING.lapse - 1, "the chapter card comes as the morning does");
  assert.ok(controlAt(CROSSING) - at("chapter") >= 8, "left alone, the card holds a good while before handing over");
  assert.ok(at("chapter") < 32, "not slow");
});

// ------------------------------------------------------------------ through the host
const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
const DT = 1 / 60;
const tick = (g: Game, n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
const press = (g: Game, key: string) => { g.keyDown(key); g.update(DT); g.keyUp(key); };
const CROSS_LINES = ["cross.engage", "cross.transit", "cross.anchor", "cross.rewrite", "cross.arrived", "cross.observed", "cross.light"];

test("the opening can be skipped with Esc: control at once, the golem up and lit, its lines thought but not shown", () => {
  const g = new Game(canvas(), canvas());
  press(g, "x");
  assert.ok(g.screens.is("intro"));
  g.keyDown("d"); tick(g, 90); // other keys do nothing, held or pressed
  assert.ok(g.screens.is("intro"));
  press(g, "Escape");
  assert.ok(g.screens.is("play"), "skipped");
  assert.deepEqual(g.world.monologue.said, timeline(INTRO).filter((b) => b.think).map((b) => b.think), "every line is on record, in order");
  assert.equal(g.monologue.lines.length, 0, "none of them on screen");
  assert.equal(g.monologue.pinned, false);
  assert.deepEqual([g.look.core, g.look.eye, g.look.dormant], [1, 1, 0]);
  assert.equal(g.bars.to, 0, "the letterbox opens");
  const x0 = g.pl.x;
  tick(g, 30); g.keyUp("d");
  assert.ok(g.pl.x > x0, "and the golem walks");
  // Esc in the first instant (the title's own key press) does not skip
  const h = new Game(canvas(), canvas());
  h.keyDown("Escape"); h.update(DT); h.update(DT); h.keyUp("Escape");
  assert.ok(h.screens.is("intro"), "Esc on the title starts the opening, it does not skip it");
});

/** What stepPlayer does when the golem stands on the freshly charged circle (sim/step.ts), without solving the ritual first. */
function beginFirstJump(w: World) {
  const pl = player(w), c = currentArea(w).ritualPos;
  setFlag(w, RUNE_NODES.dungeon.flag);
  pl.x = c.x; pl.y = c.y + 4; pl.facing = "down";
  beginTask(pl, RULES.rune[RULES.rune.length - 1].task, { kind: "rune", x: c.x, y: c.y, propId: "rune.dungeon" });
  emit(w, { t: "teleport", actor: pl.id, first: true, x: c.x, y: c.y });
}
function jumping() {
  const g = new Game(canvas(), canvas()), w = newWorld();
  g.resume(w);
  beginFirstJump(w);
  tick(g);
  assert.ok(g.screens.is("tele"), "the lift-off");
  assert.equal(g.bars.to, 1, "bars in: the crossing has begun");
  return { g, w };
}
/** The state a finished crossing must leave, however it ended. */
function assertArrived(g: Game, w: World, shown: boolean) {
  const pl = player(w);
  assert.ok(g.screens.is("play"));
  assert.equal(pl.area, "surface");
  assert.deepEqual(w.monologue.said, CROSS_LINES, "every line of the crossing is on record, in order");
  assert.ok(Math.abs(worldHour(w) - FIRST_MORNING_HOUR) < 0.4 && worldPhase(w) === "dawn", `the first morning (${worldHour(w).toFixed(2)})`);
  assert.equal(g.runeAnim, null); assert.equal(g.hideGolem, false); assert.equal(g.gaze, null); assert.equal(g.look.z, 0);
  assert.equal(g.bars.to, 0); assert.equal(g.monologue.pinned, false);
  assert.equal(g.note?.text, "THE SURFACE. THE WILD HAS SWALLOWED ALL TRACE OF THE HALLS.");
  assert.ok(hasFlag(w, RUNE_NODES.surface.flag), "the far rune is restored");
  if (!shown) assert.equal(g.monologue.lines.length, 0, "skipped lines are not shown");
  const x0 = pl.x;
  g.keyDown("d"); tick(g, 40); g.keyUp("d");
  assert.ok(pl.x > x0, "control");
  g.render();
}

test("the first jump plays the crossing through: transit, arrival, first light, the chapter card, then control", () => {
  const { g, w } = jumping(), pl = player(w), ui = g.crossingUi;
  g.keyDown("d"); // held throughout: it must do nothing until control
  let frames = 0;
  while (!g.screens.is("crossing") && frames++ < 600) tick(g);
  assert.ok(g.screens.is("crossing"), "the lift-off runs on into the crossing");
  assert.equal(pl.area, "surface"); assert.equal(worldPhase(w), "night", "it comes up in the dark");
  const x0 = pl.x, acts = new Set<string>();
  let sawHidden = false, sawGaze = false, hourAtLight = -1;
  const until = ui.at.chapter + ui.script.promptAfter + 0.2;
  while (ui.screen.t < until) {
    tick(g);
    assert.ok(g.screens.is("crossing"), `still the cutscene at ${ui.screen.t.toFixed(2)}`);
    assert.equal(pl.x, x0, "no control during the crossing");
    acts.add(ui.actAt(ui.screen.t));
    if (g.hideGolem) sawHidden = true;
    if (g.gaze) sawGaze = true;
    if (hourAtLight < 0 && ui.screen.t >= ui.at["first light"]) hourAtLight = worldHour(w);
    if (Math.abs(ui.screen.t - 3) < DT || Math.abs(ui.screen.t - 12) < DT || Math.abs(ui.screen.t - until) < DT) g.render(); // each act draws
  }
  assert.deepEqual([...acts], ["transit", "arrival", "firstLight"]);
  assert.ok(sawHidden && sawGaze, "the golem is summoned (unseen until the flash), then looks about");
  assert.ok(hourAtLight < DAY_HOURS.dawn, `still night as the rune wakes (${hourAtLight.toFixed(2)})`);
  assert.ok(worldHour(w) >= FIRST_MORNING_HOUR - 0.01, "the clock has run on to morning while it watched");
  g.keyUp("d");
  press(g, "e"); // any key at the chapter card
  assertArrived(g, w, true);
});

test("the crossing can be skipped with Esc at any stage, and leaves the world as the watched one does", () => {
  // at the lift-off, before the sim has even travelled
  {
    const { g, w } = jumping();
    tick(g, 30);
    assert.equal(player(w).area, "dungeon");
    press(g, "Escape");
    assertArrived(g, w, false);
  }
  // in the transit, during the arrival, and at first light
  for (const at of [2.5, 11, 24]) {
    const { g, w } = jumping(), ui = g.crossingUi;
    let frames = 0;
    while (!g.screens.is("crossing") && frames++ < 600) tick(g);
    while (ui.screen.t < at) tick(g);
    press(g, "Escape");
    assertArrived(g, w, false);
  }
});

test("left alone the chapter card hands over by itself; R on it wakes the golem again", () => {
  const run = () => {
    const { g, w } = jumping(), ui = g.crossingUi;
    let frames = 0;
    while (!g.screens.is("crossing") && frames++ < 600) tick(g);
    while (ui.screen.t < ui.at.chapter + ui.script.promptAfter + 0.1) tick(g);
    return { g, w, ui };
  };
  const a = run();
  while (a.g.screens.is("crossing") && a.ui.screen.t < controlAt(CROSSING) + 1) tick(a.g);
  assertArrived(a.g, a.w, true);
  const b = run();
  press(b.g, "r");
  assert.ok(b.g.screens.is("intro"), "the opening again");
  assert.notEqual(b.g.world, b.w, "in a fresh world");
  assert.equal(b.g.pl.area, "dungeon"); assert.ok(near(worldHour(b.g.world), START_HOUR, 0.01));
  assert.equal(b.g.gaze, null); assert.equal(b.g.runeAnim, null);
});

test("host: the town's lamps follow the hour, the charter stone never sleeps, and the roof crack lets in the day", () => {
  const g = new Game(canvas(), canvas()), w = newWorld(), s = getArea(w, "town").start;
  enterArea(w, player(w), "town", s.x, s.y);
  g.resume(w);
  const lamps = () => [...g.view.lights.values()].filter((L) => L.habit);
  const lit = (habit: string) => lamps().filter((L) => L.habit === habit && (L.day ?? 1) > 0.5).length;
  const count = (habit: string) => lamps().filter((L) => L.habit === habit).length;
  assert.ok(count("rune") > 20 && count("fire") > 15 && count("window") > 20, "the town's lights carry their habits");
  advanceDayTo(w, 1); tick(g, 2);
  assert.equal(lit("rune"), count("rune")); assert.equal(lit("fire"), count("fire"));
  g.render();
  advanceDayTo(w, 12); tick(g, 2);
  assert.equal(lit("rune") + lit("fire") + lit("window"), 0, "noon: every tended light is out");
  const cross = [...g.view.lights.values()].filter((L) => !L.habit && !L.sky && L.on && L.cur > 0.5 && (L.day ?? 1) === 1);
  assert.ok(cross.length >= 1, "but the charter stone's rune is still alight");
  g.render();
  advanceDayTo(w, 20.9); tick(g, 2);
  assert.equal(lit("rune"), count("rune"), "dusk: the runes are awake again");
  // the halls: the same shaft through the broken roof, moonlight then sunlight; the dark itself does not change
  const h = new Game(canvas(), canvas()), hw = newWorld();
  h.resume(hw); tick(h, 2);
  const moon = h.view.byId("moon")!;
  assert.ok(moon.b > moon.r, "moonlight");
  advanceDayTo(hw, 12); tick(h, 2);
  assert.ok(moon.r > moon.b && (moon.day ?? 1) > 1, "a sunbeam");
  assert.equal([...h.view.lights.values()].filter((L) => L.habit).length, 0, "nobody tends the halls: their torches keep no hours");
  h.render();
});
