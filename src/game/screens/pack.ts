// The pack (inventory) overlay: an RPG-style paper doll beside the pack grid.
//
//   left   the golem figure in a niche, with every gear slot arranged around it
//          (helm, back, both arms, core attachment, four rune slots). All of
//          them are always drawn. Slots with a requirement the golem doesn't
//          meet yet (content/gear.ts: `unlock`) are greyed out with a padlock,
//          take nothing, and say why when the cursor is on them.
//   right  the pack grid (8 / 16 / 48 slots by capacity tier).
//   below  a description panel for whatever the cursor is on: an item, an
//          empty slot, a locked slot and the reason it is locked.
//
// The cursor is either on a pack slot (`cursor`) or on a doll slot (`slot`).
// Movement keys move it spatially: inside the doll to the nearest slot in that
// direction, and across between doll and pack (right off the doll's right-hand
// column into the pack, left off the pack's first column onto the doll).
//   view   - E reads a book / the schematic, or puts gear on (it goes to the
//            first free usable slot of its kind: the basket on the back, a rune
//            into a rune slot) and the cursor follows it; Q drops one. E on a
//            worn slot takes the item off, if everything still fits.
//   select - opened by the play screen when the golem uses an empty ritual
//            socket: only glyphs are pickable, E places the selected one; the
//            doll is dimmed and out of reach.
// Presentation only: dropping, placing and wearing go through sim commands.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText } from "../ui/kit";
import { ITEMS, RELICS, effectLines, isGlyph, type GearSlot } from "../content/items";
import { GEAR_SLOT_DEFS, slotDef, type GearSlotDef } from "../content/gear";
import { FLAGS } from "../content/flags";
import { capacity, hasItem } from "../sim/inventory";
import { lockedText, runeMarks, slotUsable, targetSlot, wornIn } from "../sim/gear";
import { dropFromSlot, wearFromSlot, takeOffGear } from "../sim/commands";
import { placeGlyph } from "../sim/ritual";
import { hasFlag } from "../world/world";
import { itemIcon } from "../art/items";
import { slotIcon } from "../art/slots";
import { propSprite } from "../art/props";
import { drawGolem, type GolemPose } from "../golem";
import { drawText, drawTextS, textWidth } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { makeCanvas, Pen, clamp } from "../util";

export type PackMode = "view" | "select";

/** Panel and the doll's origin. The 320x180 screen is laid out by hand: nothing here scrolls. */
const PX = 5, PY = 2, PW = 310, PH = 172;
const DX = PX + 8, DY = PY + 16;
/** Doll slot size (16px icon in a 2px frame). */
const SS = 20;
/** Where each gear slot sits, relative to the doll's origin (DX, DY): helm over the head, back and core at the shoulders, arms at the hands, the runes in a row below. */
export const DOLL: Record<GearSlot, { x: number; y: number }> = {
  head: { x: 57, y: 0 },
  back: { x: 9, y: 28 }, core: { x: 105, y: 28 },
  armR: { x: 9, y: 58 }, armL: { x: 105, y: 58 },
  rune0: { x: 18, y: 94 }, rune1: { x: 44, y: 94 }, rune2: { x: 70, y: 94 }, rune3: { x: 96, y: 94 },
};
/** The figure's niche and where its feet stand (relative to the doll origin). */
const NICHE = { x: 32, y: 16, w: 70, h: 64 };
const FEET = { x: 67, y: 76 };

/** Pack grid layout per capacity tier: stays readable at 8, 16 and 48 slots without scrolling. */
export function packLayout(cap: number) {
  const L = cap <= 8 ? { cols: 4, pitch: 28, cell: 24 } : cap <= 16 ? { cols: 4, pitch: 25, cell: 22 } : { cols: 8, pitch: 19, cell: 18 };
  const rows = Math.ceil(cap / L.cols);
  const gw = L.cols * L.pitch - (L.pitch - L.cell), gh = rows * L.pitch - (L.pitch - L.cell);
  /** The grid sits centred in the right-hand column (x 156..307). */
  const gx = 156 + Math.floor((151 - gw) / 2), gy = DY;
  return { ...L, rows, gw, gh, gx, gy };
}

type Rect = { x: number; y: number; w: number; h: number };
type Dir = "left" | "right" | "up" | "down";

/** The rect, in screen px, of a doll slot. */
export const dollRect = (s: GearSlot): Rect => ({ x: DX + DOLL[s].x, y: DY + DOLL[s].y, w: SS, h: SS });

