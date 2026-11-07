// The storage screen: an overlay opened by E on a storage prop (the `useStorage`
// effect emits `openStorage`; the host pushes this screen). Two panes side by
// side: the golem's pack on the left (8 / 16 / 48 slots by capacity tier, laid
// out as the pack lays them out) and the chest's slots on the right (32 for the
// storage chest, from PropKindDef.storage). A description panel below names
// whatever the cursor is on.
//
//   W A S D / arrows  move the cursor in a pane; A off the chest's first column
//                     steps over to the pack, D off the pack's last column to
//                     the chest (on the same row, or the nearest one)
//   E / Enter / Space move the whole stack under the cursor to the other pane
//   Q                 move one item
//   R                 rename the chest (type the name, Enter keeps it, Esc cancels;
//                     an empty name goes back to its default, e.g. DUNGEON CHEST 2)
//   Esc / I / Tab     close
//
// Presentation only. Every move is sim/commands.ts: moveStorageSlot (through
// sim/storage.ts: transferSlot), so it is applied at once, saved, deterministic
// and testable headless. As much as fits moves; a full destination, an empty
// source and the tutorial's undroppable items are refused with a message.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText, TextField } from "../ui/kit";
import { ITEMS, effectLines, isDroppable } from "../content/items";
import { propDef } from "../content/props";
import { capacity } from "../sim/inventory";
import { moveStorageSlot, renameStorage } from "../sim/commands";
import { PROP_NAME_MAX, propName } from "../sim/orders";
import { itemIcon } from "../art/items";
import { drawText, drawTextS, textWidth } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { clamp } from "../util";
import type { Slot } from "../world/world";

export type StoragePane = "pack" | "chest";

const PX = 5, PY = 2, PW = 310, PH = 172;
/** Left pane and right pane: x of the pane's left edge and its width. */
const PANE = { pack: { x: 9, w: 150 }, chest: { x: 161, w: 150 } } as const;
const GY = PY + 16;

/** Grid layout per slot count: the pack's tiers (4 columns up to 16 slots, 8 beyond), 8 columns narrowed to fit two panes. Exported for tests. */
export function gridLayout(cap: number, pane: StoragePane) {
  const L = cap <= 8 ? { cols: 4, pitch: 28, cell: 24 } : cap <= 16 ? { cols: 4, pitch: 25, cell: 22 } : { cols: 8, pitch: 18, cell: 17 };
  const rows = Math.max(1, Math.ceil(cap / L.cols));
  const gw = L.cols * L.pitch - (L.pitch - L.cell), gh = rows * L.pitch - (L.pitch - L.cell);
  return { ...L, rows, gw, gh, gx: PANE[pane].x + Math.floor((PANE[pane].w - gw) / 2), gy: GY };
}

export class StorageUi {
  readonly screen: Screen;
  /** The storage prop in use (in the player's area). */
  propId: string | null = null;
  pane: StoragePane = "pack";
  /** Cursor memory per pane. */
  cursors: Record<StoragePane, number> = { pack: 0, chest: 0 };
  /** The rename field: active while the chest's name is being typed. */
  readonly nameField = new TextField(PROP_NAME_MAX);

