// Holding a key in a menu: ui/keyRepeat.ts (the timing), the real Game (a held key becomes presses for the
// screens that move a cursor, and only for those), the widget kit (a held key stops at the ends of a list, a tab bar
// and the focus order; a toggle flips once) and each keyboard-driven screen on a headless host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
const g0 = globalThis as unknown as Record<string, unknown>;
g0.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
import { Game } from "../src/game/game";
import { KeyRepeat, REPEAT_DELAY, REPEAT_EVERY, REPEAT_QUICK, REPEAT_QUICK_AFTER } from "../src/game/ui/keyRepeat";
import { Gui, rect, noInput, noKeys, type GuiInput, type GuiKeys } from "../src/game/ui/gui";
import { nav, tabStep, type UiHost } from "../src/game/ui/kit";
import { DebugUi, DEBUG_TABS } from "../src/game/screens/debug";
import { PackUi } from "../src/game/screens/pack";
import { StorageUi } from "../src/game/screens/storage";
import { TransferUi } from "../src/game/screens/transfer";
import { ManageUi } from "../src/game/screens/manage";
import { CraftingUi } from "../src/game/screens/crafting";
import { BuildUi } from "../src/game/screens/buildMenu";
import { BookUi } from "../src/game/screens/book";
import { FLAGS } from "../src/game/content/flags";
import { debugPlaces } from "../src/game/sim/debug";
import { addItems, countItem } from "../src/game/sim/inventory";
import { hasFlag, setFlag, clearFlag, player } from "../src/game/world/world";
import { makeCanvas } from "../src/game/util";
import { newWorld } from "./helpers";
import { screenHost } from "./support/screenHost";
import { BENCH, besideChest, CHEST, beside, fixture, worker } from "./support/workerFixture";

const DT = 1 / 60;
/** DebugUi's cursor per tab (private to the screen). */
const cursors = (ui: DebugUi) => (ui as unknown as { cursor: number[] }).cursor;

// ---------------------------------------------------------------- the timing
const held = (...k: string[]) => new Set(k);

/** Hold `k` for `secs` of 60 fps frames; the frames on which it repeated. */
function holdFor(r: KeyRepeat, k: string, secs: number): number[] {
  const out: number[] = [], keys = held(k);
  r.press(k);
  for (let i = 0; i < Math.round(secs / DT); i++) { r.tick(DT, keys); if (r.fired) out.push(i); }
  return out;
}

test("a held key waits, then repeats steadily, then quickens", () => {
  const r = new KeyRepeat();
  const fired = holdFor(r, "arrowdown", 3);
  const first = fired[0] * DT;
  assert.ok(first >= REPEAT_DELAY - DT && first <= REPEAT_DELAY + DT, `first repeat at ${first.toFixed(3)}s`);
  assert.deepEqual(holdFor(new KeyRepeat(), "s", REPEAT_DELAY - 2 * DT), [], "nothing before the delay");
  const gap = (i: number) => (fired[i + 1] - fired[i]) * DT;
  assert.ok(Math.abs(gap(0) - REPEAT_EVERY) <= 2 * DT, `steady gap ${gap(0).toFixed(3)}s`);
  const late = fired.length - 2;
  assert.ok(late > REPEAT_QUICK_AFTER);
  assert.ok(gap(late) <= REPEAT_QUICK + 2 * DT, `quick gap ${gap(late).toFixed(3)}s`);
  assert.ok(fired.length > 40, "it keeps going for as long as the key is held");
});

test("a key that is let go stops, and a slow frame never bursts more than one repeat", () => {
  const r = new KeyRepeat();
  r.press("w");
  r.tick(REPEAT_DELAY + 0.001, held("w"));
  assert.equal(r.fired, "w");
  r.tick(DT, held());                       // released without a keyUp (a lost focus clears the key set)
  assert.equal(r.fired, null); assert.equal(r.key, null);
  r.press("w"); r.release("w");
  r.tick(5, held("w"));
  assert.equal(r.fired, null, "released: nothing to repeat");
  r.press("w");
  r.tick(5, held("w"));
  assert.equal(r.fired, "w");
  r.tick(0.001, held("w"));
  assert.equal(r.fired, null, "one repeat per tick, whatever the hitch");
});

