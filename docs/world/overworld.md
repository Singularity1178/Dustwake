# The overworld: one surface, sites, zones, and simulation by distance (v21)

> Index: [docs/index.md](../index.md). Code: `content/places.ts`, `overworld.ts`, `oldRoad.ts`, `world/compose.ts`, `world/zones.ts`, `world/presence.ts`, `world/area.ts` (buckets, sectors), `sim/navigation.ts`, `sim/lod.ts`, `sim/folk.ts`, `sim/jobs.ts`, `sim/orders.ts`, `world/save.ts` (v21). Tests: `tests/overworld.test.ts`, and the town, folk, shops, routes, timestep and soak suites, which now run on the overworld.

## What changed, and why

Westwake used to be an area of its own, reached through a portal at the west edge of the surface: a fade, a new map. The surface is now **one continuous area** (`surface`, the overworld). You walk out of the ruins, west along the old road and in through Westwake's East Gate, and nothing loads. So does everyone else.

The surface is meant to grow into a land with many settlements a long walk apart. Nothing below assumes there are three places, or that the map is 240 tiles wide.

What stays a separate area: rooms behind doors and the halls underground. They really are somewhere else (under a roof, under the ground), a door or a stair is a natural place for a cut, and each keeps its own light and sound. Portals and runes join them to the overworld exactly as before (`sim/portals.ts`, `sim/routes.ts`).

## Sites: how one big area is authored

The overworld is not one hand-made map. It is **composed** from sites (`world/compose.ts: composeArea`):

- A site is an ordinary area builder (`town.ts`, `surface.ts`, `oldRoad.ts`). It lays out its own ground in its own coordinates, as if it were alone in the world. Westwake's builder still thinks its north-west corner is (0, 0).
- `content/places.ts: SITE_AT` is the only place that says where a site lies. `overworld.ts: SITES` lists the sites: builder, name, kind, id prefix.
- The compositor copies each site into the big grid and translates everything it made: tiles, props, lights, decals, loose items, portals, spots, rooms, NPC spawns. Ground no site covers is plain meadow. `seams` open the few tiles where one site's road runs into the next through what used to be a map edge.

This is the answer to hard-coded positions. A position written in a site's builder, or against it (the census's `door.watch`, the lamplighter's "east of x = 720", `RUNE_T`), can only be local to that site, and the site's origin is added in one place. Moving Westwake, or adding a kingdom two thousand tiles south, is a row in `SITE_AT` and a builder. Nothing else is renumbered.

Ids. Prop, loose item, light and portal ids must be unique in an area, and two sites will both have a `bush@10,12`, so each site has an id prefix: `westwake/door.tavern`, `oldroad/tree@7,40`. The ruins keep theirs bare (`rune.surface`), because every save, rune and stair has always named them so. **Spot** ids are left as the builder wrote them and carry a `zone` field instead: the people's code reads spots by kind and id prefix (`work.haul.*`), and two towns may each have a `door.tavern`.

A site's build is pure data that the compositor copies, so it is built once and kept (`overworld.ts: once`). Composing the overworld again (a load, a route query, a test) costs a copy.

## Zones: what "a place" means inside a big area

Every site becomes a **zone** (`map.ts: Zone`, `world/zones.ts`): a named rect of the area that remembers the site's origin. Any area may also declare zones of its own. A zone is the game's unit for a place on a continuous map:

