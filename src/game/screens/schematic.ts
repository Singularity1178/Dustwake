// The schematic overlay: the dungeon plan (drawn by ../schematic.ts) unrolls
// from the centre, with a blinking marker where the golem stands. Closing it
// the first time is the tutorial's moment of insight.
import type { Screen } from "../ui/screens";
import type { UiHost } from "../ui/kit";
import { FLAGS } from "../content/flags";
import { TS } from "../content/tiles";
import { getArea, hasFlag, setFlag, type World } from "../world/world";
import { buildSchematic, PLAN_X, PLAN_Y, PLAN_S } from "../schematic";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { clamp } from "../util";

export class SchematicUi {
  readonly screen: Screen;
  /** The rendered plan (of the dungeon, wherever the golem is). */
  canvas: HTMLCanvasElement | null = null;

  constructor(private g: UiHost) {
    this.screen = { id: "schem", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  /** New session: draw the plan of this world's dungeon. */
  reset(world: World) {
    const dg = getArea(world, "dungeon");
    this.canvas = dg.ritual ? buildSchematic(dg.base, dg.ritual.solution) : null;
  }

  open() {
    const g = this.g;
    g.screens.popToBase();
    g.screens.push(this.screen);
    setFlag(g.world, FLAGS.knowSchematic);
    g.sfx.noise(0.4, 0.12, "bandpass", 2500, 1, 0, 800);
  }

  private update() {
    const g = this.g;
    if (this.screen.t > 0.4 && g.hit("e", "escape", "enter", " ", "m", "i", "tab", "click")) {
      g.screens.popToBase();
      if (!hasFlag(g.world, FLAGS.tutorialInsight)) {
        setFlag(g.world, FLAGS.tutorialInsight);
        g.sfx.insight();
        g.boostEye(1.5);
      }
    }
  }

  private render() {
    const g = this.g, ctx = g.ctx;
    if (!this.canvas) return;
    const k = clamp(this.screen.t / 0.45, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, 0, W, H);
    const w = Math.round(W * e);
    const x = Math.round((W - w) / 2);
    ctx.drawImage(this.canvas, x, 0, w, H, x, 0, w, H);
    if (w < W) { ctx.fillStyle = "#d0d8e8"; ctx.fillRect(x - 3, 0, 3, H); ctx.fillRect(x + w, 0, 3, H); }
    if (k >= 1 && g.area.id === "dungeon" && Math.sin(g.t * 6) > 0) {
      const pl = g.pl;
      const mx = Math.round(PLAN_X + (pl.x / TS) * PLAN_S), my = Math.round(PLAN_Y + (pl.y / TS) * PLAN_S);
      ctx.fillStyle = "#ffcc55"; ctx.fillRect(mx - 1, my - 1, 3, 3);
      ctx.fillStyle = "#000"; ctx.fillRect(mx, my, 1, 1);
    }
  }
}
