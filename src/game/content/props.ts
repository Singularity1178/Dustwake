// Prop kind definitions (data). Sprites stay procedural in art.ts (keyed by
// kind); behaviour that used to be scattered `kind === "..."` checks in the game
// class lives here.

export interface PropLightDef {
  dx: number; dy: number; rad: number; col: [number, number, number]; int: number; flick: number;
  /** "lit": only emitted while the prop is lit. "always": emitted unconditionally. */
  when: "lit" | "always";
}

export interface PropKindDef {
  /** Collision footprint [w, h], centred on x, ending at y. */
  box?: [number, number];
  /** Sorted just in front of the wall it hangs on. */
  wallMounted?: boolean;
  /** Which state selects the alternate sprite. Default "open". */
  alt?: "lit" | "taken" | "open";
  light?: PropLightDef;
  /** Fire visuals while lit. */
  fire?: { big: boolean; embers: number; emberDy: number };
  /** Horizontal offset of an item icon resting on the prop. */
  itemDx?: number;
  /** A teleportation rune site (see content/runes.ts). Drawn as a floor circle, not a sprite. */
  rune?: boolean;
  /** Interacting shows this text (ruins, landmarks). */
  examine?: string;
  /** Lies flat on the ground: always drawn beneath actors. */
  flat?: boolean;
}

export const PROPS: Record<string, PropKindDef> = {
  bookshelf: { box: [16, 8] }, shelfrow: { box: [16, 10] }, shelf_fallen: { box: [28, 10] }, table: { box: [28, 10] },
  lectern: { box: [10, 6] }, chair: { box: [8, 5] }, bed: { box: [14, 26] }, footlocker: { box: [12, 6] },
  weaponrack: { box: [24, 6] }, limbrack: { box: [22, 6], alt: "taken" }, armorstand: { box: [10, 5] },
  barrel: { box: [12, 7] }, crate: { box: [14, 8] }, statue: { box: [18, 10] }, statue_fallen: { box: [30, 10] },
  throne: { box: [30, 14] }, maptable: { box: [28, 10], alt: "taken" }, altar: { box: [30, 10] }, pew: { box: [36, 6] },
  workbench: { box: [32, 10], itemDx: -6 }, forge: { box: [32, 12] }, anvil: { box: [14, 6] }, cradle: { box: [28, 5] },
  slab: { box: [36, 10] }, hearth: { box: [36, 10] }, longtable: { box: [50, 10] }, bench: { box: [44, 4] },
  chest: { box: [16, 8] }, pot: { box: [10, 6] }, fountain: { box: [32, 14] }, pedestal: { box: [10, 5] },
  sack: { box: [10, 5] }, parts: { box: [16, 5] },
  brazier: {
    box: [12, 6], alt: "lit",
    light: { dx: 0, dy: -4, rad: 96, col: [1, 0.58, 0.3], int: 0.9, flick: 0.2, when: "lit" },
    fire: { big: true, embers: 4, emberDy: 0 },
  },
  torch: {
    wallMounted: true, alt: "lit",
    light: { dx: 0, dy: 6, rad: 84, col: [1, 0.62, 0.32], int: 0.85, flick: 0.22, when: "lit" },
    fire: { big: false, embers: 1.5, emberDy: 1 },
  },
  mushrooms: { light: { dx: 0, dy: -3, rad: 44, col: [0.35, 0.95, 0.8], int: 0.55, flick: 0.04, when: "always" } },
  banner: { wallMounted: true },
  // ---- surface
  tree: { box: [10, 6], alt: "taken" },
  rock: { box: [16, 8], alt: "taken" },
  torch_post: {
    box: [6, 4], alt: "lit",
    light: { dx: 0, dy: -14, rad: 96, col: [1, 0.62, 0.32], int: 0.9, flick: 0.22, when: "lit" },
    fire: { big: false, embers: 1.5, emberDy: -2 },
  },
  cart: { box: [30, 10] },
  buriedgate: { box: [56, 14], examine: "THE SURFACE GATE. BURIED UNDER EARTH AND RUBBLE." },
  grate: { flat: true, examine: "AN IRON GRATE. COLD AIR RISES FROM THE HALLS BELOW." },
  runesite: { rune: true },
  runecircle: { rune: true },
  chains: { wallMounted: true },
};

const NONE: PropKindDef = {};
export const propDef = (kind: string): PropKindDef => PROPS[kind] ?? NONE;

/** Interaction radius used for props (matches the original tuning). */
export const propReach = (kind: string) => Math.min(30, 12 + (propDef(kind).box?.[0] ?? 12) / 2);
