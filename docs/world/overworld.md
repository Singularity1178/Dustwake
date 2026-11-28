# The overworld: one surface, sites, zones, discovery, and simulation by distance (v21, v22)

> Index: [docs/index.md](../index.md). Code: `content/places.ts`, `overworld.ts`, `oldRoad.ts`, `world/compose.ts`, `world/zones.ts`, `world/presence.ts`, `world/area.ts` (buckets, sectors), `sim/navigation.ts`, `sim/lod.ts`, `sim/folk.ts`, `sim/jobs.ts`, `sim/orders.ts`, `world/save.ts` (v21), `world/discovery.ts` (v22), `view/areaView.ts` (the chunk cache). Tests: `tests/overworld.test.ts`, `tests/discovery.test.ts`, `tests/chunkView.test.ts`, and the town, folk, shops, routes, timestep and soak suites, which now run on the overworld.

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
| Orders | A gather order names a zone (`fromZone`): "GATHER WOOD FROM THE OLD ROAD". The surface as a whole is too big to be somewhere. `gatherSources` offers an area with zones place by place; `walkOptions` offers each zone by where one arrives in it ("WESTWAKE START"); a walk into a settlement reads "GO TO WESTWAKE". Only zones the golem has been in are offered (Discovery, below). |
| Discovery | A zone is the unit of what the golem knows of the land: walked into, it is on record, with everything that stands in it. |
| People | A census row has a `zone`; a person's home, places, claims and rounds are their zone's (`sim/folk.ts: zoneFor`, `spotsIn`). Census flags are per place (`census.westwake`). |
| Simulation | A zone says how it wakes (below). |
| Presentation | `zoneEntered` (emitted by `stepWorld` when the player walks across a zone's edge, 20 px inside it so a border is never named twice) shows the place's name and, for a settlement, autosaves, as arriving in an area does. Lamps are tended by zone (`tendedAt`), so Westwake's lights keep hours and the camp's fire does not. The golem's "ON RECORD: A VILLAGE. OBSERVED: A TOWN." fires on entering the zone. |
| Debug | The travel menu lists each zone and its named parts under the zone's name. |

Lookups do not walk lists. `zoneAt(area, x, y)` reads a coarse cell index built once per area definition; spots are bucketed per zone.

## Discovery: what the golem knows (v22)

`world/discovery.ts`, `World.discovered` (saved). Tests: `tests/discovery.test.ts`.

**The fault.** Up to v21, "a place the player may name in an order" meant "an area that is loaded". That was already loose (a worker walking into a room loaded it; so did a townsperson going indoors), and it stopped meaning anything once the surface became one area: from the first crossing the surface was "visited", so walk orders offered WESTWAKE START and THE OLD ROAD START, gather orders offered the old road's trees, and (because the shops' doors are portals of the surface now) all six shop interiors, before the golem had taken a step west.

**The rule.** The game keeps a record of where the golem has been, at two levels, like the world itself:

- an **area** is discovered when the golem comes into it (`enterArea`);
- a **zone** of an area made of zones is discovered when the golem walks into it (`sim/step.ts: trackZone`, the moment `zoneEntered` fires: 20 px inside, so a place is known exactly when its name comes up on the screen) or arrives in it.

Only the golem discovers. A worker's travels, townsfolk, a planned route and a test calling `getArea` load areas and reveal nothing. `discover(w, area, zone)` is the only writer, so content can tell the golem of a place without a visit (a signpost, a map sold in a shop, something a townsperson says): one call.

Everything an order screen lists is read from the record, in `sim/orders.ts`, which is the only place the screens get their lists from:

