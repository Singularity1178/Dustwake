// Townsfolk: generic NPCs (data). Pure; no DOM, no World.
//
// The Treasury Guardian is hand-authored (content/npcs.ts). Everyone here is
// generic: a person is an ARCHETYPE (what they do: the watch, a labourer...),
// two TRAITS (how they do it), a name from NAMES and a generated look, living
// by a ROUTINE over the day clock. sim/folk.ts turns these rows into people
// and runs them; folkArt.ts draws them. Adding to the world is adding rows:
//
//   - an archetype: an ARCHETYPES row (garb + routine ids + talk lines); its
//     garb can reuse an existing one in folkArt.ts or add a draw entry there.
//   - a trait: a TRAITS row. Every field is a dial the routine runner reads.
//   - a routine: a ROUTINES row (blocks of the day, each an activity and a
//     place query). New activities need a case in sim/folk.ts.
//   - a resident: a CENSUS row (area, archetype, home). Names, traits and looks
//     are drawn from the world seed by hash, so each new world has its own town.
//
// Places are the area's `spots` (map.ts: Spot): a query names spot kinds and,
// optionally, an id prefix and how near home to look. A stool, an anvil or a
// bedroll holds one person at a time (EXCLUSIVE_KINDS); meeting places are shared.

import type { Spot } from "../map";

export type FolkHabitat = "town" | "forest";

/** What someone is doing in a block of their day. Each has its own behaviour in sim/folk.ts. */
export type Activity =
  | "sleep"      // in bed: indoors at home (hidden), or on a bedroll at camp
  | "indoors"    // at home, awake (hidden)
  | "work"       // at a work place, working (the spot id names the motion: work.haul.*, chore.chop.*...)
  | "chore"      // household work near home
  | "errand"     // brisk walks between doors and the market
  | "wander"     // a stroll: walk, pause, look about, maybe sit
  | "socialize"  // go where people meet and talk to whoever is there
  | "sit"        // a bench in the sun
  | "gather"     // at the tavern door at dusk
  | "tavern"     // inside the tavern, on a stool
  | "patrol"     // walk a watch route, stopping to look about
  | "post"       // stand watch at a gate
  | "lamps"      // the lamplighter's round: every fire light, in the order it is lit (or doused)
  | "hunt"       // stalk from blind to blind, draw, loose
  | "forage"     // stoop and gather
  | "camp"       // by the fire
  | "shop"       // a trip to a shop: in by its door, a visit (content/shops.ts: VISITS), out again
  | "board";     // reading the guild's board (a duty's activity: the seam for contracts)

/** Where a block happens: the first spots matching, chosen per person and per day by hash. */
export interface PlaceQuery {
  kinds: Spot["kind"][];
  /** Only spots whose id starts with one of these. */
  prefix?: string[];
  /** Prefer the N candidates nearest home (0: anywhere). */
  nearHome?: number;
}

export interface RoutineBlock {
  /** Hours (0..24, `to` may run past midnight up to 30). */
  from: number; to: number;
  act: Activity;
  at?: PlaceQuery;
}

/** One person's day, start to end. Blocks must tile the day (tests/folk.test.ts checks). */
export interface RoutineDef { id: string; blocks: RoutineBlock[] }

/** Drawn outfit family (folkArt.ts: GARB). */
export type Garb = "watch" | "labourer" | "apprentice" | "adventurer" | "resident" | "elder" | "hunter" | "forager";

export interface ArchetypeDef {
  id: string;
  /** Shown in the scan readout and the talk note. */
  title: string;
  habitat: FolkHabitat;
  garb: Garb;
  /** Walking speed (px/s) before traits. The golem limps at 48. */
  speed: number;
  /** Routine ids; a census row may pick one, else the person's hash does. */
  routines: string[];
  /** Body: young (apprentices) are shorter, old stoop. */
  age: "young" | "adult" | "old";
  /** Topics they chat about (folkArt.ts draws each as a pictogram in a speech bubble). */
  topics: ChatIcon[];
  /** What they say when the golem talks to them (one picked per talk). */
  lines: string[];
}

