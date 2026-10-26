// Dialogue text layout: the word wrapper, pagination, how authored pages map
// onto box screens (beats on the right screen), the box's real capacity, and a
// rendered check that the guardian's text stays inside the box and uses its width.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapText, paginate } from "../src/game/ui/textWrap";
import { layoutDialogue, DIALOGUE_BOX, DIALOGUE_COLS, DIALOGUE_LINES } from "../src/game/ui/dialogueLayout";
import { textWidth } from "../src/game/font";
import { createWorld, setFlag } from "../src/game/world/world";
import { FLAGS } from "../src/game/content/flags";
import { RCanvas, renderDialogueScreens } from "./support/uiSnapshot";

// ------------------------------------------------------------------ wrapper
test("wrap: greedy fill up to the width, breaking only at spaces", () => {
  assert.deepEqual(wrapText("AAA BBB CCC DDD", 7), ["AAA BBB", "CCC DDD"]);
  assert.deepEqual(wrapText("AAA BBB CCC", 11), ["AAA BBB CCC"]);
  assert.deepEqual(wrapText("A B C D E F", 3), ["A B", "C D", "E F"]);
});

test("wrap: exact-fit lines stay on one line; one more character moves the word down", () => {
  assert.deepEqual(wrapText("ABCD EFGH", 9), ["ABCD EFGH"]);
  assert.deepEqual(wrapText("ABCD EFGHI", 9), ["ABCD", "EFGHI"]);
  assert.deepEqual(wrapText("ABCDEFGHI", 9), ["ABCDEFGHI"]);
  const full = "X".repeat(DIALOGUE_COLS);
  assert.deepEqual(wrapText(full, DIALOGUE_COLS), [full]);
  assert.deepEqual(wrapText(full + " Y", DIALOGUE_COLS), [full, "Y"]);
});

test("wrap: a word longer than a line is broken across lines", () => {
  assert.deepEqual(wrapText("ABCDEFGHIJ", 4), ["ABCD", "EFGH", "IJ"]);
  assert.deepEqual(wrapText("HI ABCDEFGHIJ YO", 4), ["HI", "ABCD", "EFGH", "IJ", "YO"]);
  assert.deepEqual(wrapText("ABCDEFGH", 4), ["ABCD", "EFGH"]);
  for (const l of wrapText("A ".repeat(30) + "Z".repeat(200), 13)) assert.ok(l.length <= 13);
});

test("wrap: spaces collapse, \\n forces a break, empty paragraphs keep an empty line", () => {
  assert.deepEqual(wrapText("  AA   BB  ", 10), ["AA BB"]);
  assert.deepEqual(wrapText("AA\nBB", 10), ["AA", "BB"]);
  assert.deepEqual(wrapText("AA\n\nBB", 10), ["AA", "", "BB"]);
  assert.deepEqual(wrapText("", 10), [""]);
  assert.throws(() => wrapText("A", 0));
});

// ------------------------------------------------------------------ pagination
test("paginate: chunks of the line capacity, exact fit is one page", () => {
  assert.deepEqual(paginate(["1", "2", "3", "4"], 4), [["1", "2", "3", "4"]]);
  assert.deepEqual(paginate(["1", "2", "3", "4", "5"], 4), [["1", "2", "3", "4"], ["5"]]);
  assert.deepEqual(paginate([], 4), [[]]);
  assert.throws(() => paginate(["1"], 0));
});

test("layout: a long page spills over screens; beat on its first screen, then on its last", () => {
  const long = Array.from({ length: 9 }, (_, i) => "W" + i).join(" "); // 9 words of 2 chars
  const s = layoutDialogue([
    { text: "HELLO.", beat: "pause" },
    { text: long, beat: "wake", then: "goDormant", speaker: "ECHO" },
    { text: "BYE.", then: "goDormant" },
  ], 4, 2); // 4 cols: one 2-char word per line ("W0 W1" is 5); 2 lines per screen
  assert.deepEqual(s.map((p) => p.lines), [["HELL", "O."], ["W0", "W1"], ["W2", "W3"], ["W4", "W5"], ["W6", "W7"], ["W8"], ["BYE."]]);
  assert.deepEqual(s.map((p) => p.source), [0, 1, 1, 1, 1, 1, 2]);
  assert.deepEqual(s.map((p) => p.beat ?? "-"), ["pause", "wake", "-", "-", "-", "-", "-"]);
  assert.deepEqual(s.map((p) => p.then ?? "-"), ["-", "-", "-", "-", "-", "goDormant", "goDormant"]);
  assert.ok(s.slice(1, 6).every((p) => p.speaker === "ECHO") && !s[0].speaker);
  // a page that fits keeps both beats on its single screen
  const one = layoutDialogue([{ text: "SHORT.", beat: "wake", then: "goDormant" }]);
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].beat, one[0].then], ["wake", "goDormant"]);
});

// ------------------------------------------------------------------ the real box
test("box capacity is derived from its geometry: 68 characters x 4 lines", () => {
  const B = DIALOGUE_BOX, inner = B.w - 2 * B.padX;
  assert.equal(DIALOGUE_COLS, 68);
  assert.equal(DIALOGUE_LINES, 4);
  // a full line plus its 1 px shadow fits the inset text area; one more character doesn't
  assert.ok(textWidth("X".repeat(DIALOGUE_COLS)) + 1 <= inner);
  assert.ok(textWidth("X".repeat(DIALOGUE_COLS + 1)) + 1 > inner);
  // the last line (5 px glyph + shadow) clears the footer row; one more line wouldn't
  const bottom = (n: number) => B.textY + (n - 1) * B.lineH + 5;
  assert.ok(bottom(DIALOGUE_LINES) < B.footerY - 1);
  assert.ok(bottom(DIALOGUE_LINES + 1) >= B.footerY);
});

test("rendered: every guardian screen stays inside the box, and long pages use its width", () => {
  (globalThis as any).document = { createElement: () => new RCanvas() };
  const w = createWorld(7);
  setFlag(w, FLAGS.golemArm); // the optional arm page too
  const B = DIALOGUE_BOX, x0 = B.x + B.padX, x1 = B.x + B.w - B.padX, y0 = B.y + B.textY, y1 = B.y + B.footerY - 1;
  let screens = 0, widest = 0;
  renderDialogueScreens(w, "npc.guardian", "guardian", (name, c) => {
    screens++;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (c.data[i] !== 0xe8 || c.data[i + 1] !== 0xdc || c.data[i + 2] !== 0xc0) continue; // body text colour
      // the pixel and its shadow (+1, +1) are inside the text area, above the footer
      assert.ok(x >= x0 && x + 1 < x1 && y >= y0 && y + 1 < y1, `${name}: text pixel at ${x},${y} outside ${x0}..${x1} x ${y0}..${y1}`);
      widest = Math.max(widest, x);
    }
  });
  assert.ok(screens >= 20, `rendered ${screens} screens`);
  // the old hand-broken lines never passed x0 + 26 chars; wrapped text reaches the right margin
  assert.ok(widest > x1 - 16, `widest text pixel at ${widest}, right margin ${x1}`);
});
