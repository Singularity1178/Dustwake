// The UI v2 font: mixed case and proportional, for the high-resolution UI layer
// (ui/gui.ts). The old bitmap font (font.ts) is uppercase-only and fixed-width;
// it stays for the world's base-resolution screens. Glyphs are a 9-row cell:
// rows 0..6 are the cap height (row 6 is the baseline row), rows 7..8 hold
// descenders; x-height is rows 2..6. One pixel of space between glyphs.
//
// Drawing goes through one atlas canvas per colour (made on first use), so a
// line of text is one drawImage per character. Measuring, wrapping and the
// glyph check are pure (the content linter and tests use them in Node).

/** Glyph rows, top to bottom, "|" between rows, "#" ink. */
const G: Record<string, string> = {
  A: ".##.|#..#|#..#|####|#..#|#..#|#..#", B: "###.|#..#|#..#|###.|#..#|#..#|###.",
  C: ".##.|#..#|#...|#...|#...|#..#|.##.", D: "###.|#..#|#..#|#..#|#..#|#..#|###.",
  E: "####|#...|#...|###.|#...|#...|####", F: "####|#...|#...|###.|#...|#...|#...",
  G: ".##.|#..#|#...|#.##|#..#|#..#|.###", H: "#..#|#..#|#..#|####|#..#|#..#|#..#",
  I: "###|.#.|.#.|.#.|.#.|.#.|###", J: "..##|...#|...#|...#|#..#|#..#|.##.",
  K: "#..#|#..#|#.#.|##..|#.#.|#..#|#..#", L: "#...|#...|#...|#...|#...|#...|####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#", N: "#..#|##.#|##.#|#.##|#.##|#..#|#..#",
  O: ".##.|#..#|#..#|#..#|#..#|#..#|.##.", P: "###.|#..#|#..#|###.|#...|#...|#...",
  Q: ".##.|#..#|#..#|#..#|#..#|#.#.|.#.#", R: "###.|#..#|#..#|###.|#.#.|#..#|#..#",
  S: ".##.|#..#|#...|.##.|...#|#..#|.##.", T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#..#|#..#|#..#|#..#|#..#|#..#|.##.", V: "#...#|#...#|#...#|.#.#.|.#.#.|..#..|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#", X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..", Z: "####|...#|..#.|.#..|#...|#...|####",
  a: "....|....|.##.|...#|.###|#..#|.###", b: "#...|#...|###.|#..#|#..#|#..#|###.",
  c: "...|...|.##|#..|#..|#..|.##", d: "...#|...#|.###|#..#|#..#|#..#|.###",
  e: "....|....|.##.|#..#|####|#...|.##.", f: ".##|#..|###|#..|#..|#..|#..",
  g: "....|....|.###|#..#|#..#|#..#|.###|...#|.##.", h: "#...|#...|###.|#..#|#..#|#..#|#..#",
  i: "#|.|#|#|#|#|#", j: ".#|..|.#|.#|.#|.#|.#|.#|#.",
  k: "#...|#...|#..#|#.#.|##..|#.#.|#..#", l: "#.|#.|#.|#.|#.|#.|.#",
  m: ".....|.....|##.#.|#.#.#|#.#.#|#.#.#|#.#.#", n: "....|....|###.|#..#|#..#|#..#|#..#",
  o: "....|....|.##.|#..#|#..#|#..#|.##.", p: "....|....|###.|#..#|#..#|#..#|###.|#...|#...",
  q: "....|....|.###|#..#|#..#|#..#|.###|...#|...#", r: "...|...|#.#|##.|#..|#..|#..",
  s: "....|....|.###|#...|.##.|...#|###.", t: ".#.|.#.|###|.#.|.#.|.#.|..#",
  u: "....|....|#..#|#..#|#..#|#..#|.###", v: ".....|.....|#...#|#...#|.#.#.|.#.#.|..#..",
  w: ".....|.....|#...#|#...#|#.#.#|#.#.#|.#.#.", x: "....|....|#..#|#..#|.##.|#..#|#..#",
  y: "....|....|#..#|#..#|#..#|#..#|.###|...#|.##.", z: "....|....|####|..#.|.#..|#...|####",
  "0": ".##.|#..#|#.##|##.#|#..#|#..#|.##.", "1": ".#.|##.|.#.|.#.|.#.|.#.|###",
  "2": ".##.|#..#|...#|..#.|.#..|#...|####", "3": "###.|...#|...#|.##.|...#|...#|###.",
  "4": "..#.|.##.|#.#.|#.#.|####|..#.|..#.", "5": "####|#...|###.|...#|...#|#..#|.##.",
  "6": ".##.|#...|#...|###.|#..#|#..#|.##.", "7": "####|...#|..#.|..#.|.#..|.#..|.#..",
  "8": ".##.|#..#|#..#|.##.|#..#|#..#|.##.", "9": ".##.|#..#|#..#|.###|...#|...#|.##.",
  ".": ".|.|.|.|.|.|#", ",": "..|..|..|..|..|.#|.#|#.", ":": ".|.|.|#|.|.|#", ";": "..|..|..|.#|..|.#|.#|#.",
  "!": "#|#|#|#|#|.|#", "?": ".##.|#..#|...#|..#.|.#..|....|.#..", "'": "#|#|.|.|.|.|.", "\"": "#.#|#.#|...|...|...|...|...",
  "-": "...|...|...|...|###|...|...", "+": "...|...|...|.#.|###|.#.|...", "=": "...|...|...|###|...|###|...",
  "/": "..#|..#|.#.|.#.|.#.|#..|#..", "\\": "#..|#..|.#.|.#.|.#.|..#|..#",
  "(": ".#|#.|#.|#.|#.|#.|.#", ")": "#.|.#|.#|.#|.#|.#|#.", "[": "##|#.|#.|#.|#.|#.|##", "]": "##|.#|.#|.#|.#|.#|##",
  "<": "...|...|..#|.#.|#..|.#.|..#", ">": "...|...|#..|.#.|..#|.#.|#..",
  "%": "##...|##..#|...#.|..#..|.#...|#..##|...##", "#": ".#.#.|.#.#.|#####|.#.#.|#####|.#.#.|.#.#.",
  "*": "...|#.#|.#.|#.#|...|...|...", "_": "....|....|....|....|....|....|....|####",
  "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#", "@": ".###.|#...#|#.###|#.#.#|#.###|#....|.###.",
  "$": "..#..|.####|#.#..|.###.|..#.#|####.|..#..", "^": ".#.|#.#|...|...|...|...|...",
  "|": "#|#|#|#|#|#|#", "~": "....|....|....|.#.#|#.#.|....|....", "°": ".#.|#.#|.#.|...|...|...|...",
};

