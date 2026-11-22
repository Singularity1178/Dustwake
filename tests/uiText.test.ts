// The interface's text (ui/text.ts): the mixed-case v2 face on every screen that
// is laid out on the 320x180 grid, at every UI scale. What the world says (speech,
// the golem's thoughts) keeps the capital font. Each screen is drawn through the
// headless host on pixel canvases, linted (glyphs, inside the panel, no overlap)
// and saved to .test-out/shots/text/ for a look.
import test from "node:test";
import assert from "node:assert/strict";
import { screenHost, assertTextFits, captureText, UI_SCALES, type UiScale, type TextBox } from "./support/screenHost";
import { fixture, worker, beside, CHEST, BENCH, besideChest } from "./support/workerFixture";
import { installDom, scene, shot } from "./support/folkSnapshot";
import { composite, png, type RCanvas } from "./support/uiSnapshot";
import { sentence, titled, learnNames, forgetNames, parseHints, labelW, hintsW, clipLabel, wrapLabel, flow, label, shade, fontUnit, lineH, bindUiText, fitsLabel } from "../src/game/ui/text";
import { panel } from "../src/game/ui/kit";
import { textWidth } from "../src/game/font";
import { textWidth2, textWidth2B, font2Rows, font2BoldRows } from "../src/game/ui/font2";
import { ITEMS, ITEM_IDS, effectLines } from "../src/game/content/items";
import { RECIPES } from "../src/game/content/build";
import { CRAFT_RECIPES } from "../src/game/content/crafting";
import { GEAR_SLOT_DEFS } from "../src/game/content/gear";
import { FLAGS } from "../src/game/content/flags";
import { addItems } from "../src/game/sim/inventory";
import { setFlag, player, type World } from "../src/game/world/world";
import { PackUi } from "../src/game/screens/pack";
import { StorageUi } from "../src/game/screens/storage";
import { TransferUi } from "../src/game/screens/transfer";
import { ManageUi } from "../src/game/screens/manage";
import { CraftingUi } from "../src/game/screens/crafting";
import { BuildUi } from "../src/game/screens/buildMenu";
import { BookUi } from "../src/game/screens/book";
import { DebugUi } from "../src/game/screens/debug";
import { DialogueUi } from "../src/game/screens/dialogue";
import { itemIcon } from "../src/game/art/items";
import { writeFileSync, mkdirSync } from "node:fs";

const SCALES = Object.keys(UI_SCALES) as UiScale[];
const SHOTS = ".test-out/shots/text";
const texts = (b: TextBox[]) => b.map((x) => x.shown);
const has = (b: TextBox[], t: string) => assert.ok(texts(b).includes(t), `"${t}" not drawn; got ${texts(b).join(" | ")}`);

test("casing: capitals become sentences and titles; mixed case, names, keys and counts are left as they should be", () => {
  forgetNames();
  assert.equal(sentence("IT STANDS AND WAITS"), "It stands and waits");
  assert.equal(sentence("A CHISEL FOR CARVING RUNES. CARRY IT TO CARVE. IT IS NEVER USED UP."), "A chisel for carving runes. Carry it to carve. It is never used up.");
  assert.equal(sentence("BLOCKED: STORAGE FULL"), "Blocked: storage full");
  assert.equal(sentence("WORN: SPEED X2.5"), "Worn: speed x2.5");
  assert.equal(sentence("READY - E TO PLACE"), "Ready - E to place");
  assert.equal(sentence("W/S CHOOSE"), "W/S choose");
  assert.equal(sentence("THE GUARDIAN'S CORE IS SPENT. I CAN'T WAKE IT."), "The guardian's core is spent. I can't wake it.");
  assert.equal(sentence("THE ROAD TO WESTWAKE"), "The road to Westwake");
  assert.equal(sentence("(PRESS B TO BUILD)"), "(Press B to build)");
  assert.equal(sentence("EVERY WORK BEGINS WITH\nGROUND THAT WILL BEAR IT.\nCLEAR THE PLACE."), "Every work begins with\nground that will bear it.\nClear the place.");
  assert.equal(sentence("Already mixed: LEFT alone"), "Already mixed: LEFT alone");
  assert.equal(sentence("12/48"), "12/48");
  assert.equal(titled("CHEST OF THE OLD STAIR"), "Chest of the Old Stair");
  assert.equal(titled("IRON ORE X3"), "Iron Ore x3");
  assert.equal(titled("R ARM"), "R Arm");
  assert.equal(titled("MARTA - LABOURER"), "Marta - Labourer");
  assert.equal(titled("Bob's chest"), "Bob's chest");
  // a name the keeper typed is a name wherever it stands, once the world has taught it
  assert.equal(sentence("GAVE THE ORDER TO BOB"), "Gave the order to bob");
  learnNames(["BOB", "MARTA"]);
  assert.equal(sentence("GAVE THE ORDER TO BOB"), "Gave the order to Bob");
  assert.equal(sentence("MARTA AND BOB WAIT"), "Marta and Bob wait");
  forgetNames();
  assert.equal(sentence("GAVE THE ORDER TO BOB"), "Gave the order to bob");
});

