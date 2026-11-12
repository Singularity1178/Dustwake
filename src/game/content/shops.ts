// Westwake's shops as places people use (data). Pure; no DOM, no World.
//
// The rooms are townInteriors.ts; this file says who keeps each one, when it is open, who comes in and what they do
// there. sim/shops.ts runs the keepers and works out each person's shop trips from the clock; sim/folk.ts walks the
// customers through a visit. Adding to the town is adding rows:
//
//   - a shop's hours, keeper lines or clientele: its SHOPS row.
//   - something to do in a shop: a VISITS row (steps: where to stand, the poses struck there, a mutter, a deal at
//     the counter) and a weight for it in the shops that offer it.
//   - who shops, and when in their day: a SHOP_HABITS row per archetype.
//   - what is said over a counter: an EXCHANGES row with the deal's context (content/talk.ts).
//
// Seams for later work (contracts, recruitment, real shops): the keeper of a shop is one actor with a `keeper`
// record (sim/shops.ts) whose talk is RULES.keeper (content/interactions.ts); the guild's board is BOARD below (its
// spots, the gestures of reading it), and anyone can be sent to it with a `duty` whose act is "board".
import type { Establishment } from "./town";
import type { Activity, ChatIcon } from "./folk";

/** Poses a visit step may strike (all of them FolkPose, sim/folk.ts). */
export type VisitPose = "stand" | "browse" | "point" | "read" | "note" | "nod" | "shake" | "warm" | "sit" | "lean" | "drink";

/** Opening hours on the town clock. `close` may run past midnight (26 is 02:00). `lunch`: shut, the keeper upstairs. */
export interface ShopHours { open: number; close: number; lunch?: [number, number] }

export interface KeeperDef {
  /** Shown in the scan readout and the talk note: "EDDA MARSH - SMITH". */
  title: string;
  /** Said when the golem speaks to them (E). Placeholder lines: the next task hangs a shop or the contract desk here. */
  greet: string[];
  /** Said once when the golem walks in. */
  welcome: string[];
  /** Said to a customer coming through the door. */
  hello: string[];
  /** Said at closing time, to whoever is still in the shop. */
  closing: string[];
}

export interface ShopDef {
  id: Establishment;
  hours: ShopHours;
  keeper: KeeperDef;
  /** What is sold, as the pictogram a deal shows. */
  wares: ChatIcon;
  /** What people do here, by weight (VISITS ids). */
  visits: Record<string, number>;
  /** How much more the well-off come here (people whose house is lit by light runes: content/town.ts). */
  wellOff?: number;
  /** Traits that bring people here more (or less). */
  traits?: Record<string, number>;
  /** The note shown when the golem walks in out of hours. */
  closedNote: string;
}