test("only the last key pressed repeats; modifiers never take it; stop() ends it", () => {
  const r = new KeyRepeat();
  r.press("arrowdown"); r.press("shift");
  assert.equal(r.key, "arrowdown", "holding Shift does not steal the repeat");
  r.press("e");
  assert.equal(r.key, "e", "the newest key takes it");
  r.tick(REPEAT_DELAY + 0.01, held("arrowdown", "e"));
  assert.equal(r.fired, "e");
  r.stop();
  r.tick(5, held("arrowdown", "e"));
  assert.equal(r.fired, null);
});

test("nav(): a host without key repeat sees presses only; tabStep wraps a press and stops a repeat at the ends", () => {
  const plain = { hit: (...k: string[]) => k.includes("s") } as unknown as UiHost;
  assert.equal(nav(plain, "arrowdown", "s"), true);
  assert.equal(nav(plain, "w"), false);
  const host = (pressed: string[], repeating: string[]) => ({
    hit: (...k: string[]) => k.some((x) => pressed.includes(x)),
    navHit: (...k: string[]) => k.some((x) => pressed.includes(x) || repeating.includes(x)),
  }) as unknown as UiHost;
  assert.equal(tabStep(host(["q"], []), 0, 5), 4, "a press wraps back");
  assert.equal(tabStep(host(["r"], []), 4, 5), 0, "a press wraps forward");
  assert.equal(tabStep(host([], ["q"]), 0, 5), 0, "a held key stops at the first tab");
  assert.equal(tabStep(host([], ["r"]), 3, 5), 4);
  assert.equal(tabStep(host([], ["r"]), 4, 5), 4, "and at the last");
  assert.equal(tabStep(host([], []), 2, 5), 2);
});

// ---------------------------------------------------------------- the real Game
function realGame() {
  const canvas = () => (globalThis as unknown as { document: { createElement(t: string): HTMLCanvasElement } }).document.createElement("canvas");
  const g = new Game(canvas(), canvas());
  const w = newWorld(); g.resume(w);
  const tick = (secs = DT) => { for (let i = 0; i < Math.max(1, Math.round(secs / DT)); i++) g.update(DT); };
  tick(2 * DT);
  g.debugKey(0);
  assert.ok(g.screens.is("debug"));
  return { g, w, tick, ui: g.debugUi, screens: g.screens };
}

test("Game: holding Down in the debug menu keeps going down, after a short wait, quickening, and stops when released", () => {
  const { g, tick, ui } = realGame();
  const cursor = () => cursors(ui)[0]; // ITEMS
  assert.equal(cursor(), 0);
  assert.ok(ui.rows.length > 40);
  g.keyDown("arrowdown");
  tick(0.1);
  assert.equal(cursor(), 1, "the press itself moves one row");
  tick(REPEAT_DELAY - 0.2);
  assert.equal(cursor(), 1, "and nothing more while it waits");
  tick(0.1);
  const c0 = cursor();
  tick(0.4); const c1 = cursor();      // t = 0.4 .. 0.8 s
  tick(0.4); const c2 = cursor();      // 0.8 .. 1.2 s
  tick(0.4); const c3 = cursor();      // 1.2 .. 1.6 s
  assert.ok(c1 - c0 >= 4, `it kept going (${c1 - c0} rows in 0.4 s)`);
  assert.ok(c3 - c2 > c1 - c0, `and quickened the longer it was held (${c1 - c0} rows, then ${c3 - c2})`);
  g.keyUp("arrowdown");
  const stopped = cursor();
  tick(1);
  assert.equal(cursor(), stopped, "released: it stays where it is");
  // and up again, with W
  g.keyDown("w"); tick(1.5); g.keyUp("w");
  assert.ok(cursor() < stopped, "W holds too");
  g.keyDown("w"); tick(20); g.keyUp("w");
  assert.equal(cursor(), 0, "held up at the top it stops there");
  g.keyDown("s"); tick(30); g.keyUp("s");
  assert.equal(cursor(), ui.rows.length - 1, "held down at the bottom it stops at the last row");
  // the travel list, the one that matters most: a held key walks it
  ui.setTab(3);
  const places = debugPlaces(g.world).length;
  assert.ok(places > 8, "there are places to walk through");
  g.keyDown("s"); tick(0.1);
  assert.equal(cursors(ui)[3], 1);
  tick(1.2); g.keyUp("s");
  assert.ok(cursors(ui)[3] > 6, `the held key walked the TRAVEL list (row ${cursors(ui)[3]})`);
});

