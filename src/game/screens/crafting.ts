// Crafting screen: an overlay opened when the golem uses a work station such as
// the workbench (the `useStation` effect emits `openStation`; the host pushes
// this screen).
// A recipe list, a detail view with ingredients against what the golem carries
// (and the tools it must carry, which are never used up), and a CRAFT button
// that calls orderCraft. That starts a craft task and closes the screen so the
// golem can work at the bench; when the work is done the host reopens the
// screen (`pending` / `resume`) with the cursor where it was, so a batch is
// CRAFT, wait, CRAFT. Ingredients come from the pack plus nearby storage;
// tools stay carried. Rows come from content/crafting.ts.
//
// Until the golem knows the craft (STATION_REQUIRES) the same layout opens
// greyed out: no plans are listed or readable and the CRAFT button is dead.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText } from "../ui/kit";
import { ITEM_NAMES } from "../content/items";
import { craftEntries, craftLocked, craftReason, orderCraft, CRAFT_LOCKED_TEXT, type CraftEntry } from "../sim/crafting";
import { itemIcon } from "../art/items";
import { propSprite } from "../art/props";
import { drawText } from "../font";
import { clamp } from "../util";

const PX = 34, PY = 18, PW = 252, PH = 146;
const LX = PX + 8, LY = PY + 22, LW = 92, ROW = 11, ROWS = 9;
const DX = LX + LW + 6, DY = LY, DW = PX + PW - 8 - DX, DH = ROWS * ROW + 6;

export class CraftingUi {
  readonly screen: Screen;
  station = "crafting";
  /** The bench that was used: the golem works at it, and the craft effect checks it is still there. */
  propId: string | null = null;
  /** A craft was ordered: the host reopens the screen once the work is done (see resume). */
  pending = false;
  cursor = 0;
  scroll = 0;
  /** Focus: the recipe list, or the CRAFT button. */
  focus: "list" | "button" = "list";
  /** The golem doesn't know the craft: the screen is greyed out and lists nothing. */
  locked = false;
  private list: CraftEntry[] = [];

