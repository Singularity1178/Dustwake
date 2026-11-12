// Townsfolk (sim): generic NPCs made from content/folk.ts and living by their routines. No DOM, no Math.random:
// every choice is a hash of the world seed, the person and a counter, so the same world and the same inputs give
// the same town, through a save and a load.
//
// A person is an ordinary Actor of kind "folk" (definition `townsfolk`) carrying `person` (who they are: generated
// once, saved) and `life` (what they are doing right now: saved, so a load resumes mid-stride).
//
// What they do is derived from the clock: `planAt` reads the routine at the person's own hour (their traits and a
// little daily jitter shift it), so nobody needs catching up. Only the area the player is in is simulated step by
// step; anyone else waits where they were, and is set down where the hour says ("settled") when the player comes
// back after a while. So arriving at any hour finds people where they would plausibly be.
//
// Priority: an assigned task or order (Actor.task / Actor.job, the ordinary work system) outranks everything; then
// a `duty` (Life.duty: an activity at a place until a time, the seam later contracts and recruitment will use);
// then the routine.
//
// Folk are soft: they have no collision box (sim/collision.ts: actorBox), so they can never block the golem or a
// worker in a street or a doorway. They do the yielding themselves: they steer round the golem, step aside when it
// walks at them, and never stop in a doorway.
//
// Places: a stool, an anvil, a bedroll, a blind holds one person at a time (content/folk.ts: EXCLUSIVE_KINDS). Nobody
// is sent to one that someone else stands at or is heading for (`Life.spot` is the claim); with none free they wait
// where they are and look again. Meeting places and the watch's rounds are shared, each person a few px off the spot.
//
// Heads (`Life.head`) turn at most a quarter turn from the body, as a neck does: something behind is looked at over a
// shoulder (`gazeAt`), a seated body keeps its seat and turns its head, and a head left over from before the body
// turned is taken back (`naturalHead`, every tick, and again by folkArt.ts, which never paints a head the other way).
import {
  ARCHETYPES, CENSUS, EXCLUSIVE_IDS, EXCLUSIVE_KINDS, FOLK_INTERIORS, HABITAT_AREAS, INTERIOR_OF, NAMES, ROUTES, ROUTINES, TRAITS, ACTIVITY_LINES,
  type Activity, type ArchetypeDef, type CensusRow, type ChatIcon, type PlaceQuery, type RoutineBlock, type TraitDef,
} from "../content/folk";
import { hash01, wrapHour, DAY_SECONDS } from "../content/daycycle";
import { TS } from "../content/tiles";
import { propDef } from "../content/props";
import type { Spot } from "../map";
import type { Area } from "../world/area";
import { actorById, emit, getArea, makeActor, player, type Actor, type World } from "../world/world";
import type { Facing } from "../golem";
import { findPath, navGrid, sweptFree } from "./navigation";
import { nearestFree } from "./collision";
import { portalArrival } from "./portals";

// ---------------------------------------------------------------- types (saved on the actor)
export interface FolkLook { skin: number; hair: number; style: number; beard: number; build: number; tall: number; cloth: number; trim: number; hat: number; acc: number; fem: number }
export interface Person {
  name: string; archetype: string; traits: string[]; routine: string;
  /** Door spot (town) or bed spot (camp) of home. */
  home: string;
  /** The area the census row put them in (their habitat's main area). */
  origin: string;
  /** Watch route (content/folk.ts: ROUTES). */
  route?: string;
  look: FolkLook;
}
export type FolkPose =
  | "stand" | "walk" | "sit" | "lie" | "crouch" | "hammer" | "chop" | "hoe" | "hang" | "feed" | "sweep" | "dig"
  | "aim" | "raise" | "lean" | "drink" | "chat" | "wave" | "browse" | "draw" | "warm" | "stretch";
/** An assigned activity that outranks the routine (contracts, recruitment, later). `until`: world.day it lapses. */
export interface Duty { act: Activity; area: string; x: number; y: number; facing?: Facing; until: number; label?: string }
export interface Life {
  /** The block being lived: `${day}:${index}`, or "duty". A change starts a new block. */
  plan: string;
  act: Activity;
  state: "idle" | "walk" | "do" | "indoors" | "chat" | "attend" | "aside" | "busy";
  goal: { x: number; y: number; facing: Facing } | null;
  /** The place they hold (a spot id, or `lamp:<prop id>` on the lamplighter's round): claimed while they are at it or on the way. */
  spot: string | null;
  path: { x: number; y: number }[];
  /** Seconds left in the current pause / motion. */
  wait: number;
  /** Counter for choices within a block (next stop, next motion). */
  visit: number;
  pose: FolkPose;
  /** Where the head turns, if not where the body faces (a glance at the golem, a look about): a quarter turn at most (naturalHead). */
  head: Facing | null;
  glance: number; cool: number; chatCool: number;
  chat: { with: string; t: number; turn: number; speaker: boolean } | null;
  /** Seconds left facing the golem after it spoke to them. */
  attend: number;
  /** Carrying a load (hauling). */
  carry: boolean;
  /** Walking cadence (px walked * k): the art's step frames. */
  phase: number;
  /** World time this person was last simulated in place. Staler than STALE: settled to the hour on the next tick. */
  seen: number;
  talks: number;
  /** A pause mid-walk, already taken for this leg. */
  dawdled: boolean;
  duty?: Duty | null;
}

export const FOLK_KIND = "folk";
export const FOLK_DEF = "townsfolk";
/** Seconds without being simulated after which a person is set down where the hour says. */
export const STALE = 20;
/** `Life.seen` for someone never simulated yet: finite, so a save keeps it (JSON turns -Infinity into null). */
const NEVER = -1e9;
const HOUR_S = DAY_SECONDS / 24;

export const isFolk = (a: Actor) => a.kind === FOLK_KIND && !!a.person && !!a.life;
/** Out in the world: not indoors at home. Hidden people are not drawn, scanned or talked to. */
export const folkPresent = (a: Actor) => !isFolk(a) || a.life!.state !== "indoors";
export const archetypeOf = (a: Actor): ArchetypeDef => ARCHETYPES[a.person!.archetype];
const traitsOf = (p: Person): TraitDef[] => p.traits.map((t) => TRAITS[t]).filter(Boolean);
const dial = (p: Person, k: "speed" | "linger" | "dawdle" | "chatty") => traitsOf(p).reduce((m, t) => m * (t[k] ?? 1), 1);
const H = (w: World, s: string, salt = 0) => hash01(`${w.seed}:${s}`, salt);
/** The next deterministic roll for a person (advances their counter). */
const roll = (w: World, a: Actor) => H(w, a.id, 1000 + (a.life!.visit++ % 100000));

