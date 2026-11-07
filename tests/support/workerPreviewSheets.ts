import { workerCell, save } from "./workerPreview";
import { workerPose, type WorkerPose } from "../../src/game/workerArt";
import { initWorkerAnim, stepWorkerAnim, animPose, blowMotion, type WorkerAnim, type WorkerInput } from "../../src/game/workerAnim";
import type { Facing } from "../../src/game/golem";

const F: Facing[] = ["down", "right", "up", "left"];
const m = (facing: Facing, extra: any = {}) => ({ facing, phase: 0, moving: false, t: 0.3, hasCore: true, ...extra });
const with_ = (p: WorkerPose, x: Partial<WorkerPose>): WorkerPose => ({ ...p, ...x });

/** Step a sequencer from `start` through `seconds`, sampling `n` frames. */
function strip(start: WorkerInput, then: WorkerInput, seconds: number, n: number, facing: Facing, cols = 8, w = 30, h = 30) {
  const a: WorkerAnim = initWorkerAnim(start);
  const out = [];
  const dt = 1 / 60, per = seconds / (n - 1);
  let next = 0, t = 0;
  for (let i = 0; i < n; i++) {
    while (t < next) { stepWorkerAnim(a, dt, then); t += dt; }
    out.push(workerCell(animPose(a, m(facing, { t })), w, h));
    next += per;
  }
  const rows = [];
  for (let i = 0; i < out.length; i += cols) rows.push(out.slice(i, i + cols));
  return rows;
}
const OFF = { powered: false, active: false, moving: false, hasCore: false };
const IDLE = { powered: true, active: false, moving: false, hasCore: true };
const WORK = { powered: true, active: true, moving: false, hasCore: true };

export function sheets(dir: string) {
  const rows = [
    F.map((f) => workerCell(workerPose("off", m(f, { hasCore: false })))),
    F.map((f) => workerCell(workerPose("idle", m(f)))),
    F.map((f) => workerCell(workerPose("work", m(f)))),
    F.map((f) => workerCell(workerPose("work", m(f, { moving: true, phase: 1.5 })))),
    F.map((f) => workerCell(workerPose("work", m(f, { moving: true, phase: 4.6 })))),
  ];
  save(dir, "stand", rows, 5);
  const w = (f: Facing) => workerPose("work", m(f));
  save(dir, "tasks", [
    F.map((f) => workerCell(with_(w(f), { swing: 1 }))),
    F.map((f) => workerCell(with_(w(f), { swing: -1, dip: 2 }))),
    F.map((f) => workerCell(with_(w(f), { reach: 1 }))),
  ], 5);
  save(dir, "boot", [...strip(OFF, IDLE, 3.7, 16, "down", 8)], 4);
  save(dir, "bootSide", [...strip(OFF, IDLE, 3.7, 16, "right", 8)], 4);
  save(dir, "shutdown", [...strip(WORK, OFF, 2.7, 16, "down", 8), ...strip(WORK, OFF, 2.7, 8, "right", 8)], 4);
  save(dir, "settle", [...strip(WORK, IDLE, 5.8, 16, "down", 8), ...strip(WORK, IDLE, 5.8, 8, "right", 8)], 4);
  save(dir, "wake", [...strip(IDLE, { ...WORK, moving: false }, 0.75, 8, "down", 8), ...strip(IDLE, WORK, 0.75, 8, "right", 8)], 4);
  const blow = [];
  for (let i = 0; i < 16; i++) blow.push(workerCell(with_(w("right"), { ...blowMotion(i / 15) })));
  const blowF = [];
  for (let i = 0; i < 16; i++) blowF.push(workerCell(with_(w("down"), { ...blowMotion(i / 15) })));
  save(dir, "blow", [blow.slice(0, 8), blow.slice(8), blowF.slice(0, 8), blowF.slice(8)], 4);
}
module.exports = { sheets };
