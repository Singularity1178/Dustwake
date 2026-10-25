// Crafting screen: an overlay opened when the golem uses a crafting bench
// (the `useStation` effect emits `openStation`; the host pushes this screen).
// UI SHELL ONLY: a recipe list, a detail view with ingredients against what
// the golem carries, and a CRAFT button that calls orderCraft, which today only
// validates and reports. Crafting draws from the golem's own pack: the bench
// has no slots. Rows come from content/crafting.ts.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText } from "../ui/kit";
import { ITEM_NAMES } from "../content/items";
import { craftEntries, orderCraft, CRAFT_TEXT, type CraftEntry } from "../sim/crafting";
import { itemIcon, propSprite } from "../art";
import { drawText } from "../font";
import { clamp } from "../util";

const PX = 34, PY = 18, PW = 252, PH = 146;
const LX = PX + 8, LY = PY + 22, LW = 92, ROW = 11, ROWS = 9;
const DX = LX + LW + 6, DY = LY, DW = PX + PW - 8 - DX, DH = ROWS * ROW + 6;

export class CraftingUi {
  readonly screen: Screen;
  station = "crafting";
  /** The bench that was used (for a future "craft here" task). */
  propId: string | null = null;
  cursor = 0;
  scroll = 0;
  /** Focus: the recipe list, or the CRAFT button. */
  focus: "list" | "button" = "list";
  private list: CraftEntry[] = [];

  constructor(private g: UiHost) {
    this.screen = { id: "crafting", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  open(station: string, propId: string) {
    this.station = station; this.propId = propId; this.focus = "list";
    this.cursor = 0; this.scroll = 0;
    this.refresh();
    this.g.screens.push(this.screen);
    this.g.sfx.open();
  }

  private refresh() {
    this.list = craftEntries(this.g.world, this.g.pl, this.station);
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.list.length - 1));
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + ROWS) this.scroll = this.cursor - ROWS + 1;
  }

  private update() {
    const g = this.g;
    this.refresh();
    if (g.hit("escape", "i", "tab", "b")) { g.screens.popToBase(); return; }
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
      orderCraft(g.world, g.pl, this.station, e.recipe.id);
      g.sfx.thud();
      g.drainEvents();
    }
  }

  private render() {
    const g = this.g, ctx = g.ctx, t = g.t;
    this.refresh();
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, 320, 180);
    panel(ctx, PX, PY, PW, PH);
    const bench = propSprite("craftbench", 0, false);
    if (bench) ctx.drawImage(bench.a, PX + 8, PY + 3, 16, 14);
    drawText(ctx, "CRAFTING BENCH", PX + 28, PY + 8, UI.title);
    drawText(ctx, "USES YOUR PACK", PX + PW - 8, PY + 8, UI.dim, 1, "right");
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
    if (!this.list.length) drawText(ctx, "NO PLANS", LX + LW / 2, LY + 40, UI.dim, 1, "center");
    // detail
    frame(ctx, DX, DY, DW, DH, "#0e0c10");
    const e = this.list[this.cursor];
    if (e) {
      const r = e.recipe;
      frame(ctx, DX + 4, DY + 4, 22, 22, "#100e12", "#2a2630", "#3a3540");
      if (r.output) ctx.drawImage(itemIcon(r.output.item).a, DX + 7, DY + 7);
      else drawText(ctx, "?", DX + 14, DY + 13, UI.mid);
      drawText(ctx, clipText(r.name, DW - 36), DX + 30, DY + 6, UI.title);
      drawText(ctx, r.output ? `MAKES ${r.output.n} ${ITEM_NAMES[r.output.item]}` : r.placeholder ? "PLACEHOLDER ENTRY" : "MAKES NOTHING YET", DX + 30, DY + 14, UI.dim);
      r.desc.slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, DW - 8), DX + 4, DY + 30 + i * 8, "#a89c80"));
      ctx.fillStyle = "#2a2630"; ctx.fillRect(DX + 4, DY + 55, DW - 8, 1);
      drawText(ctx, "NEEDS", DX + 4, DY + 59, UI.dim);
      drawText(ctx, "CARRIED", DX + DW - 4, DY + 59, UI.dim, 1, "right");
      e.lines.slice(0, 3).forEach((l, i) => {
        const y = DY + 67 + i * 7;
        drawText(ctx, `${l.need} ${ITEM_NAMES[l.item]}`, DX + 4, y, UI.text);
        drawText(ctx, String(l.have), DX + DW - 4, y, l.have >= l.need ? UI.ok : UI.bad, 1, "right");
      });
      // CRAFT button
      const bx = DX + 4, by = DY + DH - 16, bw = 40, can = e.status === "ok", foc = this.focus === "button";
      frame(ctx, bx, by, bw, 12, can ? "#1e2a1c" : "#16131a", foc ? selEdge(t) : can ? "#4a6a40" : "#2a2630", foc ? "#e8d8a8" : "#3a3540");
      drawText(ctx, "CRAFT", bx + bw / 2, by + 4, can ? UI.ok : UI.dim, 1, "center");
      const why = e.status === "ok" ? "READY" : CRAFT_TEXT[e.status];
      drawText(ctx, clipText(why, DW - bw - 14), bx + bw + 5, by + 4, e.status === "ok" ? UI.ok : UI.mid);
    }
    drawText(ctx, "W/S CHOOSE   D/E TO BUTTON   E CRAFT   ESC CLOSE", 160, PY + PH - 10, UI.dim, 1, "center");
    g.renderNote(PY + PH + 6);
  }
}