// ---------------------------------------------------------------- making people
/** A person from a census row, drawn from the world seed by hash (never from w.rng, so the story's draws are untouched). */
export function makePerson(w: World, row: CensusRow, taken: Set<string> = new Set()): Person {
  const arch = ARCHETYPES[row.archetype];
  const h = (salt: number) => H(w, row.id, salt);
  // two traits from different groups
  const ids = Object.keys(TRAITS).sort();
  const traits: string[] = [];
  for (let k = 0; traits.length < 2 && k < 40; k++) {
    const t = TRAITS[ids[Math.floor(h(10 + k) * ids.length)]];
    if (!traits.some((x) => TRAITS[x].group === t.group)) traits.push(t.id);
  }
  // a name nobody else in the census has
  let name = "";
  for (let k = 0; k < 60; k++) {
    const g = NAMES.given[Math.floor(h(30 + k) * NAMES.given.length)], f = NAMES.family[Math.floor(h(31 + k * 3) * NAMES.family.length)];
    name = `${g} ${f}`;
    if (!taken.has(g) || k > 40) { taken.add(g); break; }
  }
  const fem = NAMES.given.indexOf(name.split(" ")[0] as never) >= 20 ? 1 : 0;
  const old = arch.age === "old", young = arch.age === "young";
  const look: FolkLook = {
    skin: Math.floor(h(50) * 6),
    hair: old ? 6 + Math.floor(h(51) * 2) : Math.floor(h(51) * (young ? 5 : 6)),
    style: Math.floor(h(52) * 4),
    beard: !fem && !young && h(53) < (old ? 0.6 : 0.4) ? 1 + Math.floor(h(54) * 2) : 0,
    build: Math.floor(h(55) * 3), tall: h(56) < 0.4 ? 1 : 0,
    cloth: Math.floor(h(57) * 4), trim: Math.floor(h(58) * 4), hat: Math.floor(h(59) * 3), acc: Math.floor(h(60) * 4), fem,
  };
  const routine = row.routine ?? arch.routines[Math.floor(h(70) * arch.routines.length)];
  return { name, archetype: arch.id, traits, routine, home: row.home, origin: row.area, route: row.route, look };
}

export function makeFolk(w: World, row: CensusRow, taken?: Set<string>): Actor {
  const area = getArea(w, row.area), home = spotById(area, row.home);
  const a = makeActor(row.id, FOLK_DEF, row.area, home?.x ?? area.start.x, home?.y ?? area.start.y);
  a.kind = FOLK_KIND;
  a.person = makePerson(w, row, taken);
  a.life = {
    plan: "", act: "indoors", state: "idle", goal: null, spot: null, path: [], wait: 0, visit: 0, pose: "stand", head: null,
    glance: 0, cool: H(w, row.id, 7) * 6, chatCool: 4 + H(w, row.id, 8) * 8, chat: null, attend: 0, carry: false, phase: 0,
    seen: NEVER, talks: 0, dawdled: false, duty: null,
  };
  return a;
}

/** The census flag: an area's people have been made (once; whatever becomes of them after is theirs). */
export const censusFlag = (area: string) => `census.${area}`;

/**
 * Make the people who live in `area`, once (world.getArea calls this on an area's first instantiation, and a save
 * from before townsfolk calls it for areas it had already visited). They are not placed yet: the first tick with
 * the player there settles them where the hour says.
 */
export function populateFolk(w: World, area: string) {
  if (w.flags.has(censusFlag(area))) return;
  const rows = CENSUS.filter((r) => r.area === area);
  if (!rows.length) return;
  w.flags.add(censusFlag(area));
  const taken = new Set(w.actors.filter(isFolk).map((a) => a.person!.name.split(" ")[0]));
  for (const r of rows) if (!actorById(w, r.id)) w.actors.push(makeFolk(w, r, taken));
}

// ---------------------------------------------------------------- the plan: what the hour says
const habitatAreas = (a: Actor) => HABITAT_AREAS[archetypeOf(a).habitat];
/** The hours this person's day runs early or late today: traits, their own habit, and a little daily jitter. */
export function shiftOf(w: World, a: Actor, day: number): number {
  return traitsOf(a.person!).reduce((s, t) => s + (t.shift ?? 0), 0) + (H(w, a.id, 11) - 0.5) * 0.9 + (H(w, a.id, 2000 + day) - 0.5) * 0.5;
}

/** The routine's blocks with this person's extensions applied (a thirsty labourer stays longer at the tavern). */
export function blocksOf(a: Actor): RoutineBlock[] {
  const base = ROUTINES[a.person!.routine].blocks, tr = traitsOf(a.person!);
  const b = base.map((x) => x.from).concat([24]);
  base.forEach((blk, i) => {
    const e = tr.reduce((s, t) => s + (t.extend?.[blk.act] ?? 0), 0);
    if (!e || i === base.length - 1) return;
    b[i + 1] = Math.min(24, b[i + 1] + e);
    for (let j = i + 2; j < b.length; j++) b[j] = Math.max(b[j], b[i + 1]);
  });
  return base.map((blk, i) => ({ ...blk, from: b[i], to: b[i + 1] })).filter((x) => x.to > x.from + 1e-6);
}

export interface Plan { key: string; act: Activity; at?: PlaceQuery; index: number; day: number; startDay: number; endDay: number }

/** What this person is doing at calendar time `dayValue` (world.day). Pure. */
export function planAt(w: World, a: Actor, dayValue = w.day): Plan {
  const L = a.life!;
  if (L.duty && L.duty.until > dayValue) return { key: "duty", act: L.duty.act, index: -1, day: Math.floor(dayValue), startDay: dayValue, endDay: L.duty.until };
  const day0 = Math.floor(dayValue), shift = shiftOf(w, a, day0);
  const local = dayValue - shift / 24, day = Math.floor(local), hour = (local - day) * 24;
  const blocks = blocksOf(a);
  let i = blocks.findIndex((b) => hour >= b.from && hour < b.to);
  if (i < 0) i = blocks.length - 1;
  const b = blocks[i];
  return { key: `${day}:${i}`, act: b.act, at: b.at, index: i, day, startDay: day + b.from / 24 + shift / 24, endDay: day + b.to / 24 + shift / 24 };
}

