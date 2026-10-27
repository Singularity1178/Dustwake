// Debug kits (testing only, not part of the game's rules): the same pure sim
// functions the tests call, so what the Ctrl+6 key does is checked headless.
import { FLAGS } from "../content/flags";
import { GEAR_SLOT_DEFS } from "../content/gear";
import type { ItemId } from "../content/items";
import { clearFlag, setFlag, type Actor, type World } from "../world/world";
import { countItem, giveItem } from "./inventory";
import { ensureWorn, reconcileGear, wears } from "./gear";

/** What the gear kit tops the pack up to (wood and stone, the crafted materials, the chisel for carving). */
export const GEAR_KIT: [ItemId, number][] = [["wood", 40], ["stone", 40], ["planks", 40], ["cut_stone", 40], ["chisel", 1]];
/** One of each: worn or carried, the kit never hands out a second. */
export const GEAR_KIT_RUNES: ItemId[] = ["rune_swift", "rune_glow"];

/** Every flag that unlocks a gear slot (read from the slot rows, so a new locked slot is covered with no change here). */
export const slotUnlockFlags = (): string[] => GEAR_SLOT_DEFS.flatMap((d) => d.unlock?.flags ?? []);

/** Are all the slots that can be unlocked, unlocked? */
export const allSlotsUnlocked = (w: World) => slotUnlockFlags().every((f) => w.flags.has(f));

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
  if (allSlotsUnlocked(w)) {
    for (const f of slotUnlockFlags()) clearFlag(w, f);
    reconcileGear(w, a);
    return false;
  }
  setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.knowMasonry);
  ensureWorn(w, a, "basket");
  for (const [item, n] of GEAR_KIT) { const have = countItem(a, item); if (have < n) giveItem(w, a, item, n - have); }
  for (const r of GEAR_KIT_RUNES) if (!wears(a, r) && countItem(a, r) === 0) giveItem(w, a, r, 1);
  for (const f of slotUnlockFlags()) setFlag(w, f);
  return true;
}