export type ChatIcon = "heart" | "note" | "mug" | "coin" | "sword" | "bang" | "ask" | "sun" | "moon" | "bread" | "deer" | "leaf" | "stone" | "laugh" | "skull" | "hammer";

export interface TraitDef {
  id: string;
  label: string;
  /** Traits in the same group exclude each other. */
  group: string;
  /** Hours the whole day runs early (-) or late (+). */
  shift?: number;
  /** Hours added to the end of these activities (they stay longer). */
  extend?: Partial<Record<Activity, number>>;
  /** Walking speed multiplier. */
  speed?: number;
  /** How long they linger at each stop (multiplier). */
  linger?: number;
  /** Chance to stop and pause mid-walk (multiplier). */
  dawdle?: number;
  /** Chance to strike up talk, and how long it lasts (multiplier). */
  chatty?: number;
  /** How far they notice the golem (px) and what they do: glance, approach to look, step back. */
  notice?: { range: number; react: "glance" | "approach" | "wary" };
  /** Wander radius: wide (the whole area) or near home. */
  roam?: "wide" | "near";
  /** Idle flourish (folkArt.ts / the host): whistles (notes), sighs (a puff), hums, sways (a drink too many). */
  quirk?: "whistle" | "sigh" | "sway" | "stretch" | "wave";
  /** Lines added to their talk. */
  lines?: string[];
}

export const TRAITS: Record<string, TraitDef> = {
  early_riser: { id: "early_riser", label: "EARLY RISER", group: "clock", shift: -1.2, linger: 0.9, lines: ["UP BEFORE THE ROOSTER, AS EVER."] },
  night_owl: { id: "night_owl", label: "NIGHT OWL", group: "clock", shift: 1.2, extend: { gather: 0.6, tavern: 1 }, lines: ["THE NIGHT'S WHEN A BODY CAN THINK."] },
  sociable: { id: "sociable", label: "SOCIABLE", group: "social", chatty: 2.2, linger: 1.2, quirk: "wave", lines: ["HAVE YOU MET EVERYONE YET? YOU SHOULD."] },
  reserved: { id: "reserved", label: "RESERVED", group: "social", chatty: 0.35, linger: 0.8, notice: { range: 46, react: "wary" }, lines: ["...", "I KEEP TO MYSELF."] },
  curious: { id: "curious", label: "CURIOUS", group: "notice", notice: { range: 96, react: "approach" }, lines: ["WHAT ARE YOU MADE OF? CAN I LOOK?", "DO YOU DREAM, STONE ONE?"] },
  wary: { id: "wary", label: "WARY", group: "notice", notice: { range: 64, react: "wary" }, dawdle: 0.6, lines: ["STAY BACK A PACE, IF IT PLEASES YOU."] },
  brisk: { id: "brisk", label: "BRISK", group: "pace", speed: 1.3, linger: 0.6, dawdle: 0.3, lines: ["CAN'T STOP. TIME IS COIN."] },
  idler: { id: "idler", label: "IDLER", group: "pace", speed: 0.8, linger: 1.6, dawdle: 2.2, quirk: "stretch", lines: ["NO HURRY. THE DAY ISN'T GOING ANYWHERE."] },
  cheerful: { id: "cheerful", label: "CHEERFUL", group: "mood", chatty: 1.3, quirk: "whistle", lines: ["FINE DAY! EVERY DAY'S A FINE DAY."] },
  grumpy: { id: "grumpy", label: "GRUMPY", group: "mood", chatty: 0.6, quirk: "sigh", lines: ["HMPH.", "WHAT NOW?"] },
  restless: { id: "restless", label: "RESTLESS", group: "roam", roam: "wide", dawdle: 0.8, lines: ["I'D WALK TO THE CAPITAL IF THE ROAD WENT THAT WAY."] },
  homebody: { id: "homebody", label: "HOMEBODY", group: "roam", roam: "near", lines: ["I'VE NEVER BEEN PAST THE EAST GATE. NEVER NEEDED TO."] },
  thirsty: { id: "thirsty", label: "FOND OF ALE", group: "vice", extend: { gather: 1, tavern: 1.5 }, quirk: "sway", lines: ["FIRST ROUND'S ON YOU, CLAY-FOOT."] },
};

