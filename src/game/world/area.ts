// Runtime state of one area. Pure (no DOM): the simulation and tests use it
// directly; presentation subscribes to its change notifications.
//
// Invariant: every mutation goes through a method here. Methods bump
// `revision`, plus the dependency-specific layout/interaction/storage revision.
// Tile/decal changes also publish a dirty tile rectangle
// so views can re-bake background and re-trace light visibility locally.
import type { AreaData, DecalDef, LightDef, LooseItem, PropDef } from "../map";
import { TS, T } from "../content/tiles";
import { propDef } from "../content/props";
import { maxStack, type ItemId } from "../content/items";
import type { Slot } from "./world";
import { SOCKET_COUNT } from "../content/ritual";

export interface PropInst extends PropDef {
  open: boolean;
  taken: boolean;
  /** Damage taken (harvest progress). Lives on the target so any actor's hits accumulate and it saves. */
  dmg: number;
  /** Storage prop slots; never mutate these outside Area.setInventory. */
  inventory?: Slot[];
  /** Created during play (built), not by the area builder. */
  dyn?: boolean;
  /** Collision box [x0, y0, x1, y1] in px, or null. Derived from the prop kind. */
  box: [number, number, number, number] | null;
}
export interface LooseInst extends LooseItem { taken: boolean; dyn?: boolean }

/** Tutorial puzzle state of the translocation circle. */
export interface RitualState {
  solution: number[];
  sockets: number[];
  core: boolean;
  carved: boolean;
  active: boolean;
  actT: number;
  wrong: boolean[];
}

export interface TileRect { x0: number; y0: number; x1: number; y1: number }
type Listener = (r: TileRect) => void;

/** Tiles of context re-baked around a change (AO, wall rims and decals reach this far). */
const DIRTY_PAD = 2;

export class Area {
  readonly id: string;
  readonly base: AreaData;
  readonly w: number;
  readonly h: number;
  grid: Uint8Array;
  readonly plan: Uint8Array;
  readonly style: Uint8Array;
  readonly tvar: Uint8Array;
  props: PropInst[];
  loose: LooseInst[];
  /** base.decals followed by decals added during play (append-only). */
  decals: DecalDef[];
  readonly lights: LightDef[];
  ritual: RitualState | null = null;
  revision = 0;
  layoutRevision = 0;
  interactionRevision = 0;
  storageRevision = 0;
  /** Id counters for things created during play (saved, so ids are never reused). */
  looseSeq = 0;
  propSeq = 0;
  private listeners: Listener[] = [];
  private propIndex = new Map<string, PropInst>();

  constructor(base: AreaData) {
    this.base = base;
    this.id = base.id;
    this.w = base.w;
    this.h = base.h;
    this.grid = base.grid.slice();
    this.plan = base.plan;
    this.style = base.style;
    this.tvar = base.tvar;
    this.decals = base.decals.slice();
    this.lights = base.lights;
    this.props = base.props.map((p) => this.instProp(p));
    this.loose = base.loose.map((l) => ({ ...l, taken: false }));
  }

  private instProp(p: PropDef, dyn = false): PropInst {
    const bx = propDef(p.kind).box;
    const inst: PropInst = { ...p, open: !!p.open, taken: false, dmg: 0, box: bx ? [p.x - bx[0] / 2, p.y - bx[1], p.x + bx[0] / 2, p.y] : null };
    const storage = propDef(p.kind).storage;
    if (storage) {
      if ((p.inventory?.length ?? 0) > storage.slots) throw new Error("authored storage exceeds capacity");
      inst.inventory = Array.from({ length: storage.slots }, (_, i) => p.inventory?.[i] ? { ...p.inventory[i]! } : null);
    }
    if (dyn) inst.dyn = true;
    this.propIndex.set(p.id, inst);
    return inst;
  }

  // ---- static-ish accessors (pass-through so an Area is usable as MapData)
  get rooms() { return this.base.rooms; }
  get exits() { return this.base.exits; }
  get drips() { return this.base.drips; }
  get start() { return this.base.start; }
  /** Translocation circle centre (only areas with a ritual). */
  get ritualPos() { return this.base.ritual!; }

  initRitual(solution: number[]) {
    this.setRitual({
      solution, sockets: new Array(SOCKET_COUNT).fill(-1), core: false, carved: false,
      active: false, actT: 0, wrong: new Array(SOCKET_COUNT).fill(false),
    });
  }

  tile(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return T.WALL;
    return this.grid[ty * this.w + tx];
  }
  tileAtPx(px: number, py: number) { return this.tile(Math.floor(px / TS), Math.floor(py / TS)); }
  prop(id: string) { return this.propIndex.get(id); }
  looseItem(id: string) { return this.loose.find((l) => l.id === id); }