/** The area this person should be in now: the tavern's room while they drink in it, else where they live. */
export function desiredArea(w: World, a: Actor, plan = planAt(w, a)): string {
  if (plan.key === "duty") return a.life!.duty!.area;
  const inside = INTERIOR_OF[plan.act];
  if (inside) return FOLK_INTERIORS[inside].area;
  return a.person!.origin;
}

// ---------------------------------------------------------------- places
export const spotById = (area: Area, id: string) => area.base.spots?.find((s) => s.id === id);
const homeSpot = (w: World, a: Actor) => spotById(getArea(w, a.person!.origin), a.person!.home);
/** Home is a house (asleep indoors, out of sight) unless it is a bedroll under the sky: the camp sleeps where anyone can see it. */
const indoorsAtHome = (w: World, a: Actor) => homeSpot(w, a)?.kind !== "bed";

function candidates(w: World, a: Actor, area: Area, q: PlaceQuery): Spot[] {
  let list = (area.base.spots ?? []).filter((s) => q.kinds.includes(s.kind) && (!q.prefix || q.prefix.some((p) => s.id.startsWith(p))));
  const home = area.id === a.person!.origin ? homeSpot(w, a) : undefined;
  const roam = traitsOf(a.person!).find((t) => t.roam)?.roam;
  const near = q.nearHome || (roam === "near" && q.kinds.includes("wander") ? 6 : 0);
  if (home && near && roam !== "wide") list = [...list].sort((s, t) => Math.hypot(s.x - home.x, s.y - home.y) - Math.hypot(t.x - home.x, t.y - home.y) || (s.id < t.id ? -1 : 1)).slice(0, near);
  return list;
}

/** Spots others are standing at or heading for (in this area), so two people do not pick the same stool. */
function claimed(w: World, a: Actor, area: string): Set<string> {
  const out = new Set<string>();
  for (const b of w.actors) if (b !== a && b.area === area && isFolk(b) && b.life!.spot) out.add(b.life!.spot);
  return out;
}

/** A place one person holds at a time: a stool, an anvil, a bedroll, a blind (content/folk.ts: EXCLUSIVE_KINDS, EXCLUSIVE_IDS). */
export const isExclusive = (s: Spot) => EXCLUSIVE_KINDS.includes(s.kind) || EXCLUSIVE_IDS.some((p) => s.id.startsWith(p));

/**
 * Choose a place for a query: by hash per person, day and visit, not the one they hold (they move on) and not one
 * someone else holds (`share` lets a knot form at a meeting place, never on an exclusive one). With nowhere else free
 * they keep the place they hold, if the query offers it; else nowhere is free (null: they wait and look again). There
 * is no falling back on a place someone else holds: that sent two apprentices to one anvil, into each other's path.
 */
function pick(w: World, a: Actor, area: Area, q: PlaceQuery, salt: number, share = false): Spot | null {
  const list = candidates(w, a, area, q);
  if (!list.length) return null;
  const held = claimed(w, a, area.id), own = a.life!.spot, start = Math.floor(H(w, a.id, salt) * list.length);
  const open = (s: Spot) => !held.has(s.id) || (share && !isExclusive(s));
  for (let k = 0; k < list.length; k++) { const s = list[(start + k) % list.length]; if (s.id !== own && open(s)) return s; }
  return list.find((s) => s.id === own && open(s)) ?? null;
}

/** A person's own small offset from a shared place, so a knot of people is a knot and not a stack. */
function jitter(w: World, a: Actor, s: Spot, r: number, salt: number) { return { x: s.x + Math.round((H(w, a.id, salt) - 0.5) * 2 * r), y: s.y + Math.round((H(w, a.id, salt + 1) - 0.5) * r) }; }

/** Fire lights where people keep them (the lamplighter's round), with when each is lit (dusk) or doused (dawn). */
function lampRound(a: Actor, area: Area, hour: number): { id: string; x: number; y: number; at: number }[] {
  if (!area.base.tended) return [];
  const dusk = hour > 12, route = a.person!.route;
  const out: { id: string; x: number; y: number; at: number }[] = [];
  for (const p of area.props) {
    if (propDef(p.kind).habit !== "fire" || p.dyn) continue;
    if (route === "high" && p.x < 720) continue;
    if (route === "west" && p.x >= 720) continue;
    const at = dusk ? 19.5 + hash01(p.id, 1) * 1.2 : 6.3 + hash01(p.id, 2) * 0.9; // as content/daycycle.ts: litLevel("fire")
    const f = nearestFree(area, p.x, p.y + (propDef(p.kind).wallMounted ? 16 : 10), [], [8, 4]);
    if (f) out.push({ id: p.id, x: f.x, y: f.y, at });
  }
  return out.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
}

const MOTION: Record<string, FolkPose> = { chop: "chop", hang: "hang", feed: "feed", draw: "draw", sweep: "sweep", hoe: "hoe", hammer: "hammer", dig: "dig", haul: "crouch" };
const motionOf = (spot: string | null): FolkPose => (spot ? MOTION[spot.split(".")[1]] : undefined) ?? "stand";

// ---------------------------------------------------------------- choosing the next stop
interface Goal { x: number; y: number; facing: Facing; spot: string | null; area?: string }

