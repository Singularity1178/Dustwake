// Phase 0.5 / 0.7: the v2 font, the widget kit (mouse and keyboard parity), settings and the notification feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { font2Rows, textWidth2, wrapText2, fitsFont2, clipText2 } from "../src/game/ui/font2";
import { Gui, rect, noInput, noKeys, type GuiInput, type GuiKeys } from "../src/game/ui/gui";
import { Settings, DEFAULT_KEYS, applyPalette, PALETTES, settingDefs, registerSetting } from "../src/game/ui/settings";
import { NotificationFeed, noteForEvent } from "../src/game/ui/notify";
import { VISION_CATEGORIES } from "../src/game/content/vision";
import { createWorld, actorById } from "../src/game/world/world";
import { makeCanvas } from "../src/game/util";

test("the v2 font: mixed case, every glyph's rows equally wide, proportional measuring, wrapping and clipping", () => {
  for (const [ch, rows] of font2Rows()) {
    assert.ok(rows.length >= 7 && rows.length <= 9, `${ch} has ${rows.length} rows`);
    assert.ok(rows.every((r) => r.length === rows[0].length), `${ch} rows differ in width`);
  }
  for (const c of "AZaz09.,:;!?'\"-+=/()[]<>%#*&@") assert.ok(fitsFont2(c), c);
  assert.ok(textWidth2("ill") < textWidth2("MWM"), "proportional");
  assert.ok(fitsFont2("Autosave — every 5 min…"), "typographic marks map onto the glyphs");
  const lines = wrapText2("The quick brown fox jumps over the lazy golem, twice.", 60);
  assert.ok(lines.length > 1 && lines.every((l) => textWidth2(l) <= 60));
  assert.ok(textWidth2(clipText2("A very long label indeed", 40)) <= 40);
});

const ctx = makeCanvas(640, 360).ctx;
function frame(gui: Gui, o: Partial<Omit<GuiInput, "keys">> & { keys?: Partial<GuiKeys> }, body: (g: Gui) => unknown) {
  gui.begin(ctx, 640, 360, { ...noInput(), ...o, keys: { ...noKeys(), ...(o.keys ?? {}) }, dt: 1 / 60 });
  const r = body(gui);
  gui.end();
  return r;
}
const two = (g: Gui) => [g.button("a", rect(10, 10, 50, 14), "One"), g.button("b", rect(10, 30, 50, 14), "Two")];

test("buttons: a click is press and release on the same widget; keyboard focus moves with Up / Down and Enter activates", () => {
  const g = new Gui();
  assert.deepEqual(frame(g, { mx: 20, my: 15, pressed: true, down: true }, two), [false, false]);
  assert.deepEqual(frame(g, { mx: 20, my: 15, released: true }, two), [true, false]);
  frame(g, { mx: 20, my: 15, pressed: true, down: true }, two);
  assert.deepEqual(frame(g, { mx: 20, my: 35, released: true }, two), [false, false], "dragged off: no click");
  assert.ok(g.over === false || g.over === true);
  frame(g, { keys: { down: true } }, two);
  assert.equal(g.focus, "a");
  frame(g, { keys: { down: true } }, two);
  assert.equal(g.focus, "b");
  assert.deepEqual(frame(g, { keys: { activate: true } }, two), [false, true]);
  assert.deepEqual(frame(g, { mx: 300, my: 300, pressed: true, down: true }, () => g.button("x", rect(0, 0, 10, 10), "x", { disabled: true })), false);
});

test("slider, toggle, choice and tabs: drag, wheel and keys; Q / R switch tabs from anywhere", () => {
  const g = new Gui(), r = rect(10, 10, 300, 14);
  let v = 50;
  v = frame(g, { mx: 300, my: 15, pressed: true, down: true }, (x) => x.slider("s", r, "Volume", v, 0, 100, 5)) as number;
  assert.equal(v, 100, "dragged to the end");
  v = frame(g, { mx: 200, my: 15, wheel: 1 }, (x) => x.slider("s", r, "Volume", v, 0, 100, 5)) as number;
  assert.equal(v, 95);
  assert.equal(g.wantsWheel, true);
  g.focus = "s";
  v = frame(g, { keys: { left: true } }, (x) => x.slider("s", r, "Volume", v, 0, 100, 5)) as number;
  assert.equal(v, 90);
  g.focus = "t";
  assert.equal(frame(g, { keys: { activate: true } }, (x) => x.toggle("t", r, "Shake", true)), false);
  g.focus = "c";
  const opts = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  assert.equal(frame(g, { keys: { right: true } }, (x) => x.choice("c", r, "Pick", opts, "a")), "b");
  assert.equal(frame(g, { keys: { nextTab: true } }, (x) => x.tabs("tb", r, ["One", "Two", "Three"], 2)), 0);
  assert.equal(frame(g, { keys: { prevTab: true } }, (x) => x.tabs("tb", r, ["One", "Two", "Three"], 0)), 2);
});