  // ---- mutations
  setTile(tx: number, ty: number, t: number) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return;
    this.grid[ty * this.w + tx] = t;
    this.markDirty(tx - DIRTY_PAD, ty - DIRTY_PAD, tx + DIRTY_PAD, ty + DIRTY_PAD);
  }
  addDecal(d: DecalDef) {
    this.decals.push(d);
    const tx = Math.floor(d.x / TS), ty = Math.floor(d.y / TS);
    this.markDirty(tx - DIRTY_PAD, ty - DIRTY_PAD, tx + DIRTY_PAD, ty + DIRTY_PAD, false);
  }
  setPropState(id: string, s: Partial<Pick<PropInst, "open" | "taken" | "lit" | "dmg">> & { item?: ItemId | null }) {
    const p = this.propIndex.get(id);
    if (!p) return;
    const layout = s.taken !== undefined && s.taken !== p.taken;
    if (s.open !== undefined) p.open = s.open;
    if (s.taken !== undefined) p.taken = s.taken;
    if (s.lit !== undefined) p.lit = s.lit;
    if (s.dmg !== undefined) p.dmg = s.dmg;
    if (s.item !== undefined) p.item = s.item ?? undefined;
    this.touch(layout ? "layout" : "interaction");
  }
  /** Harvest progress: add damage to a prop. */
  damageProp(id: string, n: number) {
    const p = this.propIndex.get(id);
    if (!p) return;
    p.dmg += n;
    this.touch("state");
  }
  /** Create a prop during play (building). Ids are `kind#b<n>`, never reused. */
  addProp(kind: string, x: number, y: number, o: Partial<PropDef> = {}, id?: string): PropInst {
    const pid = id ?? `${kind}#b${this.propSeq++}`;
    if (this.propIndex.has(pid)) throw new Error(`duplicate prop id "${pid}"`);
    const inst = this.instProp({ v: 0, ...o, id: pid, kind, x, y }, true);
    this.props.push(inst);
    this.touch("layout");
    return inst;
  }
  /**
   * Remove a prop (deconstruction). Built props simply vanish; for authored
   * props the save diff records the removal (base ids missing from the area).
   * Lights a prop owns and cached interactables follow through `revision`.
   */
  removeProp(id: string): PropInst | undefined {
    const p = this.propIndex.get(id);
    if (!p) return undefined;
    this.propIndex.delete(id);
    this.props = this.props.filter((q) => q !== p);
    this.touch("layout");
    return p;
  }
  takeLoose(id: string) {
    const l = this.looseItem(id);
    if (l) { l.taken = true; this.touch(); }
  }
  /** A loose stack created during play (dropped / overflow). Ids are `drop<n>`, never reused. */
  addLoose(item: ItemId, n: number, x: number, y: number, id?: string): LooseInst {
    const l: LooseInst = { id: id ?? `drop${this.looseSeq++}`, item, x, y, taken: false, dyn: true };
    if (n !== 1) l.n = n;
    this.loose.push(l);
    this.touch();
    return l;
  }
  setLooseCount(id: string, n: number) {
    const l = this.looseItem(id);
    if (!l) return;
    if (n <= 0) l.taken = true;
    else if (n === 1) delete l.n;
    else l.n = n;
    this.touch();
  }
  /** Atomic replacement: callers never receive a mutable storage handle. */
  setInventory(id: string, slots: readonly Slot[]) {
    const p = this.prop(id), cap = p && propDef(p.kind).storage?.slots;
    if (!p || cap === undefined || slots.length > cap) throw new Error("invalid storage inventory");
    if (slots.some((s) => s && (!Number.isSafeInteger(s.n) || s.n <= 0 || s.n > maxStack(s.item)))) throw new Error("invalid storage stack");
    p.inventory = Array.from({ length: cap }, (_, i) => slots[i] ? { ...slots[i]! } : null);
    this.touch("storage");
  }

  setRitual(state: RitualState | null) {
    this.ritual = state ? { ...state, solution: [...state.solution], sockets: [...state.sockets], wrong: [...state.wrong] } : null;
    this.touch();
  }
  updateRitual(state: Partial<RitualState>) {
    if (!this.ritual) return;
    Object.assign(this.ritual, state);
    if (state.solution) this.ritual.solution = [...state.solution];
    if (state.sockets) this.ritual.sockets = [...state.sockets];
    if (state.wrong) this.ritual.wrong = [...state.wrong];
    this.touch();
  }
  advanceRitual(dt: number) {
    if (this.ritual?.active) { this.ritual.actT += dt; this.touch("state"); }
  }
  restoreCounters(loose: number, props: number) { this.looseSeq = loose; this.propSeq = props; }

  /** Revisions describe dependencies, not merely how often state changes. */
  touch(change: "state" | "storage" | "interaction" | "layout" = "interaction") {
    this.revision++;
    if (change === "storage") this.storageRevision++;
    if (change === "layout") this.layoutRevision++;
    if (change === "layout" || change === "interaction") this.interactionRevision++;
  }

  // ---- change propagation
  onChange(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }
  private markDirty(x0: number, y0: number, x1: number, y1: number, layout = true) {
    this.touch(layout ? "layout" : "state");
    const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(this.w - 1, x1), y1: Math.min(this.h - 1, y1) };
    for (const l of this.listeners) l(r);
  }
}

export function unionRect(a: TileRect | null, b: TileRect): TileRect {
  if (!a) return { ...b };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
