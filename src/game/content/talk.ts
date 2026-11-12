// What townsfolk say to each other (data). Pure; no DOM, no World.
//
// The golem hears a person's `lines` when it talks to them (content/folk.ts). Among themselves people talk in
// EXCHANGES: a few short lines said in turn, each shown in the speaker's speech bubble (sim/folk.ts runs them, the
// host draws them; never a dialogue screen). Which exchange two people have depends on where they are (the context:
// passing in the street, at the well, at a shop's shelves, at the guild board, over a counter...) and on who they
// are (archetype and traits of each side). Adding talk is adding rows:
//
//   - an exchange: an EXCHANGES row (contexts, who may say it, the lines).
//   - something a kind of person says to anyone: a PEER_LINES row (their own `lines` that are not addressed to the
//     golem are said too: see `peerLines`).
//   - a way of answering: REACTIONS; a word to oneself: MUTTERS.
//
// Lines are short on purpose: at most LINE_MAX characters (two rows of a bubble), in the bitmap font's glyphs
// (tests/shops.test.ts checks every line, with the longest names put in).
import { ACTIVITY_LINES, ARCHETYPES, TRAITS, type Activity } from "./folk";
import type { VisitPose } from "./shops";

/** The longest line of ambient talk (a bubble wraps at 22: two rows). */
export const LINE_MAX = 44;

/** The longest of a person's own lines (written for the golem's ear) that is still said to a neighbour: three rows. */
export const PEER_MAX = 50;

/** Where a conversation happens. Deals (over a counter, with the keeper) are `deal.<name>` (content/shops.ts: VisitStep.deal). */
export type TalkContext = "meet" | "pass" | "watch" | "well" | "ale" | "camp" | "shop" | "board" | `deal.${string}`;

/** Who may take a side: any of these archetypes, any of these traits, none of those. */
export interface Who { arch?: string[]; trait?: string[]; not?: string[] }

/**
 * One line: who says it, the text, and a pose struck while saying it (coin across the counter, a finger at the board).
 * Tokens: {a} {b} the two given names, {you} the name of whoever is spoken to, {hail} the greeting of the hour;
 * a whole line of "@say" is one of the speaker's own lines, "@re" their way of answering, "@gripe" a grumble, "@news" gossip.
 */
export type TalkLine = [who: "a" | "b", text: string, pose?: VisitPose | "pay" | "chat"];

export interface ExchangeDef {
  id: string;
  ctx: TalkContext[];
  a?: Who; b?: Who;
  /** How readily it is chosen (default 1). */
  weight?: number;
  lines: TalkLine[];
}

const X = (id: string, ctx: TalkContext[], lines: TalkLine[], o: Partial<ExchangeDef> = {}): ExchangeDef => ({ id, ctx, lines, ...o });
const STREET: TalkContext[] = ["meet", "well"];

