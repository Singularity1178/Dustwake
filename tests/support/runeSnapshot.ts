// Developer preview for the surface rune (run by scripts/runePreview.mjs, no browser): through the real host on
// the pixel canvas, at night (when its glow reads best),
//   rune-states.png   the rune left alone: dormant, restored and linked, restored but severed (a glyph out below)
//   rune-refusal.png  E on the severed rune: the reach, a frame from each beat of the refusal (view/runeFx.ts), then embers
// Nothing is asserted here; tests/routes.test.ts and tests/runeHost.test.ts hold the behaviour.
import { mkdirSync, writeFileSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { Game } from "../../src/game/game";
import { createWorld, enterArea, getArea, player, setFlag } from "../../src/game/world/world";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { FLAGS } from "../../src/game/content/flags";
import { RUNE_NODES } from "../../src/game/content/runes";
import { drawTextS } from "../../src/game/font";
import { RUNE_DUD } from "../../src/game/view/runeFx";

const DT = 1 / 60;
type Frame = { label: string; img: RCanvas };

export function run(dir = ".preview/rune"): number {
  installDom();
  mkdirSync(dir, { recursive: true });
  let files = 0;
  const mk = (w: number, h: number): RCanvas => { const c = (globalThis as any).document.createElement("canvas") as RCanvas; c.width = w; c.height = h; c.getContext(); return c; };
  const cx = (c: RCanvas) => c.getContext() as any;
  const save = (name: string, c: RCanvas, scale: number) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); files++; console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  /** A grid of frames, each captioned. */
  const sheet = (cols: number, frames: Frame[]) => {
    const w = frames[0].img.width, h = frames[0].img.height, out = mk(cols * w, Math.ceil(frames.length / cols) * h);
    frames.forEach((f, i) => {
      const x = (i % cols) * w, y = Math.floor(i / cols) * h;
      cx(out).drawImage(f.img, x, y);
      drawTextS(cx(out), f.label, x + 4, y + 4, "#ffffff", 1, "left", "#000000");
    });
    return out;
  };
  /** A game on the surface by night with these rune flags set, the golem on the rune's south side, facing it. */
  const start = (flags: string[]) => {
    const view = mk(320, 180), ui = mk(320, 180);
    const g = new Game(view as unknown as HTMLCanvasElement, ui as unknown as HTMLCanvasElement), w = createWorld(7), pl = player(w);
    for (const f of [FLAGS.golemArm, FLAGS.tutorialDone, ...flags]) setFlag(w, f);
    const rp = getArea(w, "surface").prop(RUNE_NODES.surface.prop)!;
    enterArea(w, pl, "surface", rp.x, rp.y + 9); pl.facing = "up";
    g.resume(w);
    advanceDayTo(w, 1);
    const tick = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
    /** The world with the UI layer over it, as the page stacks them. */
    const both = () => { view.getContext(); g.render(); const c = mk(320, 180); cx(c).drawImage(view, 0, 0); cx(c).drawImage(ui, 0, 0); return c; };
    return { g, tick, both };
  };

  // left alone, in each state
  const S = RUNE_NODES.surface.flag, D = RUNE_NODES.dungeon.flag;
  const states: [string, string[]][] = [["DORMANT (NEVER WOKEN)", []], ["LINKED (THE CIRCLE BELOW IS LIT)", [S, D]], ["SEVERED (A GLYPH IS OUT BELOW)", [S]]];
  save("rune-states", sheet(3, states.map(([label, flags]) => { const s = start(flags); s.tick(90); return { label, img: s.both() }; })), 2);

  // E on the severed rune
  const r = start([S]);
  r.tick(40);
  r.g.keyDown("e"); r.tick(); r.g.keyUp("e");
  const frames: Frame[] = [{ label: "E: THE GOLEM REACHES", img: r.both() }];
  for (let i = 0; i < 120 && !r.g.runeDud; i++) r.tick();
  // One frame from each beat of the refusal (view/runeFx.ts: RUNE_DUD), so the sheet shows what it does and not
  // what a fixed frame count happens to land on (the first sheet sampled four dark frames in a row).
  const F = RUNE_DUD.flashes, mid = (i: number) => F[i][0] + F[i][1] / 2;
  const beats: [number, string][] = [
    [RUNE_DUD.surge / 2, "SURGE"], [RUNE_DUD.surge - 0.01, "PAST FULL"], [(RUNE_DUD.surge + F[0][0]) / 2, "DARK"], [mid(0), "FLASH 1"],
    [(F[0][0] + F[0][1] + F[1][0]) / 2, "DARK"], [mid(1), "FLASH 2"], [mid(3), "FLASH 4"], [RUNE_DUD.gutter + 0.05, "LAST BREATH"],
  ];
  for (const [at, name] of beats) {
    while (r.g.runeDud && r.g.runeDud.t < at) r.tick();
    if (r.g.runeDud) frames.push({ label: `${name} T ${r.g.runeDud.t.toFixed(2)} GLOW ${r.g.surfaceRuneState().glow.toFixed(2)}`, img: r.both() });
  }
  for (let i = 0; i < 200 && r.g.runeDud; i++) r.tick();
  r.tick(12);
  frames.push({ label: "AFTER: EMBERS AGAIN", img: r.both() });
  save("rune-refusal", sheet(5, frames), 1);
  return files;
}