export const SHOPS: Record<Establishment, ShopDef> = {
  smithy: {
    id: "smithy", hours: { open: 7, close: 18, lunch: [12, 13] }, wares: "hammer",
    keeper: {
      title: "SMITH",
      greet: ["THE BLACK ANVIL. NAILS TO PLOUGHSHARES. I DON'T MEND GOLEMS. YET.", "YOU'RE GOOD IRON UNDER THAT STONE. I CAN TELL.", "STAND CLEAR OF THE FORGE. YOU'D CRACK."],
      welcome: ["MIND THE SPARKS.", "DUCK. LOW BEAM."],
      hello: ["WHAT'LL IT BE?", "MIND THE SPARKS.", "BE WITH YOU."],
      closing: ["FIRE'S BANKED. OUT YOU GO."],
    },
    visits: { browse: 3, buy: 3, window: 2, fetch: 6, rounds: 2 }, traits: { brisk: 1.4 },
    closedNote: "THE BLACK ANVIL IS SHUT. THE FORGE IS BANKED.",
  },
  armory: {
    id: "armory", hours: { open: 9, close: 18, lunch: [12.5, 13.5] }, wares: "sword",
    keeper: {
      title: "ARMOURER",
      greet: ["THE GILDED BUCKLER. FINISHED ARMS FOR THOSE WITH COIN. HAVE YOU COIN?", "NOTHING HERE IN YOUR SIZE, I FEAR.", "PLEASE DON'T LEAN ON THE STANDS."],
      welcome: ["LOOK WITH YOUR EYES.", "WELCOME. MIND THE STANDS."],
      hello: ["SOMETHING WITH AN EDGE?", "WELCOME BACK.", "LOOK WITH YOUR EYES."],
      closing: ["WE CLOSE AT SIX. IT IS SIX."],
    },
    visits: { browse: 4, buy: 2, window: 3, rounds: 2 }, wellOff: 1.5, traits: { restless: 1.5 },
    closedNote: "THE GILDED BUCKLER IS SHUT. THE STANDS ARE COVERED.",
  },
  jeweler: {
    id: "jeweler", hours: { open: 10, close: 17, lunch: [13, 14] }, wares: "coin",
    keeper: {
      title: "JEWELLER",
      greet: ["THE BRIGHT FACET. STONES SET, STONES SOLD. IS THAT A RUBY IN YOUR CHEST?", "I WOULD PAY WELL FOR ONE OF YOUR EYES. NO? PITY.", "TOUCH NOTHING, PLEASE."],
      welcome: ["OH. OH MY.", "MIND THE GLASS. PLEASE."],
      hello: ["DO COME IN.", "SOMETHING THAT SPARKLES?", "MIND THE GLASS."],
      closing: ["THE CASES ARE LOCKED. GOOD EVENING."],
    },
    visits: { browse: 3, buy: 1.5, window: 4 }, wellOff: 8, traits: { curious: 1.5, homebody: 0.6 },
    closedNote: "THE BRIGHT FACET IS SHUT. THE CASES ARE LOCKED.",
  },
  tailor: {
    id: "tailor", hours: { open: 8.5, close: 18, lunch: [12, 13] }, wares: "heart",
    keeper: {
      title: "TAILOR",
      greet: ["THE SILVER NEEDLE. I COULD CUT YOU A CLOAK. IT WOULD TAKE A SAIL.", "STAND STILL. NO, I'M ONLY LOOKING. WHAT SHOULDERS.", "MIND THE BOLTS, DEAR. YOU SHED GRIT."],
      welcome: ["GOODNESS. WIPE YOUR FEET.", "MIND THE BOLTS."],
      hello: ["COME FOR A FITTING?", "NEW CLOTH IN FROM THE COAST.", "BE RIGHT WITH YOU."],
      closing: ["PINS DOWN. WE'RE CLOSED."],
    },
    visits: { browse: 4, buy: 3, window: 2 }, wellOff: 2, traits: { sociable: 1.5, cheerful: 1.3 },
    closedNote: "THE SILVER NEEDLE IS SHUT. THE FORMS STAND IN THE DARK.",
  },
  tavern: {
    id: "tavern", hours: { open: 10, close: 26 }, wares: "mug",
    keeper: {
      title: "INNKEEPER",
      greet: ["THE SUNKEN CROWN. ALE, STEW, A BED. NONE OF IT MUCH USE TO YOU.", "THE CELLAR HATCH WAS CUT FOR ONE OF YOUR SORT. WANT WORK?", "SIT IF YOU LIKE. NOT ON THE STOOLS."],
      welcome: ["MIND THE DOOR FRAME.", "WELL. THERE'S A SIGHT."],
      hello: ["THE USUAL?", "FIND A STOOL.", "STEW'S ON."],
      closing: ["DRINK UP. BEDS OR THE STREET."],
    },
    visits: { pint: 5, warm: 2, rounds: 1.5 }, traits: { thirsty: 3, idler: 1.5 },
    closedNote: "THE SUNKEN CROWN IS QUIET. THE FIRE IS LOW.",
  },
  guild: {
    id: "guild", hours: { open: 7, close: 21 }, wares: "sword",
    keeper: {
      title: "GUILD CLERK",
      greet: ["ADVENTURERS' GUILD, WESTWAKE CHAPTER. THE BOARD IS BY THE WEST WALL.", "CONTRACTS ARE FOR MEMBERS. I'LL NEED TO ASK ABOUT GOLEMS.", "ONE SHEET'S GONE YELLOW UP THERE. THE SUNKEN KEEP. KNOW IT?"],
      welcome: ["BOARD'S ON THE LEFT.", "NAME AND BUSINESS? ...OH."],
      hello: ["BOARD'S ON THE LEFT.", "SIGN THE BOOK.", "NOTHING NEW SINCE MORNING."],
      closing: ["THE HALL CLOSES AT NINE. OUT."],
    },
    visits: { board: 5, desk: 2.5, between: 2, warm: 1.5, rounds: 2 }, traits: { curious: 1.6, restless: 1.4 },
    closedNote: "THE GUILD HALL IS SHUT FOR THE NIGHT.",
  },
};

