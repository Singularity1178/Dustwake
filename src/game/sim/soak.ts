// Soak-test harness (pure, no DOM). Runs N in-game days (or seconds) of a town
// with M residents, headless, at the fixed tick, and checks invariants as it goes:
//
//   stuck      nobody stays walking without getting anywhere for longer than X s
//   items      no item is duplicated or deleted (a census of every pack, worn slot,
//              core, prop and loose stack is the same at the end as at the start)
//   place      no place (a spot, a lamp on the round) is held by two people
//   roundTrip  save -> load -> save gives the same save as the live world
//   budget     the mean simulation time per tick stays within the frame budget
//
// tests/soak.test.ts runs a short 300-actor soak on every `npm test`;
// scripts/soak.mjs runs long ones from the command line (docs/testing/soak.md).
import { createWorld, player, getArea, enterArea, type Actor, type World } from "../world/world";
import { CENSUS, EXCLUSIVE_KINDS, EXCLUSIVE_IDS, type CensusRow } from "../content/folk";
import { DAY_SECONDS } from "../content/daycycle";
import { makeFolk, isFolk, censusKey } from "./folk";
import { zoneById } from "../world/zones";
import { enableLod, lodTier } from "./lod";
import { serialize, deserialize } from "../world/save";
import { simTick, IDLE, type TickInput } from "./replay";
import { TICK } from "../core/clock";

export interface SoakOptions {
  seed?: number;
  /** Residents in the area (the census's own people count toward it). Default 300. */
  residents?: number;
  area?: string;
  /** How long to run: in-game days (DAY_SECONDS each) or seconds. Default one day. */
  days?: number;
  seconds?: number;
  /** Simulation LOD (sim/lod.ts). Default on, as the game runs. */
  lod?: boolean;
  /** Walking without getting anywhere for longer than this is "stuck" (s). Default 45. */
  stuckSeconds?: number;
  /** Mean simulation ms per tick allowed. Default 4 (of a 16.7 ms frame). */
  budgetMs?: number;
  /** Also check the save round trip every this many ticks (0: only at the end). */
  roundTripEvery?: number;
  /** The player walks a square round the area, so the in-view window moves (LOD tiers change). */
  walk?: boolean;
  /** The hour the soak starts at (default 12: people are out). */
  hour?: number;
  now?: () => number;
  onProgress?: (done: number, total: number) => void;
}

export type ViolationKind = "stuck" | "items" | "place" | "roundTrip" | "budget";
export interface Violation { kind: ViolationKind; at: number; detail: string }

export interface SoakReport {
  seed: number;
  residents: number;
  actors: number;
  ticks: number;
  simSeconds: number;
  /** Per-tick simulation time after the first second (settling everyone in is reported apart, as `firstMs`). */
  ms: { mean: number; p95: number; max: number; total: number };
  firstMs: number;
  /** Mean actors per LOD tier (sampled every 30 ticks; far counts everyone in other areas). */
  tiers: { active: number; near: number; far: number };
  items: number;
  violations: Violation[];
  ok: boolean;
}

/** Fill a place (a zone of the overworld, or an area) up to `n` townsfolk, cloning its census rows (homes and routines reused, ids and people new). */
export function populateResidents(w: World, n: number, place = "westwake"): Actor[] {
  const rows = CENSUS.filter((r) => censusKey(r) === place);
  if (!rows.length) throw new Error(`no census rows for "${place}"`);
  getArea(w, rows[0].area);
  const have = w.actors.filter((a) => isFolk(a) && (a.person?.zone ?? a.person?.origin) === place).length;
  const taken = new Set(w.actors.filter(isFolk).map((a) => a.person!.name.split(" ")[0]));
  const made: Actor[] = [];
  for (let i = have; i < n; i++) {
    const row: CensusRow = { ...rows[i % rows.length], id: `folk.soak.${place}.${i}` };
    const a = makeFolk(w, row, taken);
    w.actors.push(a);
    made.push(a);
  }
  return made;
}

/** Every item in the world, by id: packs, worn gear, cores, props (on them and in them), loose stacks. `areas`: only these. */
export function itemCensus(w: World, areas?: ReadonlySet<string>, actors = true): Map<string, number> {
  const m = new Map<string, number>(), add = (id: string, n = 1) => m.set(id, (m.get(id) ?? 0) + n);
  if (actors) for (const a of w.actors) {
    for (const s of a.inventory) if (s) add(s.item, s.n);
    for (const it of Object.values(a.gear)) if (it) add(it);
    if (a.powerCore) add(a.powerCore);
  }
  for (const area of w.areas.values()) {
    if (areas && !areas.has(area.id)) continue;
    for (const p of area.props) {
      if (p.item && !p.taken) add(p.item);
      for (const s of p.inventory ?? []) if (s) add(s.item, s.n);
    }
    for (const l of area.loose) if (!l.taken) add(l.item, l.n ?? 1);
  }
  return m;
}

const inColl = (c: readonly string[], x: string) => c.includes(x);

/** Is a held place one person's at a time (content/folk.ts: EXCLUSIVE_KINDS / EXCLUSIVE_IDS, and the lamps on the round)? A household's door is not. */
export function exclusivePlace(w: World, area: string, spot: string): boolean {
  if (spot.startsWith("lamp:") || EXCLUSIVE_IDS.some((p) => spot.startsWith(p))) return true;
  const s = w.areas.get(area)?.base.spots?.find((x) => x.id === spot);
  return !!s && inColl(EXCLUSIVE_KINDS, s.kind);
}

