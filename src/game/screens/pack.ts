// The pack (inventory) overlay. Two modes:
//   view   - browse slots, E reads a book / the schematic or puts gear on (the
//            basket goes onto the golem's back), Q drops one. The back slot
//            sits beside the golem figure, just left of the first pack slot
//            (A / left from it); E there takes the gear off again.
//   select - opened by the play screen when the golem uses an empty ritual
//            socket: only glyphs are pickable, E places the selected one.
// Presentation only: dropping, placing and wearing go through sim commands.
import type { Screen } from "../ui/screens";
import { type UiHost, frame, panel, selEdge } from "../ui/kit";
import { ITEMS, ITEM_NAMES, RELICS, isGlyph, type ItemId } from "../content/items";
import { FLAGS } from "../content/flags";
import { capacity, hasItem } from "../sim/inventory";
import { wornIn } from "../sim/gear";
import { dropFromSlot, wearFromSlot, takeOffGear } from "../sim/commands";
import { placeGlyph } from "../sim/ritual";
import { hasFlag } from "../world/world";
import { itemIcon } from "../art/items";
import { propSprite } from "../art/props";
import { drawGolem, type GolemPose } from "../golem";
import { drawText, drawTextS, textWidth } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { makeCanvas, Pen, clamp } from "../util";

export type PackMode = "view" | "select";

/** Cursor value of the back slot (gear). Pack slots are 0..cap-1. */
export const BACK_SLOT = -1;

/** Pack grid layout per capacity tier: stays readable at 8, 16 and 48 slots without scrolling. */
export function packLayout(cap: number) {
  const L = cap <= 8 ? { cols: 4, pitch: 30, cell: 26 } : cap <= 16 ? { cols: 4, pitch: 26, cell: 24 } : { cols: 8, pitch: 19, cell: 18 };
  const rows = Math.ceil(cap / L.cols);
  const gw = L.cols * L.pitch - (L.pitch - L.cell), gh = rows * L.pitch - (L.pitch - L.cell);
  const pw = 100 + gw + 10, ph = Math.max(132, gh + 46);
  const px = Math.floor((W - pw) / 2), py = Math.floor((H - ph) / 2);
  /** Top of the golem figure's frame. */
  const fy = py + Math.floor((ph - 116) / 2);
  /** The back slot: top right of the figure frame, level with the first row of the grid's side. */
  const back = { x: px + 64, y: fy + 4, s: 20 };
  return { ...L, rows, gw, gh, pw, ph, px, py, fy, back };
}

export class PackUi {
  readonly screen: Screen;
  /** Selected pack slot, or BACK_SLOT. */
  cursor = 0;
  mode: PackMode = "view";
  /** The ritual socket being filled (select mode). */
  socket = -1;

  constructor(private g: UiHost) {
    this.screen = { id: "inv", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  /** New session: the cursor starts on the first slot. */
  reset() { this.cursor = 0; }

  get cap() { return capacity(this.g.world, this.g.pl); }

  open(mode: PackMode, socket = -1) {
    const g = this.g;
    g.screens.push(this.screen);
    this.mode = mode;
    this.socket = socket;
    if (mode === "select") {
      const i = g.pl.inventory.findIndex((s) => s && isGlyph(s.item));
      this.cursor = Math.max(0, i);
    }
    if (this.cursor !== BACK_SLOT || mode !== "view") this.cursor = clamp(this.cursor, 0, this.cap - 1);
    g.sfx.tone(300, 0.08, "triangle", 0.05);
  }

  private update() {
    const g = this.g;
    if (g.hit("escape", "i", "tab")) { g.screens.popToBase(); return; }
    const cap = this.cap, cols = packLayout(cap).cols;
    const onBack = this.cursor === BACK_SLOT && this.mode === "view";
    const c = onBack ? BACK_SLOT : clamp(this.cursor, 0, cap - 1);
    let n = c;
    if (onBack) {
      // The back slot sits just left of the first pack slot: right goes back to it, left wraps to the last.
      if (g.hit("arrowright", "d")) n = 0;
      if (g.hit("arrowleft", "a")) n = cap - 1;
    } else {
      if (g.hit("arrowleft", "a")) n = c === 0 && this.mode === "view" ? BACK_SLOT : (c + cap - 1) % cap;
      if (g.hit("arrowright", "d")) n = (c + 1) % cap;
      if (g.hit("arrowup", "w")) n = (c - cols + cap) % cap;
      if (g.hit("arrowdown", "s")) n = (c + cols) % cap;
    }
    this.cursor = n;
    if (n !== c) g.sfx.tone(500, 0.04, "square", 0.02);
    if (n === BACK_SLOT) {
      if (!g.hit("e", "enter", " ")) return;
      const worn = wornIn(g.pl, "back");
      if (!worn) { g.sfx.tone(180, 0.1, "square", 0.04); return; }
      // Taking it off is refused (with a message, nothing changes) if the smaller pack couldn't hold it all.
      if (takeOffGear(g.world, g.pl, "back") === "ok") this.cursor = Math.max(0, g.pl.inventory.findIndex((s) => s?.item === worn));
      else g.sfx.thud();
      g.drainEvents();
      return;
    }
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
        // Gear: onto the golem (the basket onto its back); the cursor follows it to the back slot.
        if (wearFromSlot(g.world, g.pl, this.cursor) === "ok") this.cursor = BACK_SLOT;
        else g.sfx.thud();
        g.drainEvents();
      } else g.sfx.tone(180, 0.1, "square", 0.04);
    }
  }