const Q = (kinds: Spot["kind"][], prefix?: string[], nearHome?: number): PlaceQuery => ({ kinds, prefix, nearHome });
const HOME = Q(["door"]);
const MEET = Q(["idle", "bench"], ["idle.cross", "idle.well", "idle.statue", "idle.board", "idle.guildsteps", "idle.lamp", "bench"]);
const WANDER = Q(["wander", "idle", "bench"]);
const GATHER = Q(["gather"]);
const TAVERN = Q(["seat"]);

export const ROUTINES: Record<string, RoutineDef> = {
  watch_day: { id: "watch_day", blocks: [
    { from: 0, to: 5.6, act: "sleep", at: HOME },
    { from: 5.6, to: 7.4, act: "lamps" },
    { from: 7.4, to: 10.5, act: "post", at: Q(["idle"], ["watch."]) },
    { from: 10.5, to: 12.5, act: "patrol" },
    { from: 12.5, to: 13.5, act: "socialize", at: MEET },
    { from: 13.5, to: 16, act: "patrol" },
    { from: 16, to: 18.6, act: "post", at: Q(["idle"], ["watch."]) },
    { from: 18.6, to: 19.4, act: "socialize", at: MEET },
    { from: 19.4, to: 21.6, act: "lamps" },
    { from: 21.6, to: 24, act: "sleep", at: HOME },
  ] },
  watch_night: { id: "watch_night", blocks: [
    { from: 0, to: 6, act: "patrol" },
    { from: 6, to: 7.6, act: "post", at: Q(["idle"], ["watch."]) },
    { from: 7.6, to: 15, act: "sleep", at: HOME },
    { from: 15, to: 17, act: "wander", at: WANDER },
    { from: 17, to: 19.2, act: "gather", at: GATHER },
    { from: 19.2, to: 24, act: "patrol" },
  ] },
  labourer: { id: "labourer", blocks: [
    { from: 0, to: 5.4, act: "sleep", at: HOME },
    { from: 5.4, to: 6.4, act: "indoors", at: HOME },
    { from: 6.4, to: 12, act: "work", at: Q(["work"], ["work.haul", "work.dig"]) },
    { from: 12, to: 13, act: "socialize", at: Q(["bench", "gather", "idle"], ["bench.tavern", "gather", "idle.crown"]) },
    { from: 13, to: 18.2, act: "work", at: Q(["work"], ["work.haul", "work.dig"]) },
    { from: 18.2, to: 20.4, act: "gather", at: GATHER },
    { from: 20.4, to: 22.4, act: "tavern", at: TAVERN },
    { from: 22.4, to: 24, act: "sleep", at: HOME },
  ] },
  apprentice: { id: "apprentice", blocks: [
    { from: 0, to: 6, act: "sleep", at: HOME },
    { from: 6, to: 7.2, act: "errand", at: Q(["door", "customer"]) },
    { from: 7.2, to: 12, act: "work", at: Q(["work"], ["work.hammer"]) },
    { from: 12, to: 13.2, act: "wander", at: WANDER },
    { from: 13.2, to: 17, act: "work", at: Q(["work"], ["work.hammer"]) },
    { from: 17, to: 19.6, act: "socialize", at: MEET },
    { from: 19.6, to: 24, act: "sleep", at: HOME },
  ] },
  adventurer: { id: "adventurer", blocks: [
    { from: 0, to: 0.6, act: "tavern", at: TAVERN },
    { from: 0.6, to: 8, act: "sleep", at: HOME },
    { from: 8, to: 10, act: "socialize", at: Q(["idle"], ["idle.board", "idle.guildsteps", "idle.cross"]) },
    { from: 10, to: 13, act: "wander", at: WANDER },
    { from: 13, to: 15, act: "socialize", at: Q(["idle"], ["idle.board", "idle.guildsteps", "idle.cross"]) },
    { from: 15, to: 18, act: "wander", at: WANDER },
    { from: 18, to: 20, act: "gather", at: GATHER },
    { from: 20, to: 24, act: "tavern", at: TAVERN },
  ] },
  resident: { id: "resident", blocks: [
    { from: 0, to: 6, act: "sleep", at: HOME },
    { from: 6, to: 8, act: "chore", at: Q(["chore"], undefined, 3) },
    { from: 8, to: 11, act: "errand", at: Q(["customer", "door", "idle"], ["stall", "door.bakery", "door.apothecary", "idle.well"]) },
    { from: 11, to: 12.6, act: "indoors", at: HOME },
    { from: 12.6, to: 16, act: "chore", at: Q(["chore"], undefined, 3) },
    { from: 16, to: 18, act: "socialize", at: MEET },
    { from: 18, to: 20, act: "wander", at: WANDER },
    { from: 20, to: 24, act: "indoors", at: HOME },
  ] },
  elder: { id: "elder", blocks: [
    { from: 0, to: 7, act: "sleep", at: HOME },
    { from: 7, to: 9, act: "indoors", at: HOME },
    { from: 9, to: 12, act: "sit", at: Q(["bench"]) },
    { from: 12, to: 14, act: "indoors", at: HOME },
    { from: 14, to: 17, act: "socialize", at: Q(["idle", "bench"], ["idle.well", "idle.statue", "idle.cross", "bench"]) },
    { from: 17, to: 19, act: "wander", at: Q(["wander", "bench"], undefined, 6) },
    { from: 19, to: 24, act: "indoors", at: HOME },
  ] },
  hunter: { id: "hunter", blocks: [
    { from: 0, to: 4.8, act: "sleep", at: Q(["bed"]) },
    { from: 4.8, to: 6, act: "camp", at: Q(["camp"]) },
    { from: 6, to: 11, act: "hunt", at: Q(["hunt"]) },
    { from: 11, to: 12.5, act: "camp", at: Q(["camp"]) },
    { from: 12.5, to: 18, act: "hunt", at: Q(["hunt"]) },
    { from: 18, to: 22.5, act: "camp", at: Q(["camp"]) },
    { from: 22.5, to: 24, act: "sleep", at: Q(["bed"]) },
  ] },
  forager: { id: "forager", blocks: [
    { from: 0, to: 5.4, act: "sleep", at: Q(["bed"]) },
    { from: 5.4, to: 7, act: "camp", at: Q(["camp"]) },
    { from: 7, to: 12, act: "forage", at: Q(["forage"]) },
    { from: 12, to: 13, act: "camp", at: Q(["camp"]) },
    { from: 13, to: 17.5, act: "forage", at: Q(["forage"]) },
    { from: 17.5, to: 23, act: "camp", at: Q(["camp"]) },
    { from: 23, to: 24, act: "sleep", at: Q(["bed"]) },
  ] },
};