export const EXCHANGES: ExchangeDef[] = [
  // ---- meeting in the street, the square, on a bench
  X("hello", STREET, [["a", "{hail}, {b}."], ["b", "{hail}. KEEPING WELL?"], ["a", "@say"], ["b", "@re"]], { weight: 2 }),
  X("own", [...STREET, "ale", "camp"], [["a", "@say"], ["b", "@re"]], { weight: 2 }),
  X("own2", [...STREET, "ale", "camp"], [["a", "@say"], ["b", "@say"], ["a", "@re"]], { weight: 1.5 }),
  X("rain", STREET, [["a", "LOOKS LIKE RAIN."], ["b", "IT ALWAYS LOOKS LIKE RAIN."]]),
  X("stone_one", [...STREET, "ale"], [["a", "SEEN THE STONE ONE ABOUT?"], ["b", "WALKS LIKE A THREE-WHEELED CART."], ["a", "STILL. IT SAYS GOOD DAY."]]),
  X("stone_two", STREET, [["a", "THAT GOLEM. WHOSE IS IT?"], ["b", "NOBODY'S. THAT'S THE ODD PART."]]),
  X("supper", STREET, [["a", "{b}! JUST WHO I WANTED."], ["b", "WHAT HAVE I DONE NOW?"], ["a", "NOTHING YET. COME TO SUPPER."]], { a: { trait: ["sociable", "cheerful"] } }),
  X("fine_day", STREET, [["a", "FINE DAY FOR IT!"], ["b", "FOR WHAT?"], ["a", "FOR ANYTHING!"]], { a: { trait: ["cheerful"] } }),
  X("gripe", [...STREET, "ale", "shop"], [["a", "@gripe"], ["b", "@re"]], { a: { trait: ["grumpy"] }, weight: 3 }),
  X("gripe2", STREET, [["a", "@gripe"], ["b", "YOU SAID THAT YESTERDAY."], ["a", "IT WAS TRUE YESTERDAY."]], { a: { trait: ["grumpy"] }, weight: 2 }),
  X("quiet", [...STREET, "pass"], [["a", "{hail}, {b}."], ["b", "MM."]], { b: { trait: ["reserved"] }, weight: 3 }),
  X("in_my_day", STREET, [["a", "IN MY DAY THE WELL WAS DEEPER."], ["b", "IT'S THE SAME WELL, {a}."], ["a", "SO THEY'D HAVE US THINK."]], { a: { arch: ["elder"] }, weight: 2 }),
  X("hammer", STREET, [["a", "MASTER THREW A HAMMER AT ME."], ["b", "DID IT HIT?"], ["a", "ONLY THE ONCE."]], { a: { arch: ["apprentice"] }, weight: 2 }),
  X("back", STREET, [["a", "MY BACK'S IN TWO PIECES."], ["b", "GET A GOLEM TO CARRY IT."], ["a", "THE STONE? OR MY BACK?"]], { a: { arch: ["labourer"] }, weight: 2 }),
  X("work_going", STREET, [["a", "ANY WORK GOING?"], ["b", "RATS. IT'S ALWAYS RATS."]], { b: { arch: ["adventurer"] } }),
  X("hurry", STREET, [["a", "WHERE'S THE FIRE, {b}?"], ["b", "CAN'T STOP!"]], { b: { trait: ["brisk"] }, weight: 2 }),
  X("homebody", STREET, [["a", "EVER THINK OF LEAVING WESTWAKE?"], ["b", "WHATEVER FOR?"]], { a: { trait: ["restless"] } }),
  // ---- a nod to the watch
  X("watch_quiet", ["watch"], [["a", "ALL QUIET, WATCH?"], ["b", "ALL QUIET. KEEP IT SO."]], { b: { arch: ["watch"] }, weight: 2 }),
  X("watch_hail", ["watch", "pass"], [["a", "{hail}, WATCH."], ["b", "CITIZEN."]], { b: { arch: ["watch"] }, weight: 2 }),
  X("watch_goat", ["watch"], [["a", "ANYTHING TO REPORT?"], ["b", "A GOAT. LOOSE AGAIN."], ["a", "THAT GOAT."]], { a: { arch: ["watch"] } }),
  X("watch_golem", ["watch"], [["a", "IS THE STONE ONE ALLOWED IN?"], ["b", "IT PAID THE GATE TOLL. IN PEBBLES."]], { b: { arch: ["watch"] } }),
  X("watch_both", ["watch"], [["a", "QUIET NIGHT?"], ["b", "TOO QUIET."], ["a", "YOU ALWAYS SAY THAT."]], { a: { arch: ["watch"] }, b: { arch: ["watch"] }, weight: 3 }),
  // ---- gossip at the well
  X("baker", ["well"], [["a", "HEARD ABOUT THE BAKER?"], ["b", "NO. GO ON."], ["a", "FLOUR'S HALF CHALK, THEY SAY."], ["b", "@re"]], { weight: 2 }),
  X("news", ["well", "meet"], [["a", "@news"], ["b", "NEVER!"], ["a", "ON MY LIFE."]], { weight: 2 }),
  X("news2", ["well", "ale"], [["a", "@news"], ["b", "@re"]], { weight: 2 }),
  X("guild_lot", ["well"], [["a", "WHO'S AT THE GUILD THIS WEEK?"], ["b", "SELLSWORDS. LOUD ONES."]]),
  // ---- passing by: a word without stopping long
  X("pass_hail", ["pass"], [["a", "{hail}, {b}."], ["b", "{hail}."]], { weight: 3 }),
  X("pass_names", ["pass"], [["a", "{b}."], ["b", "{a}."]], { weight: 2 }),
  X("pass_cheer", ["pass"], [["a", "LOVELY DAY, {b}!"], ["b", "@re"]], { a: { trait: ["cheerful", "sociable"] }, weight: 2 }),
  // ---- at the tavern, in it or at its door
  X("another", ["ale"], [["a", "ANOTHER?"], ["b", "TWIST MY ARM."]], { weight: 2 }),
  X("crown", ["ale"], [["a", "TO THE CROWN!"], ["b", "SUNK AS IT IS."]]),
  X("round", ["ale"], [["a", "WHOSE ROUND IS IT?"], ["b", "YOURS. IT'S ALWAYS YOURS."], ["a", "FUNNY, THAT."]]),
  X("stew", ["ale"], [["a", "WHAT'S IN THE STEW TONIGHT?"], ["b", "BEST NOT TO ASK."]]),
  // ---- the hunters' camp
  X("wind", ["camp"], [["a", "WIND'S TURNED NORTH."], ["b", "DEER WILL MOVE AT DUSK, THEN."]], { weight: 2 }),
  X("hum", ["camp"], [["a", "HEAR THE CIRCLE HUM LAST NIGHT?"], ["b", "I HEARD NOTHING. NOR DID YOU."]], { weight: 2 }),
  X("pelts", ["camp"], [["a", "PELTS TO WESTWAKE THIS WEEK?"], ["b", "IF THE ROAD'S DRY."]]),
  X("red_ones", ["camp"], [["a", "FOUND MUSHROOMS BY THE STONES."], ["b", "NOT THE RED ONES."], ["a", "...SOME RED ONES."]]),
  // ---- two customers at a shop's shelves
  X("price", ["shop"], [["a", "LOOK AT THE PRICE OF THAT.", "point"], ["b", "DAYLIGHT ROBBERY."]], { weight: 2 }),
  X("suit", ["shop"], [["a", "WOULD IT SUIT ME?"], ["b", "@re"]]),
  X("coast", ["shop"], [["a", "THEY SAY IT'S FROM THE COAST."], ["b", "THEY SAY THAT OF EVERYTHING."]]),
  // ---- two people at the guild board (or the notice board in the square)
  X("rats", ["board"], [["a", "RATS IN A CELLAR. AGAIN.", "point"], ["b", "PAYS FOUR SILVER, THOUGH."], ["a", "PER RAT?"], ["b", "PER CELLAR.", "shake"]], { weight: 2 }),
  X("keep", ["board"], [["a", "SEE THIS ONE? THE SUNKEN KEEP.", "point"], ["b", "NOBODY COMES BACK FROM THAT.", "shake"]], { weight: 2 }),
  X("wolves", ["board"], [["a", "WOLF BOUNTY'S STILL UP.", "point"], ["b", "SO ARE THE WOLVES."]]),
  X("goat", ["board"], [["a", "LOST: ONE GOAT.", "point"], ["b", "IT'S IN MY GARDEN. AGAIN.", "nod"]]),
  X("escort", ["board"], [["a", "ESCORT TO THE COAST. TEN DAYS.", "point"], ["b", "TEN DAYS OF YOUR SINGING? NO.", "shake"]], { a: { arch: ["adventurer"] }, weight: 2 }),
  // ---- over a counter: `a` is the customer, `b` the keeper
  X("haggle", ["deal.buy"], [["a", "HOW MUCH FOR THIS?", "point"], ["b", "THREE SILVER."], ["a", "TWO."], ["b", "TWO AND A HALF."], ["a", "DONE.", "pay"], ["b", "A PLEASURE."]], { weight: 2 }),
  X("take_it", ["deal.buy"], [["a", "I'LL TAKE IT.", "pay"], ["b", "A FINE CHOICE."], ["a", "IT HAD BETTER BE.", "nod"]], { weight: 2 }),
  X("last_time", ["deal.buy"], [["a", "SAME AS LAST TIME, {b}.", "pay"], ["b", "WRAPPED AND READY."]], { weight: 2 }),
  X("half", ["deal.buy"], [["a", "THAT'S NOT WORTH HALF."], ["b", "THEN PAY HALF. TAKE HALF."], ["a", "HMPH. FINE.", "pay"]], { a: { trait: ["grumpy"] }, weight: 4 }),
  X("quick", ["deal.buy"], [["a", "THIS. QUICKLY.", "pay"], ["b", "ALWAYS IN A RUSH, {a}."]], { a: { trait: ["brisk"] }, weight: 4 }),
  X("chatty_buy", ["deal.buy"], [["a", "AND HOW'S THE FAMILY, {b}?"], ["b", "WELL. ARE YOU BUYING?"], ["a", "OH! YES.", "pay"]], { a: { trait: ["sociable"] }, weight: 4 }),
  X("looking", ["deal.looking"], [["a", "JUST LOOKING."], ["b", "LOOK ALL YOU LIKE."]], { weight: 2 }),
  X("too_dear", ["deal.looking"], [["a", "HOW MUCH? NO. NO.", "shake"], ["b", "QUALITY COSTS."]], { weight: 2 }),
  X("next_week", ["deal.looking"], [["a", "PUT IT BY FOR ME?"], ["b", "UNTIL MARKET DAY. NO LONGER."], ["a", "BLESS YOU.", "nod"]]),
  X("nails", ["deal.fetch"], [["a", "MASTER SENT ME FOR NAILS."], ["b", "TELL HIM HE STILL OWES ME."], ["a", "I'LL... TELL HIM.", "nod"]], { weight: 2 }),
  X("tongs", ["deal.fetch"], [["a", "TONGS. THE BIG ONES."], ["b", "BRING THEM BACK THIS TIME."]], { weight: 2 }),
  X("quench", ["deal.fetch"], [["a", "I CRACKED ANOTHER BLADE."], ["b", "QUENCH SLOWER. COUNT TO FIVE."], ["a", "ONE... TWO...", "nod"]]),
  X("pint", ["deal.order"], [["a", "A PINT, {b}.", "pay"], ["b", "COMING UP."]], { weight: 2 }),
  X("usual", ["deal.order"], [["a", "THE USUAL."], ["b", "IT'S ALWAYS THE USUAL."], ["a", "THAT'S WHY IT'S USUAL.", "pay"]], { weight: 2 }),
  X("slate", ["deal.order"], [["a", "PUT IT ON THE SLATE?"], ["b", "THE SLATE'S FULL, {a}."], ["a", "HMPH.", "pay"]], { a: { trait: ["thirsty", "grumpy"] }, weight: 3 }),
  X("trouble", ["deal.rounds"], [["a", "ANY TROUBLE?"], ["b", "NONE. QUIET AS STONE."], ["a", "KEEP IT SO.", "nod"]], { weight: 2 }),
  X("locks", ["deal.rounds"], [["a", "LOCK UP WELL TONIGHT."], ["b", "I ALWAYS DO."]]),
  X("new_work", ["deal.desk"], [["a", "ANYTHING NEW ON THE BOARD?"], ["b", "RATS. AND THE OLD KEEP SURVEY."], ["a", "NOBODY'S TAKING THAT.", "shake"]], { weight: 2 }),
  X("caravan", ["deal.desk"], [["a", "WHEN'S THE NEXT CARAVAN?"], ["b", "WHEN IT GETS HERE."]]),
  X("dues", ["deal.desk"], [["a", "ABOUT MY DUES..."], ["b", "THREE MONTHS BEHIND, {a}."], ["a", "IS IT THREE? MY.", "nod"]], { a: { arch: ["adventurer"] }, weight: 3 }),
  X("notice", ["deal.desk"], [["a", "CAN I PIN UP A NOTICE?"], ["b", "MEMBERS ONLY. ASK AGAIN SOON."]], { a: { arch: ["resident", "elder", "apprentice"] }, weight: 3 }),
];