| Who | How it uses zones |
| --- | --- |
| Orders | A gather order names a zone (`fromZone`): "GATHER WOOD FROM THE OLD ROAD". The surface as a whole is too big to be somewhere. `gatherSources` offers an area with zones place by place; `walkOptions` offers each zone by where one arrives in it ("WESTWAKE START"); a walk into a settlement reads "GO TO WESTWAKE". |
| People | A census row has a `zone`; a person's home, places, claims and rounds are their zone's (`sim/folk.ts: zoneFor`, `spotsIn`). Census flags are per place (`census.westwake`). |
| Simulation | A zone says how it wakes (below). |
| Presentation | `zoneEntered` (emitted by `stepWorld` when the player walks across a zone's edge, 20 px inside it so a border is never named twice) shows the place's name and, for a settlement, autosaves, as arriving in an area does. Lamps are tended by zone (`tendedAt`), so Westwake's lights keep hours and the camp's fire does not. The golem's "ON RECORD: A VILLAGE. OBSERVED: A TOWN." fires on entering the zone. |
| Debug | The travel menu lists each zone and its named parts under the zone's name. |

Lookups do not walk lists. `zoneAt(area, x, y)` reads a coarse cell index built once per area definition; spots are bucketed per zone.

## Simulation by distance

`sim/lod.ts`. Before, "the player's area" was the unit: everything in it was simulated. An overworld with many settlements cannot work that way. The tiers are now:

| Tier | Who | How it is stepped |
| --- | --- | --- |
| active | in view (the widest zoom's box plus a margin) | every tick |
| near | in the player's area and inside the bubble (about three screens each way), or anywhere in a settlement that is awake | on the 0.1 s beat, in pieces no longer than 0.1 s |
| far | another area, or the same area a long way off | abstract (below) |

**A settlement wakes as a whole.** A zone with `wake: "whole"` (a town, the ruins with their camp) is awake while the player's bubble touches its rect, and then all of it is near. A town is never half simulated, with people frozen at an invisible line. Open country (`wake: "bubble"`, the old road) is simulated only where the bubble is. A very large wild zone with a camp in it should make the camp its own zone.

**Far people are a function of the hour.** A townsperson in a sleeping zone is not stepped and holds nothing that needs advancing. The first time they are stepped again (the zone woke, or the player came into the room they are in) the existing STALE rule sets them down where the hour says, doing what they would be doing, or still on the way if the block only just began (`sim/folk.ts: settle`). Three hundred people in a town nobody is near cost one comparison each per tick.

**Far workers do the job abstractly.** An actor with work (a task, a queue, an order) is stepped on the 0.5 s beat wherever it is. Tasks are timers and effects, so the work itself needs no change: the tree is felled, the wood is in the pack, the chest fills. What made distant work expensive was walking. Far from the player a walker follows its planned path with no test against other bodies and no yielding (`sim/navigation.ts: walkTo`, `sim/lod.ts: isAbstract`). The path is still a real path over real ground, planned by the same search, so the worker takes as long as it would in sight and, wherever it is when the player turns up, it is standing somewhere it could have walked to. Two abstract walkers set down in the same spot may step out of each other when they become real.

So a worker sent from the halls to a kingdom far to the south walks there (up the stair, across the land, leg by leg), does what it was sent to do, and walks back, at walking pace, whether or not anyone is watching. `tests/overworld.test.ts` holds it: a gather order on the old road with the golem underground, a walk across the overworld, and a town that sleeps and wakes.

With LOD off (`World.lod` null, the default for behaviour tests) everything in the player's area is stepped every tick, as before.

## Navigation at scale

`sim/navigation.ts`, `world/area.ts`. The old search was a breadth-first flood of the whole area, on a grid thrown away whenever anything in the area changed. Three layers replace it, each cached per area and body size:

1. **Cells**, lazily, per sector. A sector is 16 x 16 tiles. `Area.sectorRev` counts the layout changes that can affect each sector (a prop's box, a tile, padded by a body and a step); only those sectors' cells are worked out again. Felling a tree in Westwake costs nothing at the ruins. (Before, any change in an area rebuilt its whole grid.)
2. **Regions**: within a sector, the connected groups of standable cells, linked across sector borders. A* over the region graph answers at once whether somewhere can be reached at all (`reachable`: what orders ask when choosing between many trees or ways out, instead of a path search to each) and gives the **corridor** of regions to pass through.
3. **Tiles**: A* over cells, confined to the corridor. A long trip is planned in **legs** (`planPath`): the tile path for the next `LEG` regions only, and the walker plans again when it gets there. Setting out for somewhere a thousand tiles away costs the same as crossing a street, and the route adapts as the land changes on the way.

Dynamic bodies are never baked in; they are checked while planning and at every swept step, as before.

Collision (`sim/collision.ts: boxFree`) asks the area's **collision buckets** (`Area.blockedBy`, 64 px cells) instead of walking every prop in the area. The overworld holds several thousand props; a query looks at the handful near the box. `tests/overworld.test.ts` checks the bucketed answer against brute force at six thousand points.

Per-tick lists (`world/presence.ts`): the bodies that block and the actors of each area are derived once per tick instead of filtering `World.actors` for every question, and the id-ordered stepping list is sorted once and kept while the same actors are there.

## Saves (v21)

`MIGRATIONS[20]` (`world/save.ts: toOverworld`) folds a v20 save's `town` area into `surface` and translates everything saved in either old map to where that ground now lies: actors, tasks, queued work, orders and their targets, walkers' paths, people's goals, dropped stacks, built props, decals, tile edits, runtime areas hung under them. Town ids gain `westwake/`. References to the town area become references to the surface; a gather order's source gains its zone; townsfolk gain their zone and carry on mid-stride; `census.town` / `census.surface` become `census.westwake` / `census.ruins`. Positions are frozen in the migration (`V21_AT`), never read from the live table.

`tests/support/preOverworld.ts` is the exact inverse, for tests: it rewrites a save of today into the shape v20 had. Tests that make "an old save" by stamping an old version on a current world use it, and `tests/overworld.test.ts` checks the round trip is exact.

## Numbers

On the reference machine, 300 residents in Westwake, mean simulation time per 60 Hz tick:

| Where the golem is | LOD on | LOD off |
| --- | --- | --- |
| In Westwake, among them (`node scripts/soak.mjs --residents 300 --seconds 45 --walk`) | 2.1 ms (p95 2.9 ms) | over budget, as before |
| At the ruins' rune, the town asleep down the road | 0.19 ms | 3.7 ms |

The soak's mean was 2.7 ms (p95 5.4 ms) before v21, with the town an area of its own a third the size: collision buckets and the corridor search more than pay for the larger map. `node scripts/overworldPreview.mjs` renders the whole overworld and the seams between its sites to `.preview/overworld/`.

## Adding a place

1. Write a builder for the site in its own coordinates (`AreaData`, like `oldRoad.ts`). Give it `spots` for the places people use and `tended: true` if lamps are kept.
2. Add its origin to `content/places.ts: SITE_AT` (grow `OVERWORLD_W` / `OVERWORLD_H` if it does not fit) and a row to `overworld.ts: SITES`: zone id, name, kind, id prefix, and `wake` if the default for its kind is wrong.
3. If its road meets a neighbour's through a map edge, add a seam.
4. People: census rows with `area: OVERWORLD_ID, zone: "<id>"`; rounds in `ROUTES["<id>"]`.

Nothing else needs to know. Orders offer it by name, the simulation sleeps and wakes it, paths cross to it.

## Limits to know about

- The view bakes an area's background into one canvas (`view/areaView.ts`), in chunks on demand. At 240 x 72 tiles that is 3840 x 1152 px and fine. A much larger overworld needs that canvas replaced by a cache of chunk canvases; the baking is already chunked and tile-local, so only the storage has to change.
- Regions assume a route may pass through any connected ground. There are no costs for terrain yet (roads are not preferred over meadow).
- `World.actors` is still one array walked once per tick (cheaply). Thousands of far residents are fine; tens of thousands will want per-zone storage.
