// Runtime state of one area. Pure (no DOM): the simulation and tests use it
// directly; presentation subscribes to its change notifications.
//
// Invariant: every mutation goes through a method here. Methods bump
// `revision` (anything derived from area state — interactables, nav — can
// cache on it) and tile/decal changes also publish a dirty tile rectangle so
// views can re-bake background and re-trace light visibility locally.
import type { AreaData, DecalDef, LightDef, LooseItem, PropDef } from "../map";
import { TS, T } from "../content/tiles";
import { propDef } from "../content/props";
import type { ItemId } from "../content/items";
import { SOCKET_COUNT } from "../content/ritual";

export interface PropInst extends PropDef {
  open: boolean;
  taken: boolean;
  /** Collision box [x0, y0, x1, y1] in px, or null. Derived from the prop kind. */
  box: [number, number, number, number] | null;
}
export interface LooseInst extends LooseItem { taken: boolean }

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
    this.props = base.props.map((p) => {
      const bx = propDef(p.kind).box;
      const inst: PropInst = { ...p, open: false, taken: false, box: bx ? [p.x - bx[0] / 2, p.y - bx[1], p.x + bx[0] / 2, p.y] : null };
      this.propIndex.set(p.id, inst);
      return inst;
    });
    this.loose = base.loose.map((l) => ({ ...l, taken: false }));
  }

  // ---- static-ish accessors (pass-through so an Area is usable as MapData)
  get rooms() { return this.base.rooms; }
  get exits() { return this.base.exits; }
  get drips() { return this.base.drips; }
  get start() { return this.base.start; }
  get ritualPos() { return this.base.ritual; }

  initRitual(solution: number[]) {
    this.ritual = {
      solution, sockets: new Array(SOCKET_COUNT).fill(-1), core: false, carved: false,
      active: false, actT: 0, wrong: new Array(SOCKET_COUNT).fill(false),
    };
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
    this.markDirty(tx - DIRTY_PAD, ty - DIRTY_PAD, tx + DIRTY_PAD, ty + DIRTY_PAD);
  }
  setPropState(id: string, s: Partial<Pick<PropInst, "open" | "taken" | "lit">> & { item?: ItemId | null }) {
    const p = this.propIndex.get(id);
    if (!p) return;
    if (s.open !== undefined) p.open = s.open;
    if (s.taken !== undefined) p.taken = s.taken;
    if (s.lit !== undefined) p.lit = s.lit;
    if (s.item !== undefined) p.item = s.item ?? undefined;
    this.touch();
  }
  takeLoose(id: string) {
    const l = this.looseItem(id);
    if (l) { l.taken = true; this.touch(); }
  }
  /** Non-spatial change (props, ritual, ...): bump revision only. */
  touch() { this.revision++; }

  // ---- change propagation
  onChange(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }
  private markDirty(x0: number, y0: number, x1: number, y1: number) {
    this.revision++;
    const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(this.w - 1, x1), y1: Math.min(this.h - 1, y1) };
    for (const l of this.listeners) l(r);
  }
}

export function unionRect(a: TileRect | null, b: TileRect): TileRect {
  if (!a) return { ...b };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
