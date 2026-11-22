// Settings and accessibility (pure model; storage injected). One registry: a
// later feature registers its options here (registerSetting) and they appear on
// the settings screen (screens/system.ts) and are saved with the rest. Values
// persist in localStorage ("dustwake.settings") in the browser; tests pass none.
//
// Key remapping covers the play screen's actions (Game.act / Game.held). Menus
// keep their own keys, as before. Colour-blind-safe palettes recolour the vision
// overlay's categories and the UI's alert / selection colours.
import { VISION_CATEGORIES, type Highlight } from "../content/vision";

export type SettingValue = number | boolean | string;
export type SettingCategory = "audio" | "display" | "access" | "game";

export interface SettingDef {
  id: string;
  label: string;
  category: SettingCategory;
  kind: "slider" | "toggle" | "choice";
  def: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

export const SETTING_CATEGORIES: { id: SettingCategory; label: string }[] = [
  { id: "audio", label: "Audio" }, { id: "display", label: "Display" }, { id: "access", label: "Accessibility" }, { id: "game", label: "Game" },
];

const REGISTRY: SettingDef[] = [];

/** Add an option (once per id). Later features call this from their own module. */
export function registerSetting(d: SettingDef) {
  if (!REGISTRY.some((x) => x.id === d.id)) REGISTRY.push(d);
}
export const settingDefs = (): readonly SettingDef[] => REGISTRY;
export const settingDef = (id: string) => REGISTRY.find((d) => d.id === id);

[
  { id: "volMaster", label: "Master volume", category: "audio", kind: "slider", def: 100, min: 0, max: 100, step: 5 },
  { id: "volSfx", label: "Effects", category: "audio", kind: "slider", def: 100, min: 0, max: 100, step: 5 },
  { id: "volAmbient", label: "Ambience", category: "audio", kind: "slider", def: 100, min: 0, max: 100, step: 5 },
  { id: "uiScale", label: "UI scale", category: "display", kind: "choice", def: "normal", options: [{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "large", label: "Large" }], help: "Size of the high-resolution interface (menus, tooltips, the feed)." },
  { id: "interp", label: "Smooth motion", category: "display", kind: "toggle", def: true, help: "Draw moving things between simulation ticks." },
  { id: "perf", label: "Show performance", category: "display", kind: "toggle", def: false, help: "Frame rate, ticks per frame, simulation time and LOD tiers." },
  { id: "shake", label: "Screen shake", category: "access", kind: "toggle", def: true },
  { id: "shakeAmt", label: "Shake strength", category: "access", kind: "slider", def: 100, min: 0, max: 100, step: 10 },
  { id: "flashes", label: "Bright flashes", category: "access", kind: "toggle", def: true, help: "Off: white flashes and strobes are dimmed to a soft fade." },
  { id: "palette", label: "Overlay colours", category: "access", kind: "choice", def: "default", options: [{ value: "default", label: "Default" }, { value: "deutan", label: "Deuteranopia" }, { value: "protan", label: "Protanopia" }, { value: "tritan", label: "Tritanopia" }, { value: "contrast", label: "High contrast" }], help: "Colour-blind-safe colours for the vision overlay, alerts and selection." },
  { id: "autosave", label: "Autosave", category: "game", kind: "choice", def: "5", options: [{ value: "0", label: "Off" }, { value: "2", label: "2 min" }, { value: "5", label: "5 min" }, { value: "10", label: "10 min" }], help: "Also saves on entering another area. Three older autosaves are kept." },
  { id: "pauseOnAlert", label: "Pause on alert", category: "game", kind: "toggle", def: false, help: "An alert in the feed (a worker blocked) pauses the game." },
  { id: "lod", label: "Simulation LOD", category: "game", kind: "toggle", def: true, help: "Step off-screen actors at a lower rate (needed for large populations)." },
].forEach((d) => registerSetting(d as SettingDef));

/** The play screen's remappable actions. */
export type Action = "up" | "down" | "left" | "right" | "interact" | "attack" | "core" | "scan" | "pack" | "build" | "quickPlace" | "schematic" | "save" | "load" | "pause";

export const ACTIONS: { id: Action; label: string }[] = [
  { id: "up", label: "Move up" }, { id: "down", label: "Move down" }, { id: "left", label: "Move left" }, { id: "right", label: "Move right" },
  { id: "interact", label: "Interact / use" }, { id: "attack", label: "Attack (slam)" }, { id: "core", label: "Slot / remove core" }, { id: "scan", label: "Vision mode" },
  { id: "pack", label: "Pack" }, { id: "build", label: "Build menu" }, { id: "quickPlace", label: "Quick re-place" }, { id: "schematic", label: "Schematic" },
  { id: "save", label: "Quick save" }, { id: "load", label: "Continue (load latest)" }, { id: "pause", label: "Pause / resume" },
];

/** The keys every action had before remapping existed (KeyboardEvent.key, lowercased). */
export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ["w", "arrowup"], down: ["s", "arrowdown"], left: ["a", "arrowleft"], right: ["d", "arrowright"],
  interact: ["e", "enter"], attack: [" "], core: ["c"], scan: ["z"], pack: ["i", "tab"], build: ["b"], quickPlace: ["v"], schematic: ["m"],
  save: ["k"], load: ["l"], pause: ["p"],
};

