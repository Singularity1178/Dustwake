// Developer tool (not a test): draws the golem in every facing for a set of
// states (bare, iron arm, basket on the back, slam frames...) into one PNG, so
// sprite changes can be eyeballed without a browser. Rows top to bottom are
// the states, columns are down / left / up / right. After `npm test` compiled:
//   node -e "require('./.test-out/tests/support/golemSnapshot.js').run('snapshots')"
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { drawGolem, type Facing, type GolemPose } from "../../src/game/golem";
import { Pen } from "../../src/game/util";
import { PackUi, BACK_SLOT } from "../../src/game/screens/pack";
import { ScreenStack } from "../../src/game/ui/screens";
import type { UiHost } from "../../src/game/ui/kit";
import { createWorld, player, currentArea, setFlag, type World } from "../../src/game/world/world";
import { addItems } from "../../src/game/sim/inventory";
import { ensureWorn } from "../../src/game/sim/gear";
import { FLAGS } from "../../src/game/content/flags";

const FACINGS: Facing[] = ["down", "left", "up", "right"];

export const ROWS: [string, Partial<GolemPose>][] = [
  ["bare", {}],
  ["arm", { hasArm: true }],
  ["basket", { back: "basket" }],
  ["arm+basket", { hasArm: true, back: "basket" }],
  ["walk+basket", { hasArm: true, back: "basket", moving: true, phase: 1.3 }],
  ["slumped+basket", { back: "basket", dormant: 1, eye: 0, core: 0 }],
  ["slam top (arm)", { hasArm: true, slam: 1, dip: -1 }],
  ["slam halfway (arm)", { hasArm: true, slam: -0.2 }],
  ["slam impact (arm)", { hasArm: true, slam: -1, dip: 2 }],
  ["slam top (stub)", { slam: 1, dip: -1 }],
  ["slam impact (stub)", { slam: -1, dip: 2 }],
  ["slam impact+basket", { hasArm: true, back: "basket", slam: -1, dip: 2 }],
];

/**
 * The pack screen at 320x180 in a few gear states (basket in the pack, worn
 * with the back slot selected, empty back slot), one PNG each:
 *   node -e "require('./.test-out/tests/support/golemSnapshot.js').runPack('snapshots')"
 */
export function runPack(dir = "snapshots", scale = 3) {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => new RCanvas() };
  const shots: [string, (w: World) => void, number][] = [
    ["pack-basket-in-pack", (w) => { addItems(w, player(w), "basket", 1); addItems(w, player(w), "wood", 25); }, 0],
    ["pack-basket-worn", (w) => { setFlag(w, FLAGS.golemArm); ensureWorn(w, player(w), "basket"); addItems(w, player(w), "stone", 90); }, BACK_SLOT],
    ["pack-back-empty", (w) => { setFlag(w, FLAGS.golemArm); addItems(w, player(w), "coin", 1); }, BACK_SLOT],
  ];
  mkdirSync(dir, { recursive: true });
  for (const [name, setup, cursor] of shots) {
    const w = createWorld(7);
    setup(w);
    const ui = new RCanvas(320, 180);
    const host = {
      ctx: ui.getContext(), world: w, get pl() { return player(w); }, get area() { return currentArea(w); }, t: 0.5,
      cam: { x: 0, y: 0 }, vw: 320, vh: 180, sfx: new Proxy({}, { get: () => () => {} }), screens: new ScreenStack(), typed: [],
      hit: () => false, say: () => {}, renderNote: () => {}, drainEvents: () => { w.events = []; }, renderToast: () => {},
      read: () => {}, boostEye: () => {}, animate: () => {},
    };
    const p = new PackUi(host as unknown as UiHost);
    p.open("view");
    p.cursor = cursor;
    p.screen.render();
    writeFileSync(`${dir}/${name}.png`, png(ui, scale));
  }
}

export function run(dir = "snapshots", rows: [string, Partial<GolemPose>][] = ROWS, name = "golem", scale = 6) {
  const cw = 40, ch = 44;
  const c = new RCanvas(cw * FACINGS.length, ch * rows.length);
  const ctx = c.getContext() as unknown as CanvasRenderingContext2D;
  rows.forEach(([, extra], r) => FACINGS.forEach((facing, i) => {
    ctx.fillStyle = (r + i) % 2 ? "#3a3540" : "#302c36";
    ctx.fillRect(i * cw, r * ch, cw, ch);
    const pose: GolemPose = { facing, phase: 0, moving: false, hasArm: false, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: 0.3, eyeFixed: true, ...extra };
    drawGolem(new Pen(ctx, false), i * cw + 20, r * ch + 38, pose);
  }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.png`, png(c, scale));
}