| List | Gate |
| --- | --- |
| `knownAreas` | areas the golem has been in, plus the far end of an open door or road that stands **in a zone the golem has been in** (the signs over Westwake's shop doors are read in Westwake) |
| `walkOptions` | for an area the golem has been in: its start (if that ground is known), each discovered zone's arrival point, known chests, stations and runes. For an area known only by its door: where one comes in, nothing inside, even if a worker has loaded it |
| `gatherSources` | discovered zones only (ground no zone covers goes by the area's name) |
| `storageOptions`, `stationOptions`, `gatherTargets` | props at a known point (`knownAt`): a chest in an unseen town is not offered though it stands in the same area as one that is |

Checked and left alone: the debug travel menu lists every place on purpose (it is a tool; going somewhere with it is arriving there, so it discovers); the high-resolution HUD only lists what is in the golem's own area and view; a worker's "At:" line names its area, never its zone. Orders are gated where they are offered, not where they are accepted: `assignJob` / `setWorkerOrder` still take any valid order, because the simulation, tests and saves give orders too, and an order already running must not stop being valid.

**No "known from its neighbour".** A zone is not known because the one beside it is. Sites are set down by a table, so adjacency is an accident of layout; a wild zone a thousand tiles across would announce every kingdom along its far edge the moment it was stepped into; and "next to" is not "in sight". The old game's version of this rule was about a *thing* (the waymark at the mouth of the road, the sign over a door), and that is kept for things: portals. If a place should be heard of before it is seen, say so with `discover`.

**Old saves** (`MIGRATIONS[21]`, `world/save.ts: toDiscovery`). A v21 save has no record, so one is worked out from what the save shows. Not "everything the old menus offered" (that is the fault: a save made at the ruins with Westwake unseen stops offering Westwake), and not "only where the golem stands" (nobody loses the wood they were already sending a worker for). A place counts if the save shows the golem was there or the player already acting on it: the halls and the surface if present, and on the surface the ruins (one arrives there), the zone the golem stands in, Westwake if its arrival thought has been thought, any zone the golem built in, any zone a saved order names, and the old road if Westwake counts (it was the only way). A shop's room being in the save is **not** evidence (townsfolk load rooms going about their day); it counts with the golem standing in it, something built in it, or an order naming it. The land is frozen in the migration as v21 had it.

Cost: a set lookup per question; one comparison per tick for the player. Nothing walks a list of zones.

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

## The view at scale: a cache of chunk canvases

`view/areaView.ts`, `world/area.ts` (`propsIn`, `propsOfKind`), `art/decals.ts` (`decalsNear`). Tests: `tests/chunkView.test.ts`.

The background used to be one canvas covering the area. Browsers cap a canvas at somewhere between 8k and 32k px a side (and far less area on phones), so that design ended at roughly 500 to 2000 tiles; the surface is meant to go well past that. It is now a cache:

- The ground is baked in 8 x 8 tile chunks (128 px), each into its own canvas. The bake is the same function, given the chunk's origin (`bakeRegion(..., ox, oy)`), so a chunk is pixel for pixel the ground the whole-area canvas held.
- `prepare` bakes whatever the camera can see that is not held, before the frame is drawn: nothing is ever seen unbaked.
- `idle` bakes one chunk a frame in a margin two chunks deep around the view (`AHEAD`), nearest first and the side the camera is heading toward before the others. It stops when the margin is ready. Nothing bakes the rest of the area. Two chunks is 256 px, which also covers zooming all the way out from the closest view.
- Chunks are dropped, least recently in view first and never from the view or its margin, once the cache holds more than twice what the view and margin need. Their canvases are reused, so walking allocates nothing. At the widest zoom the cache tops out around 160 chunks, about 10 MB; the old canvas for today's surface was 17.7 MB and grew with the land.
- A change to the world re-bakes only the part of each cached chunk it touches, and costs nothing where no chunk is held. Changes are no longer unioned into one rect: before, two changes a long way apart in the same frame re-baked all the land between them.
- `draw` copies the chunks under the camera, whole pixels, unscaled: no seams.

What else in a frame scaled with the area, and no longer does:

| Was | Now |
| --- | --- |
| the renderer walked every prop of the area twice a frame, the host twice more (embers, smoke), a click once | `Area.propsIn(rect)`: props by 128 px cell, returned in the area's own order (so draw order, and ties in it, are unchanged); `propsOfKind` for the rune circles |
| every light of the area was culled, flickered and handed to the accumulator each frame; `byId` searched them three times a frame | `AreaView.lightsNear(rect)`: a grid over the static lights, the moving ones apart, returned in registry order (the lit frame is the same sum); `byId` is a map |
| each chunk bake walked every decal of the area; adding one decal re-measured all of them | `decalsNear`: a grid over decal bounds, extended as decals are appended |

`tests/chunkView.test.ts` holds it on a canvas that really stores pixels (`tests/support/rasterCanvas.ts`): every frame equal to the old single canvas's, anywhere on the overworld, at every zoom, at and past the edges, after the world changes and after chunks have been dropped and re-baked; the cache within capacity across a walk of the whole land and back; `prepare` never baking while walking; and an area 8192 tiles a side (131072 px) costing what the surface costs.

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

- The view's lights are reconciled with the world by walking the area's lights and props (`AreaView.syncLights`) whenever a prop's state changes anywhere in the area. Per frame nothing walks them, but a lamp lit in a far town still costs one pass here. The fix is the same as for the background: derive lights per region near the camera. Loose items on the ground (`Area.loose`) are still one list walked per frame.
- An `Area` still holds its tiles as flat arrays (four bytes a tile) and builds the whole of itself up front. That is fine for thousands of tiles a side (8192 x 8192 is 270 MB and is what the view test uses) and not for a continent: past that the area itself needs to be built and held by region, like its background now is.
- Chest and station names number a kind across the whole area ("SURFACE CHEST 3"), so the number can hint at chests in places not yet seen. Naming them by zone would fix it and rename every existing chest; not done here.
- `portalsOf(area)` is a list (`portalAt` and `knownAreas` walk it). Six doors today; a land of towns will want portals bucketed by zone.
- Regions assume a route may pass through any connected ground. There are no costs for terrain yet (roads are not preferred over meadow).
- `World.actors` is still one array walked once per tick (cheaply). Thousands of far residents are fine; tens of thousands will want per-zone storage.