export const ARCHETYPES: Record<string, ArchetypeDef> = {
  watch: {
    id: "watch", title: "TOWN WATCH", habitat: "town", garb: "watch", speed: 19, routines: ["watch_day", "watch_night"], age: "adult",
    topics: ["bang", "sword", "moon", "mug", "ask"],
    lines: ["MOVE ALONG. NOTHING TO SEE.", "THE CHARTER STONE NEVER SLEEPS, AND NEITHER DO WE. MOSTLY.", "YOU'RE ONE OF THE OLD ONES, AREN'T YOU? FROM THE KEEP?", "KEEP TO THE STREETS AFTER DARK. THE WOODS AREN'T OURS."],
  },
  labourer: {
    id: "labourer", title: "LABOURER", habitat: "town", garb: "labourer", speed: 17, routines: ["labourer"], age: "adult",
    topics: ["stone", "mug", "coin", "laugh", "sun"],
    lines: ["YOU COULD LIFT A WAGON, YOU. WANT WORK IN THE YARD?", "THE HAULING GOLEMS NEVER TALK BACK. YOU, THOUGH...", "ACHE IN MY BACK SAYS RAIN.", "STONE DON'T CARRY ITSELF. WELL. YOURS MIGHT."],
  },
  apprentice: {
    id: "apprentice", title: "APPRENTICE", habitat: "town", garb: "apprentice", speed: 23, routines: ["apprentice"], age: "young",
    topics: ["hammer", "laugh", "ask", "coin", "heart"],
    lines: ["MASTER SAYS I'LL STRIKE MY OWN BLADE BY WINTER!", "ARE YOU A GOLEM? A REAL ONE? WHO MADE YOU?", "DON'T TELL ANYONE YOU SAW ME HERE.", "I COULD FIX THAT ARM OF YOURS. PROBABLY."],
  },
  adventurer: {
    id: "adventurer", title: "ADVENTURER", habitat: "town", garb: "adventurer", speed: 20, routines: ["adventurer"], age: "adult",
    topics: ["sword", "coin", "skull", "mug", "laugh"],
    lines: ["NOTHING ON THE GUILD BOARD BUT RAT CELLARS AGAIN.", "BETWEEN CONTRACTS. IT'S A PROFESSION, I SWEAR.", "SAW RUINS EAST OF HERE ONCE. YOU WOULDN'T KNOW ANYTHING ABOUT THAT?", "IF YOU'RE FOR HIRE, THE GUILD PAYS IN SILVER."],
  },
  resident: {
    id: "resident", title: "RESIDENT", habitat: "town", garb: "resident", speed: 18, routines: ["resident"], age: "adult",
    topics: ["bread", "heart", "sun", "coin", "ask"],
    lines: ["MIND THE WASHING, DEAR.", "THE BAKER'S LOAVES ARE SMALLER EVERY MARKET DAY.", "WESTWAKE'S QUIET. WE LIKE IT QUIET.", "MY GRANDMOTHER SAID THE KEEP'S STONE IS IN EVERY WALL HERE."],
  },
  elder: {
    id: "elder", title: "ELDER", habitat: "town", garb: "elder", speed: 11, routines: ["elder"], age: "old",
    topics: ["moon", "ask", "heart", "note", "sun"],
    lines: ["I REMEMBER WHEN THE HIGH STREET WAS MUD.", "THERE WERE STORIES OF A KEEP UNDER THE HILL. I NEVER BELIEVED THEM. NOW, HERE YOU STAND.", "SIT A WHILE. NOBODY SITS ANY MORE.", "THE STATUE BY THE WELL CAME UP FROM THE OLD STONES. IT LOOKS A BIT LIKE YOU."],
  },
  hunter: {
    id: "hunter", title: "HUNTER", habitat: "forest", garb: "hunter", speed: 19, routines: ["hunter"], age: "adult",
    topics: ["deer", "moon", "leaf", "bang", "laugh"],
    lines: ["QUIET. YOU'LL SPOOK THE DEER, STOMPING LIKE THAT.", "THE OLD CIRCLE IN THE CLEARING HUMS SOME NIGHTS. WE KEEP CLEAR.", "WESTWAKE'S A DAY'S WALK DOWN THE OLD ROAD. WE SELL PELTS THERE.", "SIT BY THE FIRE IF YOU LIKE. YOU DON'T FEEL THE COLD, I SUPPOSE."],
  },
  forager: {
    id: "forager", title: "FORAGER", habitat: "forest", garb: "forager", speed: 17, routines: ["forager"], age: "adult",
    topics: ["leaf", "bread", "sun", "heart", "ask"],
    lines: ["MUSHROOMS COME UP AFTER RAIN. NOT THE RED ONES. NEVER THE RED ONES.", "THESE WOODS FEED ANYONE WHO KNOWS WHERE TO LOOK.", "YOU'RE STEPPING ON THE SORREL.", "I'VE SEEN LIGHTS IN THE OLD STONES. GREEN ONES."],
  },
};

