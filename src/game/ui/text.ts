// Interface text for the screens that are laid out on the 320x180 base grid.
//
// Two faces, one rule. What the WORLD says and shows stays in the carved
// capitals (font.ts): speech, the golem's thoughts, bubbles, signs, the drafted
// schematic, the title. What the INTERFACE tells the keeper of the dungeon is
// written in the mixed-case v2 face (ui/font2.ts): the HUD, notices, the pack,
// storage, orders, crafting, the build menu, the debug menu, books, key hints.
//
// The base UI canvas is too coarse for the v2 face, so a screen keeps drawing
// its frames, slots and sprites on the base canvas and asks for text here, in
// base-grid coordinates. `label` puts it on the high-resolution layer above, on
// whole canvas pixels, centred on the line the 5 px capitals used to sit on.
// One v2 font pixel is 1/2 (Normal), 1/3 (Compact) or 2/3 (Large) of a base
// pixel, so at every UI scale a string is no wider and no taller than the
// capitals the layouts were drawn for. Widths, clipping and wrapping are
// measured here in base px, never guessed from a character count.
//
// Content stays as it is written (capitals: the sim, saves and the spoken lines
// use it too). Casing is presentation: `sentence` and `titled` turn an
// all-capital string into mixed case and leave anything already mixed alone.
//
// With no layer bound (a headless tool with only a base canvas), or on any
// canvas other than the bound base one, `label` falls back to the capitals, so
// everything still fits.
import { drawText2, drawText2B, textWidth2, textWidth2B, clipText2, wrapText2, fitsFont2, CELL_H2, LINE_H2, type Align } from "./font2";
import { drawText as drawCaps, textWidth as capsWidth } from "../font";
import { BASE_W, BASE_H } from "../view/zoom";

type Ctx = CanvasRenderingContext2D;

// ------------------------------------------------------------------ casing
/** Words that keep their own capitals wherever they stand. Lower case -> as shown. */
const FIXED = new Map<string, string>([
  ["westwake", "Westwake"], ["dustwake", "Dustwake"], ["veyrhold", "Veyrhold"], ["ossen", "Ossen"],
  ["id", "ID"], ["ok", "OK"], ["lod", "LOD"], ["fps", "FPS"], ["wasd", "WASD"], ["esc", "Esc"], ["ctrl", "Ctrl"],
  ["ii", "II"], ["iii", "III"], ["iv", "IV"], ["vi", "VI"], ["vii", "VII"], ["viii", "VIII"], ["ix", "IX"],
]);
/** Names learned from the world (a worker the player named, the townsfolk): they stay capitalised in a sentence. */
const NAMES = new Map<string, string>();
/** Short words that stay small inside a title. */
const MINOR = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
const cache = { sentence: new Map<string, string>(), title: new Map<string, string>() };
const remember = (m: Map<string, string>, k: string, v: string) => { if (m.size > 4000) m.clear(); m.set(k, v); return v; };

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const fixed = (w: string) => FIXED.get(w) ?? NAMES.get(w);

/**
 * Teach the casing the proper names in play ("BOB", "MARTA"), so "GAVE THE ORDER TO BOB" reads "Gave the order to
 * Bob". Whole words of three letters or more; everyday words are never taken as names.
 */
