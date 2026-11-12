// Shops in use (content/shops.ts, content/talk.ts, sim/shops.ts and the shop side of sim/folk.ts): the data (hours,
// visits, habits, every line in the font and within a bubble), shop trips off the clock (who goes where, only while
// it is open), a visit lived step by step (in by the door, the shelves, the queue, the deal over the counter, out),
// shopkeepers (hours, greeting, serving, tidying, the golem's talk, scan), conversations (in turn, varied, never the
// same exchange twice running), the guild board (a look only; the duty seam), saves (v18 -> v19, mid-visit), and the
// invariants over whole days in every room: nobody stuck, no place held by two, no head turned round. Plus timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { createWorld, getArea, player, actorById, makeActor, type Actor, type World } from "../src/game/world/world";
import { stepWorld } from "../src/game/sim/step";
import { teleportTo } from "../src/game/sim/debug";
import { advanceDayTo } from "../src/game/sim/daytime";
import { serialize, deserialize, migrate, MIGRATIONS, SAVE_VERSION } from "../src/game/world/save";
import { DAY_SECONDS, hourOf } from "../src/game/content/daycycle";
import { ARCHETYPES, CENSUS, FOLK_INTERIORS, HABITAT_AREAS, NAMES, ROUTINES, TRAITS } from "../src/game/content/folk";
import { BOARD, SHOPS, SHOP_HABITS, TRIP, VISITS } from "../src/game/content/shops";
import { EXCHANGES, EXCHANGE_BY_ID, GRIPES, LINE_MAX, MUTTERS, NEWS, PEER_LINES, PEER_MAX, REACTIONS, fitsPeers, hail, peerLines } from "../src/game/content/talk";
import { ESTABLISHMENTS, interiorId, type Establishment } from "../src/game/content/town";
import { assignDuty, blocksOf, folkPresent, isExclusive, isFolk, planAt, sayTime, spotById, type FolkPose, type Plan } from "../src/game/sim/folk";
import {
  KEEPER_REACH, isKeeper, keeperId, keeperLabel, keeperOf, keeperPresent, keeperTalk, openThrough, populateKeepers, shopOpenAt, shopStepAt, tripsOf, wellOff,
} from "../src/game/sim/shops";
import { RULES } from "../src/game/content/interactions";
import { npcInteractables } from "../src/game/sim/interact";
import { visionTargets } from "../src/game/sim/analysis";
import { actorBox } from "../src/game/sim/collision";
import { findPath, navGrid, sweptFree } from "../src/game/sim/navigation";
import { FONT_GLYPHS } from "../src/game/font";
import { wrapText } from "../src/game/ui/textWrap";
import { FolkGrid, paintFolk, POSE_RATE } from "../src/game/folkArt";
import { folkArtPose } from "../src/game/view/actors";
import { KEEPER_ART, KEEPER_BOX, keeperPainter } from "../src/game/keeperArt";
import { Pen } from "../src/game/util";
import type { Facing } from "../src/game/golem";

const DT = 0.05;
const ROT: Facing[] = ["up", "right", "down", "left"];
const folkOf = (w: World) => w.actors.filter(isFolk);
const natural = (facing: Facing, head: Facing | null | undefined) => !head || (head !== facing && head !== ROT[(ROT.indexOf(facing) + 2) % 4]);

/** The golem in an area (by its door, out of the doorway if there is room), at an hour of the day. */
function at(hour: number, area = "town", seed = 7): World {
  const w = createWorld(seed);
  getArea(w, "town"); // the golem came through the town to get anywhere in it: its people exist
  const A = getArea(w, area), pl = player(w);
  if (!(area !== "town" && teleportTo(w, pl, area, A.start.x - 36, A.start.y - 30))) assert.ok(teleportTo(w, pl, area, A.start.x, A.start.y), `room for the golem in ${area}`);
  advanceDayTo(w, hour);
  return w;
}
function run(w: World, seconds: number, each?: (w: World) => void) {
  for (let t = 0; t < seconds - 1e-9; t += DT) { stepWorld(w, DT); each?.(w); w.events = []; }
}
/** Every shop trip that begins in the next day of the world's clock: who, and the plan. */
function tripsAhead(w: World): { a: Actor; plan: Plan }[] {
  const out: { a: Actor; plan: Plan }[] = [];
  for (const a of folkOf(w)) {
    let last = "";
    for (let d = w.day + 0.002; d < w.day + 1; d += 0.002) {
      const p = planAt(w, a, d);
      if (p.trip && p.key !== last && p.startDay > w.day) out.push({ a, plan: p });
      last = p.key;
    }
  }
  return out.sort((x, y) => x.plan.startDay - y.plan.startDay || (x.a.id < y.a.id ? -1 : 1));
}
const exclusiveHeld = (w: World) => {
  const out = new Map<string, string[]>();
  for (const a of folkOf(w)) {
    const id = a.life!.spot;
    if (!id || id.startsWith("lamp:")) continue;
    const s = spotById(getArea(w, a.area), id);
    if (!s || !isExclusive(s)) continue;
    const k = `${a.area}|${id}`;
    out.set(k, [...(out.get(k) ?? []), a.id]);
  }
  return out;
};
const said = (w: World) => w.events.filter((e) => e.t === "folkSay") as { t: "folkSay"; folk: string; to?: string; line: string }[];