/** Where the current activity sends this person next (the n-th stop of the block). Null: stay put. */
function nextGoal(w: World, a: Actor, area: Area, plan: Plan): Goal | null {
  const L = a.life!, salt = 3000 + (plan.day % 1000) * 17 + plan.index * 5 + L.visit;
  const asGoal = (s: Spot | null | undefined, r = 0): Goal | null => {
    if (!s) return null;
    const j = r ? jitter(w, a, s, r, salt + 7) : s;
    const f = nearestFree(area, j.x, j.y, [], [8, 4]) ?? s;
    return { x: f.x, y: f.y, facing: s.facing, spot: s.id };
  };
  if (plan.key === "duty") { const d = L.duty!; return { x: d.x, y: d.y, facing: d.facing ?? "down", spot: null }; }
  const homeArea = a.person!.origin;
  switch (plan.act) {
    case "sleep": case "indoors": {
      if (area.id !== homeArea) return null;
      const home = homeSpot(w, a);
      return home ? { x: home.x, y: home.y, facing: "up", spot: home.id } : null;
    }
    case "patrol": {
      const route = ROUTES[area.id]?.[a.person!.route ?? ""] ?? Object.values(ROUTES[area.id] ?? {})[0];
      if (!route) return asGoal(pick(w, a, area, { kinds: ["wander"] }, salt, true));
      const n = route.length, k = L.visit % (2 * n - 2 || 1), i = k < n ? k : 2 * n - 2 - k;
      return asGoal(spotById(area, route[i]), 3);
    }
    case "lamps": {
      const hour = wrapHour((w.day - Math.floor(w.day)) * 24), round = lampRound(a, area, hour);
      const held = claimed(w, a, area.id); // two lamplighters never make for the same lamp
      const next = round.find((l) => l.at > hour - 0.04 && !L.spot?.endsWith(l.id) && !held.has(`lamp:${l.id}`)) ?? null;
      if (!next) return asGoal(pick(w, a, area, { kinds: ["patrol"] }, salt, true));
      return { x: next.x, y: next.y, facing: "up", spot: `lamp:${next.id}` };
    }
    case "work": {
      if (L.spot?.startsWith("work.haul")) return asGoal(pick(w, a, area, { kinds: ["work"], prefix: ["work.haul"] }, salt));
      return asGoal(pick(w, a, area, plan.at!, salt));
    }
    case "gather": case "socialize": case "sit": case "camp": case "tavern": case "post":
      return asGoal(pick(w, a, area, plan.at!, salt, plan.act === "socialize" || plan.act === "post"), plan.act === "socialize" || plan.act === "post" ? 9 : plan.act === "gather" ? 3 : 0);
    default:
      return plan.at ? asGoal(pick(w, a, area, plan.at, salt, plan.act === "wander"), plan.act === "wander" ? 6 : 0) : null;
  }
}

/** How long the person stays at a stop, and in what pose. */
function stopFor(w: World, a: Actor, plan: Plan): { pose: FolkPose; wait: number } {
  const L = a.life!, r = roll(w, a), linger = dial(a.person!, "linger");
  // wanted a place and none was free (every stool taken, both anvils busy): stand a moment, then look again
  if (plan.at && !L.spot && plan.act !== "sleep" && plan.act !== "indoors") return { pose: "stand", wait: 2.5 + r * 3 };
  switch (plan.act) {
    case "sleep": return { pose: "lie", wait: 9999 };
    case "work": case "chore": {
      const m = motionOf(L.spot);
      if (L.spot?.startsWith("work.haul")) return { pose: "crouch", wait: 1.6 };
      return { pose: m, wait: (9 + r * 9) * linger };
    }
    case "errand": return { pose: "browse", wait: (2.5 + r * 3) * linger };
    case "wander": return { pose: L.spot?.startsWith("bench") ? "sit" : "stand", wait: (4 + r * 7) * linger };
    case "patrol": return { pose: r < 0.4 ? "lean" : "stand", wait: 2 + r * 3 };
    case "post": return { pose: "lean", wait: 14 + r * 10 };
    case "lamps": return { pose: "raise", wait: 1.2 };
    case "hunt": return { pose: r < 0.6 ? "aim" : "crouch", wait: 2.5 + r * 2.5 };
    case "forage": return { pose: "crouch", wait: (4 + r * 4) * linger };
    case "sit": case "tavern": return { pose: "sit", wait: 25 + r * 20 };
    case "camp": return { pose: r < 0.7 ? "sit" : "warm", wait: 20 + r * 20 };
    default: return { pose: "stand", wait: (12 + r * 14) * linger };
  }
}

/** Activities that move on after each stop (the rest stay where they are for the block, fidgeting). */
const ROVING: Partial<Record<Activity, boolean>> = { wander: true, patrol: true, lamps: true, errand: true, hunt: true, forage: true, chore: true, work: true };
/** Activities where people strike up talk with whoever is near. */
const SOCIAL: Partial<Record<Activity, boolean>> = { socialize: true, gather: true, tavern: true, camp: true, wander: true, sit: true, post: true, errand: true };

// ---------------------------------------------------------------- ticking
/**
 * Advance the townsfolk (stepWorld calls this). Everyone in the player's area is simulated; people of the same
 * habitat in a neighbouring area (the tavern's room, the town) come in by the door when their plan says so; anyone
 * else waits.
 */
export function tickFolk(w: World, dt: number) {
  const pl = player(w);
  if (!pl) return;
  const here = pl.area;
  for (const a of w.actors) {
    if (!isFolk(a)) continue;
    const L = a.life!;
    // An assigned task or order is the ordinary work system's (stepWorld ticks it): it outranks the routine.
    if (a.task || (a.job && a.job.status !== "done")) { L.state = "busy"; L.pose = a.moving ? "walk" : "stand"; L.seen = w.time; continue; }
    if (a.area === here) {
      if (w.time - L.seen > STALE) settle(w, a);
      L.seen = w.time;
      if (a.area === here) tickPerson(w, a, dt);
    } else if (habitatAreas(a).includes(here) && desiredArea(w, a) === here) {
      comeIn(w, a);
    }
  }
  // a body that turned under a glance held from before takes the glance back: heads never turn round to the back
  for (const a of w.actors) if (isFolk(a) && a.life!.head) a.life!.head = naturalHead(a.facing, a.life!.head);
}

/** Someone due in the player's area: if their block has only just begun they come in by the door; else they are already here. */
function comeIn(w: World, a: Actor) {
  const plan = planAt(w, a), area = getArea(w, desiredArea(w, a, plan)), L = a.life!;
  const sinceS = (w.day - plan.startDay) * DAY_SECONDS;
  const door = (area.base.portals ?? []).find((p) => p.to.area === a.area);
  if (door && sinceS < HOUR_S * 0.8) {
    const at = portalArrival(door);
    moveTo(w, a, area.id, at.x, at.y);
    a.facing = at.facing;
    resetLeg(L); L.spot = null; L.state = "idle"; L.seen = w.time;
    return;
  }
  moveTo(w, a, area.id, a.x, a.y);
  settle(w, a);
  L.seen = w.time;
}

function moveTo(w: World, a: Actor, area: string, x: number, y: number) {
  getArea(w, area);
  a.area = area; a.x = x; a.y = y; a.vx = 0; a.vy = 0; a.moving = false;
}
function resetLeg(L: Life) { L.path = []; L.goal = null; L.chat = null; L.attend = 0; L.wait = 0; L.dawdled = false; L.carry = false; }

