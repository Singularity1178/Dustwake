// Where things lie on the overworld (data). Pure; no DOM, and no builder is
// imported here, so anything may read it (the builders themselves included).
//
// The surface is ONE area: a continuous overworld you walk across with no
// screen in between. It is put together from *sites* (overworld.ts): each site
// is authored on its own, in its own local coordinates (Westwake's builder
// still thinks its north-west corner is 0,0), and the compositor
// (world/compose.ts) sets it down at its place. So nothing authored for a site
// carries an absolute overworld position; this table is the only place that
// says where a site is. Moving Westwake, or adding a kingdom two thousand
// tiles south, is a row here and a builder; nothing else moves.
//
// Every site is also a *zone* (world/zones.ts): a named region of an area that
// orders, routines and the simulation's level of detail refer to ("go to
// WESTWAKE", "the people of WESTWAKE", "WESTWAKE is asleep: nobody is near").
import { TS } from "./tiles";

/** The overworld's area id. It keeps the id the surface always had, so saves, runes and stairs still name it. */
export const OVERWORLD_ID = "surface";
/** Its size in tiles. Sites must fit inside; ground no site covers is plain meadow. */
export const OVERWORLD_W = 240, OVERWORLD_H = 72;

/** Zone ids of the sites that make up the overworld today. */
export const ZONE = { westwake: "westwake", oldroad: "oldroad", ruins: "ruins" } as const;
export type SiteId = keyof typeof ZONE;

/**
 * Where each site's own (0, 0) lies on the overworld, in tiles. Westwake sits
 * three rows down so that its High Street (its rows 30..32) meets the old road
 * (rows 33..35 of the ruins' wild, and of the country between).
 */
export const SITE_AT: Record<SiteId, { x: number; y: number }> = {
  westwake: { x: 0, y: 3 },
  oldroad: { x: 96, y: 0 },
  ruins: { x: 144, y: 0 },
};

/** A site's origin in px: add it to a site-local position to get the overworld's. */
export const sitePx = (site: SiteId) => ({ x: SITE_AT[site].x * TS, y: SITE_AT[site].y * TS });

/**
 * The overworld id of something a site's builder named (a prop, a portal, a
 * loose item): the site's prefix and the builder's own id. The ruins keep
 * their ids bare (their prefix is empty: saves from before the overworld name
 * them so); every other site's ids carry its zone.
 */
export const zoneRef = (zone: string, id: string) => `${zone}/${id}`;
