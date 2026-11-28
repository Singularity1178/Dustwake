// Where the tests find Westwake now that it is a zone of the overworld (src/game/overworld.ts), not an area.
import { getArea, type Actor, type World } from "../../src/game/world/world";
import { zoneById } from "../../src/game/world/zones";
import { AREAS } from "../../src/game/world/areas";
import { buildTown } from "../../src/game/town";
import { buildSurface } from "../../src/game/surface";
import { OVERWORLD_ID, ZONE, sitePx } from "../../src/game/content/places";
import type { AreaData } from "../../src/game/map";

/** The overworld's area id, and the zones of it the tests name. */
export const OVER = OVERWORLD_ID, WESTWAKE = ZONE.westwake, RUINS = ZONE.ruins, OLDROAD = ZONE.oldroad;
/** px origins of the two authored sites on the overworld: add to a site-local position. */
export const TOWN_AT = sitePx("westwake"), RUINS_AT = sitePx("ruins");
export const townZone = (w: World) => zoneById(getArea(w, OVER), WESTWAKE)!;
/** Where one arrives in Westwake (just inside the East Gate): what the town area's `start` used to be. */
export const townStart = (w: World) => townZone(w).anchor;
/** Does this person live in Westwake? */
export const fromTown = (a: Actor) => a.person?.zone === WESTWAKE;
/** Is this actor out in Westwake's streets (on the overworld, inside the town's rect)? */
export const inTown = (a: Actor) => a.area === OVER && a.x >= TOWN_AT.x && a.x < TOWN_AT.x + 96 * 16 && a.y >= TOWN_AT.y && a.y < TOWN_AT.y + 68 * 16;
/**
 * Builders audited on their own, by the names the audits have always used: every registered area, plus the two
 * authored sites standalone (`town`: Westwake's own map; `wild`: the ruins' own map), as their builders lay them
 * before the compositor sets them down.
 */
export const SITE_BUILDERS: Record<string, () => AreaData> = { ...AREAS, town: buildTown, wild: () => buildSurface() };