export const EXCHANGE_BY_ID: Record<string, ExchangeDef> = Object.fromEntries(EXCHANGES.map((e) => [e.id, e]));

/** Things a kind of person says to anyone (by archetype id or trait id), besides their own lines that fit (see peerLines). */
export const PEER_LINES: Record<string, string[]> = {
  watch: ["THE GATE HINGE WANTS OIL.", "NIGHT SHIFT GETS THE GOOD STEW.", "SOMEBODY'S GOAT IS LOOSE AGAIN."],
  labourer: ["THE YARD'S SHORT A HAULER.", "NEW STONE'S IN FROM THE QUARRY.", "MY BOOTS ARE MORE HOLE THAN BOOT."],
  apprentice: ["I BURNT MY THUMB. LOOK.", "MASTER SAYS I'M NEARLY USEFUL.", "ONE DAY I'LL HAVE MY OWN FORGE."],
  adventurer: ["THE ARMOURER WANTS NINE SILVER. NINE!", "I FOUGHT A BEAR ONCE. NEARLY.", "THERE'S A KEEP UNDER THAT HILL. I KNOW IT."],
  resident: ["THE WASHING WON'T DRY IN THIS.", "MARKET'S ON THE SEVENTH DAY.", "THE TAILOR HAS NEW CLOTH IN."],
  elder: ["MY KNEES SAY FROST.", "THE OLD WELL NEVER RAN DRY. NOT ONCE.", "NOBODY BOWS TO THE STATUE ANY MORE."],
  hunter: ["TRACKS BY THE STREAM. FRESH.", "THE DEER ARE THIN THIS YEAR.", "MY BOWSTRING'S FRAYED AGAIN."],
  forager: ["SORREL'S UP BY THE OLD STONES.", "NEVER THE RED ONES.", "THE BRAMBLES ARE EARLY."],
  curious: ["WHAT'S UNDER THE HILL, DO YOU THINK?"],
  thirsty: ["IS IT TOO EARLY FOR A PINT?"],
  sociable: ["WE SHOULD ALL HAVE SUPPER."],
  wary: ["I DON'T LIKE THE LOOK OF THOSE CLOUDS."],
};

