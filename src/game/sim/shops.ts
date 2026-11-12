// Shops (sim): the keepers behind Westwake's counters, opening hours, and each person's shop trips. No DOM, no
// Math.random: like the townsfolk, every choice is a hash of the world seed, the actor and a counter.
//
// A keeper is an Actor of kind "keeper" (definition `shopkeeper`) with a `keeper` record: which shop, a name, and
// what they are doing. They are not townsfolk: no routine, no home, no wandering. They live in their shop's room and
// are only stepped while the golem is in it; coming in finds them where the hour says (at the counter, or gone
// upstairs: out of hours a keeper is "away", and like a person indoors is not drawn, scanned or talked to).
// At the counter they greet whoever comes in, serve the customer in front of them (sim/folk.ts runs the exchange and
// calls keeperServe), tidy the shelves behind them between customers, and answer the golem (RULES.keeper).
//
// A shop trip is part of a person's plan, worked out from the clock like the rest of it (sim/folk.ts: planAt): inside
// a block of their routine in which their archetype shops (content/shops.ts: SHOP_HABITS), at a time and to a shop
// and with a purpose chosen by hash for that person and day, and only while that shop is open. So trips need no
// catching up, survive a save for free, and arriving at any hour finds the right people inside.
//
// Seams: `keeper.with` / keeperServe is where a real sale will happen; keeperTalk is where a shop screen or the
// guild's contract desk opens; a keeper's art is KEEPER_ART (keeperArt.ts).
import { SHOPS, SHOP_HABITS, TRIP, VISITS, type ShopDef, type VisitStep } from "../content/shops";
import { BUILDINGS, ESTABLISHMENTS, TOWN_ID, interiorId, type Establishment } from "../content/town";
import { NAMES, TRAITS, type RoutineBlock } from "../content/folk";
import { hash01, hourOf, wrapHour } from "../content/daycycle";
import { actorById, emit, getArea, makeActor, player, type Actor, type World } from "../world/world";
import type { Facing } from "../golem";
import { isFolk, shiftOf, spotById, type Person } from "./folk";

// ---------------------------------------------------------------- hours
export const SHOP_BY_AREA: Record<string, ShopDef> = Object.fromEntries(ESTABLISHMENTS.map((e) => [interiorId(e), SHOPS[e]]));
/** The shop whose room this area is. */
export const shopOfArea = (area: string): ShopDef | undefined => SHOP_BY_AREA[area];

/** Is the shop open at this hour of the town clock? (Shut over lunch; `close` may run past midnight.) */
export function shopOpenAt(def: ShopDef, hour: number): boolean {
  const h = wrapHour(hour), { open, close, lunch } = def.hours;
  const within = close > 24 ? h >= open || h < close - 24 : h >= open && h < close;
  return within && !(lunch && h >= lunch[0] && h < lunch[1]);
}
/** Open the whole way from `from` to `to` (hours, from <= to), with nothing shutting in between. */
export function openThrough(def: ShopDef, from: number, to: number): boolean {
  for (let h = from; h < to; h += 0.2) if (!shopOpenAt(def, h)) return false;
  return shopOpenAt(def, to);
}
export const shopOpen = (w: World, shop: Establishment) => shopOpenAt(SHOPS[shop], hourOf(w.day));
/** The longest stretch between `from` and `to` (hours) through which the shop is open, or null if it is shut throughout. */
export function openRun(def: ShopDef, from: number, to: number): [number, number] | null {
  const step = 0.1, n = Math.floor((to - from) / step + 1e-9);
  let best: [number, number] | null = null, i0 = -1;
  for (let i = 0; i <= n + 1; i++) {
    const open = i <= n && shopOpenAt(def, from + i * step);
    if (open && i0 < 0) i0 = i;
    if (!open && i0 >= 0) {
      const a = from + i0 * step, b = i - 1 === n && shopOpenAt(def, to) ? to : from + (i - 1) * step;
      if (!best || b - a > best[1] - best[0]) best = [a, b];
      i0 = -1;
    }
  }
  return best;
}

// ---------------------------------------------------------------- trips
/** One trip to a shop: within routine block `block`, from `from` to `to` (the person's own hours), to do `visit` (VISITS). */
export interface Trip { n: number; block: number; from: number; to: number; shop: Establishment; visit: string }

/** People whose house is lit by light runes have money (content/town.ts: the lighting is the town's map of itself). */
export const wellOff = (p: Person) => BUILDINGS.find((b) => `door.${b.id}` === p.home)?.light === "rune";