test("Game: PgDn, tabs and quantity repeat; holding E, G, X or D on an action never does it twice", () => {
  const { g, w, tick, ui } = realGame();
  const pl = player(w);
  // ITEMS: A / D quantity repeats, E summons once
  assert.ok(ui.select("item", "wood"));
  g.keyDown("d"); tick(1); g.keyUp("d");
  assert.ok(ui.qty > 5, `quantity ran up (${ui.qty})`);
  ui.qty = 1;
  g.keyDown("e"); tick(2); g.keyUp("e");
  assert.equal(countItem(pl, "wood"), 1, "E held for two seconds summoned once");
  g.keyDown("x"); tick(2); g.keyUp("x");
  assert.equal(countItem(pl, "wood"), 0);
  // FLAGS: E / D on a row flips it once, however long it is held
  ui.setTab(2);
  assert.ok(ui.select("flag", FLAGS.knowRepair));
  clearFlag(w, FLAGS.knowRepair);
  g.keyDown("d"); tick(2); g.keyUp("d");
  assert.ok(hasFlag(w, FLAGS.knowRepair), "held D toggled the flag once, not on and off");
  assert.ok(ui.select("flag", FLAGS.knowRepair));
  g.keyDown("e"); tick(2); g.keyUp("e");
  assert.ok(!hasFlag(w, FLAGS.knowRepair), "and held E toggled it once more");
  // PgDn scrolls a page at a time while held
  ui.setTab(0);
  const before = cursors(ui)[0];
  g.keyDown("pagedown"); tick(1); g.keyUp("pagedown");
  assert.ok(cursors(ui)[0] - before > 30, "page after page");
  // Q / R tabs: a press wraps, a held key runs to the end and stops
  g.keyDown("r"); tick(3); g.keyUp("r");
  assert.equal(ui.tab, DEBUG_TABS.length - 1, "held R: to the last tab, no spinning round");
  g.keyDown("q"); tick(3); g.keyUp("q");
  assert.equal(ui.tab, 0);
  g.keyDown("q"); tick(DT); g.keyUp("q");
  assert.equal(ui.tab, DEBUG_TABS.length - 1, "a single press still wraps");
});

test("Game: a travel row is only used by a press, not by holding", () => {
  const { g, tick, ui } = realGame();
  const teleports: string[] = [];
  const orig = g.debugTeleport.bind(g);
  g.debugTeleport = (p) => { teleports.push(p.label); return orig(p); };
  ui.setTab(3);
  const here = g.area.id;
  const i = debugPlaces(g.world).findIndex((p) => p.area !== here);
  assert.ok(i >= 0);
  assert.ok(ui.select("go", debugPlaces(g.world)[i].label));
  g.keyDown("e"); tick(3); g.keyUp("e");
  assert.equal(teleports.length, 1, "held E travelled once");
});