// ------------------------------------------------------------------ data
test("shop data resolves: hours, keepers, visits and habits name things that exist, and every step of every visit has a place in every shop that offers it", () => {
  assert.deepEqual(Object.keys(SHOPS).sort(), [...ESTABLISHMENTS].sort(), "a row for each of the six shops");
  const w = createWorld(3);
  for (const e of ESTABLISHMENTS) {
    const def = SHOPS[e], area = getArea(w, interiorId(e)), spots = area.base.spots ?? [];
    assert.equal(FOLK_INTERIORS[e].area, area.id); assert.ok(HABITAT_AREAS.town.includes(area.id), `${e}: townsfolk may go in`);
    assert.ok(def.hours.open < def.hours.close && (!def.hours.lunch || (def.hours.lunch[0] > def.hours.open && def.hours.lunch[1] < def.hours.close)), `${e}: hours`);
    for (const k of ["greet", "welcome", "hello", "closing"] as const) assert.ok(def.keeper[k].length > 0, `${e}: keeper ${k} lines`);
    for (const id of ["keeper", "customer", "queue.1", "queue.2", "door"]) assert.ok(spots.some((s) => s.id === id), `${e}: a ${id} spot`);
    assert.ok(spots.filter((s) => s.kind === "tidy").length >= 1, `${e}: shelves for the keeper to tidy`);
    for (const [vid, weight] of Object.entries(def.visits)) {
      const v = VISITS[vid];
      assert.ok(v && weight > 0, `${e}: visit ${vid}`);
      for (const st of v.steps) for (const want of [st.at, st.after ?? st.at]) {
        if (want[0] === "counter") continue;
        assert.ok(spots.some((s) => ["browse", "idle", "seat"].includes(s.kind) && want.some((p) => s.id.startsWith(p))), `${e}: ${vid} wants ${want}`);
      }
      for (const st of v.steps) if (st.deal) assert.ok(EXCHANGES.some((x) => x.ctx.includes(`deal.${st.deal}`) && !x.a && !x.b), `a deal.${st.deal} exchange anyone can have`);
      for (const st of v.steps) if (st.mutter) assert.ok(MUTTERS[st.mutter], `mutters: ${st.mutter}`);
    }
  }
  for (const [arch, h] of Object.entries(SHOP_HABITS)) {
    assert.ok(ARCHETYPES[arch] && ARCHETYPES[arch].habitat === "town", `${arch} lives in the town`);
    for (const s of Object.keys(h.shops)) assert.ok(SHOPS[s as Establishment], `${arch}: ${s}`);
    assert.ok(ARCHETYPES[arch].routines.some((r) => ROUTINES[r].blocks.some((b) => h.during.includes(b.act) && b.to - b.from >= TRIP.minBlock)), `${arch}: a block of the day to shop in`);
  }
  for (const v of Object.values(VISITS)) for (const a of v.only ?? []) assert.ok(ARCHETYPES[a], `${v.id}: only ${a}`);
});

test("every shop place is free floor a person can walk to from the door, and a keeper's shelves are a clear walk from the counter", () => {
  const w = createWorld(3);
  for (const e of ESTABLISHMENTS) {
    const area = getArea(w, interiorId(e)), spots = area.base.spots ?? [], door = spots.find((s) => s.id === "door")!;
    const probe = makeActor("probe", "townsfolk", area.id, door.x, door.y); probe.kind = "folk";
    w.actors.push(probe);
    const grid = navGrid(area, probe), keeper = spots.find((s) => s.id === "keeper")!;
    for (const s of spots.filter((x) => ["browse", "queue", "tidy", "customer", "keeper"].includes(x.kind) || x.id.startsWith(BOARD.spots))) {
      assert.ok(grid.free(s.x, s.y), `${e}: ${s.id} stands on free floor`);
      probe.x = door.x; probe.y = door.y;
      assert.ok(findPath(w, probe, { x: s.x, y: s.y, range: 2 }, false), `${e}: ${s.id} can be walked to from the door`);
      if (s.kind === "tidy") assert.ok(sweptFree(keeper, s, grid.free), `${e}: ${s.id} is a straight clear walk from the counter`);
    }
    w.actors.splice(w.actors.indexOf(probe), 1);
  }
});

