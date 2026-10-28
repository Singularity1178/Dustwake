// Shared actor drawing, by the ActorDef's art key: NPC_ART (guardian-shaped
// poses, npcArt.ts), BODY_ART (bodies with power and work, workerArt.ts: the
// worker golem), the golem painter, and the test-only human fixture. Every
// path draws an albedo and an emissive pass, here and when golem vision
// retraces actors each frame into its scratch canvas (view/vision.ts).
import { actorDef } from "../content/actors";
import { drawGolem, type GolemPose } from "../golem";
import { NPC_ART, type NpcPose } from "../npcArt";
import { BODY_ART, workerPose, workerState } from "../workerArt";
import { Pen, clamp } from "../util";
import { powered } from "../sim/actorStats";
import { runeMarks } from "../sim/gear";
import type { Actor, World } from "../world/world";

interface Look { awake: number; eye: number; flare: number; reach: number }

/** Working: powered, with a task in hand or an order running. Powered with neither is idle, and looks dormant. */
export const actorActive = (a: Actor) => powered(a) && (!!a.task || a.job?.status === "running");

export function drawActor(sc: CanvasRenderingContext2D, ec: CanvasRenderingContext2D, w: World, a: Actor, camX: number, camY: number, t: number, look: Look) {
  const d = actorDef(a), x = Math.round(a.x - camX), y = Math.round(a.y - camY), hw = Math.round(d.body.box[0] / 2) + 2;
  sc.fillStyle = "rgba(0,0,0,0.45)";
  sc.fillRect(x - hw, y - 1, hw * 2, 2);
  sc.fillRect(x - hw + 3, y - 3, hw * 2 - 6, 4);
  const npcArt = NPC_ART[d.art.key];
  if (npcArt) {
    const v = clamp(look.awake, 0, 1);
    const pose: NpcPose = { facing: a.facing, awake: v * v * (3 - 2 * v), eye: look.eye + look.flare, reach: clamp(look.reach, 0, 1), t };
    npcArt(new Pen(sc, false), x, y, pose);
    npcArt(new Pen(ec, true), x, y, pose);
    return;
  }
  const active = actorActive(a);
  const task = a.task;
  const bodyArt = BODY_ART[d.art.key];
  if (bodyArt) {
    // Unpowered, powered-idle or working; `flare` (set by the host when a core goes in) flashes the core as it boots.
    const pose = workerPose(workerState(powered(a), active), {
      facing: a.facing, phase: a.phase, moving: a.moving, t, hasCore: !!a.powerCore, boot: clamp(look.flare, 0, 1),
      raise: task?.kind === "punch" ? Math.sin(task.t / task.dur * Math.PI * 2) : 0,
      reach: task && task.kind !== "punch" ? Math.abs(Math.sin(task.t * 8)) : 0,
    });
    bodyArt(new Pen(sc, false), x, y, pose);
    bodyArt(new Pen(ec, true), x, y, pose);
    return;
  }
  if (d.art.key === "golem") {
    const pose: GolemPose = {
      facing: a.facing, phase: a.phase, moving: a.moving, hasArm: a.upgrades.includes("golem.arm"),
      dormant: active ? 0 : 1, eye: active ? 1 : 0.1, core: powered(a) ? 0.8 : 0,
      raise: task?.kind === "punch" ? Math.sin(task.t / task.dur * Math.PI * 2) : 0,
      reach: task ? Math.abs(Math.sin(task.t * 8)) : 0, t, back: a.gear.back, runes: runeMarks(w, a),
    };
    drawGolem(new Pen(sc, false), x, y, pose);
    drawGolem(new Pen(ec, true), x, y, pose);
    return;
  }
  for (const emit of [false, true]) drawFixtureHuman(new Pen(emit ? ec : sc, emit), x, y, a);
}

/**
 * Test fixture only (the `npc_worker` row, art key "human"): intentionally
 * plain. No builder spawns one, no NPCS row names it and no migration creates
 * one (tests/rollout.test.ts), so no production path can show it.
 */
function drawFixtureHuman(p: Pen, x: number, y: number, a: Actor) {
  const stride = a.moving ? Math.round(Math.sin(a.phase) * 2) : 0;
  p.ox = x; p.oy = y;
  p.o(-4, -20, 8, 7, "#b79b7d"); p.o(-5, -13, 10, 9, "#63796a");
  p.r(-4 + stride, -4, 3, 4, "#594a41"); p.r(1 - stride, -4, 3, 4, "#594a41");
}