/**
 * Set someone down where the hour says: at the place of what they are doing now, doing it; or, if this block began
 * so recently they could not have got there yet, still at (or just out of the door of) where they were before.
 */
export function settle(w: World, a: Actor) {
  const L = a.life!, plan = planAt(w, a), want = desiredArea(w, a, plan);
  resetLeg(L);
  L.plan = plan.key; L.act = plan.act;
  // a stop partway through a roving block, so a patrol is not always at its first post
  L.visit = Math.floor((w.day - plan.startDay) * DAY_SECONDS / 14) + Math.floor(H(w, a.id, 9) * 7);
  if (want !== a.area) {
    // they belong in a room the player is not in: the room has them (they wait there until the player comes)
    const area = getArea(w, want);
    const g = nextGoal(w, a, area, plan);
    moveTo(w, a, want, g?.x ?? area.start.x, g?.y ?? area.start.y);
  }
  const area = getArea(w, a.area);
  const g = nextGoal(w, a, area, plan);
  L.spot = g?.spot ?? null;
  if ((plan.act === "sleep" || plan.act === "indoors") && indoorsAtHome(w, a)) {
    if (g) { a.x = g.x; a.y = g.y; L.state = "indoors"; L.pose = "stand"; return; }
  }
  if (!g) { L.state = "idle"; return; }
  // just started and a walk away: still on the way (out of the house, if they were in it)
  const since = (w.day - plan.startDay) * DAY_SECONDS, prev = planAt(w, a, plan.startDay - 0.0005);
  const travel = Math.hypot(g.x - a.x, g.y - a.y) / speedOf(a);
  if (since < travel && plan.key !== "duty" && desiredArea(w, a, prev) === a.area) {
    const pg = nextGoal(w, a, area, prev);
    if (pg) {
      const f = Math.max(0, since / Math.max(travel, 0.001));
      const x = pg.x + (g.x - pg.x) * f, y = pg.y + (g.y - pg.y) * f, at = nearestFree(area, x, y, [], [8, 4]) ?? pg;
      a.x = at.x; a.y = at.y; L.state = "idle"; L.spot = null; L.pose = "stand";
      return;
    }
  }
  a.x = g.x; a.y = g.y; a.facing = g.facing; L.goal = g; L.state = "do";
  const s = stopFor(w, a, plan);
  L.pose = s.pose; L.wait = s.wait * (0.3 + H(w, a.id, 13) * 0.7);
  aimSideOn(w, a);
}

function speedOf(a: Actor): number {
  const arch = archetypeOf(a), night = a.life!.act === "patrol" ? 0.85 : 1;
  return arch.speed * dial(a.person!, "speed") * night * (a.life!.act === "errand" ? 1.15 : 1);
}

/** One person, one step: follow the plan, walk, stop, talk, notice the golem, make way. */
function tickPerson(w: World, a: Actor, dt: number) {
  const L = a.life!, area = getArea(w, a.area), plan = planAt(w, a), want = desiredArea(w, a, plan);
  L.glance = Math.max(0, L.glance - dt); L.cool = Math.max(0, L.cool - dt); L.chatCool = Math.max(0, L.chatCool - dt);
  if (L.duty && L.duty.until <= w.day) L.duty = null;
  if (L.glance <= 0) L.head = null;
  a.moving = false;

  // a new block: leave what they were doing (a chat ends politely, a load is set down)
  if (L.plan !== plan.key) {
    const wasIndoors = L.state === "indoors";
    if (L.chat) endChat(w, a);
    L.plan = plan.key; L.act = plan.act; resetLeg(L);
    if (wasIndoors) {
      if ((plan.act === "sleep" || plan.act === "indoors") && want === a.area) { L.state = "indoors"; return; }
      // out of the door, a step into the street
      const home = homeSpot(w, a);
      if (home && a.area === a.person!.origin) { a.x = home.x; a.y = home.y + 4; a.facing = "down"; }
    }
    L.state = "idle"; L.spot = null;
  }
  if (L.state === "indoors") return;

  // talking with the golem: face it until they have had their say
  if (L.attend > 0) {
    L.attend -= dt;
    const pl = player(w);
    faceToward(a, pl.x, pl.y);
    if (!rooted(L)) L.pose = L.attend > 0.6 ? "chat" : "stand";
    if (L.attend <= 0) L.state = L.goal ? "do" : "idle";
    return;
  }
  if (L.chat) { tickChat(w, a, dt); noticeGolem(w, a, area); makeWay(w, a, area, dt); return; }

  // somewhere else entirely (the tavern's room, home from it): walk out by the door that leads there
  if (want !== a.area) {
    const door = (area.base.portals ?? []).find((p) => p.to.area === want);
    if (!door) { moveTo(w, a, want, a.x, a.y); settle(w, a); return; }
    const gx = door.x + door.w / 2, gy = door.y + door.h - 1;
    if (!L.goal || L.goal.x !== gx || L.goal.y !== gy) { L.goal = { x: gx, y: gy, facing: door.dir as Facing }; L.spot = null; L.path = []; L.state = "walk"; }
    const r = walk(w, a, area, dt);
    if (r === "arrived" || Math.hypot(a.x - gx, a.y - gy) < 6) {
      const out = getArea(w, door.to.area), op = (out.base.portals ?? []).find((p) => p.id === door.to.portal);
      const at = op ? portalArrival(op) : { x: out.start.x, y: out.start.y, facing: "down" as Facing };
      moveTo(w, a, out.id, at.x, at.y); a.facing = at.facing; resetLeg(L); L.spot = null; L.state = "idle"; L.seen = w.time;
    }
    return;
  }

  switch (L.state) {
    case "idle": {
      const g = nextGoal(w, a, area, plan);
      if (!g) { L.state = "do"; const s = stopFor(w, a, plan); L.pose = s.pose === "lie" ? "stand" : s.pose; L.wait = s.wait; aimSideOn(w, a); break; }
      L.goal = g; L.spot = g.spot; L.path = []; L.state = "walk"; L.dawdled = false;
      break;
    }
    case "walk": {
      const r = walk(w, a, area, dt);
      if (r === "arrived") arrive(w, a, plan);
      else if (r === "stuck") { L.visit++; L.state = "do"; L.pose = "stand"; L.wait = 1.5; L.goal = null; L.spot = null; }
      break;
    }
    case "aside": {
      const r = walk(w, a, area, dt);
      if (r !== "moving") { L.state = L.goal ? "do" : "idle"; L.wait = Math.max(L.wait, 1.2); L.pose = "stand"; L.path = []; }
      break;
    }
    case "do": {
      L.wait -= dt;
      fidget(w, a, plan, dt);
      if (L.wait <= 0) {
        // a pause on the way (a dawdle, a chat, a step aside), not the stop: carry on, so a stool's pose is only ever
        // taken at the stool (it used to be struck wherever the pause was: sitting on the cobbles)
        if (L.goal && Math.hypot(L.goal.x - a.x, L.goal.y - a.y) > 3) { L.state = "idle"; break; }
        if (plan.act === "work" && L.spot?.startsWith("work.haul")) {
          // hauling: pick a load up here, carry it to the next pile, set it down there
          L.carry = !L.carry; L.visit++; L.state = "idle";
        } else if (plan.act === "lamps" && L.spot?.startsWith("lamp:")) {
          const hour = wrapHour((w.day - Math.floor(w.day)) * 24), lamp = lampRound(a, area, hour).find((l) => `lamp:${l.id}` === L.spot);
          if (lamp && lamp.at > hour + 0.01) { L.wait = 0.4; break; } // early: hold the pole up until it is time
          L.state = "idle"; L.visit++;
        } else if (ROVING[plan.act] || plan.key === "duty") { L.visit++; L.state = "idle"; }
        else if (plan.at && !L.spot) { L.visit++; L.state = "idle"; } // nowhere was free: look again
        else { const s = stopFor(w, a, plan); L.pose = s.pose; L.wait = s.wait; L.visit++; if (plan.act !== "sleep" && roll(w, a) < 0.25) L.state = "idle"; }
      }
      break;
    }
  }
  noticeGolem(w, a, area);
  if (L.state === "do" || (L.state === "walk" && (plan.act === "wander" || plan.act === "errand"))) seekChat(w, a, plan);
  makeWay(w, a, area, dt);
}