test("Game: a key held across a change of screen does not carry on repeating into the new one", () => {
  const { g, tick, ui, screens } = realGame();
  g.debugKey(0);                              // back to play
  assert.ok(screens.is("play"));
  g.keyDown("s");                             // walking down...
  tick(1);
  g.debugKey(0);                              // ...and the menu opens under the held key
  assert.ok(screens.is("debug"));
  ui.setTab(3);
  const c = cursors(ui)[3];
  tick(2);
  assert.equal(cursors(ui)[3], c, "S still held, but it is not repeating in the menu");
  g.keyUp("s");
  g.keyDown("s"); tick(0.1);
  assert.equal(cursors(ui)[3], c + 1, "a fresh press works at once");
  g.keyUp("s");
});

test("Game: the widget kit gets repeats in the system menu (not for Enter / E), and none on the play screen", () => {
  const { g, tick } = realGame();
  g.debugKey(0);
  assert.ok(g.screens.is("play"));
  g.keyDown("s");
  for (let n = 0; n < 90; n++) { tick(DT); assert.equal(g.guiInput(640, 360).keys.down && n > 0, false, "no repeats on the play screen (S walks)"); }
  g.keyUp("s");
  g.systemMenu.open();
  assert.ok(g.screens.is("system"));
  tick(0.1);
  g.keyDown("arrowdown"); tick(DT);
  let i = g.guiInput(640, 360);
  assert.ok(i.keys.down && i.fresh!.down, "the press is fresh");
  let repeats = 0, freshRepeats = 0;
  for (let n = 0; n < 120; n++) { tick(DT); i = g.guiInput(640, 360); if (i.keys.down) { repeats++; if (i.fresh!.down) freshRepeats++; } }
  assert.ok(repeats > 10, `repeated ${repeats} times in two seconds`);
  assert.equal(freshRepeats, 0, "a repeat is never a fresh press");
  g.keyUp("arrowdown");
  g.keyDown("e"); tick(DT);
  assert.ok(g.guiInput(640, 360).keys.activate, "the press activates");
  let activated = 0;
  for (let n = 0; n < 120; n++) { tick(DT); if (g.guiInput(640, 360).keys.activate) activated++; }
  g.keyUp("e");
  assert.equal(activated, 0, "E held down after its press never re-activates");
});

// ---------------------------------------------------------------- the widget kit
const ctx = makeCanvas(640, 360).ctx;
type Frame = Partial<Omit<GuiInput, "keys" | "fresh">> & { keys?: Partial<GuiKeys>; fresh?: Partial<GuiKeys> };
function frame(gui: Gui, o: Frame, body: (g: Gui) => unknown) {
  const keys = { ...noKeys(), ...(o.keys ?? {}) };
  gui.begin(ctx, 640, 360, { ...noInput(), ...o, keys, fresh: { ...noKeys(), ...(o.fresh ?? {}) }, dt: DT });
  const r = body(gui);
  gui.end();
  return r;
}
const three = (g: Gui) => [g.button("a", rect(10, 10, 50, 14), "One"), g.button("b", rect(10, 30, 50, 14), "Two"), g.button("c", rect(10, 50, 50, 14), "Three")];
const repeatDown = { keys: { down: true } }, pressDown = { keys: { down: true }, fresh: { down: true } };
const repeatUp = { keys: { up: true } }, pressUp = { keys: { up: true }, fresh: { up: true } };

test("kit: a held Down / Up walks the focus to the end and stops; a fresh press wraps", () => {
  const g = new Gui();
  frame(g, pressDown, three); assert.equal(g.focus, "a");
  frame(g, repeatDown, three); assert.equal(g.focus, "b");
  frame(g, repeatDown, three); assert.equal(g.focus, "c");
  frame(g, repeatDown, three); assert.equal(g.focus, "c", "held at the last widget: no wrap");
  frame(g, pressDown, three); assert.equal(g.focus, "a", "a fresh press wraps");
  frame(g, repeatUp, three); assert.equal(g.focus, "a", "held at the first widget: no wrap");
  frame(g, pressUp, three); assert.equal(g.focus, "c");
});