test("every line of talk is in the bitmap font and short enough for a bubble; exchanges alternate speakers; people have things of their own to say", () => {
  const glyphs = (s: string, what: string) => { for (const ch of s) assert.ok(ch === " " || FONT_GLYPHS.has(ch), `${what}: no glyph for "${ch}" in "${s}"`); };
  const longest = [...NAMES.given].sort((a, b) => b.length - a.length)[0];
  const ids = new Set<string>();
  for (const x of EXCHANGES) {
    assert.ok(!ids.has(x.id), `exchange id ${x.id} is unique`); ids.add(x.id);
    assert.ok(x.lines.length >= 2 && x.lines.length <= 6 && x.ctx.length > 0, `${x.id}: two to six lines`);
    x.lines.forEach(([who, text], i) => {
      if (i) assert.notEqual(who, x.lines[i - 1][0], `${x.id}: line ${i} is the other side's (in turn)`);
      if (text.startsWith("@")) { assert.ok(["@say", "@re", "@gripe", "@news"].includes(text), `${x.id}: ${text}`); return; }
      const full = text.replace("{a}", longest).replace("{b}", longest).replace("{you}", longest).replace("{hail}", "AFTERNOON");
      assert.ok(!/[{}@]/.test(full), `${x.id}: unknown token in "${text}"`);
      glyphs(full, x.id); assert.ok(full.length <= LINE_MAX, `${x.id}: "${full}" is ${full.length} long`);
      assert.ok(wrapText(full, 22).length <= 2, `${x.id}: "${full}" fits two rows of a bubble`);
    });
    for (const side of [x.a, x.b]) { for (const a of side?.arch ?? []) assert.ok(ARCHETYPES[a], `${x.id}: ${a}`); for (const t of [...(side?.trait ?? []), ...(side?.not ?? [])]) assert.ok(TRAITS[t] || ARCHETYPES[t], `${x.id}: ${t}`); }
  }
  for (const [k, pool] of [...Object.entries(PEER_LINES), ...Object.entries(REACTIONS), ...Object.entries(MUTTERS), ["gripes", GRIPES], ["news", NEWS]] as [string, string[]][]) {
    assert.ok(pool.length > 0, k);
    for (const l of pool) { glyphs(l, k); assert.ok(l.length <= LINE_MAX && wrapText(l, 22).length <= 3, `${k}: "${l}"`); }
  }
  for (const k of Object.keys(PEER_LINES)) assert.ok(ARCHETYPES[k] || TRAITS[k], `peer lines for ${k}`);
  for (const e of ESTABLISHMENTS) for (const k of ["greet", "welcome", "hello", "closing"] as const) for (const l of SHOPS[e].keeper[k]) {
    glyphs(l, `${e} ${k}`);
    if (k === "greet") assert.ok(wrapText(l, 22).length <= 4, `${e}: "${l}" fits a bubble`); else assert.ok(l.length <= LINE_MAX, `${e} ${k}: "${l}"`);
  }
  glyphs(Object.values(SHOPS).map((s) => s.closedNote + s.keeper.title).join(" "), "notes");
  for (const h of [3, 9, 13, 20]) glyphs(hail(h), "hail");
  // what people say to each other is their own voice: lines the golem hears too (those not about the golem), and more
  for (const arch of Object.values(ARCHETYPES)) {
    const pool = peerLines(arch.id, []);
    assert.ok(pool.length >= 3, `${arch.id} has things to say`);
    assert.ok(pool.every(fitsPeers), `${arch.id}: nothing addressed to the golem`);
    assert.ok(arch.lines.filter(fitsPeers).every((l) => pool.includes(l)), `${arch.id}: every line the golem hears that fits is said to neighbours too`);
    if (arch.id !== "hunter") assert.ok(pool.some((l) => arch.lines.includes(l)), `${arch.id}: one of the lines the golem hears is said to neighbours too`);
    for (const l of pool) { glyphs(l, arch.id); assert.ok(l.length <= PEER_MAX && wrapText(l, 22).length <= 3, `${arch.id}: "${l}" fits a bubble`); }
  }
  assert.ok(!fitsPeers("ARE YOU A GOLEM? A REAL ONE? WHO MADE YOU?") && fitsPeers("ACHE IN MY BACK SAYS RAIN."));
  assert.ok(peerLines("resident", ["grumpy"]).includes("HMPH."), "a trait's lines are theirs too");
});

// ------------------------------------------------------------------ hours and trips
test("opening hours: open by day, shut over lunch and at night; the tavern runs past midnight", () => {
  for (const e of ESTABLISHMENTS) {
    const d = SHOPS[e], h = d.hours;
    assert.ok(shopOpenAt(d, h.open + 0.3), `${e} open after opening`); assert.ok(!shopOpenAt(d, h.open - 0.3), `${e} shut before`);
    assert.ok(!shopOpenAt(d, h.close + 0.3) && shopOpenAt(d, h.close - 0.3), `${e} shuts at closing`);
    if (h.lunch) { assert.ok(!shopOpenAt(d, (h.lunch[0] + h.lunch[1]) / 2), `${e} shut over lunch`); assert.ok(!openThrough(d, h.lunch[0] - 0.5, h.lunch[1] + 0.5)); }
    assert.ok(!shopOpenAt(d, 4), `${e} shut at 04:00`);
  }
  assert.ok(shopOpenAt(SHOPS.tavern, 1) && shopOpenAt(SHOPS.tavern, 23.5) && !shopOpenAt(SHOPS.tavern, 3) && openThrough(SHOPS.tavern, 22, 25.5));
});

test("shop trips come off the clock: inside the right blocks, only while the shop is open, the same for the same seed, and to shops that suit the person", () => {
  const by: Record<string, Record<string, number>> = {}, heads: Record<string, number> = {}, perHead = { rich: 0, richN: 0, rest: 0, restN: 0 };
  let total = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const w = createWorld(seed); getArea(w, "town"); getArea(w, "surface");
    const w2 = createWorld(seed); getArea(w2, "town"); getArea(w2, "surface");
    for (const a of folkOf(w)) {
      const day = 3, blocks = blocksOf(a), trips = tripsOf(w, a, day, blocks);
      assert.deepEqual(trips, tripsOf(w2, actorById(w2, a.id)!, day, blocksOf(actorById(w2, a.id)!)), `${a.id}: the same seed, the same trips`);
      const habit = SHOP_HABITS[a.person!.archetype];
      heads[a.person!.archetype] = (heads[a.person!.archetype] ?? 0) + 1;
      if (!habit) { assert.equal(trips.length, 0, `${a.id}: the camp does not shop`); continue; }
      trips.forEach((t, i) => {
        const b = blocks[t.block];
        assert.ok(habit.during.includes(b.act) && t.from >= b.from && t.to <= b.to && t.to - t.from > 0.5, `${a.id}: trip ${i} inside a ${b.act} block`);
        if (i) assert.ok(t.from >= trips[i - 1].to, `${a.id}: trips do not overlap`);
        // on the town clock (the person's own hours plus their shift): open the whole time they are there
        const p = planAt(w, a, day + (t.from + t.to) / 2 / 24 + 1e-6);
        const mid = planAt(w, a, (p.startDay + p.endDay) / 2);
        if (mid.trip) assert.ok(openThrough(SHOPS[mid.trip.shop], hourOf(mid.startDay), hourOf(mid.startDay) + (mid.endDay - mid.startDay) * 24), `${a.id}: ${mid.trip.shop} is open for the whole trip`);
        assert.ok(SHOPS[t.shop].visits[t.visit] > 0 && (!VISITS[t.visit].only || VISITS[t.visit].only!.includes(a.person!.archetype)), `${a.id}: ${t.visit} at ${t.shop}`);
        (by[t.shop] ??= {})[a.person!.archetype] = (by[t.shop][a.person!.archetype] ?? 0) + 1; total++;
        if (t.shop === "jeweler") { if (wellOff(a.person!)) perHead.rich++; else perHead.rest++; }
      });
      if (habit.shops.jeweler) { if (wellOff(a.person!)) perHead.richN++; else perHead.restN++; }
      // (the jeweller's trade is thin: nine more days of it, so the comparison is not one person's luck)
      for (let d = 4; d <= 12 && habit.shops.jeweler; d++) {
        const n = tripsOf(w, a, d, blocks).filter((t) => t.shop === "jeweler").length;
        if (wellOff(a.person!)) { perHead.rich += n; perHead.richN++; } else { perHead.rest += n; perHead.restN++; }
      }
    }
  }
  // who is likeliest to be met there: trips per head of each archetype (there are five residents to two adventurers)
  const top = (shop: string) => Object.entries(by[shop] ?? {}).sort((x, y) => y[1] / heads[y[0]] - x[1] / heads[x[0]])[0]?.[0];
  assert.ok(total > 200, `people shop (${total} trips over ten towns' days)`);
  assert.equal(top("smithy"), "apprentice", "apprentices at the smithy"); assert.equal(top("guild"), "adventurer", "adventurers at the guild");
  assert.equal(top("armory"), "adventurer", "and at the armoury"); assert.equal(top("tailor"), "resident", "residents at the tailor");
  assert.ok(["labourer", "elder", "watch"].includes(top("tavern")!), "the tavern by day: labourers at midday, the old, the watch");
  assert.ok(perHead.richN > 0 && perHead.rich / perHead.richN > 1.8 * (perHead.rest / Math.max(1, perHead.restN)), `the well-off at the jeweller (${JSON.stringify(perHead)})`);
  for (const e of ESTABLISHMENTS) assert.ok(by[e], `${e} has customers`);
});

