// Word wrapping and pagination for the bitmap font (fixed 4 px advance per
// character). Pure: no DOM, imported by the tests.

/**
 * Wrap plain text to lines of at most `cols` characters. Words are split on
 * spaces (runs of spaces collapse); a word longer than a whole line is broken
 * across lines. "\n" forces a line break; an empty paragraph ("\n\n") keeps an
 * empty line.
 */
export function wrapText(text: string, cols: number): string[] {
  if (cols < 1) throw new Error(`wrapText: cols must be >= 1 (got ${cols})`);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(" ").filter(Boolean);
    if (!words.length) { out.push(""); continue; }
    let line = "";
    for (let w of words) {
      if (line && line.length + 1 + w.length <= cols) { line += " " + w; continue; }
      if (line) out.push(line);
      while (w.length > cols) { out.push(w.slice(0, cols)); w = w.slice(cols); }
      line = w;
    }
    out.push(line);
  }
  return out;
}

/** Split lines into pages of at most `perPage` lines (always at least one page). */
export function paginate(lines: readonly string[], perPage: number): string[][] {
  if (perPage < 1) throw new Error(`paginate: perPage must be >= 1 (got ${perPage})`);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}