/** Grumbles (the grumpy), and gossip (anyone at the well). */
export const GRIPES = ["PRICES. HAVE YOU SEEN THE PRICES?", "MY FEET HURT.", "TOO MANY PEOPLE ABOUT.", "THE BELL RANG LATE AGAIN.", "NOBODY SWEEPS THIS STREET.", "IT'LL RAIN. MARK ME."];
export const NEWS = ["THE SMITH'S BOY BURNT HIS BROWS OFF.", "THE JEWELLER SLEEPS ON HIS STRONGBOX.", "THE GUILD LOST ANOTHER PARTY EAST.", "SOMEONE SAW LIGHTS UNDER THE HILL.", "THE INNKEEPER WATERS THE ALE.", "THE TAILOR'S SWEET ON THE CLERK."];

/** How someone answers, by trait (the first of their traits that has a row), else DEFAULT. */
export const REACTIONS: Record<string, string[]> = {
  cheerful: ["HA! TRUE ENOUGH.", "WONDERFUL!", "ISN'T IT JUST."],
  grumpy: ["HMPH.", "IF YOU SAY SO.", "WHAT OF IT?"],
  reserved: ["MM.", "...", "PERHAPS."],
  sociable: ["YOU DON'T SAY! GO ON.", "OH, I KNOW. I KNOW.", "TELL ME EVERYTHING."],
  curious: ["REALLY? HOW SO?", "NOW THAT'S INTERESTING."],
  wary: ["KEEP YOUR VOICE DOWN.", "I'D NOT SAY THAT ALOUD."],
  brisk: ["RIGHT. MUST GET ON.", "QUITE. GOOD DAY."],
  idler: ["NO RUSH ABOUT IT.", "AYE... AYE."],
  DEFAULT: ["AYE.", "TRUE ENOUGH.", "YOU DON'T SAY.", "WELL, THERE IT IS.", "HA!"],
};