/** One stop of a visit. */
export interface VisitStep {
  /**
   * Where: spot id prefixes in the shop's room, one chosen per person and trip by hash, never one somebody holds.
   * "counter" is the customer's place at the counter, or the queue behind it while that is taken.
   */
  at: string[];
  /** Its share of the time inside. */
  share: number;
  /** Poses struck there, in turn (a beat every few seconds). */
  poses: VisitPose[];
  /** A word to themselves now and then (content/talk.ts: MUTTERS). */
  mutter?: string;
  /** At the counter: the exchange with the keeper (content/talk.ts: EXCHANGES by this context). */
  deal?: string;
  /** After the deal is done: where they drift to, leaving the counter to the queue. */
  after?: string[];
}

export interface VisitDef {
  id: string;
  steps: VisitStep[];
  /** Only these archetypes (the smith's errand is an apprentice's, a look-in the watch's). */
  only?: string[];
  /** Archetypes and traits that do this more (or less). */
  likes?: Record<string, number>;
}

const SHELVES = ["browse", "idle."];
const LOOK: VisitPose[] = ["browse", "browse", "point", "browse", "stand"];
const READ: VisitPose[] = ["read", "read", "point", "read", "note", "read", "nod"];

export const VISITS: Record<string, VisitDef> = {
  // round the shelves and racks, and out again
  browse: { id: "browse", steps: [
    { at: SHELVES, share: 3, poses: LOOK, mutter: "browse" },
    { at: SHELVES, share: 3, poses: LOOK, mutter: "browse" },
    { at: SHELVES, share: 2, poses: ["browse", "stand", "nod"] },
  ] },
  // a look, then the counter: queue, haggle, coin across, a nod
  buy: { id: "buy", likes: { brisk: 1.6, wary: 0.8 }, steps: [
    { at: SHELVES, share: 3, poses: LOOK, mutter: "browse" },
    { at: ["counter"], share: 5, poses: ["stand"], deal: "buy", after: SHELVES, mutter: "queue" },
  ] },
  // looks at the goods, shakes their head at the price and leaves
  window: { id: "window", likes: { grumpy: 2, idler: 1.5, brisk: 0.5 }, steps: [
    { at: SHELVES, share: 3, poses: ["browse", "point", "browse"], mutter: "browse" },
    { at: SHELVES, share: 2, poses: ["browse", "shake", "stand"], mutter: "dear" },
    { at: ["counter"], share: 2, poses: ["stand"], deal: "looking", after: SHELVES },
  ] },
  // in out of the weather: the fire, a look round
  warm: { id: "warm", likes: { elder: 2.5, idler: 2, brisk: 0.3 }, steps: [
    { at: ["idle.hearth", "idle.fire"], share: 5, poses: ["warm", "warm", "stand"], mutter: "warm" },
    { at: ["idle.", "browse"], share: 2, poses: ["stand", "browse"] },
  ] },
  // the smith's errand: the master sent an apprentice for something
  fetch: { id: "fetch", only: ["apprentice"], steps: [
    { at: ["counter"], share: 4, poses: ["stand"], deal: "fetch", after: ["browse.tools", "idle.browse", "browse"] },
    { at: ["browse.tools", "idle.browse", "browse"], share: 3, poses: ["browse", "note", "browse", "point"], mutter: "browse" },
  ] },
  // the watch looks in
  rounds: { id: "rounds", only: ["watch"], steps: [
    { at: ["idle.", "browse"], share: 2, poses: ["stand", "lean"] },
    { at: ["counter"], share: 3, poses: ["stand"], deal: "rounds", after: ["idle.", "browse"] },
  ] },
  // a pint at midday: order at the bar, then a stool
  pint: { id: "pint", likes: { thirsty: 2 }, steps: [
    { at: ["counter"], share: 3, poses: ["stand"], deal: "order", after: ["seat"] },
    { at: ["seat"], share: 6, poses: ["sit"] },
  ] },
  // the guild board: read it, point, take a note, nod or shake the head (see BOARD)
  board: { id: "board", likes: { adventurer: 2, curious: 1.5 }, steps: [
    { at: ["idle.board"], share: 6, poses: READ, mutter: "board" },
    { at: ["browse", "idle.fire"], share: 2, poses: ["stand", "browse"] },
  ] },
  // a word at the desk, then the board
  desk: { id: "desk", steps: [
    { at: ["counter"], share: 4, poses: ["stand"], deal: "desk", after: ["idle.board", "browse"] },
    { at: ["idle.board"], share: 4, poses: READ, mutter: "board" },
  ] },
  // between jobs: a glance at the board, then a seat by the fire
  between: { id: "between", only: ["adventurer", "elder", "watch"], steps: [
    { at: ["idle.board"], share: 3, poses: ["read", "point", "shake"], mutter: "board" },
    { at: ["seat"], share: 6, poses: ["sit"] },
  ] },
};

