// A headless UiHost for the overlay screens: a real ScreenStack and a pixel
// canvas (the snapshot tool's RCanvas), keys pressed by the test, and every
// message and event the screen drained kept for assertions. Plus a recorder for
// the bitmap font's text calls, so a test can lint what a screen draws: only
// font glyphs, nothing outside the panel, no two strings on top of each other.
import assert from "node:assert/strict";
import { RCanvas, png } from "./uiSnapshot";
import { currentArea, player, type SimEvent, type World } from "../../src/game/world/world";
import { ScreenStack, type Screen } from "../../src/game/ui/screens";
import { FONT_GLYPHS, textWidth } from "../../src/game/font";

export interface TextBox { text: string; x0: number; x1: number; y0: number; y1: number }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontModule = require("../../src/game/font") as { drawText: (...a: unknown[]) => void; drawTextS: (...a: unknown[]) => void };

/** Run `draw` and return every string it put on the canvas with the font, as the pixel box it covers. */
export function captureText(draw: () => void): TextBox[] {
  const boxes: TextBox[] = [];
  const { drawText, drawTextS } = fontModule;
  const rec = (args: unknown[]) => {
    const [, s, x, y, , scale = 1, align = "left"] = args as [unknown, string, number, number, string, number, string];
    const text = s.toUpperCase(), w = textWidth(text, scale);
    const x0 = align === "center" ? Math.round(x - w / 2) : align === "right" ? Math.round(x - w) : Math.round(x);
    boxes.push({ text, x0, x1: x0 + w, y0: Math.round(y), y1: Math.round(y) + 5 * scale });
  };
  fontModule.drawText = (...a: unknown[]) => { rec(a); drawText(...a); };
  fontModule.drawTextS = (...a: unknown[]) => { rec(a); drawTextS(...a); };
  try { draw(); } finally { fontModule.drawText = drawText; fontModule.drawTextS = drawTextS; }
  return boxes;
}

/** The lint every new screen must pass: font glyphs only, inside the panel, and no text over other text. */
export function assertTextFits(name: string, boxes: TextBox[], panel = { x: 5, y: 2, w: 310, h: 172 }) {
  assert.ok(boxes.length > 0, `${name}: drew no text`);
  for (const b of boxes) {
    for (const ch of b.text) assert.ok(FONT_GLYPHS.has(ch), `${name}: "${b.text}" has glyph ${JSON.stringify(ch)} the font can't draw`);
    assert.ok(b.x0 >= panel.x + 2 && b.x1 <= panel.x + panel.w - 2 && b.y0 >= panel.y + 2 && b.y1 <= panel.y + panel.h - 2, `${name}: "${b.text}" leaves the panel (${b.x0}..${b.x1}, ${b.y0}..${b.y1})`);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 === b.x0 && a.y0 === b.y0 && a.text === b.text) continue;
    const over = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    assert.ok(!over, `${name}: "${a.text}" overlaps "${b.text}"`);
  }
}

export interface ScreenHost {
  host: any;
  ui: RCanvas;
  /** Message events the screen drained (player messages), in order. */
  notes: string[];
  /** Every event drained. */
  seen: SimEvent[];
  /** Press keys for one update of the top screen. */
  press(...keys: string[]): void;
  /** Render the top screens, capturing their text. */
  draw(): TextBox[];
  save(path: string): void;
}

export function screenHost(w: World): ScreenHost {
  (globalThis as any).document = { createElement: () => new RCanvas() };
  const ui = new RCanvas(320, 180), keys = new Set<string>(), notes: string[] = [], seen: SimEvent[] = [];
  const host: any = {
    ctx: ui.getContext(), wctx: new RCanvas(320, 180).getContext(), world: w, get pl() { return player(w); }, get area() { return currentArea(w); },
    t: 0.1, cam: { x: 0, y: 0 }, vw: 320, vh: 180, screens: new ScreenStack(), typed: [],
    sfx: new Proxy({}, { get: () => () => {} }),
    hit: (...k: string[]) => k.some((x) => keys.has(x)),
    say: (s: string) => { notes.push(s); },
    renderNote: () => {}, renderToast: () => {}, animate: () => {}, boostEye: () => {}, read: () => {},
    drainEvents: () => {
      for (const e of w.events) { seen.push(e); if (e.t === "message" && !e.actor) notes.push(e.text); }
      w.events = [];
    },
  };
  const base: Screen = { id: "play", opaque: true, t: 0, update() {}, render() {} };
  host.screens.set(base);
  const draw = () => captureText(() => { ui.data.fill(0); host.ctx.fillStyle = "#1a1620"; host.ctx.fillRect(0, 0, 320, 180); host.screens.render(); });
  return {
    host, ui, notes, seen, draw,
    press(...k) { for (const x of k) keys.add(x); host.screens.update(1 / 60); keys.clear(); },
    save(path) { require("node:fs").mkdirSync(require("node:path").dirname(path), { recursive: true }); require("node:fs").writeFileSync(path, png(ui, 3)); },
  };
}