/** Exclusive places held by more than one person: "area|spot" -> the holders. */
export function doubleHeld(w: World): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const a of w.actors) {
    if (!isFolk(a) || !a.life!.spot || !exclusivePlace(w, a.area, a.life!.spot)) continue;
    const k = `${a.area}|${a.life!.spot}`;
    by.set(k, [...(by.get(k) ?? []), a.id]);
  }
  return new Map([...by].filter(([, ids]) => ids.length > 1));
}

/** Does save -> load -> save give the live world's save? (Empty string: yes; else where they first differ.) */
export function roundTripDiff(w: World): string {
  const a = JSON.stringify(serialize(w));
  const b = JSON.stringify(serialize(deserialize(JSON.parse(a))));
  if (a === b) return "";
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `differs at ${i}: ...${a.slice(Math.max(0, i - 60), i + 40)}... vs ...${b.slice(Math.max(0, i - 60), i + 40)}...`;
}

const diffCensus = (a: Map<string, number>, b: Map<string, number>) => {
  const out: string[] = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) out.push(`${k} ${a.get(k) ?? 0} -> ${b.get(k) ?? 0}`);
  return out;
};

/** The walker's square: west into the town first (it starts at the east gate), so it stays among the people. */
const WALK: TickInput[] = [{ ix: -1, iy: 0, use: false }, { ix: 0, iy: 1, use: false }, { ix: 1, iy: 0, use: false }, { ix: 0, iy: -1, use: false }];

export function runSoak(o: SoakOptions = {}): SoakReport {
  const seed = o.seed ?? 1234, place = o.area ?? "westwake", stuckS = o.stuckSeconds ?? 45, budget = o.budgetMs ?? 4;
  const now = o.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const w = createWorld(seed);
  if (o.lod !== false) enableLod(w);
  w.day = Math.floor(w.day) + 1 + (o.hour ?? 12) / 24;
  // the place soaked: a zone of the overworld (Westwake) or an area; the walker starts where one arrives in it
  const pl = player(w), home = CENSUS.find((r) => censusKey(r) === place)?.area ?? place, at = getArea(w, home), s0 = zoneById(at, place)?.anchor ?? at.start;
  enterArea(w, pl, home, s0.x, s0.y);
  populateResidents(w, o.residents ?? 300, place);
  w.events = [];
  const ticks = Math.max(1, Math.round((o.seconds ?? (o.days ?? 1) * DAY_SECONDS) / TICK));
  const violations: Violation[] = [];
  const v = (kind: ViolationKind, detail: string) => { if (violations.length < 50) violations.push({ kind, at: w.time, detail }); };
  const before = itemCensus(w), known = new Set(w.areas.keys());
  const walking = new Map<string, { x: number; y: number; since: number; told: boolean }>();
  const times: number[] = [];
  const tiers = { active: 0, near: 0, far: 0 };
  let firstMs = 0;
  for (let t = 0; t < ticks; t++) {
    const t0 = now();
    simTick(w, o.walk ? WALK[Math.floor(t / 300) % 4] : IDLE);
    const ms = now() - t0;
    if (t < Math.round(1 / TICK)) firstMs += ms; else times.push(ms);
    w.events.length = 0;
    if (t % 30 === 0) {
      for (const a of w.actors) if (a.id !== w.playerId) tiers[lodTier(w, a, pl)]++;
      // an area loaded since (the walker went through a door) comes with its builder's items: they join the census
      for (const id of w.areas.keys()) if (!known.has(id)) { known.add(id); for (const [k, n] of itemCensus(w, new Set([id]), false)) before.set(k, (before.get(k) ?? 0) + n); }
      for (const a of w.actors) {
        if (!isFolk(a)) continue;
        const L = a.life!;
        // only people being simulated can be stuck: far ones are abstract (sim/lod.ts) and set down on re-entry
        if (L.state !== "walk" || a.area !== pl.area || lodTier(w, a, pl) === "far") { walking.delete(a.id); continue; }
        const s = walking.get(a.id);
        if (!s || Math.hypot(a.x - s.x, a.y - s.y) > 2) walking.set(a.id, { x: a.x, y: a.y, since: w.time, told: false });
        else if (!s.told && w.time - s.since > stuckS) { s.told = true; v("stuck", `${a.id} walking in place at ${Math.round(a.x)},${Math.round(a.y)} in ${a.area} for ${Math.round(w.time - s.since)} s`); }
      }
      for (const [k, ids] of doubleHeld(w)) v("place", `${k} held by ${ids.join(", ")}`);
    }
    if (o.roundTripEvery && t > 0 && t % o.roundTripEvery === 0) { const d = roundTripDiff(w); if (d) v("roundTrip", d); }
    if (o.onProgress && t % 600 === 0) o.onProgress(t, ticks);
  }
  for (const d of diffCensus(before, itemCensus(w))) v("items", d);
  const rt = roundTripDiff(w);
  if (rt) v("roundTrip", rt);
  const sorted = [...times].sort((a, b) => a - b), total = times.reduce((s, x) => s + x, 0);
  const ms = { mean: times.length ? total / times.length : 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, max: sorted[sorted.length - 1] ?? 0, total: total + firstMs };
  if (ms.mean > budget) v("budget", `mean ${ms.mean.toFixed(3)} ms per tick is over the ${budget} ms budget`);
  const n = Math.max(1, Math.ceil(ticks / 30));
  return {
    seed, residents: w.actors.filter(isFolk).length, actors: w.actors.length, ticks, simSeconds: ticks * TICK, ms, firstMs,
    tiers: { active: tiers.active / n, near: tiers.near / n, far: tiers.far / n },
    items: [...itemCensus(w).values()].reduce((s, x) => s + x, 0), violations, ok: violations.length === 0,
  };
}
