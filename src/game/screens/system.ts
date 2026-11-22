// The system menu (Esc on the play screen): a mouse-driven shell on the
// high-resolution layer, with keyboard and gamepad parity through ui/gui.ts.
// Tabs: GAME (resume, quick save, continue, dev tools for generated areas, a
// timing graph), SAVES (every slot as a sortable table: save, load, export,
// import, delete, with confirmations), SETTINGS (the ui/settings.ts registry by
// category), CONTROLS (remap the play screen's keys) and LOG (the notification
// history). The world is paused behind it (it is an overlay screen) but the
// scene keeps animating.
import type { Game } from "../game";
import type { Screen } from "../ui/screens";
import { THEME, type Rect } from "../ui/gui";
import { LINE_H2 } from "../ui/font2";
import { SETTING_CATEGORIES, settingDefs, ACTIONS, keyLabel, type Action } from "../ui/settings";
import { MANUAL_SLOTS, AUTO, BACKUPS, slotName } from "../world/saveStore";
import { speedLabel } from "../core/clock";
import { clockText } from "../content/daycycle";
import { worldHour } from "../sim/daytime";

const TABS = ["Game", "Saves", "Settings", "Controls", "Log"];

/** 3725 s -> "1h 02m". */
export const playTimeText = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const when = (ms: number) => { if (!ms) return "-"; const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export class SystemMenu {
  screen: Screen;
  tab = 0;
  private cat = 0;
  private slotSel = 0;
  private actSel = -1;
  private logSel = -1;
  private confirm: { title: string; lines: string[]; buttons: string[]; run: (i: number) => void } | null = null;
  /** The action whose key is being remapped (the next key pressed binds it). */
  capturing: Action | null = null;
  status = "";

  constructor(private g: Game) {
    this.screen = { id: "system", opaque: false, t: 0, update: (dt) => this.update(dt), render: () => this.render() };
  }

  open(tab?: number) {
    const g = this.g;
    if (!g.screens.has("system")) { g.screens.push(this.screen); g.sfx.tone(480, 0.06, "triangle", 0.03); }
    if (tab !== undefined) this.tab = tab;
  }
  close() {
    this.capturing = null; this.confirm = null;
    if (this.g.screens.is("system")) { this.g.screens.pop(); this.g.sfx.tone(360, 0.06, "triangle", 0.03); }
  }

  private update(dt: number) {
    const g = this.g;
    g.animate(dt);
    if (this.capturing) {
      for (const k of g.pressed) {
        if (k === "click") continue;
        if (k !== "escape") { g.settings.bind(this.capturing, k); this.status = `${ACTIONS.find((a) => a.id === this.capturing)?.label}: ${keyLabel(k)}`; }
        this.capturing = null;
        g.uiPressed.clear();
        break;
      }
      return;
    }
    if (g.hit("escape") && !this.confirm && !g.gui.modal) this.close();
  }

  private render() {
    const g = this.g, gui = g.gui, L = g.hiLayout();
    const pw = Math.min(L.lw - 16, 440), ph = Math.min(L.lh - 16, 300);
    const r = { x: Math.round((L.lw - pw) / 2), y: Math.round((L.lh - ph) / 2), w: pw, h: ph };
    gui.fill({ x: 0, y: 0, w: L.lw, h: L.lh }, "rgba(4,3,6,0.45)");
    gui.panel(r, "Dustwake");
    gui.text("Esc closes", r.x + r.w - 6, r.y + 4, THEME.dim, "right");
    this.tab = gui.tabs("sys.tabs", { x: r.x + 4, y: r.y + 18, w: r.w - 8, h: 14 }, TABS, this.tab, !this.capturing);
    const body = { x: r.x + 6, y: r.y + 38, w: r.w - 12, h: r.h - 44 };
    if (this.tab === 0) this.gameTab(body);
    else if (this.tab === 1) this.savesTab(body);
    else if (this.tab === 2) this.settingsTab(body);
    else if (this.tab === 3) this.controlsTab(body);
    else this.logTab(body);
    if (this.confirm) {
      const c = this.confirm, i = gui.modalBox("sys.confirm", c.title, c.lines, c.buttons);
      if (i >= 0) { this.confirm = null; c.run(i); }
    }
    if (this.capturing) {
      const label = ACTIONS.find((a) => a.id === this.capturing)?.label ?? this.capturing;
      gui.modalBox("sys.capture", "Remap key", [`Press a key for "${label}".`, "Esc cancels."], []);
    }
  }

  private ask(title: string, lines: string[], buttons: string[], run: (i: number) => void) { this.confirm = { title, lines, buttons, run }; }

  // ------------------------------------------------------------ GAME
  private gameTab(b: Rect) {
    const g = this.g, gui = g.gui, w = g.world, col = Math.round(b.w * 0.42);
    let y = b.y;
    const btn = (id: string, label: string, run: () => void, o: { tip?: string; disabled?: boolean } = {}) => { if (gui.button(id, { x: b.x, y, w: col, h: 14 }, label, o)) run(); y += 17; };
    btn("sys.resume", "Resume", () => this.close());
    btn("sys.quick", "Quick save", () => { if (g.saveGame("quick")) this.status = "Saved to the quick slot."; }, { tip: "The quick slot (K on the play screen)." });
    btn("sys.continue", "Continue (latest save)", () => this.ask("Load the latest save?", ["Progress since your last save will be lost."], ["Load", "Cancel"], (i) => { if (i === 0 && g.loadGame()) this.close(); }), { disabled: !g.store.list().length });
    btn("sys.title", "Wake again (new game)", () => this.ask("Start again?", ["A fresh world, from the opening. Unsaved progress is lost."], ["Start again", "Cancel"], (i) => { if (i === 0) { this.close(); g.wakeAgain(); } }));
    y += 6;
    gui.text("Generated areas (dev)", b.x, y, THEME.accent); y += 13;
    const spec = w.specs.get(g.area.id);
    btn("sys.floor", "Create test floor here", () => { g.devCreateFloor("floor"); this.close(); }, { tip: "Make a generated floor (world/areaSpec.ts) linked under this spot, and go down into it. Its way up is the stair nook north of where you arrive." });
    btn("sys.cave", "Create cave here", () => { g.devCreateFloor("cave"); this.close(); }, { tip: "The same with the cave builder (cellular automaton)." });
    btn("sys.leave", "Leave this generated area", () => { g.devLeaveFloor(); this.close(); }, { disabled: !spec?.link, tip: "Back to the spot it hangs off (walking up its stair does the same)." });
    // the right column: where and when, the speed, and a timing graph
    const x = b.x + col + 12, cw = b.w - col - 12;
    let ty = b.y;
    const line = (s: string, c: string = THEME.text) => { gui.textIn(s, x, ty, cw, c); ty += LINE_H2; };
    line(`Area: ${spec?.label ?? g.area.id}`);
    line(`Day ${Math.floor(w.day) + 1}, ${clockText(worldHour(w))}   Played ${playTimeText(w.playTime)}`, THEME.dim);
    line(`Speed: ${speedLabel(g.speed)} (paused while this menu is open)`, THEME.dim);
    line(`Actors: ${w.actors.length}   Areas loaded: ${w.areas.size}   Generated: ${w.specs.size}`, THEME.dim);
    line(`LOD: ${w.lod ? `on (a${w.lod.counts.active} n${w.lod.counts.near} f${w.lod.counts.far})` : "off"}`, THEME.dim);
    ty += 4;
    gui.graph({ x, y: ty, w: cw, h: 44 }, g.perf.history, { min: 0, budget: 4, label: "sim ms / frame", unit: "ms" });
    ty += 48;
    gui.graph({ x, y: ty, w: cw, h: 34 }, g.perf.tickHistory, { min: 0, label: "ticks / frame", color: THEME.ok });
    if (this.status) gui.textIn(this.status, b.x, b.y + b.h - 10, b.w, THEME.ok);
  }

  // ------------------------------------------------------------ SAVES
  private savesTab(b: Rect) {
    const g = this.g, gui = g.gui, st = g.store;
    const slots: string[] = [...MANUAL_SLOTS, AUTO, ...Array.from({ length: BACKUPS }, (_, i) => `${AUTO}.${i + 1}`)];
    for (const m of st.list()) if (!slots.includes(m.slot)) slots.push(m.slot);
    const info = new Map(st.list().map((m) => [m.slot, m]));
    const rows = slots.map((s) => {
      const m = info.get(s);
      if (!m) return [slotName(s), "empty", "", "", "", ""];
      if (!m.ok) return [slotName(s), "DAMAGED", m.reason ?? "", "", "", kb(m.size)];
      return [slotName(s), m.area, `Day ${m.day + 1} ${clockText(m.hour)}`, playTimeText(m.playTime), when(m.savedAt), kb(m.size)];
    });
    const th = b.h - 40;
    const res = gui.table("sys.slots", { x: b.x, y: b.y, w: b.w, h: th }, [{ label: "Slot", w: 30 }, { label: "Area", w: 18 }, { label: "In game", w: 22 }, { label: "Played", w: 14 }, { label: "Saved", w: 18 }, { label: "Size", w: 12, align: "right" }], rows, this.slotSel, {
      color: (i) => (rows[i][1] === "DAMAGED" ? THEME.bad : rows[i][1] === "empty" ? THEME.faint : undefined),
    });
    this.slotSel = Math.max(0, res.sel);
    const slot = slots[this.slotSel] ?? "quick", manual = (MANUAL_SLOTS as readonly string[]).includes(slot), filled = st.has(slot);
    if (res.activated >= 0 && filled) this.load(slot);
    const bw = Math.floor((b.w - 16) / 5), y = b.y + th + 6;
    if (gui.button("sys.s.save", { x: b.x, y, w: bw, h: 14 }, "Save here", { disabled: !manual, tip: manual ? "Save the world into this slot (the copy it replaces is kept as a backup)." : "Autosaves are written by the game." })) {
      const doIt = () => { if (g.saveGame(slot)) this.status = `Saved to ${slotName(slot)}.`; };
      if (filled) this.ask("Overwrite?", [`${slotName(slot)} already holds a save. Its old copy is kept as a backup.`], ["Overwrite", "Cancel"], (i) => { if (i === 0) doIt(); });
      else doIt();
    }
    if (gui.button("sys.s.load", { x: b.x + (bw + 4), y, w: bw, h: 14 }, "Load", { disabled: !filled })) this.load(slot);
    if (gui.button("sys.s.export", { x: b.x + (bw + 4) * 2, y, w: bw, h: 14 }, "Export file", { disabled: !filled, tip: "Download this slot as a .json file." })) this.status = g.exportSlot(slot) ? `Exported ${slotName(slot)}.` : "Nothing to export.";
    if (gui.button("sys.s.import", { x: b.x + (bw + 4) * 3, y, w: bw, h: 14 }, "Import file", { disabled: !manual, tip: "Read a .json save file into this slot (it is checked first)." })) { g.importToSlot(slot); this.status = "Choose a file..."; }
    if (gui.button("sys.s.delete", { x: b.x + (bw + 4) * 4, y, w: bw, h: 14 }, "Delete", { disabled: !filled })) {
      this.ask("Delete?", [`Delete ${slotName(slot)}? This cannot be undone.`], ["Delete", "Cancel"], (i) => { if (i === 0) { st.delete(slot); this.status = `Deleted ${slotName(slot)}.`; } });
    }
    const msg = st.lastError ? `Store: ${st.lastError}` : this.status;
    if (msg) gui.textIn(msg, b.x, y + 18, b.w, st.lastError ? THEME.bad : THEME.ok);
  }

  private load(slot: string) {
    this.ask("Load this save?", [`Load ${slotName(slot)}? Progress since your last save will be lost.`], ["Load", "Cancel"], (i) => { if (i === 0 && this.g.loadGame(slot)) this.close(); });
  }

  // ------------------------------------------------------------ SETTINGS
  private settingsTab(b: Rect) {
    const g = this.g, gui = g.gui, s = g.settings;
    this.cat = gui.tabs("sys.cat", { x: b.x, y: b.y, w: b.w, h: 13 }, SETTING_CATEGORIES.map((c) => c.label), this.cat, false);
    const cat = SETTING_CATEGORIES[this.cat].id;
    let y = b.y + 19;
    for (const d of settingDefs().filter((x) => x.category === cat)) {
      const r = { x: b.x, y, w: b.w, h: 14 };
      if (d.kind === "slider") s.set(d.id, gui.slider(`set.${d.id}`, r, d.label, s.num(d.id), d.min ?? 0, d.max ?? 100, d.step ?? 1, (v) => `${Math.round(v)}${d.max === 100 ? "%" : ""}`, d.help));
      else if (d.kind === "toggle") s.set(d.id, gui.toggle(`set.${d.id}`, r, d.label, s.bool(d.id), d.help));
      else s.set(d.id, gui.choice(`set.${d.id}`, r, d.label, d.options ?? [], s.str(d.id), d.help));
      y += 17;
    }
    if (cat === "access") {
      const p = gui.palette;
      [["Alert", p.alert], ["Warning", p.warn], ["Info", p.info], ["Selection", p.select]].forEach(([n, c], i) => {
        const x = b.x + i * 70;
        gui.fill({ x, y: y + 2, w: 8, h: 8 }, c); gui.text(n, x + 11, y + 2, THEME.dim);
      });
      y += 14;
    }
    if (gui.button("sys.set.reset", { x: b.x, y: b.y + b.h - 16, w: 120, h: 14 }, "Reset all to defaults")) {
      this.ask("Reset settings?", ["Every setting and key goes back to its default."], ["Reset", "Cancel"], (i) => { if (i === 0) g.settings.resetAll(); });
    }
  }

  // ------------------------------------------------------------ CONTROLS
  private controlsTab(b: Rect) {
    const g = this.g, gui = g.gui;
    const rows = ACTIONS.map((a) => [a.label, g.settings.keys(a.id).map(keyLabel).join("  /  ")]);
    const res = gui.table("sys.keys", { x: b.x, y: b.y, w: b.w, h: b.h - 44 }, [{ label: "Action", w: 40 }, { label: "Keys (click or Enter to remap)", w: 60 }], rows, this.actSel);
    this.actSel = res.sel;
    if (res.clicked >= 0 || res.activated >= 0) this.capturing = ACTIONS[res.activated >= 0 ? res.activated : res.clicked].id;
    if (gui.button("sys.keys.reset", { x: b.x, y: b.y + b.h - 40, w: 110, h: 14 }, "Reset keys")) g.settings.resetKeys();
    gui.para("Gamepad: stick or D-pad moves, A uses, B backs out, X slams, Y opens the pack, LB / RB switch tabs, LT / RT change speed, Start opens this menu. Menus also take the mouse.", { x: b.x, y: b.y + b.h - 22, w: b.w, h: 24 });
    if (this.status) gui.textIn(this.status, b.x + 120, b.y + b.h - 37, b.w - 120, THEME.ok);
  }

  // ------------------------------------------------------------ LOG
  private logTab(b: Rect) {
    const g = this.g, gui = g.gui, h = g.notes.history;
    if (!h.length) { gui.text("Nothing has happened yet.", b.x, b.y, THEME.dim); return; }
    const res = gui.list("sys.log", { x: b.x, y: b.y, w: b.w, h: b.h }, h.length, 12, this.logSel, (i, row) => {
      const n = h[i], c = n.level === "alert" ? gui.palette.alert : n.level === "warn" ? gui.palette.warn : gui.palette.info;
      gui.fill({ x: row.x + 2, y: row.y + 2, w: 3, h: row.h - 4 }, c);
      gui.textIn(n.count > 1 ? `${n.text} (x${n.count})` : n.text, row.x + 9, row.y + 2, row.w - 12);
    });
    this.logSel = res.sel;
  }
}
