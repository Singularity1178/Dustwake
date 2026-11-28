// Developer tool: renders the overworld (src/game/overworld.ts) as the game would bake it, and crops the places
// where its sites meet, so the seams can be looked at: the East Gate and the start of the old road, the road's far
// end where it goes into the wood round the ruins, and the whole land small.
//   node scripts/overworldPreview.mjs        -> .preview/overworld/*.png
import { writeFileSync, mkdirSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { crop, installDom, renderArea } from "./townSnapshot";
import { TS } from "../../src/game/content/tiles";
import { OVERWORLD_ID, SITE_AT } from "../../src/game/content/places";
import { WEST_ROAD } from "../../src/game/content/geography";

/** A canvas shrunk by a whole factor (nearest pixel): the whole land on one sheet. */
function shrink(src: RCanvas, k: number): RCanvas {
  const w = Math.floor(src.width / k), h = Math.floor(src.height / k), out = new RCanvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * k * src.width + x * k) * 4, o = (y * w + x) * 4;
    out.data[o] = src.data[i]; out.data[o + 1] = src.data[i + 1]; out.data[o + 2] = src.data[i + 2]; out.data[o + 3] = 255;
  }
  return out;
}

export function run(dir = ".preview/overworld") {
  installDom();
  mkdirSync(dir, { recursive: true });
  const save = (name: string, c: RCanvas, scale = 1) => writeFileSync(`${dir}/${name}.png`, png(c, scale));
  const o = renderArea(OVERWORLD_ID), ry = WEST_ROAD.surface.y0;
  // the whole overworld, day (unlit albedo) at a quarter size
  save("whole", shrink(o.flat, 4));
  // where Westwake's own map ends and the old road begins: the East Gate, the watch fire, the track running on
  save("seam_town_road", crop(o.flat, (SITE_AT.oldroad.x - 16) * TS, (ry - 10) * TS, 40 * TS, 23 * TS));
  // where the road goes into the wood round the ruins: the old map edge, opened
  save("seam_road_ruins", crop(o.flat, (SITE_AT.ruins.x - 18) * TS, (ry - 10) * TS, 40 * TS, 23 * TS));
  // the same two by night, lit as in the game
  save("seam_town_road_night", crop(o.lit, (SITE_AT.oldroad.x - 16) * TS, (ry - 10) * TS, 40 * TS, 23 * TS));
}