/** Cell height (px) and the line height (cell plus leading). */
export const CELL_H2 = 9;
export const LINE_H2 = 11;
/** Width of a space (px), before the 1 px gap. */
const SPACE = 3;

/** Typographic characters mapped onto the glyphs the font has. */
const NORM: Record<string, string> = { "—": "-", "–": "-", "…": "...", "’": "'", "‘": "'", "“": "\"", "”": "\"", "×": "x", "→": "->", "←": "<-", "·": ".", "\u00a0": " " };
export const normText2 = (s: string) => s.replace(/[—–…’‘“”×→←·\u00a0]/g, (c) => NORM[c] ?? c);

interface Glyph { w: number; rows: string[]; ax: number }
const GLYPHS = new Map<string, Glyph>();
let atlasW = 0;
for (const [ch, def] of Object.entries(G)) {
  const rows = def.split("|");
  GLYPHS.set(ch, { w: rows[0].length, rows, ax: atlasW });
  atlasW += rows[0].length + 1;
}
const FALLBACK = GLYPHS.get("?")!;

/** Characters the v2 font can draw (besides space). */
export const FONT2_GLYPHS: ReadonlySet<string> = new Set(GLYPHS.keys());
/** Every glyph's rows, for the font's own tests (rows of one glyph must be equally wide). */
export const font2Rows = (): ReadonlyMap<string, readonly string[]> => new Map([...GLYPHS].map(([k, g]) => [k, g.rows]));

/** Can the v2 font draw all of `s` (after the typographic mapping)? */
export function fitsFont2(s: string): boolean {
  for (const ch of normText2(s)) if (ch !== " " && ch !== "\n" && !GLYPHS.has(ch)) return false;
  return true;
}

export function textWidth2(s: string): number {
  let w = 0, n = 0;
  for (const ch of normText2(s)) {
    if (ch === "\n") continue;
    w += ch === " " ? SPACE : (GLYPHS.get(ch) ?? FALLBACK).w;
    n++;
  }
  return n ? w + n - 1 : 0;
}

/** Cut to `maxW` px, ending in "..." if anything was cut. */
export function clipText2(s: string, maxW: number): string {
  if (textWidth2(s) <= maxW) return s;
  let t = normText2(s);
  while (t.length && textWidth2(t + "...") > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "...";
}

/** Word-wrap to `maxW` px. "\n" breaks a line; a word longer than a line is cut. */
export function wrapText2(s: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of normText2(s).split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth2(next) <= maxW || !line) line = textWidth2(next) <= maxW ? next : clipText2(word, maxW);
      else { out.push(line); line = textWidth2(word) <= maxW ? word : clipText2(word, maxW); }
    }
    out.push(line);
  }
  return out;
}

type Ctx = CanvasRenderingContext2D;
const atlases = new Map<string, CanvasImageSource | null>();

/** The glyphs drawn once in `color` (null where there is no canvas: plain rects are drawn instead). */
function atlas(color: string): CanvasImageSource | null {
  if (atlases.has(color)) return atlases.get(color)!;
  let img: CanvasImageSource | null = null;
  try {
    const doc = (globalThis as { document?: { createElement(t: string): HTMLCanvasElement } }).document;
    if (doc) {
      const c = doc.createElement("canvas");
      c.width = atlasW; c.height = CELL_H2;
      const x = c.getContext("2d");
      if (x) {
        x.fillStyle = color;
        for (const g of GLYPHS.values()) g.rows.forEach((row, ry) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") x.fillRect(g.ax + i, ry, 1, 1); });
        img = c;
      }
    }
  } catch { img = null; }
  atlases.set(color, img);
  return img;
}

export type Align = "left" | "center" | "right";

/** Draw `s` with its top-left (or top-centre / top-right) at (x, y), in logical px of the layer. */
export function drawText2(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left") {
  s = normText2(s);
  let cx = align === "left" ? x : align === "center" ? x - textWidth2(s) / 2 : x - textWidth2(s);
  cx = Math.round(cx);
  const cy = Math.round(y), img = atlas(color);
  for (const ch of s) {
    if (ch === " ") { cx += SPACE + 1; continue; }
    if (ch === "\n") continue;
    const g = GLYPHS.get(ch) ?? FALLBACK;
    if (img) ctx.drawImage(img, g.ax, 0, g.w, CELL_H2, cx, cy, g.w, CELL_H2);
    else {
      ctx.fillStyle = color;
      g.rows.forEach((row, ry) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") ctx.fillRect(cx + i, cy + ry, 1, 1); });
    }
    cx += g.w + 1;
  }
}

/** The same with a 1 px shadow down and right. */
export function drawText2S(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left", shadow = "#000") {
  drawText2(ctx, s, x + 1, y + 1, shadow, align);
  drawText2(ctx, s, x, y, color, align);
}
