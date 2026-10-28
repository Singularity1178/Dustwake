// Developer tool (not a test): the worker golem in its three states (off,
// powered-idle, working: standing, two walk frames, a punch) in every facing,
// beside the maintainer and the guardian for scale and style, plus the ruby
// icons, the crown and the aether core. Each sheet is drawn twice: albedo, and
// "in the dark" (albedo dimmed, the emissive pass added), so glow can be judged.
// After `npm test` compiled:
//   node -e "require('./.test-out/tests/support/workerSnapshot.js').run('snapshots')"
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { drawWorker, workerPose, type WorkerState } from "../../src/game/workerArt";
import { drawGolem, type Facing } from "../../src/game/golem";
import { drawGuardian } from "../../src/game/npcArt";
import { ITEM_ART } from "../../src/game/art/items";
import { Pen } from "../../src/game/util";
import type { ItemId } from "../../src/game/content/items";

const FACINGS: Facing[] = ["down", "left", "up", "right"];
type Cell = (p: Pen, x: number, y: number) => void;

function sheet(rows: Cell[][], cw: number, ch: number, ax: number, ay: number) {
  const W = cw * Math.max(...rows.map((r) => r.length)), H = ch * rows.length;
  const a = new RCanvas(W, H), e = new RCanvas(W, H);
  const actx = a.getContext() as unknown as CanvasRenderingContext2D, ectx = e.getContext() as unknown as CanvasRenderingContext2D;
  rows.forEach((row, r) => row.forEach((f, i) => {
    actx.fillStyle = (r + i) % 2 ? "#3a3540" : "#302c36"; actx.fillRect(i * cw, r * ch, cw, ch);
    ectx.fillStyle = "#000"; ectx.fillRect(i * cw, r * ch, cw, ch);
    f(new Pen(actx, false), i * cw + ax, r * ch + ay); f(new Pen(ectx, true), i * cw + ax, r * ch + ay);
  }));
  const dark = new RCanvas(W, H); dark.getContext();
  for (let k = 0; k < a.data.length; k += 4) for (let c = 0; c < 3; c++) dark.data[k + c] = Math.min(255, a.data[k + c] * 0.3 + e.data[k + c]);
  const out = new RCanvas(W, H * 2); out.getContext();
  out.data.set(a.data, 0); out.data.set(dark.data, a.data.length);
  return out;
}

export function run(dir = "snapshots", scale = 6) {
  (globalThis as unknown as { document: unknown }).document = { createElement: () => new RCanvas() };
  mkdirSync(dir, { recursive: true });
  const worker = (state: WorkerState, extra: { moving?: boolean; phase?: number; raise?: number; reach?: number; hasCore?: boolean; boot?: number } = {}) =>
    FACINGS.map((facing): Cell => (p, x, y) => drawWorker(p, x, y, workerPose(state, { facing, phase: extra.phase ?? 0, moving: !!extra.moving, t: 0.3, hasCore: extra.hasCore ?? state !== "off", raise: extra.raise, reach: extra.reach, boot: extra.boot })));
  const rows: Cell[][] = [
    worker("off"), worker("idle"), worker("idle", { boot: 1 }), worker("work"),
    worker("work", { moving: true, phase: 1.3 }), worker("work", { moving: true, phase: 4.4 }), worker("work", { raise: 1 }), worker("work", { reach: 1 }),
    [
      (p, x, y) => drawGolem(p, x, y, { facing: "down", phase: 0, moving: false, hasArm: true, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: 0.3, eyeFixed: true }),
      (p, x, y) => drawWorker(p, x, y, workerPose("work", { facing: "down", phase: 0, moving: false, t: 0.3, hasCore: true })),
      (p, x, y) => drawGolem(p, x, y, { facing: "down", phase: 0, moving: false, hasArm: false, dormant: 1, eye: 0, core: 0, raise: 0, reach: 0, t: 0.3 }),
      (p, x, y) => drawWorker(p, x, y, workerPose("off", { facing: "down", phase: 0, moving: false, t: 0.3, hasCore: false })),
    ],
  ];
  writeFileSync(`${dir}/worker.png`, png(sheet(rows, 28, 30, 14, 26), scale));
  const cmp = sheet([[
    (p, x, y) => drawGuardian(p, x + 4, y, { facing: "down", awake: 0, eye: 0, reach: 0, t: 0 }),
    (p, x, y) => drawGolem(p, x, y, { facing: "down", phase: 0, moving: false, hasArm: true, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: 0.3, eyeFixed: true }),
    (p, x, y) => drawWorker(p, x, y, workerPose("idle", { facing: "down", phase: 0, moving: false, t: 0.3, hasCore: true })),
    (p, x, y) => drawWorker(p, x, y, workerPose("work", { facing: "right", phase: 0, moving: false, t: 0.3, hasCore: true })),
  ]], 40, 52, 20, 48);
  writeFileSync(`${dir}/worker-lineup.png`, png(cmp, scale));
  const icons: ItemId[] = ["large_ruby", "ruby_core", "crown", "core", "coin", "rune_glow"];
  writeFileSync(`${dir}/ruby-icons.png`, png(sheet([icons.map((id): Cell => (p, x, y) => { p.ox = x; p.oy = y; ITEM_ART[id](p); })], 18, 18, 1, 1), 8));
}
