// The build interface: one overlay screen ("build") with three modes.
//   menu   - browse the catalog: category tabs, a scrolling grid, a detail
//            panel, search, sort, "can build only" filter and favorites.
//   place  - the placement ghost for the chosen recipe (validity from the sim).
//   remove - the deconstruct tool: highlights what can be taken apart and
//            shows the refund before confirming.
// Presentation only: every rule comes from sim/build.ts and sim/catalog.ts, and
// confirming issues orderBuild / orderDeconstruct (normal task + effect path).
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, drawFitted, clipText, TextField } from "../ui/kit";
import { RECIPES, BUILD_CATEGORIES, BUILD_REACH, AUTHORED_SALVAGE, categoryName, placeRule, type Recipe, type Cost } from "../content/build";
import { ITEM_NAMES } from "../content/items";
import { propDef } from "../content/props";
import { TS } from "../content/tiles";
import { FLAGS } from "../content/flags";
import { catalogEntries, queryCatalog, entryReason, SORT_KEYS, SORT_NAMES, TAB_ALL, TAB_FAV, type CatalogEntry, type SortKey } from "../sim/catalog";
import {
  placement, siteFor, suggestTile, recipeAnchor, footprint, canBuild, actorTile, frontTile, BLOCK_TEXT,
  deconTargetAt, deconstructCheck, isDeconstructable, propTile, salvageOf, DECON_TEXT,
} from "../sim/build";
import { orderBuild, orderDeconstruct } from "../sim/commands";
import { propSprite } from "../art/props";
import { drawText, textWidth } from "../font";
import { hasFlag } from "../world/world";
import type { PropInst } from "../world/area";
import { clamp } from "../util";

type Mode = "menu" | "place" | "remove";

const TABS: { id: string; name: string }[] = [{ id: TAB_ALL, name: "ALL" }, { id: TAB_FAV, name: "FAV" }, ...BUILD_CATEGORIES];
const COLS = 6, ROWS = 5, CELL = 20, PITCH = 22;
const GX = 14, GY = 52, DX = 152, DY = 52, DW = 154, DH = 108;
const FAV_KEY = "dustwake.buildFavorites";

/** Sprite shown for a recipe (lit variant for lit props). */
export function recipeSprite(r: Recipe) {
  const def = propDef(r.prop);
  return propSprite(r.prop, r.v ?? 0, def.alt === "lit" ? !!r.lit : false);
}
const costText = (c: readonly Cost[]) => c.map((k) => `+${k.n} ${ITEM_NAMES[k.item]}`).join(" ");

/** A readable name for any prop: its recipe's name, else its kind. */
function propLabel(p: PropInst) {
  const s = AUTHORED_SALVAGE[p.kind];
  const id = p.recipe ?? (s && "recipe" in s ? s.recipe : undefined) ?? Object.keys(RECIPES).find((k) => RECIPES[k].prop === p.kind && p.dyn);
  return id && RECIPES[id] ? RECIPES[id].name : p.kind.replace(/_/g, " ").toUpperCase();
}

function loadFavs(): string[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]"); } catch { return []; }
}

export class BuildUi {
  readonly screen: Screen;
  mode: Mode = "menu";
  tab = 0;
  cursor = 0;
  scroll = 0;
  sort: SortKey = "category";
  affordableOnly = false;
  /** Favorites are a presentation preference (local storage), not world state. */
  favorites = new Set<string>(loadFavs());
  search = new TextField(18);
  /** The recipe being placed; remembered as the last used entry. */
  recipe: string | null = null;
  cur = { tx: 0, ty: 0 };
  /** Return to the same tool after the ordered work finishes. */
  repeat = true;
  /** Tool to reopen once the golem is idle again (set when work is ordered). */
  pending: Mode | null = null;
  private all: CatalogEntry[] = [];
  private list: CatalogEntry[] = [];

