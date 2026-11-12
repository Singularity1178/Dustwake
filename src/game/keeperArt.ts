// Shopkeepers' sprites (presentation). PLACEHOLDER: every keeper is a plain black box about the size of a person,
// until each is textured.
//
// To give a keeper real art, add a painter to KEEPER_ART under the shop's id ("smithy", "armory", "jeweler",
// "tailor", "tavern", "guild": content/shops.ts). It gets a Pen (called twice: albedo, then emissive), the keeper's
// feet (x, y) and a KeeperPose (which way they face, what they are doing: sim/shops.ts KeeperState.state, whether
// they are walking, the animation clock). Nothing else needs to change: view/actors.ts draws every actor whose
// ActorDef art key is "keeper" through `keeperPainter`, in the scene and in scan mode alike.
import type { Pen } from "./util";
import type { Facing } from "./golem";
import { drawText, textWidth } from "./font";

export interface KeeperPose {
  facing: Facing;
  /** "tend" (at the counter), "serve" (with a customer), "tidy" / "back" (to the shelves and back). Never "away": that is not drawn. */
  state: string;
  moving: boolean;
  /** Walking cadence, and the animation clock (seconds). */
  phase: number; t: number;
}
export type KeeperPainter = (p: Pen, x: number, y: number, pose: KeeperPose) => void;

/** The placeholder's size (px): about a townsperson's. */
export const KEEPER_BOX = { w: 10, h: 22 } as const;

/** The placeholder: a plain black box standing on (x, y). */
const box: KeeperPainter = (p, x, y) => {
  p.ox = x; p.oy = y;
  p.r(-KEEPER_BOX.w / 2, -KEEPER_BOX.h, KEEPER_BOX.w, KEEPER_BOX.h, "#000000");
};

/** Painters by shop id; `default` is the placeholder every shop falls back on. Real art goes here. */
export const KEEPER_ART: Record<string, KeeperPainter> = { default: box };
export const keeperPainter = (shop: string): KeeperPainter => KEEPER_ART[shop] ?? KEEPER_ART.default;

/** The card stood on a counter out of hours (drawn by the host on the world layer; `x`: its middle, `y`: its foot). */
export function drawClosedSign(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const w = textWidth("CLOSED") + 6, bx = Math.round(x - w / 2), by = y - 10;
  ctx.fillStyle = "#1a1418"; ctx.fillRect(bx, by, w, 10);
  ctx.fillStyle = "#b8ad92"; ctx.fillRect(bx + 1, by + 1, w - 2, 8);
  ctx.fillStyle = "#8f856c"; ctx.fillRect(bx + 1, by + 8, w - 2, 1);
  drawText(ctx, "CLOSED", bx + 3, by + 2, "#3a2a28");
}
