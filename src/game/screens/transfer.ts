// The transfer screen: opened by TRANSFER on a worker's management screen. Your
// pack on the left, the worker's pack on the right (8 slots for a worker golem)
// and, under it, what the worker wears (a worker golem has one rune slot). A
// description panel below names whatever the cursor is on.
//
//   W A S D / arrows  move the cursor in a pane; A off the worker's first column
//                     steps over to your pack, D off your pack's last column to
//                     the worker; S off the worker's last row drops onto its
//                     worn slots, W climbs back
//   E / Enter / Space give the whole stack under the cursor / take it back; on a
//                     worn slot, take the item off (into the worker's pack)
//   Q                 move one item
//   F                 equip the item under the cursor on the worker (a rune goes
//                     into its rune slot; from your pack it crosses over first)
//   Esc               back to the worker's screen        I / Tab   close
//
// Presentation only. Every change is sim/commands.ts (transferWithActor,
// equipActor, unequipActor): applied at once, saved, deterministic and testable
// headless. As much as fits moves; a full side, an empty slot, a body that can't
// wear the item and the tutorial's undroppable items are refused with a message.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText } from "../ui/kit";
import { ITEMS, effectLines, isDroppable, type ItemId } from "../content/items";
import { actorDef } from "../content/actors";
import { slotDef } from "../content/gear";
import { actorById, type Actor, type Slot } from "../world/world";
import { capacity } from "../sim/inventory";
import { actorLabel } from "../sim/actorStats";
import { slotsFor, wornIn } from "../sim/gear";
import { workerRefusal } from "../sim/jobs";
import { equipActor, transferWithActor, unequipActor } from "../sim/commands";
import { itemIcon } from "../art/items";
import { slotIcon } from "../art/slots";
import { drawText, drawTextS, textWidth } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { clamp } from "../util";

export type TransferPane = "pack" | "carry" | "worn";

const PX = 5, PY = 2, PW = 310, PH = 172;
const PANE = { pack: { x: 9, w: 150 }, carry: { x: 161, w: 150 }, worn: { x: 161, w: 150 } } as const;
const GY = PY + 16;
const WORN_PITCH = 28, WORN_CELL = 24;

/** Grid layout per slot count: as the storage screen lays its panes out. Exported for tests. */
export function gridLayout(cap: number, pane: "pack" | "carry") {
  const L = cap <= 8 ? { cols: 4, pitch: 28, cell: 24 } : cap <= 16 ? { cols: 4, pitch: 25, cell: 22 } : { cols: 8, pitch: 18, cell: 17 };
  const rows = Math.max(1, Math.ceil(cap / L.cols));
  const gw = L.cols * L.pitch - (L.pitch - L.cell), gh = rows * L.pitch - (L.pitch - L.cell);
  return { ...L, rows, gw, gh, gx: PANE[pane].x + Math.floor((PANE[pane].w - gw) / 2), gy: GY };
}

export class TransferUi {
  readonly screen: Screen;
  /** The worker being served. */
  targetId: string | null = null;
  pane: TransferPane = "pack";
  /** Cursor memory per pane. */
  cursors: Record<TransferPane, number> = { pack: 0, carry: 0, worn: 0 };

