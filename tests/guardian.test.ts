// The Treasury Guardian encounter and the NPC/dialogue foundation it sits on,
// driven headlessly through the sim (no browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { player, currentArea, hasFlag, setFlag, getArea, makeNpc, actorById, type World } from "../src/game/world/world";
import { T, TS } from "../src/game/content/tiles";
import { FLAGS, npcFlag } from "../src/game/content/flags";
import { DIALOGUE, BEATS, DIALOGUE_LINE_MAX, DIALOGUE_PAGE_LINES, GUARDIAN_FLAGS } from "../src/game/content/dialogue";
import { NPCS } from "../src/game/content/npcs";
import { FONT_GLYPHS } from "../src/game/font";
import { interactables } from "../src/game/sim/interact";
import { addItems, countItem, capacity } from "../src/game/sim/inventory";
import { applyEffect } from "../src/game/sim/tasks";
import { talkTo, playSegment, dialogueBeat, finishSegment, isAwake, scriptOf, currentSegment } from "../src/game/sim/dialogue";
import { propBlocks, actorBoxes, actorBox, boxFree } from "../src/game/sim/collision";
import { reachable, nearReached, type Box } from "../src/game/sim/reach";
import { serialize, deserialize, SAVE_VERSION } from "../src/game/world/save";
import type { ItemId } from "../src/game/content/items";
import { events, frames, newWorld, useOn, guardianIt, talkThrough, GUARDIAN, find } from "./helpers";

const G = GUARDIAN;
const corePresent = (w: World) => {
  let n = 0;
  for (const a of w.actors) n += countItem(a, "core");
  for (const area of w.areas.values()) {
    n += area.loose.filter((l) => !l.taken && l.item === "core").length;
    if (area.ritual?.core) n++;
  }
  return n;
};

// ------------------------------------------------------------------ encounter
test("the guardian is an NPC actor, dormant in the treasury, with an empty pack", () => {
  const w = newWorld();
  const g = actorById(w, G)!;
  assert.equal(g.kind, "npc");
  assert.equal(g.npc, "guardian");
  assert.equal(g.area, "dungeon");
  assert.deepEqual(g.inventory, []);
  const tx = Math.floor(g.x / TS), ty = Math.floor(g.y / TS);
  assert.ok(tx >= 52 && tx <= 59 && ty >= 3 && ty <= 8, `in the treasury (${tx},${ty})`);
  assert.equal(isAwake(w, G), false);
  frames(w, 120);
  assert.deepEqual(g.inventory, [], "capacity tiers (golem.*) do not apply to NPCs");
  assert.equal(NPCS.guardian.type, "special");
});

test("full encounter: wake, repair, core, farewell; repeating grants nothing", () => {
  const w = newWorld(7), pl = player(w);
  events(w);
  useOn(w, guardianIt(w));
  const ev = events(w);
  const d = ev.find((e) => e.t === "dialogue");
  assert.ok(d && d.t === "dialogue" && d.segment === "intro" && d.npc === G && d.script === "guardian");
  const script = scriptOf(w, G)!;
  let seg = currentSegment(w, pl, script)!;
  const order: string[] = [];
  while (seg) {
    order.push(seg.id);
    seg = playSegment(w, pl, G, seg)!;
  }
  assert.deepEqual(order, ["intro", "repair", "core", "farewell"]);
  const all = events(w);
  assert.ok(all.some((e) => e.t === "npcState" && e.awake));
  assert.ok(all.some((e) => e.t === "eyeRepaired" && e.by === G));
  assert.ok(all.some((e) => e.t === "npcState" && !e.awake));
  assert.ok(hasFlag(w, FLAGS.golemEye));
  assert.equal(countItem(pl, "core"), 1);
  assert.equal(corePresent(w), 1);
  assert.equal(isAwake(w, G), false, "dormant again");
  for (const f of [GUARDIAN_FLAGS.met, GUARDIAN_FLAGS.coreGiven, GUARDIAN_FLAGS.farewell]) assert.ok(hasFlag(w, f), f);

  // Talking again: a short examine-style line, no dialogue.
  useOn(w, guardianIt(w));
  const again = events(w);
  assert.ok(!again.some((e) => e.t === "dialogue"));
  assert.ok(again.some((e) => e.t === "message" && /NOT STIR/.test(e.text)));
  // Forcing every beat and segment again changes nothing.
  for (const s of script.segments) {
    for (const p of s.pages) for (const b of [p.beat, p.then]) if (b) dialogueBeat(w, pl, G, s.id, b);
    finishSegment(w, pl, G, s.id);
  }
  applyEffect(w, pl, { op: "npcGive", npc: G, item: "core", once: GUARDIAN_FLAGS.coreGiven });
  assert.equal(corePresent(w), 1, "exactly one core, ever");
  assert.ok(!events(w).some((e) => e.t === "eyeRepaired" || e.t === "itemGained"));
});

