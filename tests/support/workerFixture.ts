// The worker/storage fixture the screen tests share: the ?debug foundations
// (a lesser golem with a ruby core, a 32-slot chest and a bench in the workshop,
// a tree and a rock in the yard, the rune link between them), with the worker's
// opening order cancelled and the player beside it.
import { actorById, getArea, player, type Actor, type World } from "../../src/game/world/world";
import { cancelJob } from "../../src/game/sim/jobs";
import { foundationDemo, registerFoundations } from "../../src/game/sim/debugFoundations";
import { stepWorld } from "../../src/game/sim/step";
import { frame } from "../helpers";
import { TS } from "../../src/game/content/tiles";

registerFoundations();
export const WORKER_ID = "debug.worker";
export const CHEST: { area: string; prop: string } = { area: "debug_workshop", prop: "chest.fixture" };
export const BENCH: { area: string; prop: string } = { area: "debug_workshop", prop: "bench.fixture" };
export const DT = 0.05;

export const worker = (w: World) => actorById(w, WORKER_ID)!;
export const chestProp = (w: World) => getArea(w, CHEST.area).prop(CHEST.prop)!;
export const chestCount = (w: World, item: string) => (chestProp(w).inventory ?? []).reduce((n, s) => n + (s?.item === item ? s.n : 0), 0);

/** Stand just below `a`, facing it, as the player does to use it. */
export function beside(w: World, a: Actor) {
  const pl = player(w);
  pl.x = a.x; pl.y = a.y + 11; pl.vx = 0; pl.vy = 0; pl.facing = "up"; pl.area = a.area;
}
/** Stand just below the chest. */
export function besideChest(w: World) {
  const pl = player(w), p = chestProp(w);
  pl.x = p.x; pl.y = p.y + 9; pl.vx = 0; pl.vy = 0; pl.facing = "up";
}

/** The foundations with the worker idle and powered, and the player beside it. */
export function fixture(seed = 1178) {
  const w = foundationDemo(seed);
  cancelJob(w, worker(w));
  w.events = [];
  beside(w, worker(w));
  return { w, pl: player(w), worker: worker(w) };
}

/** Step the world (the player stays put) until `check` holds. */
export function until(w: World, check: () => boolean, limit = 6000) {
  for (let i = 0; i < limit && !check(); i++) stepWorld(w, DT);
  if (!check()) throw new Error("condition never held");
}
/** Let the player's task (a core swap) finish, one frame at a time. */
export function finishTask(w: World, limit = 900) {
  const pl = player(w);
  for (let i = 0; i < limit && pl.task; i++) frame(w);
}
export const tile = (n: number) => n * TS;