test("key hints: the capital font's hint lines parse into keys and what they do", () => {
  assert.deepEqual(parseHints("E NEXT PAGE   ESC CLOSE"), [["E", "NEXT PAGE"], ["ESC", "CLOSE"]]);
  assert.deepEqual(parseHints("W/S CHOOSE   A/D CHANGE   E CONFIRM   C CORE   ESC BACK"), [["W/S", "CHOOSE"], ["A/D", "CHANGE"], ["E", "CONFIRM"], ["C", "CORE"], ["ESC", "BACK"]]);
  assert.deepEqual(parseHints("E SELECT  Q/R TAB  / SEARCH  ESC"), [["E", "SELECT"], ["Q/R", "TAB"], ["/", "SEARCH"], ["ESC", ""]]);
  assert.deepEqual(parseHints("ANY KEY - WALK ON    R - WAKE AGAIN"), [["ANY KEY", "WALK ON"], ["R", "WAKE AGAIN"]]);
  assert.deepEqual(parseHints("A/D QTY (SHIFT X10)  PGUP/PGDN SCROLL"), [["A/D", "QTY (SHIFT X10)"], ["PGUP/PGDN", "SCROLL"]]);
  // words that only look like a key are words
  assert.deepEqual(parseHints("CAN'T DROP"), [["", "CAN'T DROP"]]);
  assert.deepEqual(parseHints("WEAR FROM THE PACK"), [["", "WEAR FROM THE PACK"]]);
  assert.deepEqual(parseHints("EMPTY: DEFAULT NAME"), [["", "EMPTY: DEFAULT NAME"]]);
  assert.deepEqual(parseHints("TYPE A NAME   ENTER KEEP"), [["", "TYPE A NAME"], ["ENTER", "KEEP"]]);
});

test("the bold weight never clogs: no stem is struck into its neighbour, every bold glyph is wider, and its rows are even", () => {
  const reg = font2Rows(), bold = font2BoldRows();
  assert.equal(bold.size, reg.size);
  for (const [ch, rows] of bold) {
    const r = reg.get(ch)!;
    assert.equal(rows.length, r.length, `bold ${ch}: as many rows`);
    for (const row of rows) assert.equal(row.length, rows[0].length, `bold ${ch}: even rows`);
    assert.ok(rows[0].length > r[0].length, `bold ${ch} is wider`);
    // a one-pixel gap between two strokes of the regular glyph is still a gap in the bold one (letters drawn by hand aside)
    if (rows[0].length === r[0].length + 1) r.forEach((row, y) => { for (let i = 0; i + 2 < row.length; i++) if (row[i] === "#" && row[i + 1] === "." && row[i + 2] === "#") assert.equal(rows[y][i + 1], ".", `bold ${ch} row ${y} keeps its counter`); });
  }
  for (const ch of "MWmw") assert.ok(bold.get(ch)![0].length >= reg.get(ch)![0].length + 2, `${ch} is drawn by hand`);
  assert.ok(textWidth2B("Worker Golem") > textWidth2("Worker Golem") + 12);
  assert.equal(textWidth2B(""), 0);
});

