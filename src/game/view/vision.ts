// Minimal vision presentation. Replace these brackets with sprite masks later;
// classification, mode and analysis already belong to the sim.
import { VISION_CATEGORIES } from "../content/vision";
import { visionTargets } from "../sim/analysis";
import { areaOf, type Actor, type World } from "../world/world";

export function drawVision(ctx: CanvasRenderingContext2D, w: World, a: Actor, camX: number, camY: number, width: number, height: number) {
  if (a.mode !== "scan") return;
  ctx.fillStyle = "rgba(2,5,12,0.55)";
  ctx.fillRect(0, 0, width, height);
  for (const p of visionTargets(w, areaOf(w, a))) {
    const x = Math.round(p.x - camX), y = Math.round(p.y - camY);
    if (x < -16 || x > width + 16 || y < 0 || y > height + 48) continue;
    ctx.fillStyle = VISION_CATEGORIES[p.category].color;
    ctx.fillRect(x - 7, y - p.height, 4, 1); ctx.fillRect(x - 7, y - p.height, 1, 4);
    ctx.fillRect(x + 4, y, 4, 1); ctx.fillRect(x + 7, y - 3, 1, 4);
    if (a.task?.kind === "scan" && a.task.target?.propId === p.id) {
      ctx.fillRect(x - 9, Math.round(y - p.height + p.height * Math.min(1, a.task.t / a.task.dur)), 18, 1);
    }
  }
}