// A headless UiHost for the overlay screens: a real ScreenStack, a pixel base
// canvas and a pixel hi-res UI layer over it (the snapshot tool's RCanvas), keys
// pressed by the test, and every message and event the screen drained kept for
// assertions. Plus a recorder for the text a screen draws, so a test can lint
// it: only glyphs its font has, nothing outside the panel, no two strings on top
// of each other.
//
// Interface text is written through ui/text.ts in the mixed-case v2 face, on the
// hi-res layer; it is recorded from that module's tap, in base px. Anything a
// screen still draws in the capital font (speech) is recorded from font.ts as
// before. A box's `text` is in capitals either way, as content writes it, so a
// test asks for "WAITING FOR POWER" whichever face draws it; `shown` is what is
// on screen ("Waiting for power").
import assert from "node:assert/strict";
import { RCanvas, png, composite } from "./uiSnapshot";
import { currentArea, player, type SimEvent, type World } from "../../src/game/world/world";
import { ScreenStack, FRAMED_SCREENS, type Screen } from "../../src/game/ui/screens";
import { FONT_GLYPHS, textWidth } from "../../src/game/font";
import { fitsFont2 } from "../../src/game/ui/font2";
import { bindUiText, textTap, inFrame } from "../../src/game/ui/text";
import { HI_W, HI_H } from "../../src/game/ui/scale";

export interface TextBox { text: string; shown: string; v2: boolean; x0: number; x1: number; y0: number; y1: number }

/**
 * The three UI scales (ui/scale.ts, Game.hiLayout): the hi layer is always HI_W x HI_H; `s` canvas px of it per UI px,
 * `k` per logical (font) px; the scaled UI canvas is uw x uh UI px. Large is the 320x180 interface as designed.
 */
export const UI_SCALES = {
  compact: { s: 3, k: 2, uw: 640, uh: 360 },
  normal: { s: 4.5, k: 3, uw: 427, uh: 240 },
  large: { s: 6, k: 4, uw: 320, uh: 180 },
} as const;
export type UiScale = keyof typeof UI_SCALES;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontModule = require("../../src/game/font") as { drawText: (...a: unknown[]) => void; drawTextS: (...a: unknown[]) => void };

/** Run `draw` and return every string it put on the canvas, in either face, as the box (base px) it covers. */
export function captureText(draw: () => void): TextBox[] {
  const boxes: TextBox[] = [];
  const { drawText, drawTextS } = fontModule;
  const rec = (args: unknown[]) => {
    const [, s, x, y, , scale = 1, align = "left"] = args as [unknown, string, number, number, string, number, string];
    const text = s.toUpperCase(), w = textWidth(text, scale);
    const x0 = align === "center" ? Math.round(x - w / 2) : align === "right" ? Math.round(x - w) : Math.round(x);
    boxes.push({ text, shown: text, v2: false, x0, x1: x0 + w, y0: Math.round(y), y1: Math.round(y) + 5 * scale });
  };
  fontModule.drawText = (...a: unknown[]) => { rec(a); drawText(...a); };
  fontModule.drawTextS = (...a: unknown[]) => { rec(a); drawTextS(...a); };
  const tap = textTap.fn;
  textTap.fn = (r) => boxes.push({ text: r.text.toUpperCase(), shown: r.text, v2: true, x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 });
  try { draw(); } finally { fontModule.drawText = drawText; fontModule.drawTextS = drawTextS; textTap.fn = tap; }
  return boxes;
}

/** The lint every screen must pass: glyphs its font can draw, inside the panel, and no text over other text. */
export function assertTextFits(name: string, boxes: TextBox[], panel = { x: 5, y: 2, w: 310, h: 172 }) {
  assert.ok(boxes.length > 0, `${name}: drew no text`);
  for (const b of boxes) {
    if (b.v2) assert.ok(fitsFont2(b.shown), `${name}: "${b.shown}" has a glyph the interface font can't draw`);
    else for (const ch of b.text) assert.ok(FONT_GLYPHS.has(ch), `${name}: "${b.text}" has glyph ${JSON.stringify(ch)} the font can't draw`);
    assert.ok(b.x0 >= panel.x + 2 && b.x1 <= panel.x + panel.w - 2 && b.y0 >= panel.y + 2 && b.y1 <= panel.y + panel.h - 2, `${name}: "${b.shown}" leaves the panel (${b.x0.toFixed(1)}..${b.x1.toFixed(1)}, ${b.y0.toFixed(1)}..${b.y1.toFixed(1)})`);
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 === b.x0 && a.y0 === b.y0 && a.text === b.text) continue;
    const over = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    assert.ok(!over, `${name}: "${a.shown}" overlaps "${b.shown}"`);
  }
}

export interface ScreenHost {
  host: any;
  /** The base UI canvas (320x180) and the hi-res layer over it. */
  ui: RCanvas;
  hi: RCanvas;
  /** Message events the screen drained (player messages), in order. */
  notes: string[];
  /** Every event drained. */
  seen: SimEvent[];
  /** Press keys for one update of the top screen. */
  press(...keys: string[]): void;
  /** Render the top screens, capturing their text. */
  draw(): TextBox[];
  /** Both canvases, stacked as the browser stacks them. */
  save(path: string): void;
  /** Switch the UI scale (the hi layer is resized, as Game.applySettings does). */
  setScale(scale: UiScale): void;
}

export function screenHost(w: World, scale: UiScale = "large"): ScreenHost {
  (globalThis as any).document = { createElement: () => new RCanvas() };
  let sc = UI_SCALES[scale];
  const ui = new RCanvas(sc.uw, sc.uh), hi = new RCanvas(HI_W, HI_H), keys = new Set<string>(), notes: string[] = [], seen: SimEvent[] = [];
  const host: any = {
    ctx: ui.getContext(), fctx: new RCanvas(320, 180).getContext(), fromFixedY: (y: number) => (y * sc.uh) / 180, wctx: new RCanvas(320, 180).getContext(), world: w, get pl() { return player(w); }, get area() { return currentArea(w); },
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
  // as Game does: the overlay screens are centred on the scaled canvas
  host.screens.drawWith = (s: Screen, draw: () => void) => (FRAMED_SCREENS.has(s.id) ? inFrame(host.ctx, draw) : draw());
  // As Game.render does each frame: clear the layer, scale it, and point the interface's text at it.
  const bind = () => {
    const hx = hi.getContext();
    hx.setTransform(1, 0, 0, 1, 0, 0);
    hi.data.fill(0);
    hx.setTransform(sc.k, 0, 0, sc.k, 0, 0);
    bindUiText({ base: host.ctx, fixed: host.fctx, hi: hx as unknown as CanvasRenderingContext2D, s: sc.s, k: sc.k, uw: sc.uw, uh: sc.uh });
  };
  bind();
  const draw = () => captureText(() => { bind(); ui.data.fill(0); host.ctx.fillStyle = "#1a1620"; host.ctx.fillRect(0, 0, sc.uw, sc.uh); host.screens.render(); });
  return {
    host, ui, hi, notes, seen, draw,
    press(...k) { bind(); for (const x of k) keys.add(x); host.screens.update(1 / 60); keys.clear(); },
    save(path) { require("node:fs").mkdirSync(require("node:path").dirname(path), { recursive: true }); require("node:fs").writeFileSync(path, png(composite(ui, hi), 1)); },
    setScale(next) { sc = UI_SCALES[next]; ui.width = sc.uw; ui.height = sc.uh; ui.getContext(); bind(); },
  };
}
