// Station screen: an overlay opened when the golem uses a work station (the
// `useStation` effect emits `openStation`; the host pushes this screen). One
// screen serves every station, and what makes it the crafting bench, the
// smelter or the anvil is data (content/crafting.ts: STATIONS): its title, the
// station's own sprite in the header, its accent, the word on its action
// button, what it says while the craft is unknown, and its tabs.
//
//   crafting bench   one list: planks, cut stone, runes, the ruby core, hafted tools
//   smelter          one list: ore and a wood fire into ingots (SMELT)
//   anvil            four tabs (Q / R, or 1-4): FORGE tool heads, REPAIR rusted
//                    ones, MODIFY (temper) a head or a tool, set or unset RUNES
//
// A recipe list, a detail view with ingredients against what the golem has
// (and the tools it must carry, which are never used up), and the action
// button, which calls orderCraft. That starts a craft task and closes the
// screen so the golem can work at the station; when the work is done the host
// reopens the screen (`pending` / `resume`) with the tab, cursor and focus
// where they were. Ingredients come from the pack plus nearby storage; tools
// stay carried. Rows come from content/crafting.ts; a row that works on a piece
// (CraftRecipe.work) is listed only while that piece is at hand.
//
// Until the golem knows the craft (StationDef.requires) the same layout opens
// greyed out: no plans are listed or readable and the button is dead.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText } from "../ui/kit";
import { ITEM_NAMES } from "../content/items";
import { STATIONS, isStation, type StationDef, type StationTab } from "../content/crafting";
import { craftList, craftLocked, craftReason, orderCraft, type CraftEntry } from "../sim/crafting";
import { itemIcon } from "../art/items";
import { propSprite } from "../art/props";
import { drawText } from "../font";
import { clamp } from "../util";

const PX = 34, PY = 18, PW = 252, PH = 146;
const LX = PX + 8, LY = PY + 22, LW = 92, ROW = 11;
const DX = LX + LW + 6, DW = PX + PW - 8 - DX;
/** The tab strip's height (and the gap under it), for stations that have tabs. */
const TAB_H = 11, TAB_GAP = 2;

export class CraftingUi {
  readonly screen: Screen;
  station = "crafting";
  /** The station prop that was used: the golem works at it, and the craft effect checks it is still there. */
  propId: string | null = null;
  /** A craft was ordered: the host reopens the screen once the work is done (see resume). */
  pending = false;
  /** The open tab (stations with tabs). */
  tab = 0;
  cursor = 0;
  scroll = 0;
  /** Focus: the recipe list, or the action button. */
  focus: "list" | "button" = "list";
  /** The golem doesn't know the craft: the screen is greyed out and lists nothing. */
  locked = false;
  private list: CraftEntry[] = [];

  constructor(private g: UiHost) {
    this.screen = { id: "crafting", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  /** What this station is (data). An unknown station id reads as the bench. */
  get def(): StationDef { return STATIONS[isStation(this.station) ? this.station : "crafting"]; }
  get tabs(): readonly StationTab[] { return this.def.tabs ?? []; }
  /** The rows the open tab lists now. */
  get entries(): readonly CraftEntry[] { return this.list; }
  private get rows() { return this.tabs.length ? 8 : 9; }

  open(station: string, propId: string) {
    this.station = station; this.propId = propId; this.focus = "list";
    this.tab = 0; this.cursor = 0; this.scroll = 0;
    this.pending = false;
    this.refresh();
    // Open on the first tab that has something to do, so a rusted head brought to the anvil is not a tab away.
    if (!this.locked && this.tabs.length && !this.list.some((e) => e.status === "ok")) {
      const i = this.tabs.findIndex((t) => craftList(this.g.world, this.g.pl, this.station, this.propId, t.id).some((e) => e.status === "ok"));
      if (i > 0) { this.tab = i; this.refresh(); }
    }
    this.g.screens.push(this.screen);
    this.g.sfx.open();
  }

  /** The ordered work is done: back to the station's plans, tab, cursor and focus as they were (if it still stands). */
  resume() {
    this.pending = false;
    if (!this.propId || !this.g.area.prop(this.propId)) return;
    this.refresh();
    this.g.screens.push(this.screen);
  }

  private refresh() {
    this.locked = craftLocked(this.g.world, this.g.pl, this.station);
    this.tab = clamp(this.tab, 0, Math.max(0, this.tabs.length - 1));
    this.list = craftList(this.g.world, this.g.pl, this.station, this.propId, this.tabs[this.tab]?.id);
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.list.length - 1));
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    if (this.cursor >= this.scroll + this.rows) this.scroll = this.cursor - this.rows + 1;
    if (!this.list.length) this.focus = "list";
  }

  private setTab(i: number) {
    const n = this.tabs.length;
    if (!n) return;
    const next = ((i % n) + n) % n;
    if (next === this.tab) return;
    this.tab = next; this.cursor = 0; this.scroll = 0; this.focus = "list";
    this.g.sfx.tone(560, 0.05, "square", 0.025);
    this.refresh();
  }