/** Who shops, in which blocks of their day, how often, and where (weights; a shop not named is never visited). */
export interface ShopHabit { during: Activity[]; chance: number; shops: Partial<Record<Establishment, number>> }

export const SHOP_HABITS: Record<string, ShopHabit> = {
  // the watch looks in on the guild and the tavern between rounds
  watch: { during: ["socialize", "wander"], chance: 0.7, shops: { guild: 3, tavern: 2, armory: 1.5, smithy: 1 } },
  // a pint at midday, and the smith for a mended pick
  labourer: { during: ["socialize"], chance: 0.75, shops: { tavern: 4, smithy: 1.5 } },
  // apprentices are in and out of the smithy all day
  apprentice: { during: ["work", "errand", "wander", "socialize"], chance: 0.8, shops: { smithy: 7, tailor: 0.6, guild: 0.8, armory: 0.6 } },
  // adventurers live between the guild board and the armoury's racks
  adventurer: { during: ["socialize", "wander"], chance: 0.9, shops: { guild: 6, armory: 3, smithy: 1, jeweler: 0.7, tailor: 0.4 } },
  // residents keep the tailor in business; the well-off among them the jeweller
  resident: { during: ["errand", "chore", "wander", "socialize"], chance: 0.7, shops: { tailor: 4, jeweler: 1.2, smithy: 1, guild: 0.5, armory: 0.2 } },
  // the old come in for the fire and the talk
  elder: { during: ["socialize", "wander", "sit"], chance: 0.6, shops: { tailor: 2, tavern: 1.5, guild: 1.5, jeweler: 0.9 } },
};

/** Shop trips: the shortest block that holds one (hours), a block long enough for two, a trip's length, and the share of it spent walking there. */
export const TRIP = { minBlock: 0.9, twoIn: 3.6, len: [1.8, 2.6] as [number, number], lead: 0.28, margin: 0.06, /** The shortest trip worth making when a shop's hours cut one short. */ minTrip: 1.2 } as const;

/**
 * The guild's contract board, and the town's notice board outdoors: where people stand to read them and how they
 * read. Only a look. Nothing is posted, taken or assigned (the next task: contracts hang here).
 */
export const BOARD = {
  /** Spot id prefix of the places in front of a board, in the guild hall and in the square. */
  spots: "idle.board",
  /** The guild's room. */
  area: "town_guild",
  /** How it is read, in turn. The grumpy shake their heads where others nod. */
  gestures: READ as VisitPose[],
} as const;
