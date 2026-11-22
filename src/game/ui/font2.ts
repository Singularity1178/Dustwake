// The UI v2 font: mixed case and proportional, for the high-resolution UI layer
// (ui/gui.ts) and, through the base-grid bridge (ui/text.ts), for every screen
// that is laid out on the 320x180 grid: the pack, storage, orders, crafting, the
// build menu, the HUD. The old bitmap font (font.ts) is uppercase-only and
// fixed-width; it stays for what the world itself says and shows: speech, the
// golem's thoughts, signs, the drafted schematic, the title. Glyphs are a 9-row cell:
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

interface Glyph { w: number; rows: string[]; ax: number; bold: string[]; bw: number; bx: number }
const GLYPHS = new Map<string, Glyph>();
let atlasW = 0, atlasBW = 0;
/**
 * The bold weight of a row: every pixel struck again one to the right, unless that would close a one-pixel gap
 * (the counters of "m", "w", "e" stay open, so bold text never clogs). One pixel wider than the regular row.
 */
const embolden = (row: string): string => {
  const out = [...row, "."];
  for (let i = 0; i < row.length; i++) if (row[i] === "#" && (row[i + 1] === "#" || row[i + 2] !== "#")) out[i + 1] = "#";
  return out.join("");
};
/**
 * Bold forms drawn by hand, for the letters whose stems stand one pixel apart: struck twice they would either clog
 * or come out with one thick stem and two thin ones (a bold "W" that reads as an "N"). They are simply wider.
 */
const BOLD: Record<string, string> = {
  M: "##...##|###.###|#######|##.#.##|##...##|##...##|##...##",
  W: "##...##|##...##|##...##|##.#.##|#######|###.###|##...##",
  m: "........|........|#######.|##.##.##|##.##.##|##.##.##|##.##.##",
  w: "........|........|##....##|##....##|##.##.##|##.##.##|.##..##.",
};
for (const [ch, def] of Object.entries(G)) {
  const rows = def.split("|"), bold = BOLD[ch]?.split("|") ?? rows.map(embolden);
  GLYPHS.set(ch, { w: rows[0].length, rows, ax: atlasW, bold, bw: bold[0].length, bx: atlasBW });
  atlasW += rows[0].length + 1;
  atlasBW += bold[0].length + 1;
}
const FALLBACK = GLYPHS.get("?")!;

/** Characters the v2 font can draw (besides space). */
export const FONT2_GLYPHS: ReadonlySet<string> = new Set(GLYPHS.keys());
/** Every glyph's rows, for the font's own tests (rows of one glyph must be equally wide). */
export const font2Rows = (): ReadonlyMap<string, readonly string[]> => new Map([...GLYPHS].map(([k, g]) => [k, g.rows]));
/** The same for the bold weight. */
export const font2BoldRows = (): ReadonlyMap<string, readonly string[]> => new Map([...GLYPHS].map(([k, g]) => [k, g.bold]));

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
      // the regular glyphs on the first row of cells, the bold ones on the second
      c.width = Math.max(atlasW, atlasBW); c.height = CELL_H2 * 2;
      const x = c.getContext("2d");
      if (x) {
        x.fillStyle = color;
        for (const g of GLYPHS.values()) {
          g.rows.forEach((row, ry) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") x.fillRect(g.ax + i, ry, 1, 1); });
          g.bold.forEach((row, ry) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") x.fillRect(g.bx + i, CELL_H2 + ry, 1, 1); });
        }
        img = c;
      }
    }
  } catch { img = null; }
  atlases.set(color, img);
  return img;
}

export type Align = "left" | "center" | "right";

/**
 * Draw `s` with its top-left (or top-centre / top-right) at (x, y), in logical px of the layer.
 * `snap`: positions are rounded to 1/snap of a logical px. The widget kit leaves it at 1 (whole logical px); the
 * base-grid text bridge (ui/text.ts) passes the layer's canvas px per logical px, so text placed from the 320x180
 * grid lands on whole canvas px at every UI scale.
 */
export function drawText2(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left", snap = 1) {
  s = normText2(s);
  let cx = align === "left" ? x : align === "center" ? x - textWidth2(s) / 2 : x - textWidth2(s);
  cx = Math.round(cx * snap) / snap;
  const cy = Math.round(y * snap) / snap, img = atlas(color);
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
export function drawText2S(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left", shadow = "#000", snap = 1) {
  drawText2(ctx, s, x + 1, y + 1, shadow, align, snap);
  drawText2(ctx, s, x, y, color, align, snap);
}

/** Width of `s` in the bold weight (headings: screen and panel titles, the name of the thing under the cursor). */
export function textWidth2B(s: string): number {
  let w = 0, n = 0;
  for (const ch of normText2(s)) {
    if (ch === "\n") continue;
    w += ch === " " ? SPACE + 1 : (GLYPHS.get(ch) ?? FALLBACK).bw;
    n++;
  }
  return n ? w + n - 1 : 0;
}

/** Bold, for headings; body text stays regular. Same arguments as `drawText2`. */
export function drawText2B(ctx: Ctx, s: string, x: number, y: number, color: string, align: Align = "left", snap = 1) {
  s = normText2(s);
  const w = textWidth2B(s);
  let cx = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
  cx = Math.round(cx * snap) / snap;
  const cy = Math.round(y * snap) / snap, img = atlas(color);
  for (const ch of s) {
    if (ch === " ") { cx += SPACE + 2; continue; }
    if (ch === "\n") continue;
    const g = GLYPHS.get(ch) ?? FALLBACK;
    if (img) ctx.drawImage(img, g.bx, CELL_H2, g.bw, CELL_H2, cx, cy, g.bw, CELL_H2);
    else {
      ctx.fillStyle = color;
      g.bold.forEach((row, ry) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") ctx.fillRect(cx + i, cy + ry, 1, 1); });
    }
    cx += g.bw + 1;
  }
}