  constructor(private g: UiHost) {
    this.screen = { id: "build", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  // ---------------------------------------------------------------- entry points
  private knows() {
    if (hasFlag(this.g.world, FLAGS.knowBuild)) return true;
    this.g.say("YOU DON'T KNOW HOW TO BUILD. PERHAPS A BOOK..."); this.g.sfx.thud();
    return false;
  }
  private show(mode: Mode) {
    if (!this.g.screens.is("build")) this.g.screens.push(this.screen);
    this.pending = null;
    if (mode === "menu") this.toMenu(); else if (mode === "place") this.toPlace(); else this.toRemove();
  }
  /** B: the catalog, with the cursor on the last used entry. */
  open() { if (this.knows()) { this.show("menu"); this.g.sfx.tone(360, 0.08, "triangle", 0.05); } }
  /** V: place the last used entry again, straight to the ghost. */
  quickPlace() {
    if (!this.knows()) return;
    if (!this.recipe) { this.open(); return; }
    this.show("place");
  }
  /** The play screen calls this whenever the golem is idle: reopen the tool after ordered work. */
  resumeAfterWork() {
    const m = this.pending;
    this.pending = null;
    if (!m || !this.repeat) return;
    if (m === "place") {
      const ok = this.recipe ? canBuild(this.g.world, this.g.pl, this.recipe) : null;
      if (!ok?.ok) { if (ok) this.g.say(BLOCK_TEXT[ok.reason]); return; }
    }
    this.g.screens.push(this.screen);
    this.mode = m;
    this.clampCursor();
  }
  private close() { this.search.active = false; this.g.screens.popToBase(); }

  private toMenu() {
    this.mode = "menu";
    this.search.active = false;
    this.refresh();
    const i = this.recipe ? this.list.findIndex((e) => e.id === this.recipe) : -1;
    if (i >= 0) { this.cursor = i; this.scrollTo(); }
  }
  private toPlace() {
    const g = this.g;
    this.mode = "place";
    this.cur = suggestTile(g.world, g.pl, g.area, this.recipe!);
    g.sfx.tone(440, 0.06, "triangle", 0.04);
  }
  private toRemove() {
    const g = this.g, t = actorTile(g.pl);
    this.mode = "remove";
    // Start on the nearest thing that can be taken apart, else in front of the golem.
    let best: PropInst | null = null, bd = Infinity;
    for (const p of g.area.props) {
      if (!isDeconstructable(p)) continue;
      const pt = propTile(p), d = Math.max(Math.abs(pt.tx - t.tx), Math.abs(pt.ty - t.ty));
      if (d <= BUILD_REACH && Math.hypot(p.x - g.pl.x, p.y - g.pl.y) < bd) { bd = Math.hypot(p.x - g.pl.x, p.y - g.pl.y); best = p; }
    }
    this.cur = best ? propTile(best) : frontTile(g.pl);
    this.clampCursor();
    g.sfx.tone(300, 0.06, "triangle", 0.04);
  }

  // ---------------------------------------------------------------- catalog
  private refresh() {
    const g = this.g;
    this.all = catalogEntries(g.world, g.pl);
    this.list = queryCatalog(this.all, { tab: TABS[this.tab].id, search: this.search.value, sort: this.sort, affordableOnly: this.affordableOnly, favorites: this.favorites });
    this.cursor = clamp(this.cursor, 0, Math.max(0, this.list.length - 1));
    this.scrollTo();
  }
  private scrollTo() {
    const row = Math.floor(this.cursor / COLS);
    if (row < this.scroll) this.scroll = row;
    if (row >= this.scroll + ROWS) this.scroll = row - ROWS + 1;
    this.scroll = clamp(this.scroll, 0, Math.max(0, Math.ceil(this.list.length / COLS) - ROWS));
  }
  private saveFavs() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...this.favorites])); } catch { /* storage unavailable: favorites last for the session */ } }

  // ---------------------------------------------------------------- update
  private update() {
    if (this.mode === "menu") this.updateMenu();
    else if (this.mode === "place") this.updatePlace();
    else this.updateRemove();
  }

  private moveGrid(letters: boolean) {
    const g = this.g, n = this.list.length;
    if (!n) return;
    const L = letters ? ["arrowleft", "a"] : ["arrowleft"], R = letters ? ["arrowright", "d"] : ["arrowright"];
    const U = letters ? ["arrowup", "w"] : ["arrowup"], D = letters ? ["arrowdown", "s"] : ["arrowdown"];
    const c = this.cursor;
    if (g.hit(...L)) this.cursor = Math.max(0, c - 1);
    if (g.hit(...R)) this.cursor = Math.min(n - 1, c + 1);
    if (g.hit(...U) && c - COLS >= 0) this.cursor = c - COLS;
    if (g.hit(...D)) this.cursor = Math.min(n - 1, c + COLS);
    if (this.cursor !== c) { g.sfx.tone(500, 0.04, "square", 0.02); this.scrollTo(); }
  }

  private updateMenu() {
    const g = this.g, s = this.search;
    this.refresh();
    if (s.active) {
      // Typing mode: letters go to the field; only arrows browse.
      if (s.feed(g.typed)) { this.cursor = 0; this.scroll = 0; this.refresh(); g.sfx.tone(620, 0.02, "square", 0.015); }
      if (g.hit("enter")) { s.active = false; g.sfx.tone(420, 0.05, "triangle", 0.04); }
      else if (g.hit("escape")) { s.clear(); s.active = false; this.refresh(); }
      this.moveGrid(false);
      return;
    }
    if (g.hit("escape", "b", "i", "tab")) { this.close(); return; }
    if (g.hit("/", "t")) { s.active = true; g.sfx.tone(520, 0.05, "triangle", 0.04); return; }
    let tab = this.tab;
    if (g.hit("q")) tab = (tab + TABS.length - 1) % TABS.length;
    if (g.hit("r")) tab = (tab + 1) % TABS.length;
    for (let i = 0; i < TABS.length; i++) if (g.hit(String(i + 1))) tab = i;
    if (tab !== this.tab) { this.tab = tab; this.cursor = 0; this.scroll = 0; this.refresh(); g.sfx.tone(380, 0.05, "triangle", 0.04); }
    if (g.hit("o")) { this.sort = SORT_KEYS[(SORT_KEYS.indexOf(this.sort) + 1) % SORT_KEYS.length]; this.refresh(); g.sfx.tone(450, 0.04, "triangle", 0.04); }
    if (g.hit("g")) { this.affordableOnly = !this.affordableOnly; this.cursor = 0; this.refresh(); g.sfx.tone(450, 0.04, "triangle", 0.04); }
    const e = this.list[this.cursor];
    if (g.hit("f") && e) {
      if (this.favorites.has(e.id)) this.favorites.delete(e.id); else this.favorites.add(e.id);
      this.saveFavs(); this.refresh(); g.sfx.tone(this.favorites.has(e.id) ? 700 : 350, 0.06, "triangle", 0.04);
    }
    if (g.hit("x")) { this.toRemove(); return; }
    this.moveGrid(true);
    if (g.hit("e", "enter", " ")) {
      const sel = this.list[this.cursor];
      if (!sel) { g.sfx.thud(); return; }
      if (sel.status !== "ok") { g.say(entryReason(sel)); g.sfx.thud(); return; }
      this.recipe = sel.id;
      this.toPlace();
    }
  }

  private clampCursor() {
    const t = actorTile(this.g.pl), c = this.cur;
    c.tx = clamp(c.tx, t.tx - BUILD_REACH, t.tx + BUILD_REACH); c.ty = clamp(c.ty, t.ty - BUILD_REACH, t.ty + BUILD_REACH);
  }
  private moveTile() {
    const g = this.g, c = this.cur, ox = c.tx, oy = c.ty;
    if (g.hit("arrowleft", "a")) c.tx--;
    if (g.hit("arrowright", "d")) c.tx++;
    if (g.hit("arrowup", "w")) c.ty--;
    if (g.hit("arrowdown", "s")) c.ty++;
    this.clampCursor();
    if (c.tx !== ox || c.ty !== oy) g.sfx.tone(500, 0.03, "square", 0.02);
  }
  /** Keys shared by the two world tools. Returns true if the screen changed. */
  private toolKeys(): boolean {
    const g = this.g;
    if (g.hit("escape", "i", "tab")) { this.close(); return true; }
    if (g.hit("b", "q")) { this.toMenu(); return true; }
    if (g.hit("x")) { if (this.mode === "remove") { if (this.recipe) this.toPlace(); else this.toMenu(); } else this.toRemove(); return true; }
    if (g.hit("t")) { this.repeat = !this.repeat; g.sfx.tone(this.repeat ? 600 : 400, 0.05, "triangle", 0.04); }
    this.moveTile();
    return false;
  }

  private updatePlace() {
    const g = this.g;
    if (!this.recipe) { this.toMenu(); return; }
    if (this.toolKeys()) return;
    if (g.hit("e", "enter", " ")) {
      if (orderBuild(g.world, g.pl, this.recipe, this.cur.tx, this.cur.ty)) { this.close(); this.pending = "place"; }
      else g.sfx.thud();
      g.drainEvents();
    }
  }

  private updateRemove() {
    const g = this.g;
    if (this.toolKeys()) return;
    if (g.hit("e", "enter", " ")) {
      const p = deconTargetAt(g.area, this.cur.tx, this.cur.ty);
      if (p && orderDeconstruct(g.world, g.pl, p.id)) { this.close(); this.pending = "remove"; }
      else { if (!p) g.say(DECON_TEXT.none); g.sfx.thud(); }
      g.drainEvents();
    }
  }

  // ---------------------------------------------------------------- render
  private render() {
    if (this.mode === "menu") this.renderMenu();
    else if (this.mode === "place") this.renderPlace();
    else this.renderRemove();
  }

  private renderMenu() {
    const g = this.g, ctx = g.ctx, t = g.t;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, 320, 180);
    panel(ctx, 6, 6, 308, 166);
    drawText(ctx, "BUILD", 14, 12, UI.title);
    drawText(ctx, `${this.list.length} OF ${this.all.length} PLANS`, 306, 12, UI.dim, 1, "right");
    // tabs
    let x = GX;
    TABS.forEach((tb, i) => {
      const w = textWidth(tb.name) + 8, sel = i === this.tab;
      frame(ctx, x, 22, w, 11, sel ? "#2a2430" : "#100e12", sel ? "#9a8c66" : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
      drawText(ctx, tb.name, x + 4, 25, sel ? UI.title : UI.mid);
      x += w + 3;
    });
    frame(ctx, 267, 22, 39, 11, "#1a1210", "#5a3a2a", "#7a5a3a");
    drawText(ctx, "X REMOVE", 271, 25, UI.amber);
    // search, sort, filter
    this.search.draw(ctx, GX, 37, 134, t, "/ SEARCH");
    frame(ctx, 152, 37, 56, 11, "#100e12", "#2a2630", "#3a3540");
    drawText(ctx, "O", 156, 40, UI.dim); drawText(ctx, "SORT:" + SORT_NAMES[this.sort], 164, 40, UI.mid);
    frame(ctx, 212, 37, 94, 11, "#100e12", this.affordableOnly ? "#4a6a40" : "#2a2630", "#3a3540");
    drawText(ctx, "G", 216, 40, UI.dim);
    ctx.fillStyle = this.affordableOnly ? UI.ok : "#2a2630"; ctx.fillRect(224, 40, 5, 5);
    drawText(ctx, "CAN BUILD ONLY", 233, 40, this.affordableOnly ? UI.ok : UI.mid);
    // grid
    for (let i = 0; i < COLS * ROWS; i++) {
      const idx = this.scroll * COLS + i, e = this.list[idx];
      const cx = GX + (i % COLS) * PITCH, cy = GY + Math.floor(i / COLS) * PITCH, sel = idx === this.cursor && !!e;
      frame(ctx, cx, cy, CELL, CELL, sel ? "#221d26" : "#100e12", sel ? selEdge(t) : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
      if (!e) continue;
      const s = recipeSprite(e.recipe);
      if (s) drawFitted(ctx, s, cx + CELL / 2, cy + CELL / 2, CELL - 4, e.status === "unknown" ? 0.18 : 1);
      if (e.status === "unknown") drawText(ctx, "?", cx + 9, cy + 8, UI.mid);
      if (e.status === "cost") { ctx.fillStyle = "#c04a3a"; ctx.fillRect(cx + CELL - 5, cy + 3, 2, 2); }
      if (this.favorites.has(e.id)) { ctx.fillStyle = UI.gold; ctx.fillRect(cx + 3, cy + 3, 2, 2); }
    }
    if (!this.list.length) drawText(ctx, "NO MATCHING PLANS", GX + (COLS * PITCH - 2) / 2, GY + 50, UI.dim, 1, "center");
    // scrollbar
    const rowsTotal = Math.ceil(this.list.length / COLS);
    if (rowsTotal > ROWS) {
      const h = ROWS * PITCH - 2, bh = Math.max(6, Math.round(h * ROWS / rowsTotal)), by = GY + Math.round((h - bh) * this.scroll / (rowsTotal - ROWS));
      ctx.fillStyle = "#2a2630"; ctx.fillRect(GX + COLS * PITCH, GY, 2, h);
      ctx.fillStyle = "#8a8392"; ctx.fillRect(GX + COLS * PITCH, by, 2, bh);
    }
    this.renderDetail(this.list[this.cursor]);
    const hint = this.search.active
      ? "TYPE TO SEARCH   ARROWS MOVE   ENTER DONE   ESC CLEAR"
      : "E SELECT  Q/R TAB  / SEARCH  O SORT  G FILTER  F FAV  X REMOVE  ESC";
    drawText(ctx, hint, 160, 164, UI.dim, 1, "center");
    g.renderNote(174);
  }

  private renderDetail(e: CatalogEntry | undefined) {
    const ctx = this.g.ctx;
    frame(ctx, DX, DY, DW, DH, "#0e0c10");
    if (!e) { drawText(ctx, "NOTHING SELECTED", DX + DW / 2, DY + 50, UI.dim, 1, "center"); return; }
    const r = e.recipe, locked = e.status === "unknown";
    frame(ctx, DX + 4, DY + 4, 36, 36, "#100e12", "#2a2630", "#3a3540");
    const s = recipeSprite(r);
    if (s) drawFitted(ctx, s, DX + 22, DY + 22, 32, locked ? 0.2 : 1);
    if (locked) drawText(ctx, "?", DX + 21, DY + 20, UI.mid);
    const tx = DX + 44;
    drawText(ctx, clipText(r.name, DW - 48), tx, DY + 6, locked ? UI.mid : UI.title);
    drawText(ctx, categoryName(r.category), tx, DY + 14, UI.mid);
    drawText(ctx, placeRule(r) === "wall" ? "HANGS ON A WALL" : "STANDS ON FLOOR", tx, DY + 22, UI.dim);
    if (this.favorites.has(e.id)) drawText(ctx, "* FAVORITE", tx, DY + 30, UI.gold);
    r.desc.slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, DW - 8), DX + 4, DY + 44 + i * 8, locked ? UI.lock : "#a89c80"));
    ctx.fillStyle = "#2a2630"; ctx.fillRect(DX + 4, DY + 69, DW - 8, 1);
    drawText(ctx, "COST", DX + 4, DY + 73, UI.dim);
    drawText(ctx, "CARRIED", DX + DW - 4, DY + 73, UI.dim, 1, "right");
    e.lines.slice(0, 3).forEach((l, i) => {
      const y = DY + 81 + i * 7, enough = l.have >= l.need;
      drawText(ctx, `${l.need} ${ITEM_NAMES[l.item]}`, DX + 4, y, locked ? UI.lock : UI.text);
      drawText(ctx, String(l.have), DX + DW - 4, y, locked ? UI.lock : enough ? UI.ok : UI.bad, 1, "right");
    });
    const status = e.status === "ok" ? "READY - E TO PLACE" : entryReason(e);
    drawText(ctx, clipText(status, DW - 8), DX + 4, DY + DH - 8, e.status === "ok" ? UI.ok : e.status === "cost" ? UI.bad : UI.mid);
  }

  /** Top bar for the two world tools. */
  private bar(l1: string, l2: string, l2col: string, l3: string) {
    const ctx = this.g.ctx;
    ctx.fillStyle = "rgba(8,7,10,0.85)"; ctx.fillRect(0, 0, 320, 30);
    drawText(ctx, clipText(l1, 312), 160, 3, UI.title, 1, "center");
    drawText(ctx, clipText(l2, 312), 160, 12, l2col, 1, "center");
    drawText(ctx, clipText(l3, 312), 160, 21, UI.dim, 1, "center");
  }
  private reachOutline(col: string) {
    const g = this.g, ctx = g.wctx, t = actorTile(g.pl);
    const camX = Math.round(g.cam.x), camY = Math.round(g.cam.y);
    const x = (t.tx - BUILD_REACH) * TS - camX, y = (t.ty - BUILD_REACH) * TS - camY, s = (BUILD_REACH * 2 + 1) * TS;
    ctx.fillStyle = col;
    for (let i = 0; i < s; i += 4) { ctx.fillRect(x + i, y, 2, 1); ctx.fillRect(x + i, y + s - 1, 2, 1); ctx.fillRect(x, y + i, 1, 2); ctx.fillRect(x + s - 1, y + i, 1, 2); }
  }
  private box(x0: number, y0: number, w: number, h: number, fill: string, edge: string) {
    const ctx = this.g.wctx;
    ctx.fillStyle = fill; ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = edge; ctx.fillRect(x0, y0, w, 1); ctx.fillRect(x0, y0 + h - 1, w, 1); ctx.fillRect(x0, y0, 1, h); ctx.fillRect(x0 + w - 1, y0, 1, h);
  }

  private renderPlace() {
    const g = this.g, id = this.recipe!, r = RECIPES[id], c = this.cur, ctx = g.wctx;
    const ok = placement(g.world, g.pl, g.area, id, c.tx, c.ty);
    const camX = Math.round(g.cam.x), camY = Math.round(g.cam.y);
    const pulse = 0.25 + 0.12 * Math.sin(g.t * 6);
    const fill = ok.ok ? `rgba(90,220,120,${pulse})` : `rgba(230,70,70,${pulse})`, edge = ok.ok ? "#7ae08a" : "#e05a5a";
    this.reachOutline("rgba(216,207,168,0.35)");
    if (placeRule(r) === "wall") {
      // Every wall face in reach that could take it, so the rule reads at a glance.
      const t = actorTile(g.pl);
      ctx.fillStyle = "rgba(122,224,138,0.55)";
      for (let ty = t.ty - BUILD_REACH; ty <= t.ty + BUILD_REACH; ty++)
        for (let tx = t.tx - BUILD_REACH; tx <= t.tx + BUILD_REACH; tx++)
          if ((tx !== c.tx || ty !== c.ty) && siteFor(g.world, g.area, id, tx, ty).ok) ctx.fillRect(tx * TS - camX + 3, ty * TS - camY + TS - 2, TS - 6, 2);
      // The face it would hang on: the wall tile, with an arrow showing it faces the floor below.
      const x = c.tx * TS - camX, y = c.ty * TS - camY;
      this.box(x, y, TS, TS, fill, edge);
      ctx.fillStyle = edge; ctx.fillRect(x + 2, y + TS - 2, TS - 4, 2);
      ctx.fillRect(x + 7, y + TS + 1, 2, 2); ctx.fillRect(x + 6, y + TS + 3, 4, 1); ctx.fillRect(x + 7, y + TS + 4, 2, 1);
    } else {
      const fp = footprint(r, c.tx, c.ty);
      this.box(Math.round(fp[0] - camX), Math.round(fp[1] - camY), Math.round(fp[2] - fp[0]), Math.round(fp[3] - fp[1]), fill, edge);
    }
    const s = recipeSprite(r);
    if (s) { const a = recipeAnchor(id, c.tx, c.ty); ctx.globalAlpha = ok.ok ? 0.65 : 0.4; ctx.drawImage(s.a, Math.round(a.x - s.ax - camX), Math.round(a.y - s.ay - camY)); ctx.globalAlpha = 1; }
    const cost = r.cost.map((k) => `${k.n} ${ITEM_NAMES[k.item]} (${countOf(g, k.item)})`).join("  ");
    this.bar(`BUILD ${r.name}: ${cost}`, ok.ok ? (placeRule(r) === "wall" ? "READY - HANGS ON THIS WALL FACE" : "READY") : BLOCK_TEXT[ok.reason], ok.ok ? UI.ok : UI.bad,
      `E PLACE  ARROWS MOVE  T REPEAT:${this.repeat ? "ON" : "OFF"}  B MENU  X REMOVE  ESC DONE`);
    g.renderNote(170);
  }

  private renderRemove() {
    const g = this.g, ctx = g.wctx, c = this.cur;
    const camX = Math.round(g.cam.x), camY = Math.round(g.cam.y);
    this.reachOutline("rgba(240,176,80,0.35)");
    const target = deconTargetAt(g.area, c.tx, c.ty);
    const chk = deconstructCheck(g.world, g.pl, g.area, target?.id);
    // Corner brackets on everything in view that can be taken apart.
    const blink = 0.55 + 0.35 * Math.sin(g.t * 5);
    for (const p of g.area.props) {
      if (!isDeconstructable(p) || p.x < camX - 32 || p.x > camX + g.vw + 32 || p.y < camY - 16 || p.y > camY + g.vh + 48) continue;
      const b = spriteBounds(p);
      ctx.globalAlpha = p === target ? 1 : blink * 0.7;
      brackets(ctx, b.x - camX - 1, b.y - camY - 1, b.w + 2, b.h + 2, p === target && chk.ok ? "#ffd070" : "#f0a040");
      ctx.globalAlpha = 1;
    }
    const x = c.tx * TS - camX, y = c.ty * TS - camY;
    const pulse = 0.2 + 0.1 * Math.sin(g.t * 6);
    this.box(x, y, TS, TS, chk.ok ? `rgba(240,170,60,${pulse})` : `rgba(230,70,70,${pulse * 0.8})`, chk.ok ? "#f0b050" : target ? "#e05a5a" : "#8a8392");
    if (target && !chk.ok) { const b = spriteBounds(target); this.box(b.x - camX - 1, b.y - camY - 1, b.w + 2, b.h + 2, "rgba(230,70,70,0.15)", "#e05a5a"); }
    const hints = `E TAKE APART  ARROWS MOVE  T REPEAT:${this.repeat ? "ON" : "OFF"}  B MENU  X BUILD  ESC DONE`;
    if (chk.ok) this.bar(`TAKE APART ${propLabel(chk.prop)}`, `REFUND ${costText(chk.refund)}`, UI.ok, hints);
    else if (target && chk.reason === "reach") this.bar(`TAKE APART ${propLabel(target)}`, `${DECON_TEXT.reach} - REFUND ${costText(salvageOf(target) ?? [])}`, UI.bad, hints);
    else this.bar(target ? propLabel(target) : "TAKE APART", DECON_TEXT[chk.ok ? "none" : chk.reason], target ? UI.bad : UI.mid, hints);
    g.renderNote(170);
  }
}

const countOf = (g: UiHost, item: Cost["item"]) => g.pl.inventory.reduce((s, x) => s + (x?.item === item ? x.n : 0), 0);

/** World-space bounds of a prop's current sprite (or its tile if it has none). */
function spriteBounds(p: PropInst) {
  const def = propDef(p.kind);
  const alt = def.alt === "lit" ? !!p.lit : def.alt === "taken" ? p.taken : p.open;
  const s = propSprite(p.kind, p.v, alt);
  if (!s) { const t = propTile(p); return { x: t.tx * TS, y: t.ty * TS, w: TS, h: TS }; }
  return { x: Math.round(p.x - s.ax), y: Math.round(p.y - s.ay), w: s.a.width, h: s.a.height };
}

function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string) {
  ctx.fillStyle = col;
  const k = 3;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]]) {
    ctx.fillRect(sx > 0 ? cx : cx - k + 1, cy, k, 1);
    ctx.fillRect(cx, sy > 0 ? cy : cy - k + 1, 1, k);
  }
}