  private render() {
    const g = this.g, ctx = g.ctx, pl = g.pl, inv = pl.inventory, cap = this.cap;
    const hasArm = hasFlag(g.world, FLAGS.golemArm);
    const L = packLayout(cap), { px, py, pw, ph, fy } = L;
    const back = wornIn(pl, "back");
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    panel(ctx, px, py, pw, ph);
    // golem figure, wearing its gear
    frame(ctx, px + 8, fy, 80, 116, "#0e0c10");
    const fig = makeCanvas(40, 40);
    const pose: GolemPose = { facing: "down", phase: 0, moving: false, hasArm, dormant: 0, eye: 1, core: 0.8 + 0.2 * Math.sin(g.t * 3), raise: 0, reach: 0, t: g.t, eyeFixed: hasFlag(g.world, FLAGS.golemEye), back };
    drawGolem(new Pen(fig.ctx, false), 20, 34, pose);
    ctx.drawImage(fig.c, px + 8, fy + 14, 80, 80);
    if (!hasArm && Math.sin(g.t * 4) > -0.2) {
      ctx.fillStyle = "#8a4040";
      const ax = px + 8 + (20 + 6) * 2, ay = fy + 14 + (34 - 13) * 2;
      for (let i = 0; i < 20; i += 2) { ctx.fillRect(ax + i % 8, ay, 1, 1); ctx.fillRect(ax, ay + i, 1, 1); ctx.fillRect(ax + 8, ay + i, 1, 1); ctx.fillRect(ax + (i % 8), ay + 20, 1, 1); }
    }
    this.renderBackSlot(L, back);
    // relics
    const rel = RELICS.filter((r) => hasItem(pl, r)).length;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < rel ? "#c9a040" : "#2a2630";
      ctx.fillRect(px + 34 + i * 6, fy + 106, 4, 4);
    }
    // header
    const gx = px + 100, gy = py + 16;
    const used = inv.slice(0, cap).filter(Boolean).length;
    drawText(ctx, `PACK ${used}/${cap}`, gx, py + 6, "#8a8392");
    if (this.mode === "select") {
      const s = propSprite("pedestal", 0, false)!;
      ctx.drawImage(s.a, px + pw - 22, py + 2);
      drawText(ctx, "?", px + pw - 24, py + 4, "#a070ff");
    }
    // grid
    for (let i = 0; i < cap; i++) {
      const cx = gx + (i % L.cols) * L.pitch, cy = gy + Math.floor(i / L.cols) * L.pitch;
      const sel = i === this.cursor;
      frame(ctx, cx, cy, L.cell, L.cell, sel ? "#221d26" : "#100e12", sel ? selEdge(g.t) : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
      const slot = inv[i];
      if (!slot) continue;
      const ic = itemIcon(slot.item);
      const dim = this.mode === "select" && !isGlyph(slot.item);
      ctx.globalAlpha = dim ? 0.25 : 1;
      const o = Math.floor((L.cell - 16) / 2);
      ctx.drawImage(ic.a, cx + o, cy + o);
      ctx.globalAlpha = 1;
      if (slot.n > 1) { const t = String(slot.n); drawTextS(ctx, t, cx + L.cell - 1 - textWidth(t), cy + L.cell - 7, "#f0e8d0", 1, "left", "#000"); }
    }
    const ty = gy + L.gh + 6;
    if (this.cursor === BACK_SLOT && this.mode === "view") {
      drawTextS(ctx, back ? ITEM_NAMES[back] : "BACK: EMPTY", gx + L.gw / 2, ty, "#d8d0b8", 1, "center");
      drawText(ctx, back ? "WORN ON YOUR BACK  E TAKE OFF" : "WEAR A BASKET FROM THE PACK", gx + L.gw / 2, ty + 10, "#6a6372", 1, "center");
    } else {
      const slot = inv[this.cursor];
      if (slot) {
        drawTextS(ctx, ITEM_NAMES[slot.item] + (slot.n > 1 ? ` x${slot.n}` : ""), gx + L.gw / 2, ty, "#d8d0b8", 1, "center");
        const def = ITEMS[slot.item];
        const use = def.opens ? "E READ  " : def.wear ? "E WEAR  " : "";
        const hint = this.mode === "select" ? "E PLACE" : `${use}${def.droppable === false ? "CAN'T DROP" : "Q DROP"}`;
        drawText(ctx, hint, gx + L.gw / 2, ty + 10, "#6a6372", 1, "center");
      }
    }
    g.renderNote();
  }

  /** The back slot beside the figure: what the golem wears there, or a faint basket outline when it's empty. */
  private renderBackSlot(L: ReturnType<typeof packLayout>, back: ItemId | undefined) {
    const g = this.g, ctx = g.ctx, b = L.back;
    const sel = this.cursor === BACK_SLOT && this.mode === "view";
    if (this.mode === "select") ctx.globalAlpha = 0.25;
    frame(ctx, b.x, b.y, b.s, b.s, sel ? "#221d26" : "#100e12", sel ? selEdge(g.t) : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
    const o = Math.floor((b.s - 16) / 2);
    if (back) ctx.drawImage(itemIcon(back).a, b.x + o, b.y + o);
    else {
      ctx.globalAlpha *= 0.16;
      ctx.drawImage(itemIcon("basket").a, b.x + o, b.y + o);
    }
    ctx.globalAlpha = 1;
    drawText(ctx, "BACK", b.x - 3 - textWidth("BACK"), b.y + 7, sel ? "#d8d0b8" : "#6a6372");
  }
}