  /** `back` reopens the worker's management screen, which stepped aside for this one. */
  constructor(private g: UiHost, private back: (targetId: string) => void) {
    this.screen = { id: "transfer", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  get cursor() { return this.cursors[this.pane]; }
  get target(): Actor | undefined { return this.targetId ? actorById(this.g.world, this.targetId) : undefined; }

  /** New session (a world was loaded or restarted): nothing remembered. */
  reset() { this.targetId = null; this.pane = "pack"; this.cursors = { pack: 0, carry: 0, worn: 0 }; }

  open(targetId: string) {
    if (targetId !== this.targetId) this.cursors = { pack: 0, carry: 0, worn: 0 };
    this.targetId = targetId; this.pane = "pack";
    this.clampCursors();
    if (this.g.screens.is("manage")) this.g.screens.pop();
    this.g.screens.push(this.screen);
    this.g.sfx.open();
  }

  /** The worn slots the worker's body has (the ones that can ever be filled by hand). */
  wornSlots(): readonly string[] { const a = this.target; return a ? actorDef(a).gearSlots : []; }

  /** The slots shown in a pane, and how many there are. */
  slots(pane: "pack" | "carry"): { slots: readonly Slot[]; cap: number } {
    const g = this.g, a = this.target;
    if (pane === "pack") return { slots: g.pl.inventory, cap: capacity(g.world, g.pl) };
    return a ? { slots: a.inventory, cap: capacity(g.world, a) } : { slots: [], cap: 0 };
  }
  private size(pane: TransferPane) { return pane === "worn" ? this.wornSlots().length : this.slots(pane).cap; }

  private clampCursors() {
    for (const k of ["pack", "carry", "worn"] as const) this.cursors[k] = clamp(this.cursors[k], 0, Math.max(0, this.size(k) - 1));
  }

  /** Move the cursor. Across the edge between the panes: the same row, or the nearest one the other pane has. */
  move(dir: "left" | "right" | "up" | "down") {
    const p = this.pane, c = this.cursor;
    if (p === "worn") {
      const n = this.wornSlots().length;
      if (dir === "left") { if (c > 0) this.cursors.worn = c - 1; else { this.pane = "pack"; this.cursors.pack = clamp(this.cursors.pack, 0, Math.max(0, this.size("pack") - 1)); } }
      else if (dir === "right") { if (c < n - 1) this.cursors.worn = c + 1; }
      else if (dir === "up") this.pane = "carry";
      return;
    }
    const { cap } = this.slots(p), L = gridLayout(cap, p);
    const col = c % L.cols, row = Math.floor(c / L.cols);
    const cross = (to: "pack" | "carry", atCol: "first" | "last") => {
      const o = this.slots(to), OL = gridLayout(o.cap, to);
      if (!o.cap) return;
      const r = Math.min(row, OL.rows - 1);
      this.cursors[to] = Math.min(o.cap - 1, r * OL.cols + (atCol === "first" ? 0 : OL.cols - 1));
      this.pane = to;
    };
    if (dir === "left") { if (col > 0) this.cursors[p] = c - 1; else if (p === "carry") cross("pack", "last"); }
    else if (dir === "right") { if (col < L.cols - 1 && c + 1 < cap) this.cursors[p] = c + 1; else if (p === "pack") cross("carry", "first"); }
    else if (dir === "up") { if (row > 0) this.cursors[p] = c - L.cols; }
    else if (row < L.rows - 1) this.cursors[p] = Math.min(cap - 1, c + L.cols);
    else if (p === "carry" && this.wornSlots().length) { this.pane = "worn"; this.cursors.worn = clamp(col, 0, this.wornSlots().length - 1); }
  }

  /** E / Q: give or take the stack (or `n` of it) under the cursor; on a worn slot, take the item off. Returns whether anything changed. */
  act(n: number): boolean {
    const g = this.g;
    if (!this.targetId) return false;
    let ok: boolean;
    if (this.pane === "worn") {
      const id = this.wornSlots()[this.cursor];
      ok = !!id && unequipActor(g.world, g.pl, this.targetId, id as never).ok;
    } else {
      ok = transferWithActor(g.world, g.pl, this.targetId, this.pane === "pack" ? "give" : "take", this.cursor, n).ok;
    }
    if (ok) g.sfx.tone(this.pane === "pack" ? 420 : 520, 0.05, "triangle", 0.04); else g.sfx.thud();
    g.drainEvents();
    return ok;
  }

  /** F: put the item under the cursor on the worker. Returns whether it is worn now. */
  equip(): boolean {
    const g = this.g;
    if (!this.targetId || this.pane === "worn") return false;
    const r = equipActor(g.world, g.pl, this.targetId, this.pane === "pack" ? "pack" : "carry", this.cursor);
    if (r.ok) g.sfx.tone(600, 0.07, "triangle", 0.05); else g.sfx.thud();
    g.drainEvents();
    return r.ok;
  }

  /** Whether the item can go on the worker (it is wearable and the body has a usable slot of that kind). */
  private wearable(item: ItemId): boolean {
    const a = this.target;
    return !!a && !!ITEMS[item].wear && slotsFor(this.g.world, a, item).length > 0;
  }

  private update() {
    const g = this.g, a = this.target;
    if (g.hit("i", "tab")) { g.screens.popToBase(); return; }
    if (!a) { g.screens.popToBase(); return; }
    if (g.hit("escape")) { g.screens.pop(); this.back(a.id); return; }
    const gone = workerRefusal(g.world, g.pl, a.id);
    if (gone) { g.say(gone); g.screens.popToBase(); return; }
    this.clampCursors();
    const before = `${this.pane}:${this.cursor}`;
    if (g.hit("arrowleft", "a")) this.move("left");
    if (g.hit("arrowright", "d")) this.move("right");
    if (g.hit("arrowup", "w")) this.move("up");
    if (g.hit("arrowdown", "s")) this.move("down");
    if (`${this.pane}:${this.cursor}` !== before) g.sfx.tone(500, 0.04, "square", 0.02);
    if (g.hit("e", "enter", " ")) this.act(Infinity);
    else if (g.hit("q")) this.act(1);
    else if (g.hit("f")) this.equip();
  }

  // ---------------------------------------------------------------- drawing
  private render() {
    const g = this.g, ctx = g.ctx, a = this.target;
    this.clampCursors();
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    panel(ctx, PX, PY, PW, PH);
    if (!a) return;
    for (const k of ["pack", "carry"] as const) {
      const { slots, cap } = this.slots(k), used = slots.slice(0, cap).filter(Boolean).length;
      const head = k === "pack" ? `PACK ${used}/${cap}` : `${actorLabel(a)} ${used}/${cap}`;
      drawText(ctx, clipText(head, PANE[k].w - 4), PANE[k].x + 2, PY + 6, this.pane === k ? UI.title : UI.mid);
      this.grid(k, slots, cap);
    }
    // what the worker wears, under its pack
    const cl = gridLayout(this.slots("carry").cap, "carry"), wy = cl.gy + cl.gh + 7;
    const worn = this.wornSlots();
    drawText(ctx, "WORN", PANE.worn.x + 2, wy, this.pane === "worn" ? UI.title : UI.mid);
    worn.forEach((id, i) => this.wornCell(a, id as never, i, PANE.worn.x + 6 + i * WORN_PITCH, wy + 9));
    if (!worn.length) drawText(ctx, "NOTHING", PANE.worn.x + 6, wy + 12, UI.dim);
    // the keys, under the worn slots
    const ky = wy + 9 + WORN_CELL + 3;
    const keys: [string, number, number, string][] = [["E GIVE / TAKE", 0, 0, UI.mid], ["F EQUIP", 1, 0, UI.mid], ["Q ONE ITEM", 0, 1, UI.mid], ["A/D OTHER SIDE", 1, 1, UI.dim], ["ESC BACK", 0, 2, UI.dim], ["TAB CLOSE", 1, 2, UI.dim]];
    for (const [t, c, r, col] of keys) drawText(ctx, t, PANE.carry.x + 4 + c * 76, ky + r * 8, col);
    this.description(a);
    g.renderNote(PY + PH + 1);
  }

  private wornCell(a: Actor, id: Parameters<typeof wornIn>[1], i: number, x: number, y: number) {
    const ctx = this.g.ctx, item = wornIn(a, id), sel = this.pane === "worn" && this.cursor === i;
    frame(ctx, x, y, WORN_CELL, WORN_CELL, item ? "#1c1722" : "#100e12", sel ? selEdge(this.g.t) : item ? "#6a5634" : "#2a2630", item ? "#a88a4c" : "#3a3540");
    if (item) ctx.drawImage(itemIcon(item).a, x + 4, y + 4);
    else { ctx.globalAlpha = 0.28; ctx.drawImage(slotIcon(slotDef(id).kind).a, x + 4, y + 4); ctx.globalAlpha = 1; }
    if (sel) this.ticks(x, y, WORN_CELL);
  }

  private grid(k: "pack" | "carry", slots: readonly Slot[], cap: number) {
    const g = this.g, ctx = g.ctx, L = gridLayout(cap, k), active = this.pane === k;
    for (let i = 0; i < cap; i++) {
      const x = L.gx + (i % L.cols) * L.pitch, y = L.gy + Math.floor(i / L.cols) * L.pitch, s = slots[i] ?? null, sel = active && i === this.cursor;
      frame(ctx, x, y, L.cell, L.cell, s ? "#17141b" : "#100e12", sel ? selEdge(g.t) : s ? "#3a3540" : "#2a2630", "#4a4552");
      if (s) {
        const o = Math.floor((L.cell - 16) / 2);
        ctx.drawImage(itemIcon(s.item).a, x + o, y + o);
        if (s.n > 1) { const t = String(s.n); drawTextS(ctx, t, x + L.cell - 1 - textWidth(t), y + L.cell - 7, "#f0e8d0", 1, "left", "#000"); }
      }
      if (sel) this.ticks(x, y, L.cell);
    }
  }

  /** Corner brackets round the selected cell, as in the pack: the cursor reads at a glance, even on an empty slot. */
  private ticks(x: number, y: number, cell: number) {
    const ctx = this.g.ctx;
    ctx.fillStyle = selEdge(this.g.t);
    for (const [cx, cy, sx, sy] of [[x - 2, y - 2, 1, 1], [x + cell + 1, y - 2, -1, 1], [x - 2, y + cell + 1, 1, -1], [x + cell + 1, y + cell + 1, -1, -1]] as const) {
      ctx.fillRect(sx > 0 ? cx : cx - 2, cy, 3, 1); ctx.fillRect(cx, sy > 0 ? cy : cy - 2, 1, 3);
    }
  }

  /** The panel under both panes: what the cursor is on and what the keys will do to it. */
  private description(a: Actor) {
    const g = this.g, ctx = g.ctx;
    const bx = PX + 4, by = PY + PH - 38, bw = PW - 8, bh = 34;
    frame(ctx, bx, by, bw, bh, "#0e0c10", "#2a2630", "#3a3540");
    frame(ctx, bx + 4, by + 5, 22, 22, "#100e12", "#2a2630", "#3a3540");
    let item: Slot | null;
    let empty: string;
    if (this.pane === "worn") {
      const id = this.wornSlots()[this.cursor], it = id ? wornIn(a, id as never) : undefined;
      item = it ? { item: it, n: 1 } : null;
      empty = id ? `${slotDef(id as never).name} SLOT` : "NO SLOT";
    } else {
      item = this.slots(this.pane).slots[this.cursor] ?? null;
      empty = `${this.pane === "pack" ? "PACK" : "ITS PACK"} SLOT ${this.cursor + 1}`;
    }
    if (!item) {
      drawText(ctx, "EMPTY", bx + 31, by + 5, UI.title);
      drawText(ctx, empty, bx + 31 + 5 * 4 + 6, by + 5, UI.dim);
      return;
    }
    const def = ITEMS[item.item];
    ctx.drawImage(itemIcon(item.item).a, bx + 7, by + 8);
    const name = def.name + (item.n > 1 ? ` X${item.n}` : "");
    drawText(ctx, clipText(name, 120), bx + 31, by + 5, UI.title);
    drawText(ctx, clipText(def.tags.join(" ").toUpperCase(), 100), bx + 31 + Math.min(120, name.length * 4) + 6, by + 5, UI.dim);
    [...(def.desc ?? []), ...effectLines(item.item)].slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, 170), bx + 31, by + 13 + i * 6, "#a89c80"));
    const keys = this.pane === "worn" ? ["E TAKE OFF"]
      : this.pane === "pack" && !isDroppable(item.item) ? ["CAN'T GIVE THIS"]
      : [this.pane === "pack" ? "E GIVE STACK" : "E TAKE STACK", this.pane === "pack" ? "Q GIVE ONE" : "Q TAKE ONE", ...(this.wearable(item.item) ? ["F EQUIP"] : [])];
    keys.forEach((k, i) => drawText(ctx, clipText(k, 86), bx + bw - 5, by + 8 + i * 7, i === 0 ? UI.text : UI.dim, 1, "right"));
  }
}