/** Given names and family names (the bitmap font: uppercase letters only). */
export const NAMES = {
  given: [
    "ALDRIC", "BRAM", "CORWIN", "DUNCAN", "EDRIC", "FENN", "GARETH", "HOLT", "IVO", "JORAH", "KELL", "LUDO", "MERRICK", "NOLL", "OSRIC", "PIP", "ROLF", "SEB", "TAM", "WAT",
    "ADA", "BRYNN", "CATRIN", "DELL", "EDDA", "FAY", "GWEN", "HILDE", "ISOLDE", "JOAN", "KIT", "LIS", "MAUD", "NELL", "ODILE", "PRU", "ROWAN", "SIBYL", "TILDE", "WYNN",
  ],
  family: [
    "ASHBY", "BARROW", "COOPER", "DALE", "FLETCHER", "GREAVES", "HOLLOW", "KEMP", "MARSH", "PIKE", "REEVE", "SALT", "THATCHER", "WELLS", "WICK", "BRACKEN", "STONE", "FARROW", "HALE", "MOSS",
  ],
} as const;

/** Who lives where: one row per person. `home` is a door spot id (or a camp bed spot for the forest). */
export interface CensusRow { id: string; area: string; archetype: string; home: string; routine?: string; route?: string }

export const CENSUS: CensusRow[] = [
  // ---- Westwake
  { id: "folk.watch.1", area: "town", archetype: "watch", home: "door.watch", routine: "watch_day", route: "high" },
  { id: "folk.watch.2", area: "town", archetype: "watch", home: "door.watch", routine: "watch_night", route: "low" },
  { id: "folk.watch.3", area: "town", archetype: "watch", home: "door.house_w1", routine: "watch_day", route: "west" },
  { id: "folk.lab.1", area: "town", archetype: "labourer", home: "door.cot_s1" },
  { id: "folk.lab.2", area: "town", archetype: "labourer", home: "door.cot_s3" },
  { id: "folk.lab.3", area: "town", archetype: "labourer", home: "door.house_l1" },
  { id: "folk.app.1", area: "town", archetype: "apprentice", home: "door.house_l2" },
  { id: "folk.app.2", area: "town", archetype: "apprentice", home: "door.cooper" },
  { id: "folk.adv.1", area: "town", archetype: "adventurer", home: "door.tavern" },
  { id: "folk.adv.2", area: "town", archetype: "adventurer", home: "door.tavern" },
  { id: "folk.res.1", area: "town", archetype: "resident", home: "door.cot_well_w" },
  { id: "folk.res.2", area: "town", archetype: "resident", home: "door.bakery" },
  { id: "folk.res.3", area: "town", archetype: "resident", home: "door.house_l3" },
  { id: "folk.res.4", area: "town", archetype: "resident", home: "door.cot_s2" },
  { id: "folk.res.5", area: "town", archetype: "resident", home: "door.townhouse_h" },
  { id: "folk.eld.1", area: "town", archetype: "elder", home: "door.cot_old" },
  { id: "folk.eld.2", area: "town", archetype: "elder", home: "door.cot_well_e" },
  // ---- the hunters' camp in the north-west wood
  { id: "folk.hunt.1", area: "surface", archetype: "hunter", home: "bed.1" },
  { id: "folk.hunt.2", area: "surface", archetype: "hunter", home: "bed.2" },
  { id: "folk.forage.1", area: "surface", archetype: "forager", home: "bed.3" },
];