function arrive(w: World, a: Actor, plan: Plan) {
  const L = a.life!, g = L.goal!;
  a.facing = g.facing;
  if ((plan.act === "sleep" || plan.act === "indoors") && a.area === a.person!.origin && indoorsAtHome(w, a)) { L.state = "indoors"; L.pose = "stand"; L.carry = false; return; }
  const s = stopFor(w, a, plan);
  L.state = "do"; L.pose = s.pose; L.wait = s.wait;
  // a hunter faces out into the wood, a lamplighter up at the lamp
  if (plan.act === "hunt") a.facing = roll(w, a) < 0.5 ? "left" : "right";
}

/** Small life at a stop: looking about, shifting weight, a quirk now and then. */
function fidget(w: World, a: Actor, plan: Plan, dt: number) {
  const L = a.life!;
  if (L.glance > 0) return;
  const quiet = L.pose === "stand" || L.pose === "lean" || L.pose === "sit" || L.pose === "warm";
  if (!quiet) return;
  // a look about, every so often (by a hash of time, so it is deterministic and unsynchronised)
  const tick = Math.floor((w.time + H(w, a.id, 21) * 9) / 3.2);
  if (Math.floor((w.time - dt + H(w, a.id, 21) * 9) / 3.2) !== tick) {
    const r = H(w, a.id, 4000 + tick);
    L.head = r < 0.3 ? turn(a.facing, 1) : r < 0.6 ? turn(a.facing, -1) : null;
    if (L.head) L.glance = 0.8 + r * 1.6; // held a moment (until the glance runs out), not for a single frame
    const quirk = traitsOf(a.person!).find((t) => t.quirk)?.quirk;
    if (L.pose === "stand" && quirk === "stretch" && r > 0.92) { L.pose = "stretch"; L.wait = Math.max(L.wait, 1.4); }
    if (plan.act === "gather" && r > 0.55) L.pose = L.pose === "stand" ? "drink" : "stand";
  }
}

// ---------------------------------------------------------------- walking
/** Follow the goal: plan a path (string-pulled), walk it at the person's pace, steer round the golem and others. */
function walk(w: World, a: Actor, area: Area, dt: number): "arrived" | "moving" | "stuck" {
  const L = a.life!, g = L.goal;
  if (!g) return "arrived";
  if (Math.hypot(g.x - a.x, g.y - a.y) < 1.5) { a.x = g.x; a.y = g.y; return "arrived"; }
  const grid = navGrid(area, a);
  if (!L.path.length) {
    const raw = findPath(w, a, { x: g.x, y: g.y, range: 2 }, false);
    if (!raw) return "stuck";
    L.path = smooth({ x: a.x, y: a.y }, [...raw, { x: g.x, y: g.y }], grid.free);
  }
  let speed = speedOf(a);
  // a pause mid-walk now and then: stop, look about, carry on (idlers more, the brisk never)
  if (!L.dawdled && L.state === "walk" && L.path.length > 3) {
    L.dawdled = true;
    if (roll(w, a) < 0.12 * dial(a.person!, "dawdle") && L.act !== "lamps") { L.state = "do"; L.pose = "stand"; L.wait = 1.5 + roll(w, a) * 2.5; L.goal = g; resumeAfter(L); return "moving"; }
  }
  // ease in and out
  const remaining = L.path.reduce((s, p, i) => s + Math.hypot(p.x - (i ? L.path[i - 1].x : a.x), p.y - (i ? L.path[i - 1].y : a.y)), 0);
  if (remaining < 10) speed *= 0.55 + remaining / 22;
  if (L.act === "hunt" && remaining < 36) speed *= 0.5; // stalking the last stretch
  let budget = speed * dt;
  const start = { x: a.x, y: a.y };
  const avoid = obstacles(w, a);
  while (L.path.length && budget > 0.01) {
    const p = L.path[0], dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy);
    if (d < 0.5) { L.path.shift(); continue; }
    let ux = dx / d, uy = dy / d;
    // steer: something in the way ahead (the golem, a worker, another person) -> veer to the side it is not on
    for (const o of avoid) {
      const ox = o.x - a.x, oy = o.y - a.y, ahead = ox * ux + oy * uy, side = ox * -uy + oy * ux;
      if (ahead > 0 && ahead < o.r + 10 && Math.abs(side) < o.r) {
        const k = side > 0 ? -1 : 1, nx = ux + -uy * k * 0.9, ny = uy + ux * k * 0.9, n = Math.hypot(nx, ny);
        if (grid.free(a.x + nx / n * 3, a.y + ny / n * 3)) { ux = nx / n; uy = ny / n; }
      }
    }
    const step = Math.min(d, budget, 2), nx = a.x + ux * step, ny = a.y + uy * step;
    if (grid.free(nx, ny)) { a.x = nx; a.y = ny; }
    else {
      // the veer would clip something: take the plain step instead (or, standing inside a seat's box, just go)
      const sx = a.x + dx / d * step, sy = a.y + dy / d * step;
      if (grid.free(sx, sy) || !grid.free(a.x, a.y)) { a.x = sx; a.y = sy; } else { L.path = []; break; }
    }
    budget -= step;
    if (Math.hypot(p.x - a.x, p.y - a.y) < 1) L.path.shift();
    a.facing = faceTo(dx, dy);
  }
  const moved = Math.hypot(a.x - start.x, a.y - start.y);
  if (moved > 0.001) { a.moving = true; a.vx = (a.x - start.x) / dt; a.vy = (a.y - start.y) / dt; L.phase += moved * 0.26; L.pose = "walk"; }
  if (!L.path.length) {
    if (Math.hypot(g.x - a.x, g.y - a.y) < 3) { a.x = g.x; a.y = g.y; return "arrived"; }
    return "moving"; // replan next step
  }
  return "moving";
}
function resumeAfter(L: Life) { L.spot = L.spot; /* the pause keeps the goal; "do" ends -> idle -> same goal is chosen again */ L.visit--; }