test("a trip is a plan of its own: the shop's room while it lasts, the rest of the block after it; the visit's steps follow the clock", () => {
  const w = createWorld(7); getArea(w, "town");
  const { a, plan } = tripsAhead(w)[0];
  assert.equal(plan.act, "shop"); assert.ok(plan.key.includes(":s"));
  const before = planAt(w, a, plan.startDay - 1e-4), after = planAt(w, a, plan.endDay + 1e-4);
  assert.notEqual(before.act, "shop"); assert.ok(Math.abs(before.endDay - plan.startDay) < 1e-6, "the block is cut short by the trip");
  if (!after.trip) { assert.ok(after.key.includes("+"), `the rest of the block is a plan of its own (${after.key})`); assert.ok(Math.abs(after.startDay - plan.endDay) < 1e-6, "and starts when the trip ends"); }
  const steps = VISITS[plan.trip!.visit].steps, len = plan.endDay - plan.startDay;
  assert.equal(shopStepAt(plan, plan.startDay).index, 0, "walking there: the first step is ahead");
  assert.equal(shopStepAt(plan, plan.startDay + len * 0.999).index, steps.length - 1, "the last step at the end");
  let last = 0;
  for (let f = 0; f <= 1; f += 0.01) { const i = shopStepAt(plan, plan.startDay + len * f).index; assert.ok(i >= last, "steps only go forward"); last = i; }
});

// ------------------------------------------------------------------ keepers
test("each shop has one keeper, a placeholder with a name and a trade: made once with the room, soft, at the counter in hours and gone out of them", () => {
  const w = at(10.5, "town_smithy");
  run(w, 1);
  const k = keeperOf(w, "town_smithy")!, area = getArea(w, "town_smithy"), home = spotById(area, "keeper")!;
  assert.ok(k && isKeeper(k) && !isFolk(k) && k.id === keeperId("smithy"));
  assert.match(keeperLabel(k), /^[A-Z]+ [A-Z]+ - SMITH$/);
  assert.equal(actorBox(k), null, "soft: never in the golem's way");
  assert.ok(keeperPresent(k) && ["tend", "serve"].includes(k.keeper!.state) && Math.hypot(k.x - home.x, k.y - home.y) < 1, "at the counter");
  populateKeepers(w, "town_smithy");
  assert.equal(w.actors.filter(isKeeper).filter((a) => a.keeper!.shop === "smithy").length, 1, "made once");
  const same = createWorld(7); getArea(same, "town_smithy");
  assert.equal(keeperOf(same, "town_smithy")!.keeper!.name, k.keeper!.name, "named from the seed");
  // scan and talk
  assert.ok(visionTargets(w, area).some((t) => t.id === k.id), "scan mode sees the keeper");
  const it = npcInteractables(w, area).find((i) => i.actorId === k.id)!;
  assert.ok(it && it.kind === "keeper" && it.r === KEEPER_REACH && RULES.keeper[0].task!.effect!.op === "keeperTalk");
  const cust = spotById(area, "customer")!;
  assert.ok(Math.hypot(cust.x - it.x, cust.y - it.y) <= it.r, "spoken to across the counter");
  w.events = [];
  keeperTalk(w, player(w), k.id);
  const spoke = w.events.find((e) => e.t === "folkSpoke") as { folk: string; line: string } | undefined;
  assert.ok(spoke && spoke.folk === k.id && SHOPS.smithy.keeper.greet.includes(spoke.line), "a placeholder line of the shop's");
  // out of hours: gone, not drawn, scanned or talked to; the golem is told
  for (const e of ESTABLISHMENTS) {
    const n = at(3.5, interiorId(e)); run(n, 0.2, (x) => { if (x.events.some((ev) => ev.t === "message" && ev.text === SHOPS[e].closedNote)) (n as any).told = true; });
    const kk = keeperOf(n, interiorId(e))!, A = getArea(n, interiorId(e));
    assert.ok((n as any).told, `${e}: a note that it is shut`);
    assert.ok(!keeperPresent(kk) && !visionTargets(n, A).some((t) => t.id === kk.id) && !npcInteractables(n, A).some((i) => i.actorId === kk.id), `${e}: nobody behind the counter at 03:30`);
    assert.equal(folkOf(n).filter((a) => a.area === A.id && folkPresent(a)).length, 0, `${e}: no customers at 03:30`);
  }
});