test("kit: holding Down in a list scrolls it row by row and stays in it at the last row", () => {
  const g = new Gui(), r = rect(10, 10, 200, 62), draw = () => {};
  const list = (sel: number) => (x: Gui) => x.list("l", r, 6, 12, sel, draw) as { sel: number };
  g.focus = "l";
  let sel = 0;
  for (let i = 0; i < 5; i++) sel = (frame(g, repeatDown, list(sel)) as { sel: number }).sel;
  assert.equal(sel, 5);
  const more = (x: Gui) => [list(sel)(x), x.button("after", rect(10, 90, 50, 14), "After")];
  frame(g, repeatDown, more);
  assert.equal(g.focus, "l", "held past the last row: it does not leave the list");
  frame(g, pressDown, more);
  assert.equal(g.focus, "after", "a fresh press does");
});

test("kit: sliders and choices keep stepping while held; a toggle only flips on a press; tab bars stop at the ends", () => {
  const g = new Gui(), r = rect(10, 10, 200, 14);
  g.focus = "s";
  let v = 50;
  for (let i = 0; i < 4; i++) v = frame(g, { keys: { right: true } }, (x) => x.slider("s", r, "Volume", v, 0, 100, 5)) as number;
  assert.equal(v, 70, "a slider moves on every repeat");
  g.focus = "t";
  const flip = (value: boolean, o: Frame) => frame(g, o, (x) => x.toggle("t", r, "Shake", value)) as boolean;
  assert.equal(flip(false, { keys: { left: true }, fresh: { left: true } }), true, "a press flips it");
  assert.equal(flip(true, { keys: { left: true } }), true, "a held key does not flip it back");
  const tabs = (i: number, o: Frame) => frame(g, o, (x) => x.tabs("tb", r, ["One", "Two", "Three"], i, true)) as number;
  assert.equal(tabs(0, { keys: { prevTab: true }, fresh: { prevTab: true } }), 2, "a press wraps");
  assert.equal(tabs(0, { keys: { prevTab: true } }), 0, "a held Q stops at the first tab");
  assert.equal(tabs(1, { keys: { nextTab: true } }), 2);
  assert.equal(tabs(2, { keys: { nextTab: true } }), 2, "and a held R at the last");
});

test("kit: input with no `fresh` keys (as hosts and tests built it before) treats every key as a press", () => {
  const g = new Gui(), r = rect(10, 10, 200, 14);
  g.begin(ctx, 640, 360, { ...noInput(), keys: { ...noKeys(), nextTab: true }, dt: DT });
  assert.equal(g.tabs("tb", r, ["One", "Two", "Three"], 2, true), 0, "wraps");
  g.end();
});

// ---------------------------------------------------------------- the screens
const rep = (sh: ReturnType<typeof screenHost>, n: number, ...k: string[]) => { for (let i = 0; i < n; i++) sh.repeat(...k); };

