// Shared actor drawing. The legacy golem painter is unchanged; variants scale
// its pixel buffer only when explicitly requested by their definition.
import { actorDef } from "../content/actors";
import { drawGolem, type GolemPose } from "../golem";
import { NPC_ART, type NpcPose } from "../npcArt";
import { makeCanvas, Pen, clamp } from "../util";
import { powered } from "../sim/actorStats";
import { runeMarks } from "../sim/gear";
import type { Actor, World } from "../world/world";

interface Look { awake: number; eye: number; flare: number; reach: number }
let scratch: ReturnType<typeof makeCanvas> | null = null;

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
  const active = powered(a) && (!!a.task || a.job?.status === "running");
  const pose: GolemPose = {
    facing: a.facing, phase: a.phase, moving: a.moving, hasArm: a.upgrades.includes("golem.arm"),
    dormant: active ? 0 : 1, eye: active ? 1 : 0.1, core: powered(a) ? 0.8 : 0,
    raise: a.task?.kind === "punch" ? Math.sin(a.task.t / a.task.dur * Math.PI * 2) : 0,
    reach: a.task ? Math.abs(Math.sin(a.task.t * 8)) : 0, t, back: a.gear.back, runes: runeMarks(w, a),
  };
  for (const [ctx, emit] of [[sc, false], [ec, true]] as const) {
    if (d.art.key === "golem") {
      const scale = d.art.scale ?? 1;
      if (scale === 1) drawGolem(new Pen(ctx, emit), x, y, pose);
      else {
        scratch ??= makeCanvas(40, 40);
        scratch.ctx.clearRect(0, 0, 40, 40);
        drawGolem(new Pen(scratch.ctx, emit), 20, 36, pose);
        ctx.drawImage(scratch.c, Math.round(x - 20 * scale), Math.round(y - 36 * scale), Math.round(40 * scale), Math.round(40 * scale));
      }
    } else {
      // Intentionally plain human fixture, not final NPC art.
      const p = new Pen(ctx, emit), stride = a.moving ? Math.round(Math.sin(a.phase) * 2) : 0;
      p.ox = x; p.oy = y;
      p.o(-4, -20, 8, 7, "#b79b7d"); p.o(-5, -13, 10, 9, "#63796a");
      p.r(-4 + stride, -4, 3, 4, "#594a41"); p.r(1 - stride, -4, 3, 4, "#594a41");
    }
  }
}