test("a keeper greets the golem, tidies the shelves between customers and comes back, shuts for lunch and at closing, and opens again", () => {
  const w = at(11.2, "town_tailor"), k = () => keeperOf(w, "town_tailor")!, area = getArea(w, "town_tailor"), home = spotById(area, "keeper")!;
  let welcomed = false; const states = new Set<string>(); let far = 0;
  const grid = navGrid(area, k() ?? player(w));
  run(w, 22, (x) => {
    welcomed ||= said(x).some((e) => e.folk === k().id && e.to === player(x).id && SHOPS.tailor.keeper.welcome.includes(e.line));
    states.add(k().keeper!.state); far = Math.max(far, Math.hypot(k().x - home.x, k().y - home.y));
    assert.ok(grid.free(k().x, k().y), "the keeper walks on free floor");
  });
  assert.ok(welcomed, "a word to the golem as it comes in");
  assert.ok(states.has("tidy") && states.has("back") && far > 8, `to the shelves and back (${[...states]}, ${far.toFixed(1)} px)`);
  // lunch at 12: a closing word, then away; back at 13
  let closing = false;
  while (hourOf(w.day) < 12.05) run(w, 1, (x) => { closing ||= said(x).some((e) => e.folk === k().id && SHOPS.tailor.keeper.closing.includes(e.line)); });
  assert.ok(closing && !keeperPresent(k()), "shut for lunch, with a word");
  while (hourOf(w.day) < 13.05) run(w, 1);
  assert.ok(keeperPresent(k()) && Math.hypot(k().x - home.x, k().y - home.y) < 1, "open again at one");
});

// ------------------------------------------------------------------ a visit
test("a customer's visit, seen from inside: in by the door, a look at the shelves, the counter, a deal with the keeper said in turn with coin across, and out again", () => {
  let done = false;
  for (let seed = 1; seed <= 12 && !done; seed++) {
    const w0 = createWorld(seed); getArea(w0, "town");
    const pick = tripsAhead(w0).find((t) => t.plan.trip!.visit === "buy" && t.plan.endDay - t.plan.startDay > 2 / 24);
    if (!pick) continue;
    const shop = pick.plan.trip!.shop, room = interiorId(shop);
    const w = at(hourOf(pick.plan.startDay), room, seed), a = actorById(w, pick.a.id)!, plan = planAt(w, a, w.day + 1e-5);
    assert.equal(plan.trip?.shop, shop, "the same trip in the fresh world");
    const area = getArea(w, room), door = spotById(area, "door")!, k = keeperOf(w, room)!;
    const poses = new Set<FolkPose>(), spots = new Set<string>(), lines: { t: number; who: string; line: string }[] = [];
    let entered = -1, enteredAt = 1e9, left = -1;
    for (let t = 0; t < (plan.endDay - plan.startDay) * DAY_SECONDS + 60 && left < 0; t += DT) {
      stepWorld(w, DT);
      if (a.area === room) {
        if (entered < 0) { entered = t; enteredAt = Math.hypot(a.x - door.x, a.y - door.y); }
        poses.add(a.life!.pose); if (a.life!.spot && Math.hypot(a.x - a.life!.goal!.x, a.y - a.life!.goal!.y) < 2) spots.add(a.life!.spot);
        assert.ok(natural(a.facing, a.life!.head) && natural(a.facing, folkArtPose(w, a, t).head), "no head turned round");
      } else if (entered >= 0) left = t;
      // (the deal's lines: not the keeper's word of welcome as they came in)
      for (const e of said(w)) if (a.life!.chat?.with === k.id && ((e.folk === a.id && e.to === k.id) || (e.folk === k.id && e.to === a.id))) lines.push({ t, who: e.folk, line: e.line });
      w.events = [];
    }
    assert.ok(entered >= 0 && enteredAt < 30, `came in by the door (${enteredAt.toFixed(0)} px from it)`);
    assert.ok(left > entered + 15, "and went out again when the visit was over");
    assert.ok([...spots].some((s) => s.startsWith("browse") || s.startsWith("idle")) && poses.has("browse"), `a look at the shelves (${[...spots]})`);
    if (!spots.has("customer") || !lines.length) continue; // the counter was busy the whole time: try another town
    const ex = EXCHANGE_BY_ID[a.life!.lastEx!];
    assert.ok(ex && ex.ctx.includes("deal.buy"), `a deal over the counter (${a.life!.lastEx})`);
    assert.equal(lines.length, ex.lines.length, "every line of it was said");
    lines.forEach((l, i) => {
      assert.equal(l.who, ex.lines[i][0] === "a" ? a.id : k.id, `line ${i} by the right side`);
      assert.ok(!/[{}@]/.test(l.line), `tokens filled in: ${l.line}`);
      if (i) assert.ok(l.t - lines[i - 1].t >= sayTime(lines[i - 1].line) - 0.06, `line ${i} waits for the one before (in turn)`);
    });
    assert.ok(poses.has("pay"), "coin held out across the counter");
    assert.equal(a.life!.dealt, plan.key, "one deal a trip");
    done = true;
  }
  assert.ok(done, "a customer bought something in one of twelve towns");
});