/**
 * The nearest candidate in a direction from a rect. Candidates inside a 50 degree
 * cone round the direction win (right from the right arm goes to the left arm,
 * not the rune slot just below it); if the cone is empty, anything that lies that
 * way will do. Within either set the score is the distance along the direction
 * plus twice the sideways drift, so what is lined up wins. Undefined if nothing
 * lies that way.
 */
export function neighbor<T extends { r: Rect }>(from: Rect, dir: Dir, cands: readonly T[]): T | undefined {
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  const scored = cands.flatMap((c) => {
    const dx = c.r.x + c.r.w / 2 - fx, dy = c.r.y + c.r.h / 2 - fy;
    const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    if (along <= 1) return [];
    const side = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    return [{ c, score: along + 2 * side, cone: side <= along * 1.2 }];
  });
  const pool = scored.some((s) => s.cone) ? scored.filter((s) => s.cone) : scored;
  return pool.reduce<{ c: T; score: number } | undefined>((b, s) => (!b || s.score < b.score ? s : b), undefined)?.c;
}

export class PackUi {
  readonly screen: Screen;
  /** Selected pack slot (used while `slot` is null). */
  cursor = 0;
  /** Selected doll slot, or null when the cursor is in the pack. */
  slot: GearSlot | null = null;
  mode: PackMode = "view";
  /** The ritual socket being filled (select mode). */
  socket = -1;
  private fig: ReturnType<typeof makeCanvas> | null = null;