test("beats are validated against the script: no core before the guardian has spoken", () => {
  const w = newWorld(), pl = player(w);
  assert.equal(dialogueBeat(w, pl, G, "core", "giveCore"), false, "core segment not yet available");
  assert.equal(dialogueBeat(w, pl, G, "intro", "giveCore"), false, "beat not in that segment");
  assert.equal(dialogueBeat(w, pl, "npc.nobody", "intro", "wake"), false);
  assert.equal(corePresent(w), 0);
});

test("an interrupted dialogue resumes at the first unfinished segment", () => {
  const w = newWorld(3), pl = player(w);
  const script = scriptOf(w, G)!;
  const seg = (id: string) => script.segments.find((s) => s.id === id)!;
  // Esc during the intro: awake, but not yet met; the intro plays again.
  assert.equal(talkTo(w, pl, G)?.id, "intro");
  playSegment(w, pl, G, seg("intro"), 3);
  assert.ok(isAwake(w, G) && !hasFlag(w, GUARDIAN_FLAGS.met));
  assert.equal(talkTo(w, pl, G)?.id, "intro");
  playSegment(w, pl, G, seg("intro"));
  // Esc before the repair beat: no eye yet, the repair segment is next again.
  assert.equal(talkTo(w, pl, G)?.id, "repair");
  playSegment(w, pl, G, seg("repair"), 0);
  assert.ok(!hasFlag(w, FLAGS.golemEye));
  assert.equal(talkTo(w, pl, G)?.id, "repair");
  // Esc right after the repair beat: the eye is mended, so the core is next.
  playSegment(w, pl, G, seg("repair"), 1);
  assert.ok(hasFlag(w, FLAGS.golemEye));
  assert.equal(talkTo(w, pl, G)?.id, "core");
  // Esc right after the core is handed over: farewell is next; still one core.
  playSegment(w, pl, G, seg("core"), 1);
  assert.equal(countItem(pl, "core"), 1);
  assert.equal(talkTo(w, pl, G)?.id, "farewell");
  // Esc on the last farewell page (before its goDormant): it stays awake and the farewell replays.
  playSegment(w, pl, G, seg("farewell"), 2);
  assert.ok(isAwake(w, G));
  assert.equal(talkTo(w, pl, G)?.id, "farewell");
  playSegment(w, pl, G, seg("farewell"));
  assert.equal(talkTo(w, pl, G), null);
  assert.ok(!isAwake(w, G));
  assert.equal(corePresent(w), 1);
  assert.ok(hasFlag(w, FLAGS.golemEye));
});

test("a full pack: the core lands on the ground, clear of the guardian, and can be picked up", () => {
  const w = newWorld(5), pl = player(w);
  const fill: ItemId[] = ["chisel", "key", "glyph0", "glyph1", "glyph2", "glyph3", "crown", "goblet"];
  for (const id of fill) addItems(w, pl, id, 1);
  assert.equal(pl.inventory.filter(Boolean).length, capacity(w, pl));
  talkThrough(w, guardianIt(w));
  const ev = events(w);
  assert.ok(!ev.some((e) => e.t === "itemGained" && e.item === "core"));
  assert.ok(hasFlag(w, GUARDIAN_FLAGS.coreGiven));
  const a = currentArea(w);
  const core = a.loose.find((l) => !l.taken && l.item === "core")!;
  assert.ok(core, "core on the ground");
  const gb = actorBox(actorById(w, G)!)!;
  assert.ok(core.x < gb[0] - 3 || core.x > gb[2] + 3 || core.y < gb[1] - 3 || core.y > gb[3] + 3, "not under the guardian");
  assert.equal(corePresent(w), 1);
  // make room and pick it up
  pl.inventory[pl.inventory.findIndex((s) => s?.item === "crown")] = null;
  useOn(w, find(w, (i) => i.looseId === core.id));
  assert.equal(countItem(pl, "core"), 1);
  assert.equal(corePresent(w), 1);
});