  /** The word on the action button for a row: its own, else its tab's, else the station's. */
  private verb(e?: CraftEntry) { return e?.recipe.verb ?? this.tabs[this.tab]?.verb ?? this.def.verb; }

  private update() {
    const g = this.g;
    this.refresh();
    if (g.hit("escape", "i", "tab", "b")) { g.screens.popToBase(); return; }
    if (this.locked) {
      // Nothing to choose. Using it again just says why it is dark.
      if (g.hit("e", "enter", " ")) { orderCraft(g.world, g.pl, this.station, ""); g.sfx.thud(); g.drainEvents(); }
      return;
    }
    if (this.tabs.length) {
      if (g.hit("q")) this.setTab(this.tab - 1);
      if (g.hit("r")) this.setTab(this.tab + 1);
      this.tabs.forEach((_, i) => { if (g.hit(String(i + 1))) this.setTab(i); });
    }
    const c = this.cursor;
    if (g.hit("arrowup", "w")) this.cursor = Math.max(0, c - 1);
    if (g.hit("arrowdown", "s")) this.cursor = Math.max(0, Math.min(this.list.length - 1, c + 1));
    if (g.hit("arrowright", "d") && this.list.length) this.focus = "button";
    if (g.hit("arrowleft", "a")) this.focus = "list";
    if (this.cursor !== c) { g.sfx.tone(500, 0.04, "square", 0.02); this.refresh(); }
    if (g.hit("e", "enter", " ")) {
      const e = this.list[this.cursor];
      if (!e) { g.sfx.thud(); return; }
      if (this.focus === "list") { this.focus = "button"; g.sfx.tone(420, 0.05, "triangle", 0.04); return; }
      if (orderCraft(g.world, g.pl, this.station, e.recipe.id, this.propId)) {
        // The golem works at the station with the world running; the host reopens this screen after.
        this.pending = true;
        g.screens.popToBase();
      } else g.sfx.thud();
      g.drainEvents();
    }
  }