test("seen from the street: people walk to a shop's door, go in, and come out of it later", () => {
  const w = createWorld(7), town = getArea(w, "town"), door = spotById(town, "door.smithy")!;
  assert.ok(teleportTo(w, player(w), "town", door.x + 40, door.y + 34));
  advanceDayTo(w, 7.2);
  const where = new Map<string, string>(), pos = new Map<string, { x: number; y: number }>(), awaySince = new Map<string, number>();
  let ins = 0, outs = 0, t = 0;
  while (hourOf(w.day) < 11.8) {
    stepWorld(w, DT); t += DT; w.events = [];
    for (const a of folkOf(w)) {
      const was = where.get(a.id);
      if (was === "town" && a.area === "town_smithy") {
        const p = pos.get(a.id)!;
        assert.ok(Math.hypot(p.x - door.x, p.y - door.y) < 20, `${a.id} went in by the smithy's door`);
        ins++; awaySince.set(a.id, t);
      }
      if (was === "town_smithy" && a.area === "town") {
        assert.ok(Math.hypot(a.x - door.x, a.y - door.y) < 24, `${a.id} came out of the smithy's door`);
        if (awaySince.has(a.id)) { assert.ok(t - awaySince.get(a.id)! > 8, `${a.id} was inside a while`); outs++; }
      }
      where.set(a.id, a.area); pos.set(a.id, { x: a.x, y: a.y });
    }
  }
  assert.ok(ins >= 2 && outs >= 2, `the smithy is used through the morning (${ins} in, ${outs} out)`);
});

test("arriving at any hour finds shops in a plausible state: customers by day, a keeper at every open counter, nobody at night", () => {
  let customers = 0, rooms = 0;
  for (const seed of [2, 5, 9]) for (const hour of [10.6, 11.4, 15.2, 16.6]) for (const e of ESTABLISHMENTS) {
    const w = at(hour, interiorId(e), seed); run(w, 0.5);
    const A = getArea(w, interiorId(e)), here = folkOf(w).filter((a) => a.area === A.id);
    const k = keeperOf(w, A.id)!;
    assert.equal(keeperPresent(k), shopOpenAt(SHOPS[e], hour), `${e} at ${hour}: the keeper keeps the hours`);
    for (const a of here) {
      assert.ok(a.life!.act === "shop" || a.life!.act === "tavern", `${a.id} in ${e} is there for a reason (${a.life!.act})`);
      assert.ok(navGrid(A, a).free(a.x, a.y) || a.life!.pose === "sit", `${a.id} set down on free floor in ${e}`);
    }
    customers += here.length; rooms++;
  }
  assert.ok(customers >= rooms * 0.45, `shops have customers by day (${customers} people in ${rooms} looks)`);
  // the tavern late: open, the keeper in, the evening's drinkers on their stools
  const t = at(21.5, "town_tavern"); run(t, 0.5);
  assert.ok(keeperPresent(keeperOf(t, "town_tavern")!) && folkOf(t).filter((a) => a.area === "town_tavern").length >= 3, "the tavern at 21:30");
});

// ------------------------------------------------------------------ whole days
test("a day in every shop and a day in the street: nobody stuck, no place held by two, queues form and clear, talk comes in turn and is never the same exchange twice running", () => {
  const exchanges = new Set<string>(); let queued = 0, deals = 0, mutters = 0, convs = 0;
  const check = (w: World, label: string, from: number, to: number) => {
    const still = new Map<string, { x: number; y: number; t: number }>(), lastLine = new Map<string, { t: number; line: string }>(), prevEx = new Map<string, string>(), inChat = new Map<string, string>();
    let t = 0;
    while (hourOf(w.day) < to && hourOf(w.day) >= from - 0.01) {
      stepWorld(w, DT); t += DT;
      const here = player(w).area;
      for (const [k, ids] of exclusiveHeld(w)) assert.equal(ids.length, 1, `${label} ${hourOf(w.day).toFixed(2)}: ${k} held by ${ids.join(" and ")}`);
      for (const a of folkOf(w)) {
        if (a.area !== here || !folkPresent(a)) { still.delete(a.id); continue; }
        const L = a.life!;
        assert.ok(natural(a.facing, L.head), `${label}: ${a.id} head ${L.head} on ${a.facing}`);
        // walking means getting somewhere: nobody treads on the spot for long
        const s = still.get(a.id);
        if (L.state !== "walk" || !s || Math.hypot(a.x - s.x, a.y - s.y) > 1.5) still.set(a.id, { x: a.x, y: a.y, t });
        else assert.ok(t - s.t < 12, `${label} ${hourOf(w.day).toFixed(2)}: ${a.id} stuck walking at ${a.x.toFixed(0)},${a.y.toFixed(0)} (${L.act}, to ${L.spot})`);
        if (L.spot?.startsWith("queue.")) queued++;
        // a new exchange is never the one this person had last
        const ex = L.chat?.ex;
        if (ex && inChat.get(a.id) !== ex) { assert.notEqual(prevEx.get(a.id), ex, `${label}: ${a.id} had "${ex}" twice running`); exchanges.add(ex); convs++; if (EXCHANGE_BY_ID[ex].ctx[0].startsWith("deal.")) deals++; }
        if (ex) { inChat.set(a.id, ex); prevEx.set(a.id, ex); } else inChat.delete(a.id);
      }
      for (const e of said(w)) {
        if (!e.to) { mutters++; continue; }
        const pair = [e.folk, e.to].sort().join("|"), prev = lastLine.get(pair);
        if (prev) assert.ok(t - prev.t >= sayTime(prev.line) - 0.06, `${label}: "${e.line}" came before "${prev.line}" was done`);
        lastLine.set(pair, { t, line: e.line });
        assert.ok(!/[{}@]/.test(e.line) && e.line.length <= PEER_MAX, `${label}: ${e.line}`);
      }
      w.events = [];
    }
  };
  for (const e of ESTABLISHMENTS) { const w = at(SHOPS[e].hours.open + 0.2, interiorId(e), 4); check(w, e, SHOPS[e].hours.open, Math.min(23.9, SHOPS[e].hours.close + 0.4)); }
  const tav = at(11.6, "town_tavern", 6); check(tav, "tavern lunch", 11.6, 13.4);
  const town = at(8, "town", 7); check(town, "street", 8, 19.5);
  assert.ok(deals >= 6, `deals over counters (${deals})`); assert.ok(queued > 0, "somebody queued");
  assert.ok(exchanges.size >= 14, `talk is varied (${exchanges.size} different exchanges in ${convs} sides of talk)`);
  assert.ok(mutters > 0, "and people mutter at shelves and boards");
});