// ------------------------------------------------------------------ treasury
const boxesOf = (w: World, withActors = true): Box[] => {
  const a = getArea(w, "dungeon");
  const b: Box[] = a.props.filter(propBlocks).map((p) => p.box!);
  return withActors ? [...b, ...actorBoxes(w, "dungeon", w.playerId)] : b;
};

test("the treasury chest is looted: open, empty, not a container", () => {
  const w = newWorld();
  const c = currentArea(w).prop("chest@57,4")!;
  assert.equal(c.open, true);
  assert.equal(c.item, undefined);
  assert.ok(!c.container);
  assert.ok(!interactables(currentArea(w)).some((i) => i.propId === "chest@57,4"));
  assert.ok(!currentArea(w).props.some((p) => p.item === "core"), "no prop holds the core");
  // a save diff does not record the builder's open state
  assert.equal(serialize(w).areas.dungeon.props["chest@57,4"], undefined);
});

test("the treasury and the guardian are reachable; the guardian blocks nothing", () => {
  const w = newWorld(), a = getArea(w, "dungeon");
  a.setTile(51, 5, T.FLOOR); // the door, once unlocked
  a.setTile(47, 10, T.FLOOR); a.setTile(47, 11, T.FLOOR); // the cracked wall, once broken
  const withG = reachable(a, boxesOf(w), a.base.start);
  const without = reachable(a, boxesOf(w, false), a.base.start);
  const g = actorById(w, G)!, gb = actorBox(g)!;
  // the doorway and the treasury floor in front of the guardian are reachable
  assert.equal(withG[5 * a.w + 51], 1, "doorway");
  assert.equal(withG[6 * a.w + 55], 1, "treasury floor");
  const it = guardianIt(w);
  assert.ok(nearReached(a, withG, it.x, it.y + it.r / 2, 0), "a spot to talk from");
  // every cell reachable without the guardian is still reachable, unless the golem would overlap its body
  for (let ty = 0; ty < a.h; ty++) for (let tx = 0; tx < a.w; tx++) {
    if (!without[ty * a.w + tx] || withG[ty * a.w + tx]) continue;
    const fx = tx * TS + 8, fy = ty * TS + 11;
    const overlaps = fx + 5 > gb[0] && fx - 5 < gb[2] && fy > gb[1] && fy - 5 < gb[3];
    assert.ok(overlaps, `guardian cuts off ${tx},${ty}`);
  }
  // the treasury's loose coin is still reachable
  const coin = a.looseItem("coin")!;
  assert.ok(nearReached(a, withG, coin.x, coin.y));
});

test("the golem cannot walk through the guardian", () => {
  const w = newWorld(), pl = player(w), g = actorById(w, G)!;
  currentArea(w).setTile(51, 5, T.FLOOR);
  pl.x = g.x; pl.y = g.y + 20; pl.facing = "up";
  frames(w, 240, { ix: 0, iy: -1, use: false });
  assert.ok(pl.y - 5 >= g.y - 0.01, `stopped at its body (golem feet ${pl.y.toFixed(1)}, guardian feet ${g.y})`);
  assert.ok(!boxFree(currentArea(w), g.x, g.y - 2, actorBoxes(w, "dungeon", pl.id)));
});

// ------------------------------------------------------------------ data lint
test("dialogue text fits the bitmap font, the line width and the page height", () => {
  const ok = (s: string, where: string) => {
    for (const ch of s) assert.ok(FONT_GLYPHS.has(ch), `${where}: glyph ${JSON.stringify(ch)} not in the font`);
  };
  for (const [sid, script] of Object.entries(DIALOGUE)) {
    ok(script.idle, `${sid}.idle`);
    assert.ok(script.idle.length <= 60, `${sid}.idle fits the note line`);
    const ids = new Set<string>();
    for (const seg of script.segments) {
      assert.ok(!ids.has(seg.id), `${sid}: duplicate segment ${seg.id}`); ids.add(seg.id);
      assert.ok(seg.pages.length > 0);
      seg.pages.forEach((p, i) => {
        const where = `${sid}.${seg.id}[${i}]`;
        assert.ok(p.lines.length >= 1 && p.lines.length <= DIALOGUE_PAGE_LINES, `${where}: ${p.lines.length} lines`);
        for (const l of p.lines) { assert.ok(l.length <= DIALOGUE_LINE_MAX, `${where}: "${l}" is ${l.length} chars`); ok(l, where); }
        if (p.speaker) ok(p.speaker, where);
        for (const b of [p.beat, p.then]) if (b) assert.ok(BEATS[b], `${where}: unknown beat ${b}`);
      });
    }
  }
  for (const [id, d] of Object.entries(NPCS)) { ok(d.name, id); assert.ok(DIALOGUE[d.dialogue], `${id}: script ${d.dialogue}`); }
});