  constructor(private g: UiHost) {
    this.screen = { id: "crafting", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  open(station: string, propId: string) {
    this.station = station; this.propId = propId; this.focus = "list";
    this.cursor = 0; this.scroll = 0;
    this.pending = false;
    this.refresh();
    this.g.screens.push(this.screen);
    this.g.sfx.open();
  }

  /** The ordered work is done: back to the bench's plans, cursor and focus as they were (if the bench still stands). */
  resume() {
    this.pending = false;
    if (!this.propId || !this.g.area.prop(this.propId)) return;
    this.refresh();
    this.g.screens.push(this.screen);
  }

  private refresh() {
    this.locked = craftLocked(this.g.world, this.g.pl, this.station);
    this.list = craftEntries(this.g.world, this.g.pl, this.station, undefined, this.propId);
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.list.length - 1));
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + ROWS) this.scroll = this.cursor - ROWS + 1;
  }

  private update() {
    const g = this.g;
    this.refresh();
    if (g.hit("escape", "i", "tab", "b")) { g.screens.popToBase(); return; }
    if (this.locked) {
      // Nothing to choose. Using it again just says why it is dark.
      if (g.hit("e", "enter", " ")) { orderCraft(g.world, g.pl, this.station, ""); g.sfx.thud(); g.drainEvents(); }
      return;
    }
    const c = this.cursor;
    if (g.hit("arrowup", "w")) this.cursor = Math.max(0, c - 1);
    if (g.hit("arrowdown", "s")) this.cursor = Math.min(this.list.length - 1, c + 1);
    if (g.hit("arrowright", "d")) this.focus = "button";
    if (g.hit("arrowleft", "a")) this.focus = "list";
    if (this.cursor !== c) { g.sfx.tone(500, 0.04, "square", 0.02); this.refresh(); }
    if (g.hit("e", "enter", " ")) {
      const e = this.list[this.cursor];
      if (!e) { g.sfx.thud(); return; }
      if (this.focus === "list") { this.focus = "button"; g.sfx.tone(420, 0.05, "triangle", 0.04); return; }
      if (orderCraft(g.world, g.pl, this.station, e.recipe.id, this.propId)) {
        // The golem works at the bench with the world running; the host reopens this screen after.
        this.pending = true;
        g.screens.popToBase();
      } else g.sfx.thud();
      g.drainEvents();
    }
  }

  private render() {
    const g = this.g, ctx = g.ctx, t = g.t;
    this.refresh();
    const locked = this.locked;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, 320, 180);
    panel(ctx, PX, PY, PW, PH);
    const bench = propSprite("workbench", 0, false);
    if (bench) { ctx.globalAlpha = locked ? 0.4 : 1; ctx.drawImage(bench.a, PX + 8, PY + 3, 16, 15); ctx.globalAlpha = 1; }
    drawText(ctx, "CRAFTING BENCH", PX + 28, PY + 8, locked ? UI.mid : UI.title);
    drawText(ctx, "PACK + NEARBY STORAGE", PX + PW - 8, PY + 8, UI.dim, 1, "right");
    // recipe list
    frame(ctx, LX, LY, LW, DH, "#0e0c10");
    for (let i = 0; i < ROWS; i++) {
      const idx = this.scroll + i, e = this.list[idx];
      if (!e) continue;
      const y = LY + 3 + i * ROW, sel = idx === this.cursor;
      if (sel) frame(ctx, LX + 2, y, LW - 4, ROW - 1, "#221d26", this.focus === "list" ? selEdge(t) : "#5a5040", "#3a3540");
      const col = e.status === "ok" ? UI.text : e.status === "unknown" ? UI.lock : UI.mid;
      drawText(ctx, clipText(e.status === "unknown" ? "???" : e.recipe.name, LW - 12), LX + 6, y + 2, sel ? UI.title : col);
    }
    if (locked) {
      // Empty rows, no names: the list is there but there is nothing to read in it.
      for (let i = 0; i < 5; i++) { ctx.fillStyle = "#17141b"; ctx.fillRect(LX + 6, LY + 5 + i * ROW, 40 + ((i * 17) % 28), 5); }
    } else if (!this.list.length) drawText(ctx, "NO PLANS", LX + LW / 2, LY + 40, UI.dim, 1, "center");
    // detail
    frame(ctx, DX, DY, DW, DH, "#0e0c10");
    const e = this.list[this.cursor];
    if (e) {
      const r = e.recipe;
      frame(ctx, DX + 4, DY + 4, 22, 22, "#100e12", "#2a2630", "#3a3540");
      ctx.drawImage(itemIcon(r.output.item).a, DX + 7, DY + 7);
      drawText(ctx, clipText(r.name, DW - 36), DX + 30, DY + 6, UI.title);
      drawText(ctx, clipText(`MAKES ${r.output.n} ${ITEM_NAMES[r.output.item]}`, DW - 36), DX + 30, DY + 14, UI.dim);
      r.desc.slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, DW - 8), DX + 4, DY + 30 + i * 8, "#a89c80"));
      ctx.fillStyle = "#2a2630"; ctx.fillRect(DX + 4, DY + 55, DW - 8, 1);
      drawText(ctx, "NEEDS", DX + 4, DY + 59, UI.dim);
      drawText(ctx, "AVAILABLE", DX + DW - 4, DY + 59, UI.dim, 1, "right");
      e.lines.slice(0, 2).forEach((l, i) => {
        const y = DY + 67 + i * 7;
        drawText(ctx, `${l.need} ${ITEM_NAMES[l.item]}`, DX + 4, y, UI.text);
        drawText(ctx, String(l.have), DX + DW - 4, y, l.have >= l.need ? UI.ok : UI.bad, 1, "right");
      });
      // Tools are carried, not used up: shown after the materials, with a tick or a cross.
      e.tools.slice(0, 1).forEach((t, i) => {
        const y = DY + 67 + Math.min(2, e.lines.length) * 7 + i * 7;
        drawText(ctx, clipText(`TOOL ${ITEM_NAMES[t.item]}`, DW - 20), DX + 4, y, UI.mid);
        drawText(ctx, t.have ? "HAVE" : "MISSING", DX + DW - 4, y, t.have ? UI.ok : UI.bad, 1, "right");
      });
    }
    // CRAFT button (also drawn dead while locked, so the layout is the same)
    if (e || locked) {
      const bx = DX + 4, by = DY + DH - 16, bw = 40, can = !locked && e?.status === "ok", foc = !locked && this.focus === "button";
      frame(ctx, bx, by, bw, 12, can ? "#1e2a1c" : "#16131a", foc ? selEdge(t) : can ? "#4a6a40" : "#2a2630", foc ? "#e8d8a8" : "#3a3540");
      drawText(ctx, "CRAFT", bx + bw / 2, by + 4, can ? UI.ok : UI.dim, 1, "center");
      const why = !e ? "LOCKED" : e.status === "ok" ? "READY" : craftReason(e);
      drawText(ctx, clipText(why, DW - bw - 14), bx + bw + 5, by + 4, can ? UI.ok : UI.mid);
    }
    if (locked) {
      // Grey the whole station over, then say why on top of it.
      ctx.fillStyle = "rgba(34,32,40,0.5)"; ctx.fillRect(PX + 2, PY + 2, PW - 4, PH - 4);
      drawText(ctx, clipText(CRAFT_LOCKED_TEXT, DW - 8), DX + DW / 2, DY + 30, UI.mid, 1, "center");
      drawText(ctx, "FIND OUT HOW TO BUILD.", DX + DW / 2, DY + 40, UI.dim, 1, "center");
    }
    drawText(ctx, locked ? "ESC CLOSE" : "W/S CHOOSE   D/E TO BUTTON   E CRAFT   ESC CLOSE", 160, PY + PH - 10, UI.dim, 1, "center");
    g.renderNote(PY + PH + 6);
  }
}
