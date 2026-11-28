// The overworld: the one continuous surface area, as a table of sites (west to east: the West Road, Westwake, the Throne Road, the old road, the ruins).
//
// Westwake, the old road and the ruins used to be reached through a fade
// between separate maps. They are one area now: you walk out of the East Gate,
// along the road and into the wood over the keep without a screen in between,
// and so does anyone else. Rooms behind doors and the halls underground stay
// areas of their own (they really are somewhere else: under a roof, under the
// ground), joined to the overworld by portals and runes as before.
//
// Adding a place is adding a row: a builder, where it goes, what it is called.
// content/places.ts holds the positions; world/compose.ts does the setting down;
// world/zones.ts is how the rest of the game refers to the result.
import { FS } from "./content/tiles";
import { WEST_ROAD } from "./content/geography";
import { OVERWORLD_H, OVERWORLD_ID, OVERWORLD_W, SITE_AT, ZONE } from "./content/places";
import { TOWN_NAME } from "./content/town";
import type { AreaData } from "./map";
import { buildOldRoad } from "./oldRoad";
import { buildThroneRoad } from "./throneRoad";
import { buildWestRoad } from "./westRoad";
import { buildSurface } from "./surface";
import { buildTown } from "./town";
import { composeArea, type ComposeDef, type SiteDef } from "./world/compose";
import { openWoodGap } from "./woodGap";

/**
 * A site's own build is pure data that the compositor copies, so it is made once and kept: composing the overworld
 * again (a load, a route query, a test) costs a copy, not three builders.
 */
const built = new Map<() => AreaData, AreaData>();
const once = (build: () => AreaData) => () => {
  let d = built.get(build);
  if (!d) built.set(build, (d = build()));
  return d;
};

export const SITES: readonly SiteDef[] = [
  {
    // The Throne's road out of the West Bar: how the empire's carriers come. It runs west to the edge of the map.
    zone: ZONE.westroad, name: "THE WEST ROAD", kind: "road", at: SITE_AT.westroad, build: once(buildWestRoad), ids: `${ZONE.westroad}/`,
    label: "THE WEST ROAD",
  },
  {
    // The market town. Its east road used to be a portal off the edge of its map; the road simply goes on now.
    zone: ZONE.westwake, name: TOWN_NAME, kind: "settlement", at: SITE_AT.westwake, build: once(buildTown), ids: `${ZONE.westwake}/`,
    label: `${TOWN_NAME}, MARKET TOWN`, dropPortals: ["east_road"],
  },
  {
    // The Throne Road past the town's east wall, north and south, with the East Gate's spur running into it. It is
    // well away from the ruins (the hunters' track, not this, goes there).
    zone: ZONE.throneroad, name: "THE THRONE ROAD", kind: "road", at: SITE_AT.throneroad, build: once(buildThroneRoad), ids: `${ZONE.throneroad}/`,
    label: "THE THRONE ROAD",
  },
  {
    zone: ZONE.oldroad, name: "THE OLD ROAD", kind: "road", at: SITE_AT.oldroad, build: once(buildOldRoad), ids: `${ZONE.oldroad}/`,
    label: "THE OLD ROAD",
  },
  {
    // The wild over the sunken keep: the rune circle, the buried stair, the hunters' camp. Its ids stay bare, as
    // every save, rune and stair has always named them.
    zone: ZONE.ruins, name: "THE RUINS", kind: "wild", at: SITE_AT.ruins, build: once(() => buildSurface()), ids: "",
    label: "THE RUINS", dropPortals: [WEST_ROAD.portal],
    // a small site with a camp in it: its people are simulated whenever the player is anywhere near it (see sim/lod.ts)
    wake: "whole",
  },
];

export const OVERWORLD: ComposeDef = {
  id: OVERWORLD_ID, w: OVERWORLD_W, h: OVERWORLD_H, sites: SITES, start: ZONE.ruins, ambient: [0.32, 0.31, 0.42],
  // The ruins' builder cuts its road through the thicket up to, not through, its own first column (that was the
  // edge of its map, and the portal's box). The road goes on, so that column is opened.
  seams: [{ x: SITE_AT.ruins.x, y: WEST_ROAD.surface.y0, w: 1, h: WEST_ROAD.surface.y1 - WEST_ROAD.surface.y0 + 1, style: FS.EARTH }],
};

/** The sites set down side by side, then the band of thicket that stood between the old road and the ruins opened (woodGap.ts). */
export const buildOverworld = (): AreaData => openWoodGap(composeArea(OVERWORLD));
