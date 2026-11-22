# Townsfolk (v18)

> Split out of the old single `ARCHITECTURE.md` (Phase 0.9). Index: [docs/index.md](../index.md).

## Townsfolk (v18)
Westwake and the north-west wood are lived in: twenty generic NPCs, seventeen in the town and three at a hunters' camp. The work was interrupted before it was finished; finishing it found two bugs seen in play, both fixed below. `tests/folk.test.ts` holds all of it.

### What they are

- **Data (`content/folk.ts`).** A person is an `ARCHETYPES` row (what they do: the watch, labourer, apprentice, adventurer, resident, elder, hunter, forager), two `TRAITS` from different groups (dials the runner reads: an early riser's day runs early, a thirsty one stays at the tavern, the reserved talk less, the curious come to look), a name from `NAMES` and a generated look, living by a `ROUTINES` row: blocks of the day, each an activity and a place query (spot kinds, an id prefix, how near home). `CENSUS` says who lives where (area, archetype, home), `ROUTES` the watch's rounds. A person, an archetype, a trait or a routine is a row; a new activity is a case in `sim/folk.ts`. The routines must tile the day, every trait's stretch included (tested).
- **Actors (`sim/folk.ts`).** A person is an ordinary Actor of kind `folk` (definition `townsfolk`) with `person` (who: made once from the world seed by hash, never from `w.rng`, so the story's draws are untouched) and `life` (what they are doing now: saved, so a load resumes mid-stride). `getArea` makes an area's people on its first instantiation (`populateFolk`, once, under the `census.<area>` flag: whatever becomes of someone after that is theirs). They are soft: `actorBox` gives them no box, so they never block the golem or a worker; they steer round, step aside when walked at (`makeWay`) and never stop in a doorway.
- **The plan comes from the clock** (`planAt`): the routine at the person's own hour (traits and a small daily jitter shift it), so nobody has to be caught up. Only the player's area is stepped; everyone else waits, and a person not simulated for `STALE` seconds is set down where the hour says (`settle`) when the golem arrives. The tavern block takes its drinkers into the tavern's room (`FOLK_INTERIORS`), by the door if it has only just begun. A task or order (the ordinary work system) outranks a `duty` (an activity at a place until a time: the seam for contracts and recruitment), which outranks the routine.
- **Between the hours.** Roving activities (patrol, errands, work, chores, hunting, foraging, a stroll) move on after each stop; the rest stay and fidget. The watch's day shift lights and douses the fire lights in the order `litLevel` gives them, one round for each side of the town. They chat among themselves (a pictogram of one of their topics in a bubble: `folkChat`), notice the golem (a glance, a wave, a step back, a closer look) and answer it: E on someone is `RULES.folk`, whose `folkTalk` effect turns them to the golem and says one of their lines (archetype, traits, what they are doing) in a speech bubble, with their name and trade as a note. Whoever is indoors (`folkPresent` false) is not drawn, scanned or talked to. The camp sleeps outdoors, on its bedrolls, in sight (its homes are `bed` spots, not doors).
- **Presentation.** `folkArt.ts` paints a person from look, garb and pose into a pixel grid, outlines it and caches the sprite by everything that changes a pixel. `view/actors.ts: folkArtPose` adds the timing (step, motion frame, blink); the host draws speech bubbles, pictograms and sleepers' Zs on the world layer, and the watch's lantern lights the street round them after dark.
- **The camp (`surface.ts`).** In the clearing in the north-west wood, out of sight of the rune and the stair: a lit campfire, a lean-to, a pelt rack, a seat log and three bedrolls, with bed, camp, hunt and forage spots, all by fixed positions and after everything else, so nothing else in the wild moved. `buildSurface({ camp: false })` is the wild as it was. The fire's light, like every prop's light in every builder, names its owner and has no `id`: that was the id-less light `tests/wild.test.ts` tripped over. The test was wrong, not the code: it now holds the camp-less wild to the old rule and checks that the camp adds one light, the fire's, nowhere near the rune or the stair head.

### Places held one at a time (bug)

Seen in play: two apprentices hammering at one anvil, overlapping, walking into each other. `pick` chose a place by hash and skipped places others held, but when nothing else was free it fell back on its first candidate, whoever held it. Since a roving person never re-picks the place they are at, two apprentices with exactly two anvils were each sent to the other's anvil and crossed on the way. Sharing was also decided per activity, not per place: a stroll shared everything, benches included, and the gate's two watch posts were shared by whoever stood post.

- **Exclusivity is data:** `EXCLUSIVE_KINDS` (seat, bench, work, chore, bed, camp, hunt, forage, stall, customer, keeper, gather) and `EXCLUSIVE_IDS` (the `watch.` posts). `Life.spot` is the claim, held while at the place or on the way to it. Meeting places, a stroll's corners, the rounds and doorsteps stay shared (a knot, each person jittered off the spot).
- **`pick` never falls back on a held place.** With nowhere else free a person keeps the place they hold, else gets none, stands where they are and looks again a few seconds later. A lamplighter skips a lamp the other holds. A pause on the way (a dawdle, a chat, a step aside) now carries on to the place, where before the place's pose was struck wherever the pause happened (people sat down on the cobbles).
- **Across a save:** the claims are `Life.spot`, saved with the actor, so a load holds exactly what was held. `Life.seen` starts at a finite "never": it used to be `-Infinity`, which a save turned into `null`.

### Heads (bug)

Seen in play: townsfolk looking straight back over their own backs. A glance at the golem set the head to wherever the golem was (`faceTo`), whatever the body faced. Behind someone seated, working, drinking or chatting, the head turned 180 degrees; a person stepping aside walked one way and looked the other; a head set before the body turned stayed set. Seated people in a chat also turned their whole body round on the seat to face each other. The painter drew whatever head it was given.

- `naturalHead(facing, head)` is the rule: a quarter turn either way, never round to the back. `gazeAt(facing, dx, dy)` looks at something within it, over the shoulder on its side when it is behind. Every glance, step aside and chat uses them. A seated body (or one warming at the fire) keeps its seat and turns its head, and a head left over from before a turn is taken back at the end of every tick. `folkArt.ts` (and `folkArtPose`) apply the same rule when painting, so no caller can draw an owl.
- Also finished from the interrupted work: a drawn bow is side-on (hunters were turned on arriving at a blind, but not when set down by the hour), and a look about lasts a moment instead of a single frame.

### Saves (v18)

`SAVE_VERSION` is 18. Actors may carry `person` and `life`, and the world `census.<area>` flags. `MIGRATIONS[17]` only bumps the version: `deserialize` calls `populateFolk` for every area a save has visited, so a pre-v18 save's town and camp are lived in on load, from its own seed, while a v18 save (its flags set) is untouched.

### Tests and tools

- `tests/folk.test.ts` covers:
  - **Data:** routines tile the day, traits included; census rows, routes and every place query resolve in their areas.
  - **Making people:** from the seed (deterministic, another seed another town, unique names, trait groups, the rng untouched); the census made once, its flag saved, soft bodies.
  - **The day:** the plan by the hour and the tavern's room; settling at 02:00 (the town abed and hidden, the night watch out, the camp asleep on its bedrolls); a duty walked to over open ground, then lapsing; a chat (they face each other, pictograms of their topics, they part); talk; making way.
  - **Saves:** the v17 to v18 path (`deserialize` calling `populateFolk`, unvisited areas, a v18 save untouched); a save and load mid-stride carrying on identically.
  - **Heads:** every garb, pose and facing painted (a head asked to look behind paints as straight ahead, a quarter turn shows); in play, the golem circling and walking at someone in twelve poses and four facings; two seated people chatting with the golem behind them.
  - **Places:** the whole town made apprentices for a morning (seventeen people, two anvils) and labourers for an evening (eleven stools). A long run (a whole day in the town, saved and loaded at noon, an evening in the tavern, a day at the camp) checks every tick that no exclusive place is held or stood at by two people, that no head turns round and that every bow is side-on.
  - Both bug tests fail when run against the code as it was.
- `node scripts/folkPreview.mjs` renders to `.preview/folk/*.png`: a sprite sheet (every archetype, look, facing and pose), a sheet of heads, the real host in the town, the tavern and the camp at several hours, scan mode, and close-ups (the anvils, a bench, the camp asleep).
  - Scan mode used to crash it (`ctx.fill is not a function`). The fault was the snapshot canvas (`tests/support/uiSnapshot.ts`), not the game: it had no paths and a `restore()` that did nothing. It now fills rect paths as their union and keeps a state stack. The folk preview's canvas also does the `saturation` blend, so the scan shot is the game's. `view/vision.ts` is unchanged.
- Tests changed for townsfolk:
  - `tests/wild.test.ts`: as above.
  - `tests/entrance.test.ts`: the stair head is the surface's only doorstep; the camp's places are not its business.
  - `tests/town.test.ts`: no longer "nobody lives here yet". The census's townsfolk are the only people, all of them, none a golem, a shopkeeper or a dialogue NPC.
  - `tests/rockArt.test.ts` and the comments beside the other `SAVE_VERSION` pins now name v18.

**Left alone on purpose.**
- `world/world.ts` and `world/save.ts` import `populateFolk` from `sim/folk.ts`, the first `world -> sim` import. Moving person-making into `world/` would restore the boundary.
- Entering the tavern before the town (only possible with the debug teleport) finds it empty until the town is visited.