test("measuring: at every UI scale interface text is no wider and no taller than the capitals the layouts were drawn for", () => {
  const w = fixture().w;
  const lines: string[] = [];
  for (const id of ITEM_IDS) lines.push(ITEMS[id].name, ...(ITEMS[id].desc ?? []), ...effectLines(id));
  for (const r of Object.values(RECIPES)) lines.push(r.name, ...r.desc);
  for (const r of CRAFT_RECIPES) lines.push(r.name, ...r.desc);
  for (const d of GEAR_SLOT_DEFS) lines.push(d.name, ...(d.hint ?? []));
  assert.ok(lines.length > 200);
  for (const scale of SCALES) {
    const sh = screenHost(w, scale);
    sh.draw();
    const u = fontUnit();
    assert.equal(u, UI_SCALES[scale].k / UI_SCALES[scale].s, scale);
    assert.ok(lineH() <= 7.4, `${scale}: a line fits the capital font's 7 px pitch`);
    for (const l of lines) {
      assert.ok(fitsLabel(l) && fitsLabel(l, "title"), `"${l}" has a glyph the interface font lacks`);
      assert.ok(labelW(l) <= textWidth(l) + 0.01, `${scale}: "${sentence(l)}" (${labelW(l).toFixed(1)}) is wider than its capitals (${textWidth(l)})`);
      assert.ok(labelW(l, { case: "title" }) <= textWidth(l) + 0.01, `${scale}: "${titled(l)}" is wider than its capitals`);
    }
    // clipping and wrapping are measured, never counted
    const long = "A VERY LONG NAME FOR A VERY SMALL CHEST INDEED";
    for (const max of [30, 60, 120]) {
      assert.ok(labelW(clipLabel(long, max), { case: "raw" }) <= max, `${scale}: clipped to ${max}`);
      for (const l of wrapLabel(long, max)) assert.ok(labelW(l, { case: "raw" }) <= max, `${scale}: wrapped to ${max}`);
    }
    assert.ok(clipLabel(long, 60).endsWith("..."));
    assert.equal(clipLabel("SHORT", 200), "Short");
    assert.ok(hintsW("E MOVE STACK") > labelW("E MOVE STACK"), "a key cap takes room");
    // hand-wrapped lines flow again as one paragraph, cased as running text
    const para = flow(["A CHISEL FOR CARVING RUNES.", "CARRY IT TO CARVE. IT IS", "NEVER USED UP."], 400);
    assert.deepEqual(para, ["A chisel for carving runes. Carry it to carve. It is never used up."]);
    assert.ok(flow(["A CHISEL FOR CARVING RUNES.", "CARRY IT TO CARVE. IT IS", "NEVER USED UP."], 90, 2).length <= 2);
  }
});

/** Open every base-grid screen in a busy state and hand each to `each`. */
function screens(w: World, scale: UiScale, each: (name: string, sh: ReturnType<typeof screenHost>, panel?: { x: number; y: number; w: number; h: number }) => void) {
  const pl = player(w);
  setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.golemArm);
  addItems(w, pl, "wood", 12); addItems(w, pl, "stone", 5); addItems(w, pl, "iron_ore", 3); addItems(w, pl, "rune_glow", 1); addItems(w, pl, "book_build", 1); addItems(w, pl, "planks", 8);
  const open = (name: string, make: (sh: ReturnType<typeof screenHost>) => void, after?: (sh: ReturnType<typeof screenHost>) => void, pn?: { x: number; y: number; w: number; h: number }) => {
    const sh = screenHost(w, scale);
    make(sh);
    assert.ok(sh.host.screens.size > 1, `${name} opened`);
    each(name, sh, pn);
    after?.(sh);
  };
  open("pack", (sh) => new PackUi(sh.host).open("view"), (sh) => { for (const k of ["d", "s", "a", "a", "a", "w"]) { sh.press(k); each("pack moved", sh); } });
  open("storage", (sh) => { besideChest(w); new StorageUi(sh.host).open(CHEST.prop); }, (sh) => { sh.press("d"); sh.press("d"); each("storage chest side", sh); });
  open("manage", (sh) => { beside(w, worker(w)); new ManageUi(sh.host).open(worker(w).id); },
    (sh) => { for (const k of ["s", "e", "s", "s"]) { sh.press(k); each("manage rows", sh); } });
  open("transfer", (sh) => {
    beside(w, worker(w));
    addItems(w, pl, "rune_swift", 1);
    const manage = new ManageUi(sh.host), transfer = new TransferUi(sh.host, (id) => manage.open(id));
    transfer.open(worker(w).id);
  }, (sh) => { sh.press("d"); each("transfer other side", sh); });
  open("crafting", (sh) => new CraftingUi(sh.host).open("crafting", BENCH.prop), (sh) => { sh.press("s"); each("crafting next", sh); });
  open("build", (sh) => new BuildUi(sh.host).open(), (sh) => { sh.press("d"); sh.press("s"); each("build moved", sh); });
  open("book", (sh) => new BookUi(sh.host).open("book_build"));
  open("debug", (sh) => {
    Object.assign(sh.host, {
      debugSpeed: false, debugSpeedMult: 3, debugNoclip: false, debugHud: false, zoom: 1, hasArm: true,
      has: () => false, debugSetFlag() {}, debugTeleport: () => false, debugNewGame() {}, debugFoundations() {}, debugZoom() {}, saveGame() {}, loadGame: () => false,
    });
    new DebugUi(sh.host).toggle();
  }, (sh) => { for (const k of ["s", "r", "r", "r", "r"]) { sh.press(k); each("debug tab", sh, { x: 0, y: 0, w: 320, h: 180 }); } }, { x: 0, y: 0, w: 320, h: 180 });
}

