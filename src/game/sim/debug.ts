// Debug kits (testing only, not part of the game's rules): the same pure sim
// functions the tests call, so what the Ctrl+6 key does is checked headless.
import { FLAGS, NPC_AWAKE, npcFlag } from "../content/flags";
import { RECIPES } from "../content/build";
import { analysisFlag } from "../content/vision";
import { ACTORS, actorDef } from "../content/actors";
import { ITEMS, ITEM_IDS, glyphItem, type ItemId } from "../content/items";
import { GLYPHS } from "../content/glyphs";
import { RUNE_NODES } from "../content/runes";
import { AREA_NAMES } from "../content/geography";
import { npcDef } from "../content/npcs";
import { TS } from "../content/tiles";
import { AREAS } from "../world/areas";
import { player, setActorFlag, setFlag, clearFlag, hasFlag, enterArea, getArea, areaOf, type Actor, type World } from "../world/world";
import { countItem, giveItem, addItems, removeItems, heldItems, dropSpot, spawnLoose } from "./inventory";
import { actorBoxes, boxFree } from "./collision";
import { ensureWorn, reconcileGear, wears } from "./gear";

/** What the gear kit tops the pack up to (wood and stone, the crafted materials, the chisel for carving). */
export const GEAR_KIT: [ItemId, number][] = [["wood", 40], ["stone", 40], ["planks", 40], ["cut_stone", 40], ["chisel", 1]];
/** One of each: worn or carried, the kit never hands out a second. */
export const GEAR_KIT_RUNES: ItemId[] = ["rune_swift", "rune_glow"];

/** Every flag that unlocks a gear slot (read from the slot rows, so a new locked slot is covered with no change here). */
export const slotUnlockFlags = (a?: Actor): string[] => Object.values((a ? actorDef(a) : ACTORS.golem).gearUnlocks ?? {}).flatMap((r) => r?.actorFlags ?? []);

/** Debug only (Ctrl+4, Ctrl+6): every analysis-gated plan read, from the live catalog. Saves never do this. */
export function learnAllPlans(w: World) {
  for (const r of Object.values(RECIPES)) if (r.analysis) w.flags.add(analysisFlag(r.analysis));
}

/** Are all the slots that can be unlocked, unlocked? */
export const allSlotsUnlocked = (w: World, a = player(w)) => slotUnlockFlags(a).every((f) => a.upgrades.includes(f));

/**
 * Ctrl+6, a toggle. ON: building knowledge (and masonry, for the brazier), the
 * basket worn so everything fits, the materials topped up (never stacked past
 * the target on a second press), the rune chisel, both runes (unless already
 * held or worn), and every locked gear slot unlocked (the second arm and the
 * other three rune slots). OFF: the slots lock again; anything worn in them
 * goes back to the pack (nothing is deleted). Materials and runes stay.
 * Returns whether the kit is now ON.
 */
export function toggleGearKit(w: World, a: Actor): boolean {
  if (allSlotsUnlocked(w, a)) {
    for (const f of slotUnlockFlags(a)) setActorFlag(a, f, false);
    reconcileGear(w, a);
    return false;
  }
  setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.knowMasonry); learnAllPlans(w);
  ensureWorn(w, a, "basket");
  for (const [item, n] of GEAR_KIT) { const have = countItem(a, item); if (have < n) giveItem(w, a, item, n - have); }
  for (const r of GEAR_KIT_RUNES) if (!wears(a, r) && countItem(a, r) === 0) giveItem(w, a, r, 1);
  for (const f of slotUnlockFlags(a)) setActorFlag(a, f);
  return true;
}

// ---------------------------------------------------------------- debug menu (Ctrl+0)
// Everything the debug menu does to the world lives here as pure sim functions,
// so tests run them headless. The menu (screens/debug.ts) only picks and displays.
/** The number of units of an item held in the pack, plus worn (the menu shows both). */
export const heldCount = (a: Actor, id: ItemId) => countItem(a, id) + (wears(a, id) ? 1 : 0);

/** What a summon did, for the menu's status line. */
export type SummonResult = { ok: boolean; text: string };

/**
 * Summon `n` of an item into the pack (what does not fit lands on the ground
 * beside the golem, as every pickup does). Body parts that install themselves
 * (the iron arm) are installed instead of packed, like picking them up.
 */