// ------------------------------------------------------------------ saves
/** A v4 save of `w`, as the old build would have written it (no NPC actors or flags; the chest was a closed container). */
function asV4(w: World, chestOpened: boolean) {
  const s: any = JSON.parse(JSON.stringify(serialize(w)));
  s.version = 4;
  s.actors = s.actors.filter((a: any) => a.kind !== "npc");
  s.flags = s.flags.filter((f: string) => !f.startsWith("npc."));
  const props = { ...s.areas.dungeon.props };
  delete props["chest@57,4"];
  if (chestOpened) props["chest@57,4"] = { open: true, item: null };
  s.areas.dungeon.props = props;
  return s;
}

test("v4 -> v5: a save without the core gets a dormant guardian who still gives it", () => {
  assert.equal(SAVE_VERSION, 5);
  const w0 = newWorld(11), pl0 = player(w0);
  addItems(w0, pl0, "chisel", 1);
  pl0.x = 56 * TS; pl0.y = 7 * TS;
  const w = deserialize(asV4(w0, false)), pl = player(w);
  const g = actorById(w, G)!;
  assert.ok(g && g.kind === "npc" && g.npc === "guardian");
  assert.ok(!isAwake(w, G) && !hasFlag(w, GUARDIAN_FLAGS.coreGiven));
  assert.equal(getArea(w, "dungeon").prop("chest@57,4")!.open, true, "the chest is the empty one");
  assert.equal(corePresent(w), 0);
  assert.deepEqual(talkThrough(w, guardianIt(w)), ["intro", "repair", "core", "farewell"]);
  assert.equal(countItem(pl, "core"), 1);
  assert.equal(corePresent(w), 1);
});

test("v4 -> v5: a save whose core was taken or placed never gets a second one", () => {
  // taken: in the pack
  const a0 = newWorld(12); addItems(a0, player(a0), "core", 1);
  const a = deserialize(asV4(a0, true));
  assert.ok(hasFlag(a, GUARDIAN_FLAGS.coreGiven));
  assert.deepEqual(talkThrough(a, guardianIt(a)), ["intro", "repair", "farewell"], "the story still plays, minus the gift");
  assert.ok(hasFlag(a, FLAGS.golemEye));
  assert.equal(corePresent(a), 1);
  // placed: seated in the circle (the pack no longer has it)
  const b0 = newWorld(13); getArea(b0, "dungeon").ritual!.core = true;
  const b = deserialize(asV4(b0, true));
  assert.ok(hasFlag(b, GUARDIAN_FLAGS.coreGiven));
  talkThrough(b, guardianIt(b));
  assert.equal(corePresent(b), 1);
  // opened a moment before saving: the grant was still scheduled
  const c0 = newWorld(14);
  c0.scheduled.push({ at: c0.time + 0.2, actor: "golem", area: "dungeon", effect: { op: "grantItem", item: "core" } });
  const c = deserialize(asV4(c0, true));
  assert.ok(hasFlag(c, GUARDIAN_FLAGS.coreGiven));
  frames(c, 30);
  talkThrough(c, guardianIt(c));
  assert.equal(corePresent(c), 1);
});

test("save/load mid-encounter round-trips and resumes with no duplicate core", () => {
  const w = newWorld(21), pl = player(w);
  const script = scriptOf(w, G)!;
  playSegment(w, pl, G, script.segments[0]);
  playSegment(w, pl, G, script.segments[1]);
  playSegment(w, pl, G, script.segments[2], 1); // core handed over, then Esc
  const s = JSON.parse(JSON.stringify(serialize(w)));
  const w2 = deserialize(s);
  assert.deepEqual(serialize(w2), serialize(w));
  assert.ok(isAwake(w2, G) && hasFlag(w2, FLAGS.golemEye));
  assert.equal(talkTo(w2, player(w2), G)?.id, "farewell");
  talkThrough(w2, guardianIt(w2));
  assert.equal(corePresent(w2), 1);
  assert.ok(!isAwake(w2, G));
});