export function learnNames(names: Iterable<string>) {
  let changed = false;
  for (const n of names) {
    for (const w of n.toLowerCase().split(/[^a-z']+/)) {
      if (w.length < 3 || MINOR.has(w) || FIXED.has(w) || NAMES.has(w)) continue;
      NAMES.set(w, cap(w)); changed = true;
    }
  }
  if (changed) { cache.sentence.clear(); cache.title.clear(); }
}
/** Forget learned names (another world was loaded). */
export function forgetNames() { if (NAMES.size) { NAMES.clear(); cache.sentence.clear(); cache.title.clear(); } }

const isCaps = (s: string) => s === s.toUpperCase() && s !== s.toLowerCase();

/**
 * "IT STANDS AND WAITS. NO ORDER." -> "It stands and waits. No order." Text that is already mixed case is left
 * alone. Sentences start with a capital; "I", known names and a lone key letter ("PRESS E", "W/S") keep theirs.
 */
export function sentence(s: string): string {
  if (!isCaps(s)) return s;
  const hit = cache.sentence.get(s);
  if (hit !== undefined) return hit;
  let t = s.toLowerCase();
  // known words and names
  t = t.replace(/[a-z]+/g, (w, i: number) => (t[i - 1] === "'" ? w : fixed(w) ?? w));
  // key pairs (w/s, a/d), then a lone letter that is not the article: a key or a label ("press E", "detail B")
  t = t.replace(/(^|[^a-z'0-9])([a-z](?:\/[a-z])+)(?![a-z'0-9])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  t = t.replace(/(^|[^a-zA-Z'0-9/])([b-hj-z])(?![a-zA-Z'0-9/])/g, (_m, a: string, b: string) => a + b.toUpperCase());
  t = t.replace(/(^|[^a-zA-Z'])i(?![a-zA-Z])/g, "$1I");
  // the first letter, and the first after a full stop, "!" or "?"
  t = t.replace(/(^|[.!?]["')\]]*\s+)(["'(\[]*)([a-z])/g, (_m, a: string, b: string, c: string) => a + b + c.toUpperCase());
  return remember(cache.sentence, s, t);
}

/**
 * "CHEST OF THE OLD STAIR" -> "Chest of the Old Stair": a name. Mixed case is left alone; counts ("X3") stay small.
 */
export function titled(s: string): string {
  if (!isCaps(s)) return s;
  const hit = cache.title.get(s);
  if (hit !== undefined) return hit;
  let first = true;
  const t = s.toLowerCase().replace(/[a-z0-9']+/g, (w) => {
    const lead = first; first = false;
    if (/^x\d+$/.test(w)) return w;
    const f = fixed(w);
    if (f) return f;
    return !lead && MINOR.has(w) ? w : cap(w);
  });
  return remember(cache.title, s, t);
}

export type Case = "sentence" | "title" | "raw";
const show = (s: string, c: Case = "sentence") => (c === "raw" ? s : c === "title" ? titled(s) : sentence(s));

// ------------------------------------------------------------------ the layer
export interface TextLayer {
  /** The base UI canvas's context: text asked for on it is drawn on `hi` instead. */
  base: Ctx;
  /** The hi-res UI layer's context, scaled `k` canvas px per logical px by the host. */
  hi: Ctx;
  /** Canvas px of the hi layer per base px (2, or 3 for Compact and Large). */
  s: number;
  /** Canvas px per logical px, which is one font px (1, or 2 for Large). */
  k: number;
}
let L: TextLayer | null = null;
/** The host binds the layer every frame (Game.render); null unbinds (text falls back to the capitals). */
export function bindUiText(l: TextLayer | null) { L = l; }
export const uiTextBound = () => L !== null;
/** Base px per v2 font px (0 with no layer bound). */
export const fontUnit = () => (L ? L.k / L.s : 0);
/** Logical px of the hi layer per base px. */
const f = () => L!.s / L!.k;
const on = (ctx: Ctx) => L !== null && ctx === L.base;

/** What a `label` call put on screen, in base px: the tests' lint reads these (tests/support/screenHost.ts). */
export interface TextRec { text: string; raw: string; x0: number; x1: number; y0: number; y1: number }
export const textTap: { fn: ((r: TextRec) => void) | null } = { fn: null };

export interface LabelOpts { case?: Case; bold?: boolean }

/** The 7-row capitals sit centred on the line the 5 px capital font used. */
const lift = () => (5 - 7 * fontUnit()) / 2;
const widthPx = (t: string, bold?: boolean) => (bold ? textWidth2B(t) : textWidth2(t));

/** Width of `s` as `label` draws it, in base px. */
export function labelW(s: string, o?: LabelOpts): number {
  if (!L) return capsWidth(s);
  return widthPx(show(s, o?.case), o?.bold) * fontUnit();
}
/** Height of a line of text (cell and leading) and of the cell alone, in base px. */
export const lineH = () => (L ? LINE_H2 * fontUnit() : 7);
export const cellH = () => (L ? CELL_H2 * fontUnit() : 5);

/** `s` as shown, cut to `maxW` base px ("..." where it was cut). */
export function clipLabel(s: string, maxW: number, o?: LabelOpts): string {
  if (!L) { const n = Math.max(0, Math.floor((maxW + 1) / 4)); return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + "."; }
  const t = show(s, o?.case);
  if (!o?.bold) return clipText2(t, maxW / fontUnit());
  let c = t;
  while (c.length && textWidth2B(c === t ? c : c + "...") > maxW / fontUnit()) c = c.slice(0, -1);
  return c === t ? t : c.trimEnd() + "...";
}
/** The tail of `s` that fits `maxW` (a text field shows the end of what is typed). */
export function clipLabelLeft(s: string, maxW: number, o?: LabelOpts): string {
  if (!L) { const n = Math.floor((maxW + 1) / 4); return s.length <= n ? s : s.slice(s.length - n); }
  let t = show(s, o?.case);
  while (t.length && widthPx(t, o?.bold) * fontUnit() > maxW) t = t.slice(1);
  return t;
}
/** `s` as shown, word-wrapped to `maxW` base px. */
export function wrapLabel(s: string, maxW: number, o?: LabelOpts): string[] {
  if (!L) return capsWrap(s, Math.max(1, Math.floor((maxW + 1) / 4)));
  return wrapText2(show(s, o?.case), maxW / fontUnit());
}
/**
 * Lines authored for the capital font (hand-wrapped at a column count) as one paragraph, cased as running text and
 * wrapped again to `maxW`. At most `max` lines; the last is cut with "..." if there was more.
 */
export function flow(lines: readonly string[], maxW: number, max = 99, o?: LabelOpts): string[] {
  const text = lines.map((l) => l.trim()).filter(Boolean).join(" ");
  if (!text) return [];
  const out = wrapLabel(text, maxW, o);
  if (out.length <= max) return out;
  const kept = out.slice(0, max);
  kept[max - 1] = clipLabel(`${kept[max - 1]} ${out[max]}`, maxW, { ...o, case: "raw" });
  return kept;
}
function capsWrap(s: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const w of para.split(/ +/).filter(Boolean)) {
      if (!line) line = w.slice(0, cols);
      else if (line.length + 1 + w.length <= cols) line += " " + w;
      else { out.push(line); line = w.slice(0, cols); }
    }
    out.push(line);
  }
  return out;
}

function put(ctx: Ctx, t: string, x: number, y: number, color: string, align: Align, bold?: boolean) {
  const l = L!, k = f(), a = ctx.globalAlpha, hi = l.hi, was = hi.globalAlpha;
  if (a !== was) hi.globalAlpha = a;
  (bold ? drawText2B : drawText2)(hi, t, x * k, (y + lift()) * k, color, align, l.k);
  if (a !== was) hi.globalAlpha = was;
}

/**
 * Interface text at (x, y) on the base grid, where the capital font's `drawText` would have put it. `ctx` is the
 * canvas the screen is drawing on: the base UI canvas goes to the hi-res layer in the v2 face (with that canvas's
 * current alpha); anything else gets the capitals.
 */
export function label(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left", o?: LabelOpts) {
  if (!s) return;
  if (!on(ctx)) { drawCaps(ctx, s, x, y, color, 1, align); return; }
  const t = show(s, o?.case);
  if (textTap.fn) {
    const w = widthPx(t, o?.bold) * fontUnit(), x0 = align === "left" ? x : align === "center" ? x - w / 2 : x - w, y0 = y + lift();
    textTap.fn({ text: t, raw: s, x0, x1: x0 + w, y0, y1: y0 + cellH() });
  }
  put(ctx, t, x, y, color, align, o?.bold);
}

/** `label` with a shadow one font px down and right (text over the world: notices, counts on icons). */
export function labelS(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left", shadow = "#000", o?: LabelOpts) {
  if (!s) return;
  if (!on(ctx)) { drawCaps(ctx, s, x + 1, y + 1, shadow, 1, align); drawCaps(ctx, s, x, y, color, 1, align); return; }
  const t = show(s, o?.case), u = fontUnit();
  // an outline, not just a drop: the fine strokes stay readable over a bright floor
  for (const [dx, dy] of [[1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) put(ctx, t, x + dx * u, y + dy * u, shadow, align, o?.bold);
  label(ctx, t, x, y, color, align, { ...o, case: "raw" });
}

/** Can the v2 face draw all of `s` as shown? (The lint for interface text.) */
export const fitsLabel = (s: string, c?: Case) => fitsFont2(show(s, c));

// ------------------------------------------------------------------ the two canvases
/** A rect on the hi layer, given in base px. */
function hiRect(x: number, y: number, w: number, h: number, color: string, alpha: number) {
  const l = L!, k = f(), hi = l.hi, was = hi.globalAlpha, r = (v: number) => Math.round(v * k * l.k) / l.k;
  const x0 = r(x), y0 = r(y), x1 = r(x + w), y1 = r(y + h);
  if (alpha !== was) hi.globalAlpha = alpha;
  hi.fillStyle = color; hi.fillRect(x0, y0, x1 - x0, y1 - y0);
  if (alpha !== was) hi.globalAlpha = was;
}

/**
 * Something opaque was drawn on the base canvas at this rect (a panel, a page, a toast): wipe the hi layer there, so
 * text from the screen beneath does not show through it.
 */
export function occlude(ctx: Ctx, x: number, y: number, w: number, h: number) {
  if (!on(ctx)) return;
  const k = f();
  L!.hi.clearRect(x * k, y * k, w * k, h * k);
}

/**
 * Dim the whole screen for an overlay: the colour over the base canvas, and the same fade on the text already on
 * the hi layer (it is thinned, not painted over, so the base canvas is not dimmed twice).
 */
export function shade(ctx: Ctx, color = "rgba(0,0,0,0.55)") {
  ctx.fillStyle = color; ctx.fillRect(0, 0, BASE_W, BASE_H);
  if (!on(ctx)) return;
  const m = color.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/), a = m ? Number(m[1]) : 1, hi = L!.hi, k = f();
  if (a >= 1) { hi.clearRect(0, 0, BASE_W * k, BASE_H * k); return; }
  const op = hi.globalCompositeOperation, was = hi.globalAlpha;
  hi.globalCompositeOperation = "destination-out"; hi.globalAlpha = a;
  hi.fillStyle = "#000"; hi.fillRect(0, 0, BASE_W * k, BASE_H * k);
  hi.globalCompositeOperation = op; hi.globalAlpha = was;
}

/** A translucent veil was drawn over part of the base canvas (a locked station greyed over): thin the hi layer's text there as much. */
export function thin(ctx: Ctx, x: number, y: number, w: number, h: number, alpha: number) {
  if (!on(ctx)) return;
  const hi = L!.hi, k = f(), op = hi.globalCompositeOperation, was = hi.globalAlpha;
  hi.globalCompositeOperation = "destination-out"; hi.globalAlpha = alpha;
  hi.fillStyle = "#000"; hi.fillRect(x * k, y * k, w * k, h * k);
  hi.globalCompositeOperation = op; hi.globalAlpha = was;
}

// ------------------------------------------------------------------ key hints
/** A key (or "" for plain words) and what it does: ["E", "Take off"]. */
export type Hint = readonly [key: string, text: string];

const KEY = "(?:ESC|TAB|ENTER|SPACE|SHIFT|CTRL|ALT|ANY KEY|WASD|ARROWS|PGUP|PGDN|HOME|END|DEL|[A-Z0-9/'<>^*])";
const HINT_RE = new RegExp(`^(${KEY}(?:[/+-]${KEY})*)(?:\\s+-\\s+|\\s+)(\\S.*)$`);
const KEY_ONLY_RE = new RegExp(`^${KEY}(?:[/+-]${KEY})*$`);

/** "E NEXT PAGE   ESC CLOSE" (the capital font's hint lines: two or more spaces between hints) -> key and text pairs. */
export function parseHints(s: string): Hint[] {
  return s.trim().split(/\s{2,}/).filter(Boolean).map((seg): Hint => {
    const m = seg.match(HINT_RE);
    return m ? [m[1], m[2]] : KEY_ONLY_RE.test(seg) ? [seg, ""] : ["", seg];
  });
}
const hintList = (h: string | readonly Hint[]): readonly Hint[] => (typeof h === "string" ? parseHints(h) : h);
const hintString = (h: string | readonly Hint[]) => (typeof h === "string" ? h : h.map(([k, t]) => (k && t ? `${k} ${t}` : k || t)).join("   "));
/** Key legends are capitals, as on the key; a long name gets its usual short form. */
const legend = (k: string) => k.toUpperCase();

// in font px: padding inside a key cap, the gap to its text, the gap between hints
const KEY_PAD = 2, KEY_GAP = 3, HINT_GAP = 8;
const hintPx = (h: readonly Hint[]) => h.reduce((n, [k, t], i) => n + (i ? HINT_GAP : 0) + (k ? textWidth2(legend(k)) + KEY_PAD * 2 : 0) + (k && t ? KEY_GAP : 0) + (t ? textWidth2(sentence(t)) : 0), 0);

/** Width of a hint line as `hints` draws it, in base px. */
export function hintsW(h: string | readonly Hint[]): number {
  if (!L) return capsWidth(hintString(h));
  return hintPx(hintList(h)) * fontUnit();
}

/** Key cap colours (legend, face, the lit top edge, the dark lower lip) and an overall alpha. */
export interface HintOpts { key?: string; cap?: string; rim?: string; lip?: string; alpha?: number }

/**
 * A line of key hints at (x, y) on the base grid: each key on a small key cap, what it does beside it. Takes the
 * pairs, or a hint line as the capital font had it ("W/S CHOOSE   E CONFIRM"). Cut from the right to `maxW`.
 */
export function hints(ctx: Ctx, h: string | readonly Hint[], x: number, y: number, color: string, align: Align = "left", maxW = Infinity, o: HintOpts = {}) {
  if (!on(ctx)) { const s = hintString(h); if (s) drawCaps(ctx, s, x, y, color, 1, align); return; }
  let list = [...hintList(h)];
  const u = fontUnit();
  while (list.length > 1 && hintPx(list) * u > maxW) list = list.slice(0, -1);
  if (!list.length) return;
  const w = hintPx(list) * u, top = y + lift(), a = (o.alpha ?? 1) * ctx.globalAlpha;
  let cx = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
  cx = Math.round(cx / u) * u;
  if (textTap.fn) textTap.fn({ text: hintString(list), raw: hintString(list), x0: cx, x1: cx + w, y0: top - u, y1: top + cellH() });
  list.forEach(([k, t], i) => {
    if (i) cx += HINT_GAP * u;
    if (k) {
      const lg = legend(k), kw = (textWidth2(lg) + KEY_PAD * 2) * u;
      hiRect(cx, top - u, kw, 9 * u, o.cap ?? "#2c2733", a);
      hiRect(cx, top + 8 * u, kw, u, o.lip ?? "#131016", a);
      hiRect(cx, top - u, kw, u, o.rim ?? "#443d4d", a);
      put(ctx, lg, cx + KEY_PAD * u, y, o.key ?? "#f0e6cc", "left");
      cx += kw + (t ? KEY_GAP * u : 0);
    }
    if (t) { const s = sentence(t); put(ctx, s, cx, y, color, "left"); cx += textWidth2(s) * u; }
  });
}