/** Watch routes: spot ids walked in order, there and back. */
export const ROUTES: Record<string, Record<string, string[]>> = {
  town: {
    high: ["patrol.watchhouse", "patrol.gate", "patrol.high.e", "patrol.square.ne", "patrol.square.nw", "patrol.high.w", "patrol.bar"],
    low: ["patrol.watchhouse", "patrol.high.e", "patrol.yard.n", "patrol.low.e", "patrol.low.mid", "patrol.tavern", "patrol.low.w", "patrol.lane.w", "patrol.high.w", "patrol.square.nw", "patrol.square.ne"],
    west: ["patrol.bar", "patrol.high.w", "patrol.lane.n", "patrol.old.w", "patrol.old.e", "patrol.lane.n", "patrol.square.nw", "patrol.square.ne", "patrol.high.e"],
  },
};

/** Interior areas folk may go into, from the town door spot to the area (the tavern is the only one so far). */
export const FOLK_INTERIORS: Record<string, { area: string; door: string }> = {
  tavern: { area: "town_tavern", door: "door.tavern" },
  smithy: { area: "town_smithy", door: "door.smithy" },
  armory: { area: "town_armory", door: "door.armory" },
  jeweler: { area: "town_jeweler", door: "door.jeweler" },
  tailor: { area: "town_tailor", door: "door.tailor" },
  guild: { area: "town_guild", door: "door.guild" },
};