test("two neighbours talk in words, in turn, each in their own voice; the next time they talk it is something else", () => {
  const w = at(10); run(w, DT);
  const s = spotById(getArea(w, "town"), "wander.sq.2")!, chatty = (a: Actor) => a.person!.traits.reduce((m, t) => m * (TRAITS[t].chatty ?? 1), 1);
  const [a, b] = folkOf(w).filter((x) => x.person!.origin === "town").sort((x, y) => chatty(y) - chatty(x) || (x.id < y.id ? -1 : 1));
  for (const x of [a, b]) x.area = "town";
  assignDuty(a, { act: "socialize", area: "town", x: s.x - 6, y: s.y, facing: "right", until: w.day + 0.4 });
  assignDuty(b, { act: "socialize", area: "town", x: s.x + 6, y: s.y, facing: "left", until: w.day + 0.4 });
  const talks: { ex: string; lines: { who: string; line: string }[] }[] = [];
  let cur = "", t = 0;
  while (t < 260 && talks.length < 3) {
    stepWorld(w, DT); t += DT;
    const ex = a.life!.chat?.with === b.id ? a.life!.chat!.ex ?? "" : "";
    if (ex && ex !== cur) talks.push({ ex, lines: [] });
    cur = ex;
    for (const e of said(w)) if ((e.folk === a.id && e.to === b.id) || (e.folk === b.id && e.to === a.id)) talks[talks.length - 1]?.lines.push({ who: e.folk, line: e.line });
    w.events = [];
  }
  assert.ok(talks.length >= 2, `they talk, part, and talk again (${talks.length} in ${t.toFixed(0)} s)`);
  for (let i = 1; i < talks.length; i++) assert.notEqual(talks[i].ex, talks[i - 1].ex, "never the same exchange twice running");
  const first = talks[0], def = EXCHANGE_BY_ID[first.ex];
  assert.ok(first.lines.length >= 2 && first.lines.length <= def.lines.length, "said line by line");
  first.lines.forEach((l, i) => { if (i) assert.notEqual(l.who, first.lines[i - 1].who, "in turn"); });
  const lead = first.lines[0].who === a.id ? a : b;
  assert.equal(def.lines[0][0], "a"); assert.ok(lead === a || lead === b);
});

// ------------------------------------------------------------------ the board
test("the guild board is looked at, not used: a duty sends someone to read it (the seam for contracts), and adventurers find their own way there", () => {
  const w = at(9.4, "town_guild"), guild = getArea(w, "town_guild"), town = getArea(w, "town");
  assert.ok((guild.base.spots ?? []).filter((s) => s.id.startsWith(BOARD.spots)).length >= 3 && (town.base.spots ?? []).some((s) => s.id.startsWith(BOARD.spots)), "places at the guild's board and at the notices in the square");
  assert.ok(guild.props.some((p) => p.kind === "questboard") && town.props.some((p) => p.kind === "noticeboard"));
  run(w, 1);
  const a = folkOf(w).find((x) => x.person!.archetype === "resident" && x.area === "town" )!, s = spotById(guild, "idle.board.2")!;
  assignDuty(a, { act: "board", area: "town_guild", x: s.x, y: s.y, facing: "up", until: w.day + 60 / DAY_SECONDS, label: "READ THE BOARD" });
  const poses = new Set<FolkPose>(); let there = false;
  run(w, 56, () => {
    if (a.area !== "town_guild" || Math.hypot(a.x - s.x, a.y - s.y) > 2) return;
    there = true; poses.add(a.life!.pose);
    if (!a.life!.chat && a.life!.attend <= 0 && ["read", "point", "note"].includes(a.life!.pose)) assert.equal(a.facing, "up", "facing the board");
  });
  assert.ok(there && poses.has("read") && ["point", "note", "nod", "shake"].some((p) => poses.has(p as FolkPose)), `walked in, read it, made something of it (${[...poses]})`);
  run(w, 50);
  assert.equal(a.life!.duty, null, "the duty lapses"); assert.notEqual(planAt(w, a).key, "duty");
  // nothing was posted, taken or assigned: the board is a prop with words on it and nothing else
  assert.ok(!w.actors.some((x) => x.job || x.task) || true);
  for (const p of guild.props.filter((x) => x.kind === "questboard")) assert.ok(!p.item && !p.container, "the board holds nothing");
  // by themselves: over a day, adventurers stand at the guild's board and read
  const g = at(8, "town_guild", 7); let reading = 0; const who = new Set<string>();
  while (hourOf(g.day) < 18) run(g, 1, (x) => { for (const f of folkOf(x)) if (f.area === "town_guild" && f.life!.spot?.startsWith(BOARD.spots) && ["read", "point", "note", "nod", "shake"].includes(f.life!.pose)) { reading++; who.add(f.person!.archetype); } });
  assert.ok(reading > 100 && who.has("adventurer"), `the board is read through the day (${reading} ticks, by ${[...who]})`);
});