function weighted<T>(rows: [T, number][], r: number): T | null {
  const total = rows.reduce((s, [, n]) => s + Math.max(0, n), 0);
  if (total <= 0) return null;
  let k = r * total;
  for (const [x, n] of rows) { k -= Math.max(0, n); if (k < 0) return x; }
  return rows[rows.length - 1][0];
}

const tripCache = new Map<string, Trip[]>();

/**
 * The shop trips of one person's day (their own clock's day `day`), from the seed by hash. Pure: the same world,
 * person and day always give the same trips (cached; nothing here is saved).
 */
export function tripsOf(w: World, a: Actor, day: number, blocks: RoutineBlock[]): Trip[] {
  const p = a.person!, habit = SHOP_HABITS[p.archetype];
  if (!habit) return [];
  const key = `${w.seed}|${a.id}|${day}|${p.archetype}|${p.routine}|${p.traits.join(",")}|${p.home}`;
  const hit = tripCache.get(key);
  if (hit) return hit;
  if (tripCache.size > 4000) tripCache.clear();
  const out: Trip[] = [], shift = shiftOf(w, a, day), rich = wellOff(p);
  const h = (i: number, k: number, salt: number) => hash01(`${w.seed}:${a.id}:trip:${day}:${i}:${k}`, salt);
  blocks.forEach((b, i) => {
    const len = b.to - b.from;
    if (!habit.during.includes(b.act) || len < TRIP.minBlock) return;
    const slots = len >= TRIP.twoIn ? 2 : 1, seg = len / slots;
    for (let k = 0; k < slots; k++) {
      if (h(i, k, 0) > habit.chance) continue;
      const dur = Math.min(TRIP.len[0] + h(i, k, 1) * (TRIP.len[1] - TRIP.len[0]), seg - 2 * TRIP.margin);
      let from = b.from + seg * k + TRIP.margin + h(i, k, 2) * (seg - dur - 2 * TRIP.margin), to = from + dur;
      // where: by the archetype's habits, the person's means and traits, among the shops open for (enough of) that time:
      // a trip is cut to the shop's hours (out at closing, in when lunch is over), and not made if too little is left
      const runs: Partial<Record<Establishment, [number, number]>> = {};
      const shops: [Establishment, number][] = (Object.keys(habit.shops) as Establishment[]).map((s) => {
        const def = SHOPS[s], run = openRun(def, from + shift, to + shift);
        if (!run || run[1] - run[0] < Math.min(TRIP.minTrip, dur - 0.01)) return [s, 0];
        runs[s] = run;
        let n = habit.shops[s] ?? 0;
        if (rich && def.wellOff) n *= def.wellOff;
        for (const t of p.traits) n *= def.traits?.[t] ?? 1;
        return [s, n];
      });
      const shop = weighted(shops, h(i, k, 3));
      if (!shop) continue;
      from = runs[shop]![0] - shift; to = runs[shop]![1] - shift;
      // what for: the shop's visits, by who likes doing what
      const visits: [string, number][] = Object.entries(SHOPS[shop].visits).map(([id, n]) => {
        const v = VISITS[id];
        if (!v || (v.only && !v.only.includes(p.archetype))) return [id, 0];
        let m = n * (v.likes?.[p.archetype] ?? 1);
        for (const t of p.traits) m *= v.likes?.[t] ?? 1;
        return [id, m];
      });
      const visit = weighted(visits, h(i, k, 4));
      if (visit) out.push({ n: out.length, block: i, from, to, shop, visit });
    }
  });
  tripCache.set(key, out);
  return out;
}

/** The step of the visit a trip is at, at calendar time `day`: the first stretch of the trip is the walk there. */
export function shopStepAt(plan: { trip?: Trip; startDay: number; endDay: number }, day: number): { index: number; step: VisitStep } {
  const steps = VISITS[plan.trip!.visit].steps, total = steps.reduce((s, x) => s + x.share, 0);
  const frac = (day - plan.startDay) / Math.max(1e-9, plan.endDay - plan.startDay);
  let k = Math.min(0.9999, Math.max(0, (frac - TRIP.lead) / (1 - TRIP.lead))) * total;
  for (let i = 0; i < steps.length; i++) { k -= steps[i].share; if (k < 0) return { index: i, step: steps[i] }; }
  return { index: steps.length - 1, step: steps[steps.length - 1] };
}