  private render() {
    const g = this.g, ctx = g.ctx, t = g.t;
    this.refresh();
    const locked = this.locked, def = this.def, tabs = this.tabs, rows = this.rows;
    // With tabs the lists start lower and are a row shorter; the detail's lower half closes up to fit.
    const top = LY + (tabs.length ? TAB_H + TAB_GAP : 0), DH = rows * ROW + 6, DY = top, tight = tabs.length ? 1 : 0;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, 320, 180);
    panel(ctx, PX, PY, PW, PH);
    const art = propSprite(def.prop, 0, false);
    if (art) { ctx.globalAlpha = locked ? 0.4 : 1; ctx.drawImage(art.a, PX + 8, PY + 3, 16, 15); ctx.globalAlpha = 1; }
    drawText(ctx, def.name, PX + 28, PY + 8, locked ? UI.mid : def.accent);
    drawText(ctx, "PACK + NEARBY STORAGE", PX + PW - 8, PY + 8, UI.dim, 1, "right");
    // the station's colour under the header: steady for the bench and the anvil, breathing like a fire for the smelter
    ctx.globalAlpha = locked ? 0.12 : this.station === "smelting" ? 0.4 + 0.2 * Math.sin(t * 5) : 0.3;
    ctx.fillStyle = def.accent; ctx.fillRect(PX + 8, PY + 19, PW - 16, 1);
    ctx.globalAlpha = 1;
    // tabs
    if (tabs.length) {
      const tw = Math.floor((PW - 16) / tabs.length);
      tabs.forEach((tb, i) => {
        const x = PX + 8 + i * tw, on = i === this.tab && !locked;
        const n = locked ? 0 : craftList(g.world, g.pl, this.station, this.propId, tb.id).length;
        frame(ctx, x, LY, tw - 2, TAB_H, on ? "#221d26" : "#0e0c10", on ? def.accent : "#2a2630", on ? "#3a3540" : "#1c1a20");
        drawText(ctx, `${i + 1} ${tb.name}`, x + (tw - 2) / 2, LY + 3, on ? UI.title : n ? UI.text : UI.dim, 1, "center");
      });
    }
    // recipe list
    frame(ctx, LX, top, LW, DH, "#0e0c10");
    for (let i = 0; i < rows; i++) {
      const idx = this.scroll + i, e = this.list[idx];
      if (!e) continue;
      const y = top + 3 + i * ROW, sel = idx === this.cursor;
      if (sel) frame(ctx, LX + 2, y, LW - 4, ROW - 1, "#221d26", this.focus === "list" ? selEdge(t) : "#5a5040", "#3a3540");
      const col = e.status === "ok" ? UI.text : e.status === "unknown" ? UI.lock : UI.mid;
      drawText(ctx, clipText(e.status === "unknown" ? "???" : e.recipe.name, LW - 12), LX + 6, y + 2, sel ? UI.title : col);
    }
    if (this.list.length > rows) {
      // more above / below
      if (this.scroll > 0) drawText(ctx, "^", LX + LW - 6, top + 2, UI.dim);
      if (this.scroll + rows < this.list.length) drawText(ctx, "V", LX + LW - 6, top + DH - 8, UI.dim);
    }
    // detail
    frame(ctx, DX, DY, DW, DH, "#0e0c10");
    const e = this.list[this.cursor];
    if (locked) {
      // Empty rows, no names: the list is there but there is nothing to read in it.
      for (let i = 0; i < 5; i++) { ctx.fillStyle = "#17141b"; ctx.fillRect(LX + 6, top + 5 + i * ROW, 40 + ((i * 17) % 28), 5); }
    } else if (!this.list.length) {
      drawText(ctx, "NOTHING HERE", LX + LW / 2, top + 40, UI.dim, 1, "center");
      (tabs[this.tab]?.empty ?? ["NO PLANS"]).forEach((l, i) => drawText(ctx, clipText(l, DW - 8), DX + DW / 2, DY + 30 + i * 9, i ? UI.dim : UI.mid, 1, "center"));
    }
    if (e) {
      const r = e.recipe, pitch = tight ? 7 : 8, low = tight ? -4 : 0;
      frame(ctx, DX + 4, DY + 4, 22, 22, "#100e12", "#2a2630", "#3a3540");
      ctx.drawImage(itemIcon(r.output.item).a, DX + 7, DY + 7);
      drawText(ctx, clipText(r.name, DW - 36), DX + 30, DY + 6, UI.title);
      const also = (r.also ?? []).map((x) => ` + ${ITEM_NAMES[x.item]}`).join("");
      drawText(ctx, clipText(`MAKES ${r.output.n} ${ITEM_NAMES[r.output.item]}${also}`, DW - 36), DX + 30, DY + 14, UI.dim);
      r.desc.slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, DW - 8), DX + 4, DY + 30 + i * pitch, "#a89c80"));
      ctx.fillStyle = "#2a2630"; ctx.fillRect(DX + 4, DY + 55 + low, DW - 8, 1);
      drawText(ctx, "NEEDS", DX + 4, DY + 59 + low - tight, UI.dim);
      drawText(ctx, "AVAILABLE", DX + DW - 4, DY + 59 + low - tight, UI.dim, 1, "right");
      e.lines.slice(0, 2).forEach((l, i) => {
        const y = DY + 67 + low - tight + i * 7;
        drawText(ctx, clipText(`${l.need} ${ITEM_NAMES[l.item]}`, DW - 24), DX + 4, y, UI.text);
        drawText(ctx, String(l.have), DX + DW - 4, y, l.have >= l.need ? UI.ok : UI.bad, 1, "right");
      });
      // Tools are carried, not used up: shown after the materials, with a tick or a cross.
      e.tools.slice(0, 1).forEach((tl, i) => {
        const y = DY + 67 + low - tight + Math.min(2, e.lines.length) * 7 + i * 7;
        drawText(ctx, clipText(`TOOL ${ITEM_NAMES[tl.item]}`, DW - 20), DX + 4, y, UI.mid);
        drawText(ctx, tl.have ? "HAVE" : "MISSING", DX + DW - 4, y, tl.have ? UI.ok : UI.bad, 1, "right");
      });
    }
    // the action button (also drawn dead while locked, so the layout is the same)
    if (e || locked) {
      const bx = DX + 4, by = DY + DH - 16, bw = 40, can = !locked && e?.status === "ok", foc = !locked && this.focus === "button";
      frame(ctx, bx, by, bw, 12, can ? "#1e2a1c" : "#16131a", foc ? selEdge(t) : can ? "#4a6a40" : "#2a2630", foc ? "#e8d8a8" : "#3a3540");
      drawText(ctx, this.verb(e), bx + bw / 2, by + 4, can ? UI.ok : UI.dim, 1, "center");
      const why = !e ? "LOCKED" : e.status === "ok" ? "READY" : craftReason(e);
      drawText(ctx, clipText(why, DW - bw - 14), bx + bw + 5, by + 4, can ? UI.ok : UI.mid);
    }
    if (locked) {
      // Grey the whole station over, then say why on top of it.
      ctx.fillStyle = "rgba(34,32,40,0.5)"; ctx.fillRect(PX + 2, PY + 2, PW - 4, PH - 4);
      drawText(ctx, clipText(def.lockedText, DW - 8), DX + DW / 2, DY + 30, UI.mid, 1, "center");
      drawText(ctx, clipText(def.lockedHint, DW - 8), DX + DW / 2, DY + 40, UI.dim, 1, "center");
    }
    const keys = locked ? "ESC CLOSE" : `${tabs.length ? "Q/R TAB   " : ""}W/S CHOOSE   D/E TO BUTTON   E ${this.verb(e)}   ESC CLOSE`;
    drawText(ctx, keys, 160, PY + PH - 10, UI.dim, 1, "center");
    g.renderNote(PY + PH + 6);
  }
}