export function summonItem(w: World, a: Actor, id: ItemId, n: number): SummonResult {
  const def = ITEMS[id];
  if (def.equip) { setActorOrWorldFlag(w, a, def.equip.flag, true); return { ok: true, text: `${def.name} INSTALLED` }; }
  n = Math.max(1, Math.floor(n));
  const before = countItem(a, id);
  giveItem(w, a, id, n);
  const stored = countItem(a, id) - before;
  return { ok: true, text: stored >= n ? `+${n} ${def.name}` : `+${stored} PACKED, ${n - stored} ON THE GROUND` };
}

/** Summon `n` of an item onto the ground in front of the golem (stacks merge up to their stack size). */
export function summonLoose(w: World, a: Actor, id: ItemId, n: number): SummonResult {
  const def = ITEMS[id];
  if (def.equip) return { ok: false, text: `${def.name} CANNOT LIE ON THE GROUND` };
  const area = areaOf(w, a);
  const spot = dropSpot(area, a, actorBoxes(w, area.id, a.id));
  if (!spot) return { ok: false, text: "NO ROOM ON THE GROUND HERE" };
  n = Math.max(1, Math.floor(n));
  spawnLoose(area, id, n, spot.x, spot.y);
  return { ok: true, text: `${n} ${def.name} ON THE GROUND` };
}

/** Delete up to `n` of an item from the pack. Returns how many went. */
export function deleteItem(a: Actor, id: ItemId, n: number): number {
  const k = Math.min(n, countItem(a, id));
  if (k > 0) removeItems(a, id, k);
  return k;
}

/** Empty the pack (worn gear stays on). Returns the number of units removed. */
export function clearPack(a: Actor): number {
  let n = 0;
  for (const id of new Set(heldItems(a))) n += deleteItem(a, id, countItem(a, id));
  return n;
}

/** Every item with a stack size above one, topped up to `to` in the pack (what does not fit lands on the ground). */
export function fillMaterials(w: World, a: Actor, to = 40) {
  for (const id of ITEM_IDS) {
    if (!ITEMS[id].tags.includes("material")) continue;
    const have = countItem(a, id);
    if (have < to) giveItem(w, a, id, to - have);
  }
}

/** The story kit (Ctrl+2): every rune glyph, the aether core, the chisel and the schematic, skipping what is held or placed. Returns how many were given. */
export function grantStoryKit(w: World, a: Actor): number {
  const r = areaOf(w, a).ritual;
  let given = 0;
  const give = (id: ItemId) => { addItems(w, a, id, 1); given++; };
  for (let g = 0; g < GLYPHS.length; g++) {
    const id = glyphItem(g);
    if (countItem(a, id) > 0 || r?.sockets.includes(g)) continue;
    give(id);
  }
  if (countItem(a, "core") === 0 && !r?.core) give("core");
  for (const id of ["chisel", "schematic"] as ItemId[]) if (countItem(a, id) === 0) give(id);
  return given;
}

/** The build kit (Ctrl+4): every build flag and plan, the basket worn, 40 of each raw and crafted material. */
export function grantBuildKit(w: World, a: Actor) {
  setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.knowMasonry); learnAllPlans(w); ensureWorn(w, a, "basket");
  for (const id of ["wood", "stone", "planks", "cut_stone"] as ItemId[]) addItems(w, a, id, 40);
}

/** Set a flag wherever it lives: body flags (the arm, the slots) on the actor, the rest on the world. */
function setActorOrWorldFlag(w: World, _a: Actor, f: string, on: boolean) { if (on) setFlag(w, f); else clearFlag(w, f); }

export const flagOn = (w: World, f: string) => hasFlag(w, f);

/** Unlock every gear slot (true) or lock them all again (false: worn items go back to the pack). */
export function setAllSlots(w: World, a: Actor, on: boolean) {
  for (const f of slotUnlockFlags(a)) setActorFlag(a, f, on);
  if (!on) reconcileGear(w, a);
}

/** One row of the debug menu's flag list. */
export interface DebugFlag { flag: string; label: string; group: "BODY" | "KNOWLEDGE" | "STORY" | "RUNES" | "PLANS" | "NPCS" }

const pretty = (s: string) => s.replace(/[._]/g, " ").toUpperCase();