/** String pulling: from each point, jump to the farthest later point in a straight free line (looks ahead 8). */
function smooth(from: { x: number; y: number }, pts: { x: number; y: number }[], free: (x: number, y: number) => boolean) {
  const out: { x: number; y: number }[] = [];
  let cur = from, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 8);
    while (j > i && !sweptFree(cur, pts[j], free)) j--;
    out.push(pts[j]); cur = pts[j]; i = j + 1;
  }
  return out;
}

function obstacles(w: World, a: Actor) {
  const out: { x: number; y: number; r: number }[] = [];
  for (const b of w.actors) {
    if (b === a || b.area !== a.area) continue;
    if (isFolk(b)) { if (b.life!.state !== "indoors" && Math.hypot(b.x - a.x, b.y - a.y) < 30) out.push({ x: b.x, y: b.y, r: 6 }); }
    else if (Math.hypot(b.x - a.x, b.y - a.y) < 50) out.push({ x: b.x, y: b.y - 2, r: 13 });
  }
  return out;
}

/** The golem walks at someone standing in its way: they step aside, to the side they are already on. */
function makeWay(w: World, a: Actor, area: Area, dt: number) {
  const L = a.life!;
  if (L.state === "walk" || L.state === "aside" || L.pose === "lie" || L.pose === "sit") return;
  for (const b of w.actors) {
    if (b === a || b.area !== a.area || isFolk(b)) continue;
    const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy), v = Math.hypot(b.vx, b.vy);
    if (d > 16 || v < 6 || (dx * b.vx + dy * b.vy) <= 0) continue;
    const ux = b.vx / v, uy = b.vy / v, side = dx * -uy + dy * ux >= 0 ? 1 : -1;
    for (const k of [side, -side]) {
      const tx = a.x + -uy * k * 16, ty = a.y + ux * k * 16;
      const f = nearestFree(area, tx, ty, [], [8, 4]);
      if (f && Math.hypot(f.x - b.x - b.vx * 0.3, f.y - b.y - b.vy * 0.3) > 12) {
        if (L.chat) endChat(w, a);
        const keep = L.goal;
        L.path = [{ x: f.x, y: f.y }]; L.state = "aside";
        L.goal = { x: f.x, y: f.y, facing: faceTo(b.x - f.x, b.y - f.y) };
        L.spot = keep ? L.spot : null;
        L.head = gazeAt(a.facing, -dx, -dy); L.glance = 1.2;
        return;
      }
    }
  }
  void dt;
}

// ---------------------------------------------------------------- noticing the golem
function noticeGolem(w: World, a: Actor, area: Area) {
  const L = a.life!, pl = player(w);
  if (pl.area !== a.area || L.pose === "lie") return;
  const n = traitsOf(a.person!).find((t) => t.notice)?.notice ?? { range: 52, react: "glance" as const };
  const range = archetypeOf(a).age === "young" ? Math.max(n.range, 80) : n.range;
  const dx = pl.x - a.x, dy = pl.y - a.y, d = Math.hypot(dx, dy);
  if (d > range) return;
  // a glance follows the golem as far as the neck turns (stepping aside too: the body walks away, the eyes stay on it)
  if (L.glance > 0) { L.head = gazeAt(a.facing, dx, dy); return; }
  if (L.cool > 0 || L.state === "aside") return;
  const r = roll(w, a);
  L.glance = 1.4 + r * 2; L.cool = 7 + r * 10; L.head = gazeAt(a.facing, dx, dy);
  if (L.state !== "do" && L.state !== "idle") return;
  const quirk = traitsOf(a.person!).find((t) => t.quirk)?.quirk;
  // standing about: turn to look properly; the young and the friendly wave
  if (L.pose === "stand" || L.pose === "lean" || L.pose === "browse") {
    a.facing = faceTo(dx, dy); L.head = null;
    if ((quirk === "wave" || archetypeOf(a).age === "young") && d < 70 && r < 0.6) { L.pose = "wave"; L.wait = Math.max(L.wait, 1.6); }
  }
  if (n.react === "wary" && d < 34) {
    const f = nearestFree(area, a.x - dx / d * 18, a.y - dy / d * 18, [], [8, 4]);
    if (f) { L.path = [f]; L.goal = { x: f.x, y: f.y, facing: faceTo(dx, dy) }; L.state = "aside"; }
  } else if (n.react === "approach" && d > 30 && (L.act === "wander" || L.act === "socialize" || L.act === "camp") && L.state === "do") {
    const f = nearestFree(area, pl.x - dx / d * 26, pl.y - dy / d * 26, [], [8, 4]);
    if (f) { L.path = [f]; L.goal = { x: f.x, y: f.y, facing: faceTo(dx, dy) }; L.state = "aside"; L.wait = 3; }
  }
}