test("debug screen: repeats move the cursor and the quantity, never activate", () => {
  const w = newWorld(), sh = screenHost(w);
  Object.defineProperties(sh.host, {
    debugSpeed: { get: () => false, set: () => {} }, debugSpeedMult: { get: () => 3, set: () => {} }, debugNoclip: { get: () => false, set: () => {} },
    debugHud: { get: () => false, set: () => {} }, zoom: { get: () => 1 }, hasArm: { get: () => hasFlag(w, FLAGS.golemArm) },
  });
  Object.assign(sh.host, { has: () => false, debugSetFlag: (f: string, on: boolean) => { if (on) setFlag(w, f); else clearFlag(w, f); } });
  const ui = new DebugUi(sh.host);
  ui.toggle();
  rep(sh, 5, "s"); assert.equal(cursors(ui)[0], 5);
  rep(sh, 2, "arrowup"); assert.equal(cursors(ui)[0], 3);
  const page = (ui as unknown as { visible(): number }).visible();
  rep(sh, 3, "pagedown"); assert.equal(cursors(ui)[0], 3 + 3 * page, "PgDn held: page after page");
  rep(sh, 4, "d"); assert.equal(ui.qty, 5);
  rep(sh, 2, "a"); assert.equal(ui.qty, 3);
  rep(sh, 3, "e"); rep(sh, 3, "enter"); rep(sh, 3, "g"); rep(sh, 3, "x");
  assert.ok(player(w).inventory.every((s) => !s), "a repeating E / G / X does nothing");
  rep(sh, 3, "r"); assert.equal(ui.tab, 3, "R held steps on, a tab per repeat");
  rep(sh, 30, "r"); assert.equal(ui.tab, DEBUG_TABS.length - 1, "and stops at the last tab");
  ui.setTab(2);
  assert.ok(ui.select("flag", FLAGS.knowRepair));
  clearFlag(w, FLAGS.knowRepair);
  rep(sh, 3, "d"); rep(sh, 3, "e"); rep(sh, 3, "arrowright");
  assert.ok(!hasFlag(w, FLAGS.knowRepair), "repeats never toggle a flag");
  sh.press("d");
  assert.ok(hasFlag(w, FLAGS.knowRepair), "a press does");
});

test("pack, storage and transfer: a repeat moves the cursor like a press", () => {
  const w = newWorld(), pl = player(w);
  addItems(w, pl, "wood", 12);
  const sh = screenHost(w), ui = new PackUi(sh.host);
  ui.open("view");
  rep(sh, 3, "d"); assert.equal(ui.cursor, 3);
  rep(sh, 1, "s"); assert.equal(ui.cursor, 7);
  rep(sh, 2, "arrowleft"); assert.equal(ui.cursor, 5);
  rep(sh, 3, "e"); rep(sh, 3, "q");
  assert.equal(countItem(pl, "wood"), 12, "repeating E / Q never uses or drops");

  const f = fixture(), st = screenHost(f.w), store = new StorageUi(st.host);
  besideChest(f.w);
  store.open(CHEST.prop);
  rep(st, 3, "d"); assert.equal(store.cursor, 3);
  rep(st, 1, "d"); assert.equal(store.pane, "chest", "across into the chest");
  rep(st, 2, "s"); assert.ok(store.cursor > 0);
  const kept = JSON.stringify(f.pl.inventory);
  rep(st, 4, "e"); rep(st, 4, "q");
  assert.equal(JSON.stringify(f.pl.inventory), kept, "repeating E / Q moves nothing");

  const t = fixture(), sx = screenHost(t.w);
  const manage = new ManageUi(sx.host), transfer = new TransferUi(sx.host, (id) => manage.open(id));
  beside(t.w, worker(t.w));
  addItems(t.w, player(t.w), "rune_swift", 1);
  transfer.open(worker(t.w).id);
  rep(sx, 2, "d"); const at = `${transfer.pane}:${transfer.cursor}`;
  assert.notEqual(at, "pack:0");
  rep(sx, 3, "e"); rep(sx, 3, "f");
  assert.equal(countItem(player(t.w), "rune_swift"), 1, "repeating E / F gives and equips nothing");
});