/** Every flag the game reads that can be toggled: the FLAGS table, the rune sites, every analysis plan and each NPC's awake state. */
export function debugFlags(w: World): DebugFlag[] {
  const out: DebugFlag[] = [];
  const seen = new Set<string>();
  const add = (flag: string, label: string, group: DebugFlag["group"]) => { if (!seen.has(flag)) { seen.add(flag); out.push({ flag, label, group }); } };
  const group = (f: string): DebugFlag["group"] => (f.startsWith("golem.") ? "BODY" : f.startsWith("know.") ? "KNOWLEDGE" : "STORY");
  for (const f of Object.values(FLAGS)) add(f, pretty(f), group(f));
  for (const n of Object.values(RUNE_NODES)) add(n.flag, `RUNE: ${n.name}`, "RUNES");
  const keys = new Set<string>();
  for (const r of Object.values(RECIPES)) if (r.analysis) keys.add(r.analysis);
  for (const k of keys) add(analysisFlag(k), `PLAN: ${pretty(k)}`, "PLANS");
  for (const a of w.actors) if (a.kind === "npc") add(npcFlag(a.id, NPC_AWAKE), `${npcDef(a.npc)?.name ?? pretty(a.id)} AWAKE`, "NPCS");
  // Anything else already set on the world (a flag a newer feature added) is listed too, so nothing is hidden.
  for (const f of [...w.flags].sort()) add(f, pretty(f), group(f));
  return out;
}

/** A place the debug menu can send the golem. */
export interface DebugPlace { label: string; group: string; area: string; x: number; y: number }

const startCache = new Map<string, { x: number; y: number }>();
const areaName = (id: string) => AREA_NAMES[id] ?? id.toUpperCase();

/**
 * Every place worth jumping to: each area's start, its rooms, the rune sites
 * and circles, and every other actor standing in it. Areas not visited yet
 * offer just their start (read from the pure builder, never instantiated here,
 * so opening the menu changes nothing in the world).
 */
export function debugPlaces(w: World): DebugPlace[] {
  const out: DebugPlace[] = [];
  for (const id of Object.keys(AREAS)) {
    const name = areaName(id), area = w.areas.get(id);
    if (!area) {
      if (!startCache.has(id)) startCache.set(id, AREAS[id]().start);
      const s = startCache.get(id)!;
      out.push({ label: `${name}: START (NEW AREA)`, group: name, area: id, x: s.x, y: s.y });
      continue;
    }
    out.push({ label: `${name}: START`, group: name, area: id, x: area.start.x, y: area.start.y });
    for (const r of area.rooms) out.push({ label: `${name}: ${r.name}`, group: name, area: id, x: (r.x + r.w / 2) * TS, y: (r.y + r.h / 2) * TS });
    if (area.base.ritual) out.push({ label: `${name}: CIRCLE`, group: name, area: id, x: area.base.ritual.x, y: area.base.ritual.y + 36 });
    for (const n of Object.values(RUNE_NODES)) {
      const p = n.area === id ? area.prop(n.prop) : undefined;
      if (p) out.push({ label: `${name}: RUNE ${n.name}`, group: name, area: id, x: p.x + n.arrive.dx, y: p.y + n.arrive.dy });
    }
    for (const a of w.actors) if (a.area === id && a.id !== w.playerId) out.push({ label: `${name}: ${npcDef(a.npc)?.name ?? actorDef(a).name}`, group: name, area: id, x: a.x, y: a.y + 14 });
  }
  return out;
}

/**
 * Put the actor at (x, y) in an area, nudged to the nearest free spot (a ring
 * search, so a room's centre that holds a table still works). Crosses areas
 * through enterArea. False (and nothing moves) if no free spot is near.
 */
export function teleportTo(w: World, a: Actor, areaId: string, x: number, y: number): boolean {
  if (!AREAS[areaId]) return false;
  const area = getArea(w, areaId);
  const bodies = actorBoxes(w, areaId, a.id), size = actorDef(a).body.box;
  let spot: { x: number; y: number } | null = null;
  for (let r = 0; r <= 12 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) for (let dx = -r; dx <= r && !spot; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const px = Math.round(x + dx * 4), py = Math.round(y + dy * 4);
      if (boxFree(area, px, py, bodies, size)) spot = { x: px, y: py };
    }
  }
  if (!spot) return false;
  if (a.area !== areaId) enterArea(w, a, areaId, spot.x, spot.y);
  a.x = spot.x; a.y = spot.y; a.vx = 0; a.vy = 0;
  a.task = null; a.queue = [];
  return true;
}