/** "arrowup" -> "Up", " " -> "Space". */
export function keyLabel(k: string): string {
  const named: Record<string, string> = { " ": "Space", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right", enter: "Enter", tab: "Tab", escape: "Esc", backspace: "Backspace" };
  return named[k] ?? (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1));
}

export interface Palette { important: string; interactable: string; npc: string; buildable: string; alert: string; warn: string; info: string; select: string }

/** Okabe-Ito based sets for the common colour-vision deficiencies, and a high-contrast set. */
export const PALETTES: Record<string, Palette> = {
  default: { important: "#ffd27a", interactable: "#74dce2", npc: "#c5a0ff", buildable: "#97d38a", alert: "#ff6a5a", warn: "#f0c060", info: "#8ac8e8", select: "#f0d890" },
  deutan: { important: "#f0e442", interactable: "#56b4e9", npc: "#cc79a7", buildable: "#0072b2", alert: "#d55e00", warn: "#e69f00", info: "#56b4e9", select: "#f0e442" },
  protan: { important: "#f0e442", interactable: "#56b4e9", npc: "#cc79a7", buildable: "#e69f00", alert: "#d55e00", warn: "#f0e442", info: "#56b4e9", select: "#ffffff" },
  tritan: { important: "#ff6e6e", interactable: "#00c0c0", npc: "#f0f0f0", buildable: "#e69f00", alert: "#ff3030", warn: "#ff9ec8", info: "#00c0c0", select: "#ffffff" },
  contrast: { important: "#ffffff", interactable: "#00ffff", npc: "#ff40ff", buildable: "#ffff00", alert: "#ff2020", warn: "#ffff00", info: "#00ffff", select: "#ffffff" },
};

/** Recolour the vision overlay's categories (content/vision.ts) to a palette. */
export function applyPalette(id: string): Palette {
  const p = PALETTES[id] ?? PALETTES.default;
  for (const k of ["important", "interactable", "npc", "buildable"] as Highlight[]) VISION_CATEGORIES[k].color = p[k];
  return p;
}

export interface KvSync { getItem(k: string): string | null; setItem(k: string, v: string): void }
const KEY = "dustwake.settings";

export class Settings {
  private values = new Map<string, SettingValue>();
  keymap: Record<Action, string[]> = cloneKeys(DEFAULT_KEYS);
  private listeners: ((id: string) => void)[] = [];

  constructor(private storage: KvSync | null = null) { this.load(); }

  get(id: string): SettingValue {
    if (this.values.has(id)) return this.values.get(id)!;
    return settingDef(id)?.def ?? false;
  }
  num(id: string) { return Number(this.get(id)); }
  bool(id: string) { return !!this.get(id); }
  str(id: string) { return String(this.get(id)); }

  set(id: string, v: SettingValue) {
    const d = settingDef(id);
    if (d?.kind === "slider" && typeof v === "number") v = Math.max(d.min ?? 0, Math.min(d.max ?? 100, Math.round(v / (d.step ?? 1)) * (d.step ?? 1)));
    if (d?.kind === "choice" && !d.options?.some((o) => o.value === v)) return;
    if (this.get(id) === v) return;
    this.values.set(id, v);
    this.save();
    for (const f of this.listeners) f(id);
  }

  onChange(f: (id: string) => void) { this.listeners.push(f); }

  keys(a: Action): string[] { return this.keymap[a] ?? DEFAULT_KEYS[a]; }

  /** Make `key` the first key of `a`; it is taken off any other action, so no key does two things in play. */
  bind(a: Action, key: string) {
    for (const other of Object.keys(this.keymap) as Action[]) if (other !== a) this.keymap[other] = this.keymap[other].filter((k) => k !== key);
    this.keymap[a] = [key, ...this.keymap[a].filter((k) => k !== key)].slice(0, 3);
    this.save();
    for (const f of this.listeners) f("keys");
  }
  resetKeys() { this.keymap = cloneKeys(DEFAULT_KEYS); this.save(); for (const f of this.listeners) f("keys"); }
  resetAll() { this.values.clear(); this.resetKeys(); for (const f of this.listeners) f("*"); }

  load() {
    let raw: string | null = null;
    try { raw = this.storage?.getItem(KEY) ?? null; } catch { raw = null; }
    if (!raw) return;
    try {
      const o = JSON.parse(raw) as { values?: Record<string, SettingValue>; keys?: Partial<Record<Action, string[]>> };
      for (const [k, v] of Object.entries(o.values ?? {})) this.values.set(k, v);
      for (const a of Object.keys(DEFAULT_KEYS) as Action[]) {
        const ks = o.keys?.[a];
        if (Array.isArray(ks) && ks.every((k) => typeof k === "string")) this.keymap[a] = ks.slice(0, 3);
      }
    } catch { /* a damaged settings record: defaults */ }
  }
  save() {
    try { this.storage?.setItem(KEY, JSON.stringify({ values: Object.fromEntries(this.values), keys: this.keymap })); } catch { /* storage full or blocked */ }
  }
}

const cloneKeys = (k: Record<Action, string[]>) => Object.fromEntries(Object.entries(k).map(([a, ks]) => [a, [...ks]])) as Record<Action, string[]>;

/** localStorage when there is one (the browser), else nothing (Node). */
export function browserStorage(): KvSync | null {
  try { return (globalThis as { localStorage?: KvSync }).localStorage ?? null; } catch { return null; }
}