/** Words to oneself, by what one is at (content/shops.ts: VisitStep.mutter), and for the grumpy in a queue. */
export const MUTTERS: Record<string, string[]> = {
  browse: ["HM.", "NICE WORK, THAT.", "NOT TODAY.", "NOW THAT'S FINE.", "HM. MAYBE."],
  dear: ["TOO DEAR.", "FOR THAT? NO.", "I'LL THINK ON IT."],
  queue: ["ANY DAY NOW.", "...", "COME ON."],
  warm: ["AH. THAT'S BETTER.", "BLESS THIS FIRE."],
  board: ["RATS. AGAIN.", "HM. FOUR SILVER.", "NOT FOR ME.", "WHO PINNED THIS?", "STILL NO TAKERS."],
};

/** The greeting of the hour. */
export const hail = (hour: number) => (hour < 12 ? "MORNING" : hour < 17.5 ? "AFTERNOON" : "EVENING");

/** A line the golem hears that would be odd said to a neighbour: it is about the golem, or too long for passing talk. */
const TO_THE_GOLEM = /\bYOU\b|\bYOU'|\bYOUR|GOLEM|STONE ONE|CLAY-FOOT|\bDEAR\b|OLD ONES|CAN I LOOK/;
export const fitsPeers = (line: string) => line.length <= PEER_MAX && !TO_THE_GOLEM.test(line);

/**
 * What someone says to their neighbours: their archetype's and traits' own lines that fit (not about the golem, short
 * enough), what they are doing, and PEER_LINES. The same people, the same voices, whoever is listening.
 */
export function peerLines(archetype: string, traits: string[], act?: Activity): string[] {
  const own = [...(ARCHETYPES[archetype]?.lines ?? []), ...traits.flatMap((t) => TRAITS[t]?.lines ?? []), ...(act ? ACTIVITY_LINES[act] ?? [] : [])];
  return [...own.filter(fitsPeers), ...(PEER_LINES[archetype] ?? []), ...traits.flatMap((t) => PEER_LINES[t] ?? [])];
}