  constructor(private g: UiHost) {
    this.screen = { id: "storage", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  get cursor() { return this.cursors[this.pane]; }

  /** New session (a world was loaded or restarted): nothing remembered. */
  reset() { this.propId = null; this.pane = "pack"; this.cursors = { pack: 0, chest: 0 }; this.nameField.active = false; this.nameField.clear(); }

  open(propId: string) {
    if (propId !== this.propId) this.cursors = { pack: 0, chest: 0 };
    this.propId = propId; this.pane = "pack";
    this.nameField.active = false; this.nameField.clear();
    this.clampCursors();
    this.g.screens.push(this.screen);
    this.g.sfx.open();
  }

  /** The slots shown in a pane, and how many there are. */
  slots(pane: StoragePane): { slots: readonly Slot[]; cap: number } {
    const g = this.g;
    if (pane === "pack") return { slots: g.pl.inventory, cap: capacity(g.world, g.pl) };
    const p = this.propId ? g.area.prop(this.propId) : undefined;
    return { slots: p?.inventory ?? [], cap: p ? propDef(p.kind).storage?.slots ?? 0 : 0 };
  }

  private clampCursors() {
    for (const k of ["pack", "chest"] as const) this.cursors[k] = clamp(this.cursors[k], 0, Math.max(0, this.slots(k).cap - 1));
  }

  /** Move the cursor. Across the edge between the panes: the same row, or the nearest one the other pane has. */
  move(dir: "left" | "right" | "up" | "down") {
    const { cap } = this.slots(this.pane), L = gridLayout(cap, this.pane), c = this.cursor;
    const col = c % L.cols, row = Math.floor(c / L.cols);
    const cross = (to: StoragePane, atCol: "first" | "last") => {
      const o = this.slots(to), OL = gridLayout(o.cap, to);
      if (!o.cap) return;
      const r = Math.min(row, OL.rows - 1);
      this.cursors[to] = Math.min(o.cap - 1, r * OL.cols + (atCol === "first" ? 0 : OL.cols - 1));
      this.pane = to;
    };
    if (dir === "left") { if (col > 0) this.cursors[this.pane] = c - 1; else if (this.pane === "chest") cross("pack", "last"); }
    else if (dir === "right") { if (col < L.cols - 1 && c + 1 < cap) this.cursors[this.pane] = c + 1; else if (this.pane === "pack") cross("chest", "first"); }
    else if (dir === "up") { if (row > 0) this.cursors[this.pane] = c - L.cols; }
    else if (row < L.rows - 1) this.cursors[this.pane] = Math.min(cap - 1, c + L.cols);
  }

  /** The chest's name as the orders call it (the player's own, else DUNGEON CHEST 2 and the like). */
  get name(): string {
    const p = this.propId ? this.g.area.prop(this.propId) : undefined;
    return p ? propName(this.g.area, p) : "STORAGE";
  }

  /** Start typing a new name, the current one as the starting text. */
  startRename() {
    if (!this.propId) return;
    this.nameField.value = this.name.slice(0, PROP_NAME_MAX); this.nameField.active = true;
    this.g.sfx.tone(520, 0.05, "triangle", 0.04);
  }
  /** Keep what was typed (empty: the default name). Returns whether the chest took it. */
  commitRename(): boolean {
    const g = this.g, f = this.nameField;
    f.active = false;
    const r = this.propId ? renameStorage(g.world, g.pl, this.propId, f.value) : { ok: false, text: "" };
    f.clear();
    if (r.ok) g.sfx.tone(420, 0.05, "triangle", 0.04); else g.sfx.thud();
    g.drainEvents();
    return r.ok;
  }
  cancelRename() { this.nameField.active = false; this.nameField.clear(); }

  /** Move the stack under the cursor (or `n` of it) to the other pane. Returns whether anything moved. */
  act(n: number): boolean {
    const g = this.g;
    if (!this.propId) return false;
    const r = moveStorageSlot(g.world, g.pl, this.propId, this.pane === "pack" ? "store" : "take", this.cursor, n);
    if (r.moved) g.sfx.tone(this.pane === "pack" ? 420 : 520, 0.05, "triangle", 0.04); else g.sfx.thud();
    g.drainEvents();
    return r.moved > 0;
  }

  private update() {
    const g = this.g;
    if (this.nameField.active) {
      // Typing mode: letters go to the field, never to the cursor or the moves.
      if (!this.propId || !g.area.prop(this.propId)) { this.cancelRename(); g.say("THE STORAGE IS GONE"); g.screens.popToBase(); return; }
      if (this.nameField.feed(g.typed)) g.sfx.tone(620, 0.02, "square", 0.015);
      if (g.hit("enter")) this.commitRename();
      else if (g.hit("escape")) this.cancelRename();
      return;
    }
    if (g.hit("escape", "i", "tab")) { g.screens.popToBase(); return; }
    if (!this.propId || !g.area.prop(this.propId)) { g.say("THE STORAGE IS GONE"); g.screens.popToBase(); return; }
    if (g.hit("r")) { this.startRename(); return; }
    this.clampCursors();
    const before = `${this.pane}:${this.cursor}`;
    if (g.hit("arrowleft", "a")) this.move("left");
    if (g.hit("arrowright", "d")) this.move("right");
    if (g.hit("arrowup", "w")) this.move("up");
    if (g.hit("arrowdown", "s")) this.move("down");
    if (`${this.pane}:${this.cursor}` !== before) g.sfx.tone(500, 0.04, "square", 0.02);
    if (g.hit("e", "enter", " ")) this.act(Infinity);
    else if (g.hit("q")) this.act(1);
  }

  // ---------------------------------------------------------------- drawing
  private render() {
    const g = this.g, ctx = g.ctx;
    this.clampCursors();
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    panel(ctx, PX, PY, PW, PH);
    const name = this.name, renaming = this.nameField.active;
    for (const k of ["pack", "chest"] as const) {
      const { slots, cap } = this.slots(k), used = slots.slice(0, cap).filter(Boolean).length;
      const head = k === "pack" ? `PACK ${used}/${cap}` : `${name} ${used}/${cap}`;
      if (k === "chest" && renaming) this.nameField.draw(ctx, PANE.chest.x, PY + 3, PANE.chest.w - 2, g.t, "NAME");
      else drawText(ctx, clipText(head, PANE[k].w - 4), PANE[k].x + 2, PY + 6, this.pane === k ? UI.title : UI.mid);
      this.grid(k, slots, cap);
    }
    // the keys, under the chest's grid
    const cl = gridLayout(this.slots("chest").cap, "chest"), ky = cl.gy + cl.gh + 8;
    const keys: [string, number, number, string][] = renaming
      ? [["ENTER KEEP NAME", 0, 0, UI.mid], ["ESC CANCEL", 0, 1, UI.dim], ["EMPTY: DEFAULT NAME", 0, 2, UI.dim]].map(([t, c, r, col]) => [t as string, c as number, r as number, col as string])
      : [["E MOVE STACK", 0, 0, UI.mid], ["R RENAME", 1, 0, UI.mid], ["Q MOVE ONE", 0, 1, UI.mid], ["A/D OTHER SIDE", 1, 1, UI.dim], ["ESC CLOSE", 0, 2, UI.dim]];
    for (const [t, c, r, col] of keys) drawText(ctx, t, PANE.chest.x + 4 + c * 76, ky + r * 8, col);
    this.description();
    g.renderNote(PY + PH + 1);
  }

  private grid(k: StoragePane, slots: readonly Slot[], cap: number) {
    const g = this.g, ctx = g.ctx, L = gridLayout(cap, k), active = this.pane === k;
    for (let i = 0; i < cap; i++) {
      const x = L.gx + (i % L.cols) * L.pitch, y = L.gy + Math.floor(i / L.cols) * L.pitch, s = slots[i] ?? null;
      const sel = active && i === this.cursors[k];
      frame(ctx, x, y, L.cell, L.cell, sel ? "#221d26" : s ? "#17141b" : "#100e12", sel ? selEdge(g.t) : s ? "#3a3540" : "#2a2630", sel ? "#e8d8a8" : "#4a4552");
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
  private description() {
    const g = this.g, ctx = g.ctx;
    const bx = PX + 4, by = PY + PH - 38, bw = PW - 8, bh = 34;
    frame(ctx, bx, by, bw, bh, "#0e0c10", "#2a2630", "#3a3540");
    const s = this.slots(this.pane).slots[this.cursor] ?? null;
    frame(ctx, bx + 4, by + 5, 22, 22, "#100e12", "#2a2630", "#3a3540");
    if (!s) {
      drawText(ctx, "EMPTY", bx + 31, by + 5, UI.title);
      drawText(ctx, `${this.pane === "pack" ? "PACK" : "STORAGE"} SLOT ${this.cursor + 1}`, bx + 31 + 5 * 4 + 6, by + 5, UI.dim);
      return;
    }
    const def = ITEMS[s.item], store = this.pane === "pack";
    ctx.drawImage(itemIcon(s.item).a, bx + 7, by + 8);
    const name = def.name + (s.n > 1 ? ` X${s.n}` : "");
    drawText(ctx, clipText(name, 120), bx + 31, by + 5, UI.title);
    drawText(ctx, clipText(def.tags.join(" ").toUpperCase(), 100), bx + 31 + Math.min(120, name.length * 4) + 6, by + 5, UI.dim);
    [...(def.desc ?? []), ...effectLines(s.item)].slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, 170), bx + 31, by + 13 + i * 6, "#a89c80"));
    const keys = store && !isDroppable(s.item) ? ["CAN'T STORE THIS"] : store ? ["E STORE STACK", "Q STORE ONE"] : ["E TAKE STACK", "Q TAKE ONE"];
    keys.forEach((k, i) => drawText(ctx, clipText(k, 86), bx + bw - 5, by + 14 + i * 7, i === 0 ? UI.text : UI.dim, 1, "right"));
  }
}