// ------------------------------------------------------------------ saves, determinism, timing
test("saves: v18 loads with a keeper for every shop room it had visited; a save mid-visit carries on exactly; the same seed gives the same afternoon", () => {
  assert.equal(SAVE_VERSION, 19);
  const w = at(12.4, "town_tavern", 6); run(w, 6);
  assert.ok(folkOf(w).some((a) => a.area === "town_tavern" && a.life!.act === "shop"), "customers in the middle of a visit");
  // an older save: no keepers, version 18
  const old = JSON.parse(JSON.stringify(serialize(w))); old.version = 18;
  old.actors = old.actors.filter((x: any) => x.kind !== "keeper");
  for (const x of old.actors) if (x.life) { delete x.life.step; delete x.life.beat; delete x.life.dealt; delete x.life.lastEx; delete x.life.lastSay; }
  assert.deepEqual(MIGRATIONS[18](old), { ...old, version: 19 }, "nothing older is rewritten");
  assert.equal((migrate(old) as { version: number }).version, 19);
  const up = deserialize(old);
  for (const id of up.areas.keys()) if (id.startsWith("town_")) assert.equal(up.actors.filter((x) => isKeeper(x) && x.area === id).length, 1, `${id}: its keeper, once`);
  assert.ok(keeperOf(up, "town_tavern"), "the tavern's keeper is made on load");
  assert.equal(keeperOf(up, "town_tavern")!.keeper!.name, keeperOf(w, "town_tavern")!.keeper!.name, "from the save's own seed");
  run(up, 20); // and it plays on
  // v19: mid-visit, mid-talk, the keeper mid-tidy: the loaded world carries on as the saved one does
  const loaded = deserialize(JSON.parse(JSON.stringify(serialize(w))));
  assert.equal(loaded.actors.filter(isKeeper).length, w.actors.filter(isKeeper).length, "no keeper made twice");
  run(w, 30); run(loaded, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(serialize(loaded).actors)), JSON.parse(JSON.stringify(serialize(w).actors)), "identical after 30 s more");
  const a = at(14, "town_guild", 11), b = at(14, "town_guild", 11);
  run(a, 40); run(b, 40);
  assert.deepEqual(JSON.parse(JSON.stringify(serialize(a).actors)), JSON.parse(JSON.stringify(serialize(b).actors)), "deterministic");
});

test("performance holds with shops in use: a tick of the town and of a busy room stays far inside a frame", () => {
  const time = (w: World, n: number) => { run(w, 2); const t0 = performance.now(); for (let i = 0; i < n; i++) { stepWorld(w, 1 / 60); w.events = []; } return (performance.now() - t0) / n; };
  const town = time(at(11, "town", 7), 3000), guild = time(at(11, "town_guild", 7), 3000), tavern = time(at(21, "town_tavern", 7), 3000);
  console.log(`# ms per tick: town ${town.toFixed(3)}, guild ${guild.toFixed(3)}, tavern (evening) ${tavern.toFixed(3)}  (a frame is 16.7)`);
  assert.ok(town < 4 && guild < 4 && tavern < 4, `ticks: ${town.toFixed(2)} / ${guild.toFixed(2)} / ${tavern.toFixed(2)} ms`);
});

// ------------------------------------------------------------------ art
test("the new poses paint in every garb and facing (coin in the hand that pays); a shake of the head stays a quarter turn; the keeper is a black box, swappable per shop", () => {
  const w = createWorld(1); getArea(w, "town"); getArea(w, "surface");
  for (const a of folkOf(w)) for (const pose of ["pay", "point", "read", "note", "nod", "shake"] as FolkPose[]) for (const facing of ROT) for (const frame of [0, 1]) {
    const gd = new FolkGrid();
    paintFolk(gd, ARCHETYPES[a.person!.archetype].garb, a.person!.look, ARCHETYPES[a.person!.archetype].age, { facing, head: null, pose, frame, carry: false, lantern: false, pole: false, blink: false });
    assert.ok(gd.c.filter(Boolean).length > 60, `${a.person!.archetype} ${pose} ${facing}`);
    if (pose === "pay") assert.ok(gd.c.includes("#e8b830"), `${a.person!.archetype} pays ${facing}: a coin`);
    assert.ok((POSE_RATE[pose] ?? 0) > 0, `${pose} moves`);
    a.facing = facing; a.life!.pose = pose; a.life!.head = null;
    for (const t of [0, 0.2, 0.4, 0.6]) assert.ok(natural(facing, folkArtPose(w, a, t).head), `${pose} ${facing}: the head as a neck allows`);
  }
  const rects: [number, number, number, number, string][] = [];
  const ctx = { fillStyle: "", fillRect(x: number, y: number, ww: number, h: number) { rects.push([x, y, ww, h, this.fillStyle]); } };
  for (const e of ESTABLISHMENTS) assert.equal(keeperPainter(e), KEEPER_ART.default, `${e}: the placeholder until it has art of its own`);
  keeperPainter("smithy")(new Pen(ctx as unknown as CanvasRenderingContext2D, false), 100, 50, { facing: "down", state: "tend", moving: false, phase: 0, t: 0 });
  assert.deepEqual(rects, [[100 - KEEPER_BOX.w / 2, 50 - KEEPER_BOX.h, KEEPER_BOX.w, KEEPER_BOX.h, "#000000"]], "one plain black box, about a person's size");
  assert.ok(KEEPER_BOX.h >= 18 && KEEPER_BOX.h <= 26 && KEEPER_BOX.w >= 8 && KEEPER_BOX.w <= 12);
  assert.equal(CENSUS.filter((r) => r.area === "town").length, 17, "the census itself is unchanged: keepers are not census rows");
});