test("lists scroll with the wheel and move their selection with the keys; tables sort by a clicked column; a modal blocks the rest", () => {
  const g = new Gui(), r = rect(10, 10, 200, 62), draw = () => {};
  g.focus = "l";
  let res = frame(g, { keys: { down: true } }, (x) => x.list("l", r, 30, 12, 0, draw)) as { sel: number };
  assert.equal(res.sel, 1);
  assert.equal(g.focus, "l", "the list kept Up / Down for its rows");
  res = frame(g, { mx: 50, my: 30, wheel: 3 }, (x) => x.list("l", r, 30, 12, 1, draw)) as { sel: number };
  assert.equal(g.wantsWheel, true);
  const rows = [["b", "2"], ["a", "10"], ["c", "1"]];
  frame(g, { mx: 150, my: 15, released: true }, (x) => x.table("t", rect(10, 10, 200, 80), [{ label: "Name", w: 50 }, { label: "N", w: 50 }], rows, -1));
  const t = frame(g, {}, (x) => x.table("t", rect(10, 10, 200, 80), [{ label: "Name", w: 50 }, { label: "N", w: 50 }], rows, -1)) as { order: number[] };
  assert.deepEqual(t.order, [2, 0, 1], "sorted by the number column, numerically");
  // a modal: the button under it does not react; Esc answers its last button
  const body = (x: Gui) => [x.button("under", rect(300, 170, 40, 14), "Under"), x.modalBox("m", "Sure?", ["Really?"], ["Yes", "No"])];
  frame(g, {}, body);
  const out = frame(g, { mx: 310, my: 175, pressed: true, down: true, released: true }, body) as [boolean, number];
  assert.equal(out[0], false);
  assert.equal((frame(g, { keys: { back: true } }, body) as [boolean, number])[1], 1);
});

test("settings: defaults, clamping, a rebound key leaves every other action, and they persist", () => {
  const mem = new Map<string, string>(), storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const s = new Settings(storage);
  assert.equal(s.num("volMaster"), 100);
  assert.equal(s.bool("pauseOnAlert"), false);
  s.set("volMaster", 143); assert.equal(s.num("volMaster"), 100);
  s.set("volMaster", 42); assert.equal(s.num("volMaster"), 40, "snapped to the step");
  s.set("uiScale", "huge"); assert.equal(s.str("uiScale"), "large", "not an option: the default, Large");
  s.bind("attack", "e");
  assert.deepEqual(s.keys("attack").slice(0, 1), ["e"]);
  assert.ok(!s.keys("interact").includes("e"));
  const again = new Settings(storage);
  assert.equal(again.num("volMaster"), 40);
  assert.equal(again.keys("attack")[0], "e");
  again.resetAll();
  assert.deepEqual(again.keys("interact"), DEFAULT_KEYS.interact);
  registerSetting({ id: "test.later", label: "A later feature", category: "game", kind: "toggle", def: true });
  assert.ok(settingDefs().some((d) => d.id === "test.later"), "later features register in one place");
});

test("palettes recolour the vision categories (colour-blind-safe sets)", () => {
  applyPalette("deutan");
  assert.equal(VISION_CATEGORIES.buildable.color, PALETTES.deutan.buildable);
  applyPalette("default");
  assert.equal(VISION_CATEGORIES.buildable.color, PALETTES.default.buildable);
});

test("notifications: repeats merge, alerts call back, and sim events become notes", () => {
  const f = new NotificationFeed();
  let alerts = 0;
  f.onAlert = () => alerts++;
  f.push("Hello"); f.push("Hello");
  assert.equal(f.items.length, 1); assert.equal(f.items[0].count, 2);
  f.push("Blocked", "alert");
  assert.equal(alerts, 1);
  f.update(100);
  assert.equal(f.items.length, 0);
  assert.equal(f.history.length, 2);
  const w = createWorld(41), wk = actorById(w, "npc.worker.artificery")!;
  const n = noteForEvent(w, { t: "jobChanged", actor: wk.id, status: "blocked", reason: "storageFull" })!;
  assert.equal(n.level, "alert");
  assert.match(n.text, /blocked: storage full/);
  assert.equal(noteForEvent(w, { t: "jobChanged", actor: w.playerId, status: "blocked" }), null, "the player's own orders are not news");
  assert.equal(noteForEvent(w, { t: "dayPhase", phase: "dawn", day: 2 })!.text, "Dawn, day 3");
});