for (const scale of SCALES) {
  test(`every base-grid screen writes in the interface face and fits, at the ${scale} UI scale`, () => {
    const seen = new Set<string>();
    screens(fixture().w, scale, (name, sh, pn) => {
      const b = sh.draw();
      assertTextFits(`${scale} ${name}`, b, pn);
      const caps = b.filter((x) => !x.v2);
      assert.deepEqual(caps.map((x) => x.text), [], `${scale} ${name}: still drawn in the capital font`);
      assert.ok(b.some((x) => /[a-z]/.test(x.shown)), `${scale} ${name}: mixed case on screen`);
      if (!seen.has(name)) { seen.add(name); sh.save(`${SHOTS}/${scale}-${name.replace(/ /g, "-")}.png`); }
    });
    for (const n of ["pack", "storage", "manage", "transfer", "crafting", "build", "book", "debug"]) assert.ok(seen.has(n), `${n} was drawn`);
  });
}

test("what a screen says: titles for names, sentences for the rest, keys on caps", () => {
  const f = fixture(), sh = screenHost(f.w);
  addItems(f.w, f.pl, "wood", 3);
  besideChest(f.w);
  const ui = new StorageUi(sh.host);
  ui.open(CHEST.prop);
  ui.pane = "pack"; ui.cursors.pack = f.pl.inventory.findIndex((x) => x?.item === "wood");
  const b = sh.draw();
  has(b, "Pack"); has(b, "Debug Workshop Chest"); has(b, "E MOVE STACK"); has(b, "ESC CLOSE");
  has(b, "Wood x3"); has(b, "material"); has(b, "E STORE STACK");
  assert.ok(texts(b).some((t) => /^[A-Z][a-z].*\.$/.test(t)), "its description, as a sentence");
  // every box still answers to its capitals, so older tests need not care which face drew it
  assert.ok(b.some((x) => x.text === "DEBUG WORKSHOP CHEST" && x.v2));
});

test("the two canvases: a panel wipes the text under it, an overlay's shade thins it, alpha carries over", () => {
  const sh = screenHost(fixture().w), ctx = sh.host.ctx as CanvasRenderingContext2D;
  const ink = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0;
    for (let y = y0 * 2; y < y1 * 2; y++) for (let x = x0 * 2; x < x1 * 2; x++) n += sh.hi.data[(y * sh.hi.width + x) * 4 + 3];
    return n;
  };
  sh.draw();
  label(ctx, "THE CHEST IS FULL", 160, 100, "#ffffff", "center");
  label(ctx, "14:30", 300, 176, "#ffffff", "right");
  const full = ink(100, 96, 220, 110), clock = ink(270, 172, 310, 180);
  assert.ok(full > 0 && clock > 0, "text is on the hi-res layer, not the base canvas");
  assert.equal(sh.ui.data.some((v, i) => i % 4 < 3 && v === 255), false, "nothing white on the base canvas");
  shade(ctx, "rgba(0,0,0,0.55)");
  const dimmed = ink(100, 96, 220, 110);
  assert.ok(dimmed > full * 0.4 && dimmed < full * 0.5, `the shade thins it by its alpha (${(dimmed / full).toFixed(2)})`);
  panel(ctx, 5, 2, 310, 172);
  assert.equal(ink(100, 96, 220, 110), 0, "a panel covers the text beneath it");
  assert.ok(ink(270, 175, 310, 180) > 0, "and leaves what is outside it");
  // text drawn with the base canvas's alpha is as faint on the layer
  sh.draw();
  ctx.globalAlpha = 0.5; label(ctx, "FADING", 160, 100, "#ffffff", "center"); ctx.globalAlpha = 1;
  const half = ink(100, 96, 220, 110);
  sh.draw();
  label(ctx, "FADING", 160, 100, "#ffffff", "center");
  assert.ok(Math.abs(half / ink(100, 96, 220, 110) - 0.5) < 0.05);
  // on any other canvas, or with no layer bound, text falls back to the capitals and still fits
  bindUiText(null);
  assert.equal(labelW("THE CHEST IS FULL"), textWidth("THE CHEST IS FULL"));
  assert.equal(clipLabel("THE CHEST IS FULL", 30), "THE CH.");
  const b = captureText(() => label(ctx, "THE CHEST IS FULL", 160, 100, "#ffffff", "center"));
  assert.deepEqual(b.map((x) => [x.text, x.v2]), [["THE CHEST IS FULL", false]]);
});