/** Activities that take a person into an interior area (keyed into FOLK_INTERIORS). */
export const INTERIOR_OF: Partial<Record<Activity, string>> = { tavern: "tavern" };

/** Each area's people: the habitat they belong to. */
export const HABITAT_AREAS: Record<FolkHabitat, string[]> = { town: ["town", "town_tavern", "town_smithy", "town_armory", "town_jeweler", "town_tailor", "town_guild"], forest: ["surface"] };

/**
 * Places one person holds at a time: a stool or a bench, a work place (an anvil, a haul pile), a chore, a bedroll, a
 * place by the fire, a blind, a patch to forage, a stall and the customer's place in front of it, a place in the knot
 * at the tavern door, and (by id: they are `idle` spots) the gate's two watch posts. sim/folk.ts never sends anyone
 * to one that someone else stands at or is heading for. Every other kind (the meeting places, a stroll's corners,
 * the watch's rounds, doorsteps) is shared: a knot, each person a few px off the spot, never a stack.
 */
export const EXCLUSIVE_KINDS: Spot["kind"][] = ["seat", "bench", "work", "chore", "bed", "camp", "hunt", "forage", "stall", "customer", "keeper", "gather", "browse", "queue"];
export const EXCLUSIVE_IDS: string[] = ["watch."];

/** Lines by what they are doing when the golem talks to them (added to the archetype's and the traits'). */
export const ACTIVITY_LINES: Partial<Record<Activity, string[]>> = {
  work: ["CAN'T TALK LONG. WORK WON'T WAIT."],
  chore: ["THESE CHORES WON'T DO THEMSELVES."],
  gather: ["COME FOR A DRINK? OH. YOU DON'T, DO YOU."],
  tavern: ["PULL UP A STOOL. CAREFUL, THEY'RE NOT MADE FOR YOUR SORT."],
  lamps: ["EVERY LAMP IN ITS TURN. THE RUNES LIGHT THEMSELVES. THESE DON'T."],
  patrol: ["ON MY ROUND. ALL QUIET."],
  sit: ["AH, THE SUN ON THESE OLD BONES."],
  hunt: ["SHH."],
  camp: ["WARM YOURSELF. OR WHATEVER IT IS YOU DO."],
  shop: ["JUST LOOKING. SAME AS YOU, I'D GUESS.", "MIND THE SHELVES, BIG ONE."],
  board: ["READING THE BOARD. NOTHING FOR YOUR SORT. YET."],
};
