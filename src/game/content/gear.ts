// Gear slots (data). Everything the pack screen, the wear/take-off rules and
// the debug kit know about the golem's body slots is a row here:
//   - which slots exist and what kind of item each takes,
//   - which are usable (an optional unlock Requirement: a world flag, an item
//     carried, an item worn) and why a locked one is locked.
// Nothing counts "usable slots": a slot is usable when its requirement is met,
// so unlocking one later is a data/state change (set its flag), not a code one.
import type { Requirement } from "./interactions";
import { FLAGS } from "./flags";

/** What a gear item declares it fits (ItemDef.wear.kind). */
export type GearKind = "back" | "head" | "arm" | "core" | "rune";

/** Body slots an actor wears gear in (Actor.gear is keyed by these). */
export type GearSlot = "back" | "head" | "armR" | "armL" | "core" | "rune0" | "rune1" | "rune2" | "rune3";

export interface GearSlotDef {
  id: GearSlot;
  kind: GearKind;
  /** Short label (bitmap font: uppercase, FONT_GLYPHS). */
  name: string;
  /** Up to 3 lines (at most 34 characters each) for the description panel while the slot is usable (locked slots use `locked`). */
  hint?: string[];
  /** Requirement to use the slot. Absent: always usable. */
  unlock?: Requirement;
  /** Why it is locked, shown with the cursor on it: the first entry whose `when` is met (or has none) wins. Same 3 x 34 limits. */
  locked?: { when?: Requirement; text: string[] }[];
}

const SEALED = ["THIS RUNE SLOT IS SEALED.", "SOMETHING WILL OPEN IT", "LATER."];

/**
 * Slot order is also the order a gear kind fills its slots in (the first empty
 * usable slot of the kind takes a new item).
 *
 * Which side is which: the golem's LEFT arm is the damaged one, the broken stub
 * the iron arm replaces (golem.ts draws it on screen-right facing down); its
 * RIGHT arm is the sound stone one. The right arm is usable now. The left arm
 * is locked by its own flag, NOT by `golem.arm`: the iron arm stays what it
 * always was (an installed body part that sets `golem.arm`, never a slot item),
 * and the slot opens when a proper arm exists to take fittings.
 */
export const GEAR_SLOT_DEFS: readonly GearSlotDef[] = [
  { id: "head", kind: "head", name: "HELM", hint: ["A BARE HEAD.", "A HELM WOULD FIT HERE."] },
  { id: "back", kind: "back", name: "BACK", hint: ["NOTHING ON YOUR BACK.", "WEAR A BASKET FROM THE PACK."] },
  { id: "armR", kind: "arm", name: "R ARM", hint: ["THE SOUND STONE ARM.", "FITTINGS FOR AN ARM GO HERE."] },
  {
    id: "armL", kind: "arm", name: "L ARM", unlock: { flags: [FLAGS.slotArmLeft] },
    locked: [
      { when: { flags: [FLAGS.golemArm] }, text: ["THE IRON ARM IS BOLTED ON.", "IT TAKES NO FITTINGS YET."] },
      { text: ["A BROKEN STUB. NOTHING CAN", "BE FITTED TO IT YET."] },
    ],
  },
  { id: "core", kind: "core", name: "CORE", hint: ["A MOUNT BESIDE THE CORE.", "FOR ATTACHMENTS TO IT, NOT", "THE AETHER CORE ITSELF."] },
  { id: "rune0", kind: "rune", name: "RUNE 1", hint: ["AN OPEN RUNE SLOT.", "WEAR A RUNE FROM THE PACK."] },
  { id: "rune1", kind: "rune", name: "RUNE 2", unlock: { flags: [FLAGS.slotRune1] }, locked: [{ text: SEALED }] },
  { id: "rune2", kind: "rune", name: "RUNE 3", unlock: { flags: [FLAGS.slotRune2] }, locked: [{ text: SEALED }] },
  { id: "rune3", kind: "rune", name: "RUNE 4", unlock: { flags: [FLAGS.slotRune3] }, locked: [{ text: SEALED }] },
];

export const GEAR_SLOTS: readonly GearSlot[] = GEAR_SLOT_DEFS.map((d) => d.id);
export const slotDef = (id: GearSlot): GearSlotDef => GEAR_SLOT_DEFS.find((d) => d.id === id)!;
/** The slots that take a kind of gear, in fill order. */
export const slotsOfKind = (kind: GearKind): GearSlot[] => GEAR_SLOT_DEFS.filter((d) => d.kind === kind).map((d) => d.id);
export const RUNE_SLOTS: readonly GearSlot[] = slotsOfKind("rune");

// ---------------------------------------------------------------- tunables
/**
 * RUNE OF SWIFT: "increases speed by 150%". Read literally as +150%, i.e. 2.5x
 * the base speed (the repo's own debug super-speed note reads "200% faster = 3x"
 * the same way). Effects add: the speed multiplier is 1 + the sum of the worn
 * bonuses. This is the one number to change.
 */
export const RUNE_SWIFT_SPEED_BONUS = 1.5;

/** The golem's own glow (it used to be hard-coded in the host). */
export interface GolemLight { rad: number; col: [number, number, number]; int: number }
export const GOLEM_LIGHT: GolemLight = { rad: 108, col: [1, 0.78, 0.5], int: 1 };
/** RUNE OF GLOW: a bright white light in a wider radius than the standard glow. */
export const RUNE_GLOW_LIGHT: GolemLight = { rad: 176, col: [1, 1, 1], int: 1.25 };