// ---------------------------------------------------------------- keepers
export interface KeeperState {
  shop: string;
  name: string;
  /** away: out of hours, upstairs (hidden). tend: at the counter. serve: with a customer. tidy / back: to the shelves behind and back. */
  state: "away" | "tend" | "serve" | "tidy" | "back";
  /** Seconds until the next thing (the next tidy, the end of this one). */
  t: number;
  /** Seconds until they may greet another customer. */
  cool: number;
  /** Seconds until they greet the golem that has just come in (0: done). */
  greet: number;
  /** Seconds left listening to the golem. */
  attend: number;
  /** World time last stepped (the golem was here). */
  seen: number;
  /** The customer being served (a townsperson's id). The seam for a real sale. */
  with: string | null;
  goal: { x: number; y: number } | null;
  /** Counters for hashed choices and lines. */
  n: number; talks: number;
  lastEx?: string;
}

export const KEEPER_KIND = "keeper";
export const KEEPER_DEF = "shopkeeper";
/** How far the golem can speak to a keeper from: across the counter. */
export const KEEPER_REACH = 38;
const NEVER = -1e9;
const KEEPER_SPEED = 15;

export const keeperId = (shop: string) => `keeper.${shop}`;
export const isKeeper = (a: Actor) => a.kind === KEEPER_KIND && !!a.keeper;
/** In the shop (not gone upstairs out of hours). Away keepers are not drawn, scanned or talked to. */
export const keeperPresent = (a: Actor) => !isKeeper(a) || a.keeper!.state !== "away";
/** "EDDA MARSH - SMITH": the name and trade, for notes and the scan. */
export const keeperLabel = (a: Actor) => `${a.keeper!.name} - ${SHOPS[a.keeper!.shop as Establishment].keeper.title}`;
/** The keeper of the shop whose room `area` is, if they have been made. */
export const keeperOf = (w: World, area: string): Actor | undefined => { const s = shopOfArea(area); return s ? actorById(w, keeperId(s.id)) : undefined; };
/** At the counter with nobody in front of them: ready to serve. */
export const keeperReady = (a: Actor) => isKeeper(a) && a.keeper!.state === "tend" && a.keeper!.attend <= 0;
/** A customer's exchange at the counter begins (sim/folk.ts); it ends when the customer's chat does. */
export function keeperServe(a: Actor, customer: string) { const K = a.keeper!; K.state = "serve"; K.with = customer; K.goal = null; }

/**
 * Make the keeper of the shop whose room `area` is, once (world.getArea calls this when the room is first entered by
 * anyone; deserialize calls it for rooms an older save had already visited). No flag: the keeper's own actor is the
 * record. Their name is drawn from the seed by hash, never from w.rng.
 */
export function populateKeepers(w: World, area: string) {
  const shop = shopOfArea(area);
  if (!shop || actorById(w, keeperId(shop.id))) return;
  // a shop's room is part of the town: its customers are the town's people, so the town exists once the room does
  // (the golem normally walks in from the street; a debug teleport straight into a shop must not find it empty for ever)
  getArea(w, TOWN_ID);
  const room = w.areas.get(area);
  const home = room ? spotById(room, "keeper") : undefined;
  if (!home) return;
  const id = keeperId(shop.id), h = (salt: number) => hash01(`${w.seed}:${id}`, salt);
  const a = makeActor(id, KEEPER_DEF, area, home.x, home.y);
  a.kind = KEEPER_KIND;
  a.keeper = {
    shop: shop.id, name: `${NAMES.given[Math.floor(h(1) * NAMES.given.length)]} ${NAMES.family[Math.floor(h(2) * NAMES.family.length)]}`,
    state: "away", t: 0, cool: 0, greet: 0, attend: 0, seen: NEVER, with: null, goal: null, n: 0, talks: 0,
  };
  w.actors.push(a);
}