// ---------------------------------------------------------------- talking among themselves
function seekChat(w: World, a: Actor, plan: Plan) {
  const L = a.life!;
  if (!SOCIAL[plan.act] || L.chatCool > 0 || L.chat || L.pose === "lie") return;
  for (const b of w.actors) {
    if (b === a || b.area !== a.area || !isFolk(b)) continue;
    const M = b.life!;
    if (M.chat || M.state === "indoors" || M.chatCool > 0 || M.attend > 0 || M.pose === "lie" || !SOCIAL[M.act]) continue;
    if (M.state !== "do" && !(M.state === "walk" && (M.act === "wander" || M.act === "errand"))) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d > (L.state === "walk" ? 22 : 36)) continue;
    const p = 0.35 * dial(a.person!, "chatty") * dial(b.person!, "chatty");
    if (roll(w, a) > p) { L.chatCool = 3 + roll(w, a) * 4; return; }
    const len = (4 + roll(w, a) * 6) * Math.sqrt(dial(a.person!, "chatty") * dial(b.person!, "chatty"));
    for (const [x, y, sp] of [[a, b, true], [b, a, false]] as [Actor, Actor, boolean][]) {
      const X = x.life!;
      if (X.state === "walk") { X.state = "do"; X.wait = len + 1; X.visit--; }
      X.chat = { with: y.id, t: len, turn: 0.4 + (sp ? 0 : 1.2), speaker: sp };
      faceToward(x, y.x, y.y);
      if (X.pose === "walk" || X.pose === "browse") X.pose = "stand";
    }
    return;
  }
}

function tickChat(w: World, a: Actor, dt: number) {
  const L = a.life!, c = L.chat!, b = actorById(w, c.with);
  if (!b || b.area !== a.area || !b.life?.chat) { endChat(w, a); return; }
  c.t -= dt; c.turn -= dt;
  faceToward(a, b.x, b.y);
  if (c.turn <= 0) {
    c.speaker = !c.speaker; c.turn = 1.3 + roll(w, a) * 1.2;
    if (c.speaker) {
      const topics = archetypeOf(a).topics, mood = traitsOf(a.person!).find((t) => t.quirk === "whistle" || t.quirk === "sigh");
      const icon: ChatIcon = roll(w, a) < 0.2 ? (mood?.quirk === "sigh" ? "ask" : "laugh") : topics[Math.floor(roll(w, a) * topics.length)];
      emit(w, { t: "folkChat", folk: a.id, icon });
    }
  }
  const sitting = rooted(L);
  if (!sitting && L.pose !== "drink") L.pose = c.speaker && c.turn > 0.5 ? "chat" : "stand";
  if (c.t <= 0) endChat(w, a);
}

function endChat(w: World, a: Actor) {
  const L = a.life!, b = L.chat ? actorById(w, L.chat.with) : undefined;
  L.chat = null; L.chatCool = 10 + roll(w, a) * 14;
  if (L.pose === "chat") L.pose = "stand";
  if (b?.life?.chat?.with === a.id) { b.life.chat = null; b.life.chatCool = 10 + roll(w, b) * 14; if (b.life.pose === "chat") b.life.pose = "stand"; }
}

// ---------------------------------------------------------------- the golem talks to them
/** The `folkTalk` effect: they stop, turn to the golem and say a line (the host shows it in a speech bubble). */
export function folkTalk(w: World, by: Actor, targetId: string | undefined) {
  const a = targetId ? actorById(w, targetId) : undefined;
  if (!a || !isFolk(a) || a.area !== by.area || !folkPresent(a)) return;
  const L = a.life!;
  if (L.chat) endChat(w, a);
  const arch = archetypeOf(a);
  const pool = [...arch.lines, ...traitsOf(a.person!).flatMap((t) => t.lines ?? []), ...(ACTIVITY_LINES[L.act] ?? [])];
  const line = pool[Math.floor(H(w, a.id, 5000 + L.talks++) * pool.length)];
  L.attend = 3.6; L.glance = 0; L.cool = 12;
  emit(w, { t: "talkedTo", actor: by.id, npc: a.id });
  emit(w, { t: "folkSpoke", actor: by.id, folk: a.id, line });
}

/** Give someone a duty that outranks their routine (the seam for contracts and recruitment). */
export function assignDuty(a: Actor, duty: Duty | null) {
  if (!isFolk(a)) return;
  a.life!.duty = duty;
}

/** "ALDRIC KEMP - LABOURER": the name and what they are, for notes and the scan. */
export const folkLabel = (a: Actor) => `${a.person!.name} - ${archetypeOf(a).title}`;

// ---------------------------------------------------------------- helpers
export function faceTo(dx: number, dy: number): Facing {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}
const ROT: Facing[] = ["up", "right", "down", "left"];
const turn = (f: Facing, k: number): Facing => ROT[(ROT.indexOf(f) + k + 4) % 4];
const STEP: Record<Facing, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

// ---------------------------------------------------------------- heads
// A head turns a quarter turn either way from the body and no further, as a neck does. With four facings a head
// looks where the body faces (null) or to one side of it, never the other way from it.
/** The head as it can be on a body facing `facing`: null (straight ahead) for the body's own facing and the one behind it. */
export function naturalHead(facing: Facing, head: Facing | null | undefined): Facing | null {
  return !head || head === facing || head === turn(facing, 2) ? null : head;
}
/** Where the head turns to look at something (dx, dy) away: at it, within a quarter turn; if it is behind, over the shoulder on its side. */
export function gazeAt(facing: Facing, dx: number, dy: number): Facing | null {
  const want = faceTo(dx, dy);
  if (want !== turn(facing, 2)) return naturalHead(facing, want);
  const side = turn(facing, 1), [sx, sy] = STEP[side];
  return dx * sx + dy * sy >= 0 ? side : turn(facing, -1);
}
/** Seated, or warming at the fire: the body keeps to its place and only the head turns. */
const rooted = (L: Life) => L.pose === "sit" || L.pose === "warm" || L.pose === "lie";
/** Turn to someone: a standing body faces them; a seated one keeps its seat and turns its head as far as it goes. */
function faceToward(a: Actor, x: number, y: number) {
  const L = a.life!;
  if (rooted(L)) L.head = gazeAt(a.facing, x - a.x, y - a.y);
  else { a.facing = faceTo(x - a.x, y - a.y); L.head = null; }
}
/** A drawn bow is held side-on (folkArt.ts draws the aim in profile): a hunter facing the camera, or away, turns to a side. */
function aimSideOn(w: World, a: Actor) {
  if (a.life!.pose === "aim" && a.facing !== "left" && a.facing !== "right") a.facing = H(w, a.id, 6000 + a.life!.visit) < 0.5 ? "left" : "right";
}
export { TS as FOLK_TS };