  constructor(private g: UiHost) {
    this.screen = { id: "inv", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  /** New session: the cursor starts on the first slot. */
  reset() { this.cursor = 0; this.slot = null; }

  get cap() { return capacity(this.g.world, this.g.pl); }

  open(mode: PackMode, socket = -1) {
    const g = this.g;
    g.screens.push(this.screen);
    this.mode = mode;
    this.socket = socket;
    if (mode === "select") {
      const i = g.pl.inventory.findIndex((s) => s && isGlyph(s.item));
      this.cursor = Math.max(0, i);
      this.slot = null;
    }
    this.cursor = clamp(this.cursor, 0, this.cap - 1);
    g.sfx.tone(300, 0.08, "triangle", 0.05);
  }

  private cellRect(i: number): Rect {
    const L = packLayout(this.cap);
    return { x: L.gx + (i % L.cols) * L.pitch, y: L.gy + Math.floor(i / L.cols) * L.pitch, w: L.cell, h: L.cell };
  }

  private move(dir: Dir) {
    const cap = this.cap, L = packLayout(cap);
    if (this.slot) {
      const cands = GEAR_SLOT_DEFS.filter((d) => d.id !== this.slot).map((d) => ({ id: d.id, r: dollRect(d.id) }));
      const n = neighbor(dollRect(this.slot), dir, cands);
      if (n) { this.slot = n.id; return; }
      if (dir === "right") {
        // Off the doll's right-hand edge: into the pack, the cell level with the slot.
        const from = dollRect(this.slot);
        const cells = Array.from({ length: cap }, (_, i) => ({ i, r: this.cellRect(i) })).filter((c) => c.i % L.cols === 0);
        const best = cells.reduce((b, c) => (Math.abs(c.r.y - from.y) < Math.abs(b.r.y - from.y) ? c : b), cells[0]);
        this.slot = null; this.cursor = best.i;
      }
      return;
    }
    const c = clamp(this.cursor, 0, cap - 1), col = c % L.cols;
    if (dir === "left" && col === 0 && this.mode === "view") {
      // Off the pack's first column: onto the doll, the slot level with this row.
      // The doll's right-hand edge is what faces the pack: core, left arm, the last rune slot.
      const all = GEAR_SLOT_DEFS.map((d) => ({ id: d.id, r: dollRect(d.id) }));
      const edge = Math.max(...all.map((c) => c.r.x + c.r.w));
      const n = neighbor(this.cellRect(c), "left", all.filter((c) => c.r.x + c.r.w >= edge - 12));
      if (n) this.slot = n.id;
      return;
    }
    if (dir === "left") this.cursor = (c + cap - 1) % cap;
    else if (dir === "right") this.cursor = (c + 1) % cap;
    else if (dir === "up") this.cursor = (c - L.cols + cap) % cap;
    else this.cursor = (c + L.cols) % cap;
  }

  private update() {
    const g = this.g;
    if (g.hit("escape", "i", "tab")) { g.screens.popToBase(); return; }
    const before = `${this.slot}:${this.cursor}`;
    if (g.hit("arrowleft", "a")) this.move("left");
    if (g.hit("arrowright", "d")) this.move("right");
    if (g.hit("arrowup", "w")) this.move("up");
    if (g.hit("arrowdown", "s")) this.move("down");
    if (`${this.slot}:${this.cursor}` !== before) g.sfx.tone(500, 0.04, "square", 0.02);
    if (this.slot) { if (g.hit("e", "enter", " ")) this.useSlot(this.slot); return; }
    const slot = g.pl.inventory[this.cursor];
    if (g.hit("q") && this.mode === "view") {
      if (!slot) return;
      const r = dropFromSlot(g.world, g.pl, this.cursor, 1);
      if (r !== "ok") g.sfx.thud();
      g.drainEvents();
      return;
    }
    if (g.hit("e", "enter", " ")) {
      if (!slot) return;
      const id = slot.item;
      if (this.mode === "select") {
        if (isGlyph(id)) {
          g.screens.popToBase();
          placeGlyph(g.world, g.pl, g.area, this.socket, ITEMS[id].glyph!);
          g.drainEvents();
        } else g.sfx.thud();
      } else if (ITEMS[id].opens) g.read(id);
      else if (ITEMS[id].wear) {
        // Gear: onto the golem; the cursor follows it to the slot it went to.
        const to = targetSlot(g.world, g.pl, id);
        if (wearFromSlot(g.world, g.pl, this.cursor) === "ok") this.slot = to ?? null;
        else g.sfx.thud();
        g.drainEvents();
      } else g.sfx.tone(180, 0.1, "square", 0.04);
    }
  }

  /** E on a doll slot: take the worn item off (refused, with a message, if it wouldn't all fit); locked and empty slots only say so. */
  private useSlot(slot: GearSlot) {
    const g = this.g;
    if (!slotUsable(g.world, g.pl, slot)) { g.sfx.thud(); return; }
    const worn = wornIn(g.pl, slot);
    if (!worn) { g.sfx.tone(180, 0.1, "square", 0.04); return; }
    if (takeOffGear(g.world, g.pl, slot) === "ok") { this.slot = null; this.cursor = Math.max(0, g.pl.inventory.findIndex((s) => s?.item === worn)); }
    else g.sfx.thud();
    g.drainEvents();
  }

  // ---------------------------------------------------------------- drawing
  private render() {
    const g = this.g, ctx = g.ctx, pl = g.pl, inv = pl.inventory, cap = this.cap;
    const L = packLayout(cap);
    const select = this.mode === "select";
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    panel(ctx, PX, PY, PW, PH);
    // ---- headers
    drawText(ctx, "GEAR", DX, PY + 6, UI.mid);
    const used = inv.slice(0, cap).filter(Boolean).length;
    drawText(ctx, `PACK ${used}/${cap}`, L.gx, PY + 6, UI.mid);
    if (select) {
      ctx.drawImage(propSprite("pedestal", 0, false)!.a, PX + PW - 22, PY + 2);
      drawText(ctx, "?", PX + PW - 24, PY + 4, "#a070ff");
    }
    // ---- the paper doll (dimmed while a ritual socket is being filled)
    ctx.globalAlpha = select ? 0.3 : 1;
    this.renderFigure();
    for (const d of GEAR_SLOT_DEFS) this.renderSlot(d);
    ctx.globalAlpha = 1;
    // ---- the pack grid
    for (let i = 0; i < cap; i++) {
      const r = this.cellRect(i);
      const sel = !this.slot && i === this.cursor;
      const slot = inv[i];
      frame(ctx, r.x, r.y, r.w, r.h, sel ? "#221d26" : slot ? "#17141b" : "#100e12", sel ? selEdge(g.t) : slot ? "#3a3540" : "#2a2630", sel ? "#e8d8a8" : "#4a4552");
      if (!slot) continue;
      const ic = itemIcon(slot.item);
      const dim = select && !isGlyph(slot.item);
      ctx.globalAlpha = dim ? 0.25 : 1;
      const o = Math.floor((L.cell - 16) / 2);
      ctx.drawImage(ic.a, r.x + o, r.y + o);
      ctx.globalAlpha = 1;
      if (slot.n > 1) { const t = String(slot.n); drawTextS(ctx, t, r.x + L.cell - 1 - textWidth(t), r.y + L.cell - 7, "#f0e8d0", 1, "left", "#000"); }
      if (sel) this.ticks(r);
    }
    this.renderDescription();
    g.renderNote(PY + PH + 1);
  }

  /** The figure in its niche, wearing what the golem wears. */
  private renderFigure() {
    const g = this.g, ctx = g.ctx, pl = g.pl;
    const hasArm = hasFlag(g.world, FLAGS.golemArm);
    frame(ctx, DX + NICHE.x, DY + NICHE.y, NICHE.w, NICHE.h, "#0e0c10", "#26222c", "#34303c");
    // faint links from the slots flanking the figure to its niche
    ctx.fillStyle = "#26222c";
    for (const s of ["back", "core", "armR", "armL"] as GearSlot[]) {
      const r = dollRect(s), left = DOLL[s].x < NICHE.x;
      ctx.fillRect(left ? r.x + r.w : DX + NICHE.x + NICHE.w, r.y + SS / 2, left ? DX + NICHE.x - (r.x + r.w) : r.x - (DX + NICHE.x + NICHE.w), 1);
    }
    this.fig ??= makeCanvas(40, 40);
    this.fig.ctx.clearRect(0, 0, 40, 40);
    const pose: GolemPose = {
      facing: "down", phase: 0, moving: false, hasArm, dormant: 0, eye: 1, core: 0.8 + 0.2 * Math.sin(g.t * 3), raise: 0, reach: 0, t: g.t,
      eyeFixed: hasFlag(g.world, FLAGS.golemEye), back: pl.gear.back, runes: runeMarks(g.world, pl),
    };
    drawGolem(new Pen(this.fig.ctx, false), 20, 34, pose);
    const fx = DX + FEET.x - 40, fy = DY + FEET.y - 68;
    ctx.drawImage(this.fig.c, fx, fy, 80, 80);
    // the broken stub blinks until the iron arm is on (screen-right: the golem's left arm)
    if (!hasArm && Math.sin(g.t * 4) > -0.2) {
      ctx.fillStyle = "#8a4040";
      const ax = fx + (20 + 6) * 2, ay = fy + (34 - 13) * 2;
      for (let i = 0; i < 20; i += 2) { ctx.fillRect(ax + i % 8, ay, 1, 1); ctx.fillRect(ax, ay + i, 1, 1); ctx.fillRect(ax + 8, ay + i, 1, 1); ctx.fillRect(ax + (i % 8), ay + 20, 1, 1); }
    }
    // relics found (the three old treasures), beside the header
    const rel = RELICS.filter((r) => hasItem(pl, r)).length;
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < rel ? "#c9a040" : "#2a2630"; ctx.fillRect(DX + 22 + i * 6, PY + 7, 4, 4); }
    drawText(ctx, "RUNES", DX + FEET.x, DY + 86, UI.dim, 1, "center");
  }

  /** Corner brackets round the selected cell: the cursor reads at a glance, even on a filled slot. */
  private ticks(r: Rect) {
    const ctx = this.g.ctx;
    ctx.fillStyle = selEdge(this.g.t);
    for (const [x, y, sx, sy] of [[r.x - 2, r.y - 2, 1, 1], [r.x + r.w + 1, r.y - 2, -1, 1], [r.x - 2, r.y + r.h + 1, 1, -1], [r.x + r.w + 1, r.y + r.h + 1, -1, -1]] as const) {
      ctx.fillRect(sx > 0 ? x : x - 2, y, 3, 1); ctx.fillRect(x, sy > 0 ? y : y - 2, 1, 3);
    }
  }

  /** One doll slot: empty (faint silhouette of what it takes), filled (the item, a warm frame) or locked (greyed, hatched, a padlock). */
  private renderSlot(d: GearSlotDef) {
    const g = this.g, ctx = g.ctx, r = dollRect(d.id);
    const usable = slotUsable(g.world, g.pl, d.id), item = wornIn(g.pl, d.id);
    const sel = this.slot === d.id && this.mode === "view";
    if (!usable) {
      frame(ctx, r.x, r.y, r.w, r.h, "#0c0b0e", sel ? selEdge(g.t) : "#1c1a20", sel ? "#e8d8a8" : "#26232b");
      ctx.fillStyle = "#17151c";
      for (let j = 0; j < r.h - 4; j++) for (let i = 0; i < r.w - 4; i++) if ((i + j) % 5 === 0) ctx.fillRect(r.x + 2 + i, r.y + 2 + j, 1, 1);
      this.padlock(r.x + r.w / 2, r.y + r.h / 2, sel ? "#8a8392" : "#4a4552");
    } else if (item) {
      frame(ctx, r.x, r.y, r.w, r.h, sel ? "#2a2230" : "#1c1722", sel ? selEdge(g.t) : "#6a5634", sel ? "#e8d8a8" : "#a88a4c");
      ctx.drawImage(itemIcon(item).a, r.x + (r.w - 16) / 2, r.y + (r.h - 16) / 2);
    } else {
      frame(ctx, r.x, r.y, r.w, r.h, sel ? "#221d26" : "#100e12", sel ? selEdge(g.t) : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
      ctx.globalAlpha *= sel ? 0.5 : 0.28;
      ctx.drawImage((d.kind === "back" ? itemIcon("basket") : slotIcon(d.kind)).a, r.x + (r.w - 16) / 2, r.y + (r.h - 16) / 2);
      ctx.globalAlpha /= sel ? 0.5 : 0.28;
      if (d.kind === "rune") drawText(ctx, d.name.slice(-1), r.x + 3, r.y + 3, UI.dim);
    }
    if (d.kind !== "rune") drawText(ctx, d.name, r.x + r.w / 2, r.y + r.h + 2, sel ? UI.title : usable ? UI.dim : UI.lock, 1, "center");
    if (sel) this.ticks(r);
  }

  private padlock(cx: number, cy: number, col: string) {
    const ctx = this.g.ctx;
    ctx.fillStyle = col;
    cx = Math.round(cx); cy = Math.round(cy);
    ctx.fillRect(cx - 2, cy - 4, 1, 3); ctx.fillRect(cx + 2, cy - 4, 1, 3); ctx.fillRect(cx - 1, cy - 5, 3, 1);
    ctx.fillRect(cx - 3, cy - 1, 7, 6);
    ctx.fillStyle = "#0c0b0e"; ctx.fillRect(cx, cy + 1, 1, 2);
  }

  /** The panel under both: what the cursor is on, what it does, and the keys. */
  private renderDescription() {
    const g = this.g, ctx = g.ctx, pl = g.pl, w = g.world;
    const bx = DX, by = PY + PH - 38, bw = PW - 16, bh = 34;
    frame(ctx, bx, by, bw, bh, "#0e0c10", "#2a2630", "#3a3540");
    let icon: HTMLCanvasElement | null = null, ghost = false;
    let name = "", sub = "", subCol: string = UI.dim;
    let lines: string[] = [], keys: string[] = [];
    let linesCol: string = "#a89c80";
    if (this.slot) {
      const d = slotDef(this.slot), usable = slotUsable(w, pl, d.id), item = wornIn(pl, d.id);
      if (!usable) {
        name = d.name; sub = "LOCKED"; subCol = UI.bad; lines = lockedText(w, pl, d); linesCol = UI.mid; ghost = true;
        icon = (d.kind === "back" ? itemIcon("basket") : slotIcon(d.kind)).a;
      } else if (item) {
        const def = ITEMS[item];
        icon = itemIcon(item).a; name = def.name; sub = `WORN: ${d.name}`; subCol = UI.gold;
        lines = [...(def.desc ?? []), ...effectLines(item)]; keys = ["E TAKE OFF"];
      } else {
        icon = (d.kind === "back" ? itemIcon("basket") : slotIcon(d.kind)).a; ghost = true;
        name = d.name; sub = "EMPTY"; lines = d.hint ?? []; keys = this.mode === "view" ? ["WEAR FROM THE PACK"] : [];
      }
    } else {
      const s = pl.inventory[this.cursor];
      if (s) {
        const def = ITEMS[s.item];
        icon = itemIcon(s.item).a; name = def.name + (s.n > 1 ? ` X${s.n}` : "");
        sub = def.tags.join(" ").toUpperCase();
        lines = [...(def.desc ?? []), ...effectLines(s.item)];
        if (this.mode === "select") keys = isGlyph(s.item) ? ["E PLACE"] : [];
        else {
          if (def.opens) keys.push("E READ");
          else if (def.wear) keys.push(targetSlot(w, pl, s.item) ? `E WEAR (${slotDef(targetSlot(w, pl, s.item)!).name})` : "NO FREE SLOT YET");
          keys.push(def.droppable === false ? "CAN'T DROP" : "Q DROP");
        }
      } else { name = "EMPTY"; sub = `SLOT ${this.cursor + 1}`; ghost = false; lines = []; }
    }
    // icon box
    frame(ctx, bx + 4, by + 5, 22, 22, "#100e12", "#2a2630", "#3a3540");
    if (icon) { ctx.globalAlpha = ghost ? 0.35 : 1; ctx.drawImage(icon, bx + 7, by + 8); ctx.globalAlpha = 1; }
    drawText(ctx, clipText(name, 120), bx + 31, by + 5, UI.title);
    drawText(ctx, clipText(sub, 100), bx + 31 + Math.min(120, name.length * 4) + 6, by + 5, subCol);
    lines.slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, 170), bx + 31, by + 13 + i * 6, linesCol));
    keys.slice(0, 2).forEach((k, i) => drawText(ctx, clipText(k, 86), bx + bw - 5, by + 14 + i * 7, i === 0 ? UI.text : UI.dim, 1, "right"));
  }
}