// ------------------------------------------------------------------ foundation
test("dormant is reversible: wake it again and a later data-only segment plays", () => {
  const w = newWorld(31), pl = player(w);
  talkThrough(w, guardianIt(w));
  assert.ok(!isAwake(w, G));
  const script = DIALOGUE.guardian;
  const repaired = npcFlag(G, "repaired");
  // a future post-repair chapter, added purely as data
  script.segments.push({
    id: "afterRepair", when: { flags: [repaired] }, done: npcFlag(G, "thanked"),
    pages: [{ beat: "wake", lines: ["I AM WHOLE AGAIN."] }],
  });
  try {
    assert.equal(talkTo(w, pl, G), null, "nothing to say yet");
    setFlag(w, repaired); // what the repair work will do later
    applyEffect(w, pl, { op: "npcAwake", npc: G, awake: true });
    assert.ok(isAwake(w, G));
    assert.equal(talkTo(w, pl, G)?.id, "afterRepair");
    assert.ok(events(w).some((e) => e.t === "dialogue" && e.segment === "afterRepair"));
    playSegment(w, pl, G, script.segments[script.segments.length - 1]);
    assert.ok(hasFlag(w, npcFlag(G, "thanked")));
    assert.equal(corePresent(w), 1);
  } finally {
    script.segments.pop();
  }
});

test("a second NPC is pure data: its own NpcDef row and script, talked to through the generic path", () => {
  NPCS.tester = { name: "TEST SUBJECT", type: "special", dialogue: "tester", art: "guardian", box: [10, 6], reach: 18, height: 20 };
  DIALOGUE.tester = {
    idle: "IT IGNORES YOU.",
    segments: [
      { id: "hello", done: "npc.tester.hello", pages: [{ beat: "wake", lines: ["HELLO."] }] },
      { id: "bye", when: { flags: ["npc.tester.hello"] }, done: "npc.tester.bye", pages: [{ then: "goDormant", lines: ["BYE."] }] },
    ],
  };
  try {
    const w = newWorld(41), pl = player(w);
    const t = makeNpc({ id: "npc.tester", npc: "tester", x: pl.x + 40, y: pl.y }, "dungeon");
    w.actors.push(t);
    const it = find(w, (i) => i.kind === "npc" && i.actorId === "npc.tester");
    assert.equal(it.npc, "tester");
    assert.deepEqual(talkThrough(w, it), ["hello", "bye"]);
    assert.ok(hasFlag(w, "npc.tester.hello") && hasFlag(w, "npc.tester.bye"));
    assert.ok(!isAwake(w, "npc.tester"));
    useOn(w, find(w, (i) => i.actorId === "npc.tester"));
    assert.ok(events(w).some((e) => e.t === "message" && e.text === "IT IGNORES YOU."));
    assert.equal(corePresent(w), 0, "the guardian's beats were never involved");
    assert.ok(!hasFlag(w, GUARDIAN_FLAGS.met));
  } finally {
    delete NPCS.tester; delete DIALOGUE.tester;
  }
});

test("guardian state lives under npc.guardian.*, never golem.*", () => {
  const w = newWorld(51);
  const before = new Set(w.flags);
  talkThrough(w, guardianIt(w));
  const added = [...w.flags].filter((f) => !before.has(f));
  assert.ok(added.length >= 3);
  for (const f of added) assert.ok(f.startsWith("npc.guardian.") || f === FLAGS.golemEye, f);
  assert.deepEqual(added.filter((f) => f.startsWith("golem.")), [FLAGS.golemEye], "only the player's own eye");
  // runtime state is a flag too (awake), and it is reversible
  applyEffect(w, player(w), { op: "npcAwake", npc: G, awake: true });
  assert.ok(w.flags.has("npc.guardian.awake"));
  applyEffect(w, player(w), { op: "npcAwake", npc: G, awake: false });
  assert.ok(!w.flags.has("npc.guardian.awake"));
});
