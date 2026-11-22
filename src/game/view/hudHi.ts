// The high-resolution HUD (drawn on the 2x UI layer through ui/gui.ts): the game
// speed bar, the notification feed, and the mouse in the world: hover tooltips,
// click to use what E would use, click or drag to select actors, right-click for
// a context menu, an inspector panel for whatever was picked, and the
// performance readout. Presentation only: it acts through the host (a press of
// E on the next tick, the speed, the selection), never on the World directly.
import type { Game } from "../game";
import { BASE_W, BASE_H } from "./zoom";
import { THEME, type Rect } from "../ui/gui";
import { drawText2, textWidth2, clipText2, LINE_H2 } from "../ui/font2";
import { GAME_SPEEDS, speedLabel } from "../core/clock";
import { actorName } from "../ui/notify";
import { keyLabel } from "../ui/settings";
import { folkLabel } from "../sim/folk";
import { keeperLabel } from "../sim/shops";
import { ITEM_NAMES, type ItemId } from "../content/items";
import type { Actor } from "../world/world";
import type { PropInst } from "../world/area";

type Pick = { kind: "actor"; a: Actor } | { kind: "prop"; p: PropInst } | { kind: "loose"; id: string; item: ItemId; x: number; y: number };

/** "MARTA - LABOURER" -> "Marta - Labourer"; mixed case is left alone. */
export function titled(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

export class HiHud {
  selection: string[] = [];
  inspect: { kind: "actor" | "prop"; id: string } | null = null;
  menu: { x: number; y: number; items: { label: string; run: () => void }[] } | null = null;
  private drag: { x0: number; y0: number; x1: number; y1: number; moved: boolean } | null = null;
  private selRow = -1;

  constructor(private g: Game) {}

  reset() { this.selection = []; this.inspect = null; this.menu = null; this.drag = null; }
  /** Esc on the play screen: close the menu / inspector / selection first. True if there was one. */
  dismiss(): boolean {
    if (this.menu) { this.menu = null; return true; }
    if (this.inspect) { this.inspect = null; return true; }
    if (this.selection.length) { this.selection = []; return true; }
    return false;
  }

  render() {
    const g = this.g, play = g.screens.is("play"), sys = g.screens.is("system");
    if (play) this.worldMarks();
    if (play || sys) { this.speedBar(); this.feed(); }
    if (play) { this.selectionPanel(); this.inspectPanel(); this.contextMenu(); this.worldPointer(); }
    if (g.settings.bool("perf") && (play || sys)) this.perfReadout();
  }

  // ------------------------------------------------------------ speed and feed
  private speedBar() {
    const g = this.g, gui = g.gui, L = g.hiLayout(), pauseKeys = g.keysFor("pause").map(keyLabel).join("/");
    // Bottom left corner. Mouse only: W / S / E / Enter / Space never move onto or press these (they are the walk, pick up and slam keys).
    const y0 = L.lh - 21;
    gui.panel({ x: 3, y: y0, w: 5 * 21 + 5, h: 18 });
    GAME_SPEEDS.forEach((s, i) => {
      const hot = i + 1, tip = s === 0 ? `Pause (${hot} or ${pauseKeys})` : `${speedLabel(s)} speed (${hot})`;
      if (gui.button(`speed.${s}`, { x: 6 + i * 21, y: y0 + 3, w: 19, h: 12 }, s === 0 ? "||" : `${s}x`, { selected: g.speed === s, tip, noFocus: true })) g.setSpeed(s);
    });
  }

  private feed() {
    const g = this.g, gui = g.gui, L = g.hiLayout(), items = g.notes.items;
    let y = Math.round(L.lh * 0.2);
    for (const n of items) {
      const text = n.count > 1 ? `${n.text} (x${n.count})` : n.text;
      const w = Math.min(Math.round(L.lw * 0.42), textWidth2(text) + 14), x = L.lw - 4 - w;
      const r = { x, y, w, h: 14 }, a = Math.min(1, (n.ttl - n.age) / 1.2, n.age / 0.15);
      const ctx = gui.ctx!;
      ctx.globalAlpha = Math.max(0, a);
      if (gui.button(`note.${n.id}`, r, "", { tip: "Click to dismiss" })) g.notes.dismiss(n.id);
      const col = n.level === "alert" ? gui.palette.alert : n.level === "warn" ? gui.palette.warn : gui.palette.info;
      gui.fill({ x: r.x + 1, y: r.y + 1, w: 3, h: r.h - 2 }, col);
      drawText2(ctx, clipText2(text, w - 12), r.x + 8, r.y + 3, n.level === "info" ? THEME.text : col);
      ctx.globalAlpha = 1;
      y += 16;
    }
  }

  // ------------------------------------------------------------ the world under the mouse
  private layerOf(wx: number, wy: number) {
    const g = this.g, L = g.hiLayout();
    return g.cam.toLayer(wx, wy, g.vw, g.vh, L.lw, L.lh);
  }

  /** What is under world point (wx, wy): the frontmost actor, prop or loose item. */
  pick(wx: number, wy: number): Pick | null {
    const g = this.g, area = g.area;
    let best: Pick | null = null, by = -Infinity;
    for (const a of g.world.actors) {
      if (a.area !== area.id || (a.kind === "folk" && a.life?.state === "indoors")) continue;
      if (wx >= a.x - 7 && wx <= a.x + 7 && wy >= a.y - 26 && wy <= a.y + 3 && a.y > by) { best = { kind: "actor", a }; by = a.y; }
    }
    for (const p of area.props) {
      if (p.taken && !p.container) continue;
      const b = p.box ?? [p.x - 7, p.y - 14, p.x + 7, p.y];
      if (wx >= b[0] && wx <= b[2] && wy >= Math.min(b[1], p.y - 14) && wy <= b[3] && p.y > by) { best = { kind: "prop", p }; by = p.y; }
    }
    for (const l of area.loose) {
      if (!l.taken && Math.abs(wx - l.x) <= 5 && wy >= l.y - 6 && wy <= l.y + 4 && l.y > by) { best = { kind: "loose", id: l.id, item: l.item, x: l.x, y: l.y }; by = l.y; }
    }
    return best;
  }

  label(p: Pick): string {
    const g = this.g;
    if (p.kind === "loose") return titled(ITEM_NAMES[p.item] ?? p.item);
    if (p.kind === "prop") return titled(p.p.name ?? p.p.kind.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toUpperCase());
    const a = p.a;
    if (a.id === g.world.playerId) return "You (the maintainer)";
    return titled(a.person ? folkLabel(a) : a.keeper ? keeperLabel(a) : actorName(a));
  }

  private status(p: Pick): string {
    if (p.kind === "loose") return "";
    if (p.kind === "prop") return [p.p.open ? "open" : "", p.p.lit ? "lit" : "", p.p.inventory?.some(Boolean) ? "holds items" : ""].filter(Boolean).join(", ");
    const a = p.a;
    if (a.life) return `${a.life.act}, ${a.life.state}`;
    if (a.job && a.job.status !== "done") return `order: ${a.job.status}${a.job.reason ? ` (${a.job.reason})` : ""}`;
    if (a.task) return `busy: ${a.task.kind}`;
    return "";
  }

  private isTarget(p: Pick): boolean {
    const t = this.g.target;
    if (!t) return false;
    return (p.kind === "actor" && t.actorId === p.a.id) || (p.kind === "prop" && t.propId === p.p.id) || (p.kind === "loose" && t.looseId === p.id);
  }

  private worldPointer() {
    const g = this.g, gui = g.gui, inp = gui.input, m = g.mouse;
    if (!Number.isFinite(m.x)) { if (!inp.down) this.drag = null; return; }
    const overUi = gui.pointerOver || !!this.menu;
    const wp = g.cam.toWorld(m.x, m.y, g.vw, g.vh, BASE_W, BASE_H);
    const hit = this.pick(wp.x, wp.y);
    if (inp.pressed && !overUi) this.drag = { x0: wp.x, y0: wp.y, x1: wp.x, y1: wp.y, moved: false };
    if (this.drag && inp.down) {
      this.drag.x1 = wp.x; this.drag.y1 = wp.y;
      if (Math.hypot(wp.x - this.drag.x0, wp.y - this.drag.y0) > 4) this.drag.moved = true;
    }
    if (this.drag && inp.released) {
      const d = this.drag;
      if (d.moved) {
        const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
        this.selection = g.world.actors.filter((a) => a.area === g.area.id && a.id !== g.world.playerId && a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1 + 4 && !(a.kind === "folk" && a.life?.state === "indoors")).map((a) => a.id);
      } else if (hit && this.isTarget(hit)) g.mouseUse = true;
      else if (hit?.kind === "actor" && hit.a.id !== g.world.playerId) this.selection = [hit.a.id];
      else if (!hit) this.selection = [];
      this.drag = null;
    }
    if (inp.rpressed && !gui.pointerOver) {
      const items = this.menuFor(hit);
      this.menu = items.length ? { x: inp.mx, y: inp.my, items } : null;
    }
    if (hit && !overUi && !this.drag?.moved) {
      const lines = [this.label(hit), this.status(hit), this.isTarget(hit) ? "Click to use (E)" : hit.kind === "actor" ? "Click to select, right-click for more" : "Right-click for more"].filter(Boolean);
      this.tooltip(lines, inp.mx, inp.my);
    }
  }

  private menuFor(hit: Pick | null): { label: string; run: () => void }[] {
    const g = this.g, out: { label: string; run: () => void }[] = [];
    if (hit) {
      if (hit.kind !== "loose") out.push({ label: "Inspect", run: () => { this.inspect = hit.kind === "actor" ? { kind: "actor", id: hit.a.id } : { kind: "prop", id: hit.p.id }; } });
      if (this.isTarget(hit)) out.push({ label: "Use (E)", run: () => { g.mouseUse = true; } });
      if (hit.kind === "actor" && hit.a.id !== g.world.playerId) {
        const on = this.selection.includes(hit.a.id);
        out.push({ label: on ? "Deselect" : "Add to selection", run: () => { this.selection = on ? this.selection.filter((x) => x !== hit.a.id) : [...this.selection, hit.a.id]; } });
      }
    }
    if (this.selection.length) out.push({ label: "Clear selection", run: () => { this.selection = []; } });
    out.push({ label: g.speed === 0 ? "Resume" : "Pause", run: () => g.togglePause() });
    out.push({ label: "Menu...", run: () => g.systemMenu.open() });
    return out;
  }

  private contextMenu() {
    const g = this.g, gui = g.gui, m = this.menu;
    if (!m) return;
    const L = g.hiLayout(), w = 110, h = m.items.length * 13 + 6;
    const x = Math.min(m.x, L.lw - w - 2), y = Math.min(m.y, L.lh - h - 2);
    gui.panel({ x, y, w, h });
    let picked = false;
    m.items.forEach((it, i) => { if (gui.button(`ctx.${i}.${it.label}`, { x: x + 3, y: y + 3 + i * 13, w: w - 6, h: 12 }, it.label)) { it.run(); picked = true; } });
    const inp = gui.input, outside = Number.isFinite(inp.mx) && (inp.mx < x || inp.my < y || inp.mx > x + w || inp.my > y + h);
    if (picked || ((inp.pressed || inp.rpressed) && outside)) this.menu = null;
  }

  private worldMarks() {
    const g = this.g, gui = g.gui, col = gui.palette.select;
    for (const id of this.selection) {
      const a = g.world.actors.find((x) => x.id === id);
      if (!a || a.area !== g.area.id) continue;
      const p0 = this.layerOf(a.x - 8, a.y - 27), p1 = this.layerOf(a.x + 8, a.y + 3);
      const r = { x: Math.round(p0.x), y: Math.round(p0.y), w: Math.round(p1.x - p0.x), h: Math.round(p1.y - p0.y) }, k = 4;
      for (const [cx, cy, sx, sy] of [[r.x, r.y, 1, 1], [r.x + r.w, r.y, -1, 1], [r.x, r.y + r.h, 1, -1], [r.x + r.w, r.y + r.h, -1, -1]]) {
        gui.fill({ x: sx > 0 ? cx : cx - k, y: cy, w: k, h: 1 }, col);
        gui.fill({ x: cx, y: sy > 0 ? cy : cy - k, w: 1, h: k }, col);
      }
    }
    const d = this.drag;
    if (d?.moved) {
      const p0 = this.layerOf(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)), p1 = this.layerOf(Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
      const r = { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
      gui.ctx!.globalAlpha = 0.15; gui.fill(r, col); gui.ctx!.globalAlpha = 1;
      gui.stroke(r, col);
    }
  }

  // ------------------------------------------------------------ panels
  private selectionPanel() {
    const g = this.g, gui = g.gui, L = g.hiLayout();
    const sel = this.selection.map((id) => g.world.actors.find((a) => a.id === id)).filter((a): a is Actor => !!a);
    if (sel.length !== this.selection.length) this.selection = sel.map((a) => a.id);
    if (!sel.length) return;
    const rows = Math.min(6, sel.length), w = Math.min(200, L.lw * 0.4), h = 22 + rows * 12 + 4;
    const r = { x: 4, y: L.lh - h - 26, w, h };
    gui.panel(r, `Selected (${sel.length})`);
    const res = gui.list("hud.sel", { x: r.x + 3, y: r.y + 18, w: r.w - 6, h: rows * 12 + 2 }, sel.length, 12, this.selRow, (i, row) => {
      const p: Pick = { kind: "actor", a: sel[i] };
      gui.textIn(this.label(p), row.x + 3, row.y + 2, row.w * 0.55);
      gui.textIn(this.status(p), row.x + row.w * 0.57, row.y + 2, row.w * 0.42, THEME.dim);
    });
    this.selRow = res.sel;
    if (res.clicked >= 0) this.inspect = { kind: "actor", id: sel[res.clicked].id };
  }

  private inspectPanel() {
    const g = this.g, gui = g.gui, ins = this.inspect;
    if (!ins) return;
    const lines: string[] = [];
    let title = "";
    if (ins.kind === "actor") {
      const a = g.world.actors.find((x) => x.id === ins.id);
      if (!a) { this.inspect = null; return; }
      title = this.label({ kind: "actor", a });
      lines.push(`Kind: ${a.kind} (${a.definition})`, `Where: ${a.area} at ${Math.round(a.x)}, ${Math.round(a.y)}`);
      if (a.life) lines.push(`Doing: ${a.life.act} (${a.life.state})`, `Place held: ${a.life.spot ?? "none"}`);
      if (a.task) lines.push(`Task: ${a.task.kind} ${Math.round((a.task.t / Math.max(0.001, a.task.dur)) * 100)}%`);
      if (a.job) lines.push(`Order: ${a.job.status}${a.job.reason ? ` (${a.job.reason})` : ""}`);
      if (a.powerCore !== undefined && a.kind !== "folk") lines.push(`Core: ${a.powerCore ? titled(ITEM_NAMES[a.powerCore]) : "none"}`);
      const held = a.inventory.filter(Boolean).map((s) => `${titled(ITEM_NAMES[s!.item])} x${s!.n}`);
      lines.push(held.length ? `Carries: ${held.join(", ")}` : "Carries nothing");
    } else {
      const p = g.area.prop(ins.id);
      if (!p) { this.inspect = null; return; }
      title = this.label({ kind: "prop", p });
      lines.push(`Kind: ${p.kind}`, `Id: ${p.id}`);
      const st = this.status({ kind: "prop", p });
      if (st) lines.push(`State: ${st}`);
      if (p.item && !p.taken) lines.push(`Holds: ${titled(ITEM_NAMES[p.item])}`);
      const inv = (p.inventory ?? []).filter(Boolean).map((s) => `${titled(ITEM_NAMES[s!.item])} x${s!.n}`);
      if (inv.length) lines.push(`Contents: ${inv.slice(0, 6).join(", ")}${inv.length > 6 ? "..." : ""}`);
    }
    const w = 210, h = 22 + lines.length * LINE_H2 + 6, r = { x: 4, y: 40, w, h };
    gui.panel(r, clipText2(title, w - 30));
    if (gui.button("hud.inspect.close", { x: r.x + w - 16, y: r.y + 3, w: 12, h: 11 }, "x", { tip: "Close (Esc)" })) this.inspect = null;
    lines.forEach((l, i) => gui.textIn(l, r.x + 6, r.y + 20 + i * LINE_H2, w - 12, i < 2 ? THEME.dim : THEME.text));
  }

  private perfReadout() {
    const g = this.g, gui = g.gui, p = g.perf, lod = g.world.lod, here = g.area.id;
    let near = 0, far = 0;
    for (const a of g.world.actors) if (a.area !== here) far++; else near++;
    const r: Rect = { x: 3, y: 24, w: 150, h: 46 };
    gui.panel(r);
    gui.text(`${Math.round(p.fps)} fps  ${p.ticks} tick/f  sim ${p.simMs.toFixed(2)} ms`, r.x + 4, r.y + 3, THEME.text);
    gui.text(lod ? `LOD a${lod.counts.active} n${lod.counts.near} f${lod.counts.far}  here ${near} away ${far}` : `LOD off  here ${near} away ${far}`, r.x + 4, r.y + 13, THEME.dim);
    gui.graph({ x: r.x + 3, y: r.y + 24, w: r.w - 6, h: 19 }, p.history, { min: 0, budget: 4, unit: "ms" });
  }

  private tooltip(lines: string[], x: number, y: number) {
    const gui = this.g.gui, L = this.g.hiLayout();
    const w = Math.max(...lines.map((l) => textWidth2(l))) + 8, h = lines.length * LINE_H2 + 4;
    let tx = x + 12, ty = y + 10;
    if (tx + w > L.lw - 2) tx = x - w - 6;
    if (ty + h > L.lh - 2) ty = y - h - 4;
    const r = { x: tx, y: ty, w, h };
    gui.fill(r, "#08070a"); gui.stroke(r, THEME.hi);
    lines.forEach((l, i) => gui.text(l, tx + 4, ty + 3 + i * LINE_H2, i === 0 ? THEME.text : THEME.dim));
  }
}