test("manage and crafting: a repeat steps the rows and the choice rows; crafting only on a press", () => {
  const f = fixture(), sh = screenHost(f.w), ui = new ManageUi(sh.host);
  ui.open(f.worker.id);
  const start = ui.row;
  rep(sh, 2, "s"); assert.equal(ui.row, Math.min(ui.menu.length - 1, start + 2));
  rep(sh, 5, "w"); assert.equal(ui.row, 0);
  // GATHER...: its choice rows turn on every repeat, its button does nothing on one
  sh.press("s"); sh.press("e");
  assert.equal(ui["view"], "gather");
  rep(sh, 3, "s");
  const amount = () => ui.menu[ui.row].value;
  assert.equal(ui.menu[ui.row].label, "AMOUNT");
  const first = amount(), seen = new Set<string | undefined>([first]);
  for (let i = 0; i < 8; i++) { sh.repeat("d"); seen.add(amount()); }
  assert.ok(seen.size > 2, `the amount turned through ${[...seen].join(", ")}`);
  rep(sh, 4, "s");
  assert.ok(ui.menu[ui.row].label.startsWith("ISSUE"));
  rep(sh, 4, "e"); rep(sh, 4, "d"); rep(sh, 4, "enter");
  assert.ok(!f.worker.job, "a repeating E / D never gives the order");

  const w = newWorld(), pl = player(w);
  setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.golemArm);
  addItems(w, pl, "wood", 12); addItems(w, pl, "stone", 5); addItems(w, pl, "planks", 8);
  const sc = screenHost(w), craft = new CraftingUi(sc.host);
  craft.open("crafting", BENCH.prop);
  assert.ok(sc.host.screens.is("crafting"));
  const n = craft["list"].length;
  assert.ok(n >= 2, "the bench has recipes");
  rep(sc, n + 5, "s"); assert.equal(craft.cursor, n - 1, "held down it stops at the last recipe");
  rep(sc, n + 5, "w"); assert.equal(craft.cursor, 0);
  rep(sc, 3, "e"); rep(sc, 3, "enter");
  assert.ok(sc.host.screens.is("crafting"), "a repeating E crafts nothing");
  assert.equal(craft.focus, "list");
  if (craft.tabs.length > 1) {
    rep(sc, 20, "r"); assert.equal(craft.tab, craft.tabs.length - 1, "held R goes to the last tab and stops");
  }
});

test("build menu: a repeat moves the catalog cursor and the ghost; a held tab key stops at the end; E places nothing", () => {
  const w = newWorld(), pl = player(w);
  setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.golemArm);
  addItems(w, pl, "wood", 12); addItems(w, pl, "stone", 5);
  const sh = screenHost(w), ui = new BuildUi(sh.host);
  ui.open();
  assert.ok(sh.host.screens.is("build"));
  const c = ui["cursor"] as number;
  rep(sh, 3, "d"); assert.equal(ui["cursor"], c + 3);
  rep(sh, 1, "s"); assert.ok((ui["cursor"] as number) > c + 3);
  rep(sh, 6, "arrowleft"); assert.ok((ui["cursor"] as number) >= 0);
  const tabs = ui["tab"] as number;
  sh.press("q"); assert.notEqual(ui["tab"], tabs, "a press changes the tab");
  ui["tab"] = 0;
  rep(sh, 3, "q"); assert.equal(ui["tab"], 0, "held Q stays on the first tab");
  rep(sh, 30, "r"); assert.ok((ui["tab"] as number) > 0);
  const last = ui["tab"] as number;
  rep(sh, 3, "r"); assert.equal(ui["tab"], last, "held R stays on the last tab");
});

test("book: a held right turns pages to the last one and never closes the book", () => {
  const w = newWorld(), pl = player(w);
  addItems(w, pl, "book_build", 1);
  const sh = screenHost(w), ui = new BookUi(sh.host);
  ui.open("book_build");
  assert.ok(sh.host.screens.is("book"));
  const sc = sh.host.screens.top!;
  sc.t = 1; // past the page-turn grace
  const page = () => (ui as unknown as { book: { page: number } }).book.page;
  rep(sh, 40, "arrowright");
  assert.ok(page() > 0, "pages turned");
  assert.ok(sh.host.screens.is("book"), "a repeat never closes it");
  rep(sh, 5, "d"); assert.ok(sh.host.screens.is("book"));
  const last = page();
  rep(sh, 40, "a");
  assert.equal(page(), 0, "held left goes back to the first page");
  assert.ok(last >= 0);
  rep(sh, 3, "e");
  assert.ok(sh.host.screens.is("book"), "and a repeating E does not close it either");
});
