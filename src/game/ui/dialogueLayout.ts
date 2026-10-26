// Dialogue box geometry and page layout. Scripts (content/dialogue.ts) author
// each page as a plain paragraph; here it is word-wrapped to the box's real
// text width and split into as many screens as the box's line capacity needs.
// Pure (no DOM): the dialogue screen draws from it and the tests lint against it.
import type { BeatId, DialoguePage } from "../content/dialogue";
import { BASE_W, BASE_H } from "../view/zoom";
import { wrapText, paginate } from "./textWrap";

/** Font metrics: 3 px glyphs on a 4 px advance, 5 px tall; drawTextS adds a 1 px shadow right and down. */
const ADVANCE = 4, GLYPH_H = 5, SHADOW = 1;

/** The box, in UI-layer pixels (relative offsets are from the box's top-left). */
export const DIALOGUE_BOX = {
  x: 14, w: BASE_W - 28, h: 54, y: BASE_H - 54 - 6,
  /** Text inset from the left edge; the same margin is kept on the right. */
  padX: 10,
  /** First text line's top, and the line pitch. */
  textY: 8, lineH: 10,
  /** Top of the footer row ("ESC LEAVE" / "E >"). */
  footerY: 54 - 9,
} as const;

/** Characters per line: n characters with their shadow take n * 4 px of the inset text width. */
export const DIALOGUE_COLS = Math.floor((DIALOGUE_BOX.w - 2 * DIALOGUE_BOX.padX) / ADVANCE);
/** Lines per screen: the last line (glyph + shadow) must end at least 1 px above the footer row. */
export const DIALOGUE_LINES = Math.floor((DIALOGUE_BOX.footerY - 2 - (GLYPH_H + SHADOW - 1) - DIALOGUE_BOX.textY) / DIALOGUE_BOX.lineH) + 1;

/** One screen of the box: wrapped lines plus the beats of the authored page it came from. */
export interface DialogueScreenPage {
  lines: string[];
  speaker?: string;
  /** Only on the first screen of an authored page: fires when it shows. */
  beat?: BeatId;
  /** Only on the last screen of an authored page: fires when it is dismissed. */
  then?: BeatId;
  /** Index of the authored page (in the list passed to layoutDialogue). */
  source: number;
}

/** Wrap and paginate authored pages into screens. Beats stay with the first / last screen of their page. */
export function layoutDialogue(pages: readonly DialoguePage[], cols = DIALOGUE_COLS, perPage = DIALOGUE_LINES): DialogueScreenPage[] {
  const out: DialogueScreenPage[] = [];
  pages.forEach((p, source) => {
    const chunks = paginate(wrapText(p.text, cols), perPage);
    chunks.forEach((lines, i) => {
      const s: DialogueScreenPage = { lines, source };
      if (p.speaker) s.speaker = p.speaker;
      if (i === 0 && p.beat) s.beat = p.beat;
      if (i === chunks.length - 1 && p.then) s.then = p.then;
      out.push(s);
    });
  });
  return out;
}