test("the world keeps its own voice: speech stays in the capital font, only the keys under it are the interface's", () => {
  for (const scale of SCALES) {
    const f = fixture(), sh = screenHost(f.w, scale);
    const w = scene("dungeon", -1, -1, 10, 0.2).w, npc = w.actors.find((a) => a.npc === "guardian");
    assert.ok(npc, "the guardian is in the dungeon");
    Object.assign(sh.host, { world: w });
    const d = new DialogueUi(sh.host) as unknown as { open(n: string, s: string, seg: string): void; dlg: { page: number; chars: number; hold: number; pages: { lines: string[] }[] } | null };
    d.open(npc!.id, "guardian", "intro");
    assert.ok(d.dlg, "the guardian speaks");
    Object.assign(d.dlg!, { chars: 1e9, hold: 0 });
    sh.host.t = 0;
    const b = sh.draw();
    const spoken = b.filter((x) => !x.v2).map((x) => x.text);
    for (const line of d.dlg!.pages[0].lines) assert.ok(spoken.includes(line.toUpperCase()), `${scale}: "${line}" is spoken in capitals`);
    assert.ok(spoken.every((t) => t === t.toUpperCase()));
    const ui = b.filter((x) => x.v2).map((x) => x.shown);
    assert.deepEqual(ui.sort(), ["E Next", "Esc Leave"].sort(), `${scale}: the keys are interface text`);
    sh.save(`${SHOTS}/${scale}-dialogue.png`);
  }
});

test("the HUD through the real host: notices, the item toast and the clock are interface text at every scale; Large is the capitals' size", () => {
  installDom();
  const { g } = scene("dungeon", -1, -1, 10, 0.5);
  const save = (name: string) => {
    const base = shot(g) as RCanvas, out = composite(base, g.hiCanvas as unknown as RCanvas);
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(`${SHOTS}/${name}.png`, png(out, 1));
  };
  for (const scale of SCALES) {
    g.settings.set("uiScale", scale);
    const L = g.hiLayout();
    assert.equal(L.cw / 320, UI_SCALES[scale].s, `${scale}: canvas px per base px`);
    assert.equal(L.k, UI_SCALES[scale].k, `${scale}: canvas px per font px`);
    assert.equal(L.lw * L.k, L.cw);
    g.say("THE CHEST IS FULL");
    g.toast = { icon: itemIcon("iron_ore"), name: "IRON ORE", t: 1 };
    const b = captureText(() => g.render());
    has(b, "The chest is full"); has(b, "Iron Ore");
    assert.ok(b.some((x) => x.v2 && /^\d\d:\d\d$/.test(x.shown)), `${scale}: the clock`);
    assert.deepEqual(b.filter((x) => !x.v2).map((x) => x.text), [], `${scale}: nothing on the HUD is left in the capital font`);
    for (const x of b) assert.ok(x.x0 >= 0 && x.x1 <= 320 && x.y0 >= 0 && x.y1 <= 181, `${scale}: "${x.shown}" is on screen`);
    save(`${scale}-hud`);
    // an overlay over the play screen: its panel hides the HUD's text, its own text is drawn after
    g.packUi.open("view");
    const p = captureText(() => g.render());
    has(p, "Pack"); has(p, "Gear");
    save(`${scale}-hud-pack`);
    g.screens.popToBase();
    g.note = null; g.toast = null;
  }
  g.settings.set("uiScale", "normal");
});