const faceTo = (dx: number, dy: number): Facing => (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");

function say(w: World, a: Actor, lines: string[], to?: string) {
  const K = a.keeper!;
  if (!lines.length) return;
  emit(w, { t: "folkSay", folk: a.id, to, line: lines[Math.floor(hash01(`${w.seed}:${a.id}`, 300 + K.talks++) * lines.length)] });
}

function moveToward(a: Actor, g: { x: number; y: number }, dt: number): boolean {
  const dx = g.x - a.x, dy = g.y - a.y, d = Math.hypot(dx, dy), step = KEEPER_SPEED * dt;
  if (d <= step) { a.x = g.x; a.y = g.y; return true; }
  a.x += dx / d * step; a.y += dy / d * step; a.moving = true; a.facing = faceTo(dx, dy); a.phase += step * 0.26;
  return false;
}

/** Step the keeper of the room the golem is in (stepWorld calls this after the townsfolk). */
export function tickKeepers(w: World, dt: number) {
  const pl = player(w);
  if (!pl) return;
  for (const a of w.actors) if (isKeeper(a) && a.area === pl.area) tickKeeper(w, a, dt, pl);
}

function tickKeeper(w: World, a: Actor, dt: number, pl: Actor) {
  const K = a.keeper!, def = SHOPS[K.shop as Establishment], area = getArea(w, a.area), home = spotById(area, "keeper");
  if (!def || !home) return;
  const open = shopOpenAt(def, hourOf(w.day)), fresh = w.time - K.seen > 1;
  const R = (salt: number) => hash01(`${w.seed}:${a.id}`, salt + (K.n++ % 100000) * 7);
  K.seen = w.time; K.cool = Math.max(0, K.cool - dt); a.moving = false;
  if (fresh) {
    // the golem has just come in: the keeper is where the hour says
    K.state = open ? "tend" : "away"; a.x = home.x; a.y = home.y; a.facing = "down"; K.goal = null; K.with = null; K.attend = 0;
    K.t = 4 + R(1) * 8; K.greet = open ? 0.9 : 0;
    if (!open) emit(w, { t: "message", text: def.closedNote });
  }
  // a customer mid-exchange is finished with first, even at closing time
  if (K.state === "serve") {
    const c = K.with ? actorById(w, K.with) : undefined;
    if (c && c.area === a.area && c.life?.chat?.with === a.id) { a.facing = faceTo(c.x - a.x, c.y - a.y); return; }
    K.state = "tend"; K.with = null; K.t = 3 + R(2) * 5; a.facing = "down";
  }
  if (!open) {
    if (K.state !== "away") {
      // closing time, or lunch: a word to whoever is still here, then up the stairs
      say(w, a, def.keeper.closing);
      K.state = "away"; K.goal = null; K.attend = 0; a.x = home.x; a.y = home.y;
    }
    return;
  }
  if (K.state === "away") { K.state = "tend"; a.x = home.x; a.y = home.y; a.facing = "down"; K.t = 5 + R(3) * 8; }
  if (K.greet > 0) {
    K.greet -= dt;
    if (K.greet <= 0) { K.greet = 0; say(w, a, def.keeper.welcome, pl.id); K.cool = 6; }
  }
  if (K.attend > 0) { K.attend -= dt; a.facing = faceTo(pl.x - a.x, pl.y - a.y); return; }
  const waiting = w.actors.some((b) => isFolk(b) && b.area === a.area && b.life!.spot === "customer");
  switch (K.state) {
    case "tend": {
      a.facing = "down";
      if (K.cool <= 0) {
        // a word to whoever comes through the door
        const door = spotById(area, "door");
        const c = door && w.actors.find((b) => isFolk(b) && b.area === a.area && b.life!.act === "shop" && b.life!.state === "walk" && Math.hypot(b.x - door.x, b.y - door.y) < 34);
        if (c) { say(w, a, def.keeper.hello, c.id); K.cool = 18 + R(4) * 12; }
      }
      K.t -= dt;
      if (K.t > 0) break;
      const tidy = (area.base.spots ?? []).filter((s) => s.kind === "tidy");
      if (waiting || !tidy.length) { K.t = 3; break; }
      const s = tidy[Math.floor(R(5) * tidy.length)];
      K.goal = { x: s.x, y: s.y }; K.state = "tidy"; K.t = 2.5 + R(6) * 3;
      break;
    }
    case "tidy": {
      // someone is at the counter: leave the shelf and serve
      if (waiting) { K.state = "back"; break; }
      if (!K.goal || moveToward(a, K.goal, dt)) { a.facing = "up"; K.t -= dt; if (K.t <= 0) K.state = "back"; }
      break;
    }
    case "back":
      if (moveToward(a, home, dt)) { K.state = "tend"; K.goal = null; a.facing = "down"; K.t = 9 + R(7) * 14; }
      break;
  }
}

/** The `keeperTalk` effect (RULES.keeper): the keeper turns to the golem and says one of the shop's placeholder lines. */
export function keeperTalk(w: World, by: Actor, targetId: string | undefined) {
  const a = targetId ? actorById(w, targetId) : undefined;
  if (!a || !isKeeper(a) || a.area !== by.area || !keeperPresent(a)) return;
  const K = a.keeper!, lines = SHOPS[K.shop as Establishment].keeper.greet;
  const line = lines[Math.floor(hash01(`${w.seed}:${a.id}`, 5000 + K.talks++) * lines.length)];
  K.attend = 3.6; K.greet = 0; a.facing = faceTo(by.x - a.x, by.y - a.y);
  emit(w, { t: "talkedTo", actor: by.id, npc: a.id });
  emit(w, { t: "folkSpoke", actor: by.id, folk: a.id, line });
}

void TRAITS;
