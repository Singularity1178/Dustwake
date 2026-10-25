// Test helpers: drive the simulation the way the play screen does, without a browser.
import { createWorld, player, currentArea, type World } from "../src/game/world/world";
import { stepPlayer, stepWorld, addPlayTime, type PlayerInput } from "../src/game/sim/step";
import { interactables, type Interactable } from "../src/game/sim/interact";
import type { SimEvent } from "../src/game/world/world";

export const DT = 1 / 60;
const NONE: PlayerInput = { ix: 0, iy: 0, use: false };

/** One play-screen frame: player step, then world step (same order as the host). */
export function frame(w: World, input: PlayerInput = NONE) {
  addPlayTime(w, DT);
  const r = stepPlayer(w, DT, input);
  stepWorld(w, DT);
  return r;
}

export function frames(w: World, n: number, input: PlayerInput = NONE) {
  for (let i = 0; i < n; i++) frame(w, input);
}

/** Drain and return events emitted so far. */
export function events(w: World): SimEvent[] {
  const e = w.events;
  w.events = [];
  return e;
}

export function find(w: World, pred: (it: Interactable) => boolean): Interactable {
  const it = interactables(currentArea(w)).find(pred);
  if (!it) throw new Error("interactable not found");
  return it;
}

/** Stand just below an interactable, facing up at it (as the player would). */
export function standAt(w: World, it: Interactable) {
  const pl = player(w);
  pl.x = it.x; pl.y = it.y + 9; pl.vx = 0; pl.vy = 0; pl.facing = "up";
}

/** Walk up to `it`, press use, and let the resulting work finish (plus a little slack for scheduled effects). */
export function useOn(w: World, it: Interactable) {
  standAt(w, it);
  const r = frame(w, { ix: 0, iy: 0, use: true });
  let guard = 0;
  while (player(w).task && guard++ < 1000) frame(w);
  frames(w, 30);
  return r;
}

export const propItem = (w: World, propId: string) => find(w, (i) => i.propId === propId);
export const newWorld = (seed = 12345) => createWorld(seed);
