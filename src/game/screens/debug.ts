// The debug menu (Ctrl+0). Testing only, not part of the game's rules: every
// change goes through the pure sim functions in sim/debug.ts (the same ones the
// tests run), so this screen only picks a row and shows the result.
//
//   ITEMS      summon any item into the pack or onto the ground, delete, wear
//   PLAYER     arm, eye, speed, noclip, gear slots, kits, pack tools
//   FLAGS      every progression flag, rune site, plan and NPC state, toggled
//   TELEPORT   any area, room, rune site or NPC
//   WORLD      save / load / new game, the fixture, HUD, zoom, unlock everything
//
// Layout (320x180, nothing here is bigger than the panel): a tab row, a
// scrolling list on the left (with a search field on the tabs that have many
// rows), a detail panel on the right, then a key line and a status line.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText, TextField } from "../ui/kit";
import { ITEMS, ITEM_IDS, effectLines, maxStack, type ItemId } from "../content/items";
import { FLAGS } from "../content/flags";
import { wrapText } from "../ui/textWrap";
import { itemIcon } from "../art/items";
import { drawText, textWidth } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { clamp } from "../util";
import type { Sprite } from "../util";
import {
  allSlotsUnlocked, clearPack, debugFlags, debugPlaces, deleteItem, fillMaterials, flagOn, grantBuildKit, grantStoryKit,
  heldCount, learnAllPlans, setAllSlots, summonItem, summonLoose, toggleGearKit, type DebugPlace,
} from "../sim/debug";
import { countItem } from "../sim/inventory";
import { ensureWorn, wears } from "../sim/gear";
import { setFlag } from "../world/world";

/** What the menu needs from the host (Game): the debug toggles it owns, and the few things only the host can do. */
export interface DebugHost extends UiHost {
  debugSpeed: boolean;
  /** The multiplier super speed applies while it is on. */
  debugSpeedMult: number;
  debugNoclip: boolean;
  debugHud: boolean;
  readonly zoom: number;
  readonly hasArm: boolean;
  /** Is a key held right now (Shift scales the quantity). */
  has(...k: string[]): boolean;
  /** Set or clear a flag; the mended eye also moves the zoom. */
  debugSetFlag(flag: string, on: boolean): void;
  debugTeleport(p: DebugPlace): boolean;
  debugNewGame(): void;
  debugFoundations(): void;
  debugZoom(): void;
  saveGame(): void;
  loadGame(): boolean;
}

/** The speeds the PLAYER tab cycles through (multipliers; 1 is off). */
export const DEBUG_SPEEDS = [1, 3, 6, 12];

interface Row {
  key: string;
  label: string;
  /** Right-aligned state text. */
  value?: string;
  vcol?: string;
  /** Detail panel text, wrapped to the panel. */
  desc: string;
  icon?: Sprite;
  item?: ItemId;
  flag?: string;
  place?: DebugPlace;
}

interface Tab { name: string; search: boolean; hint: string }
export const DEBUG_TABS: Tab[] = [
  { name: "ITEMS", search: true, hint: "E PACK  G GROUND  X DELETE  F WEAR  A/D QTY (SHIFT X10)  M MAX" },
  { name: "PLAYER", search: false, hint: "W/S CHOOSE  E OR D APPLY  A BACK (SPEED)" },
  { name: "FLAGS", search: true, hint: "W/S CHOOSE  E TOGGLE  / SEARCH  PGUP/PGDN SCROLL" },
  { name: "TELEPORT", search: true, hint: "W/S CHOOSE  E GO  / SEARCH  PGUP/PGDN SCROLL" },
  { name: "WORLD", search: false, hint: "W/S CHOOSE  E APPLY" },
];
const TABS = DEBUG_TABS;

/** Panel, list and detail geometry (the 320x180 screen is laid out by hand). */
export const DEBUG_PANEL = { x: 4, y: 2, w: 312, h: 174 };
const PX = DEBUG_PANEL.x, PY = DEBUG_PANEL.y, PW = DEBUG_PANEL.w, PH = DEBUG_PANEL.h;
const LX = 9, LW = 150, DX = 164, DW = 145, TOP = 31, BOTTOM = 153, ROW = 12;
const COLS = Math.floor((DW - 8 + 1) / 4);

const ON = UI.ok, OFF = UI.dim;
const onOff = (b: boolean): Pick<Row, "value" | "vcol"> => ({ value: b ? "ON" : "OFF", vcol: b ? ON : OFF });

export class DebugUi {
  readonly screen: Screen;
  tab = 0;
  private cursor = [0, 0, 0, 0, 0];
  private scroll = [0, 0, 0, 0, 0];
  readonly search = new TextField(16);
  qty = 1;
  /** The rows shown now (built and filtered every frame). */
  rows: Row[] = [];
  status: { text: string; ok: boolean } | null = null;

  constructor(private g: DebugHost) {
    this.screen = { id: "debug", opaque: false, t: 0, update: (dt) => this.update(dt), render: () => this.render() };
  }

  /** Open from the play screen (or close, if it is already open). */
  toggle() {
    const g = this.g;
    if (g.screens.is("debug")) { g.screens.popToBase(); return; }
    if (!g.screens.is("play")) return;
    this.search.active = false;
    this.status = null;
    g.screens.push(this.screen);
    g.sfx.tone(440, 0.06, "triangle", 0.03);
    this.refresh();
  }

  private tell(text: string, ok = true) { this.status = { text: text.toUpperCase(), ok }; }

  // ---------------------------------------------------------------- rows
  private build(tab: number): Row[] {
    const g = this.g, w = g.world, pl = g.pl;
    if (tab === 0) {
      return ITEM_IDS.map((id) => {
        const def = ITEMS[id], n = countItem(pl, id), worn = wears(pl, id);
        return {
          key: "item", item: id, label: def.name, icon: itemIcon(id),
          value: worn ? (n ? `WORN +${n}` : "WORN") : n ? `X${n}` : undefined, vcol: UI.amber,
          desc: (def.desc ?? []).join(" "),
        };
      });
    }
    if (tab === 1) {
      const speed = g.debugSpeed ? g.debugSpeedMult : 1;
      return [
        { key: "arm", label: "IRON ARM", ...onOff(g.hasArm), desc: "THE GOLEM'S SECOND ARM. LETS IT BREAK CRACKED WALLS AND WALK FASTER." },
        { key: "eye", label: "MENDED EYE", ...onOff(flagOn(w, FLAGS.golemEye)), desc: "THE REPAIRED EYE. UNLOCKS THE MOUSE WHEEL ZOOM." },
        { key: "speed", label: "SUPER SPEED", value: speed === 1 ? "OFF" : `X${speed}`, vcol: speed === 1 ? OFF : ON, desc: "WALK FASTER. E OR D STEPS UP, A STEPS DOWN: OFF, X3, X6, X12." },
        { key: "noclip", label: "NOCLIP", ...onOff(g.debugNoclip), desc: "WALK THROUGH WALLS, PROPS AND BODIES. THE EDGE OF THE AREA STILL HOLDS." },
        { key: "slots", label: "ALL GEAR SLOTS", ...onOff(allSlotsUnlocked(w, pl)), desc: "UNLOCK THE LEFT ARM AND THE OTHER RUNE SLOTS. TURNING OFF SENDS WORN GEAR BACK TO THE PACK." },
        { key: "gearkit", label: "GEAR KIT", desc: "BUILD AND MASONRY KNOWLEDGE, THE BASKET WORN, MATERIALS TO 40, THE CHISEL, BOTH RUNES, ALL SLOTS (CTRL+6). AGAIN LOCKS THE SLOTS." },
        { key: "buildkit", label: "BUILD KIT", desc: "BUILD AND MASONRY KNOWLEDGE, EVERY PLAN, THE BASKET WORN, AND 40 EACH OF WOOD, STONE, PLANKS AND CUT STONE (CTRL+4)." },
        { key: "storykit", label: "STORY KIT", desc: "EVERY RUNE GLYPH, THE AETHER CORE, THE CHISEL AND THE SCHEMATIC, SKIPPING WHAT IS HELD OR PLACED (CTRL+2)." },
        { key: "plans", label: "LEARN ALL PLANS", desc: "READ EVERY ANALYSIS GATED PLAN, SO EVERYTHING SHOWS IN THE BUILD MENU." },
        { key: "mats", label: "FILL MATERIALS", desc: "TOP UP EVERY MATERIAL (WOOD, STONE, PLANKS, CUT STONE, RUBY) TO 40. WHAT DOES NOT FIT LANDS ON THE GROUND." },
        { key: "basket", label: "WEAR BASKET", value: wears(pl, "basket") ? "WORN" : undefined, vcol: ON, desc: "STRAP A BASKET TO THE BACK (ONE FROM THE PACK, ELSE A NEW ONE). THE PACK GROWS." },
        { key: "clear", label: "CLEAR PACK", value: `${pl.inventory.reduce((n, s) => n + (s ? s.n : 0), 0)} HELD`, vcol: UI.amber, desc: "DELETE EVERYTHING IN THE PACK. WORN GEAR STAYS ON." },
      ];
    }
    if (tab === 2) {
      return debugFlags(w).map((f) => ({
        key: "flag", flag: f.flag, label: `${f.group}: ${f.label}`, ...onOff(flagOn(w, f.flag)),
        desc: `GROUP: ${f.group}\nFLAG: ${f.flag.toUpperCase().replace(/_/g, "-")}`,
      }));
    }
    if (tab === 3) {
      const here = pl.area;
      return debugPlaces(w).map((p) => ({
        key: "go", place: p, label: p.label, value: p.area === here ? undefined : "TRAVEL", vcol: UI.amber,
        desc: `AREA: ${p.group}\nPOSITION: ${Math.round(p.x)}, ${Math.round(p.y)}\nTHE GOLEM IS PUT ON THE NEAREST FREE SPOT.`,
      }));
    }
    return [
      { key: "hud", label: "COORDINATE HUD", ...onOff(g.debugHud), desc: "SHOW THE AREA, THE GOLEM'S POSITION AND TILE, AND THE ACTIVE DEBUG MODES IN THE CORNER." },
      { key: "zoom", label: "ZOOM", value: `X${g.zoom.toFixed(2)}`, vcol: UI.amber, desc: "CYCLE THE VIEW ZOOM THROUGH ITS STEPS (WORKS WITHOUT THE MENDED EYE)." },
      { key: "unlock", label: "UNLOCK EVERYTHING", desc: "ARM, EYE, ALL SLOTS, ALL KNOWLEDGE AND PLANS, AND THE GEAR, BUILD AND STORY KITS. STORY, RUNE AND NPC FLAGS ARE LEFT ALONE." },
      { key: "save", label: "SAVE GAME", desc: "WRITE THE ONE LOCALSTORAGE SLOT (K ON THE PLAY SCREEN)." },
      { key: "load", label: "LOAD GAME", desc: "LOAD THE SAVED GAME AND RESUME (L ON THE PLAY SCREEN)." },
      { key: "new", label: "NEW GAME", desc: "START A FRESH WORLD STRAIGHT IN THE DUNGEON, SKIPPING THE INTRO. THE CURRENT RUN IS DROPPED UNSAVED." },
      { key: "fixture", label: "FOUNDATION FIXTURE", desc: "LOAD THE TWO AREA FIXTURE: A WORKER GOLEM GATHERS WOOD THROUGH THE RUNES AND DEPOSITS IT IN A CHEST. THE CURRENT RUN IS DROPPED UNSAVED." },
    ];
  }

  /** Rebuild the rows for the current tab and keep the cursor in range and in view. */
  refresh() {
    const t = this.tab;
    let rows = this.build(t);
    const q = this.search.value.trim();
    if (TABS[t].search && q) {
      const words = q.split(" ");
      rows = rows.filter((r) => {
        const hay = `${r.label} ${r.item ?? ""} ${r.item ? ITEMS[r.item].tags.join(" ") : ""}`.toUpperCase().replace(/_/g, " ");
        return words.every((x) => hay.includes(x));
      });
    }
    this.rows = rows;
    const vis = this.visible();
    this.cursor[t] = clamp(this.cursor[t], 0, Math.max(0, rows.length - 1));
    this.scroll[t] = clamp(this.scroll[t], 0, Math.max(0, rows.length - vis));
    if (this.cursor[t] < this.scroll[t]) this.scroll[t] = this.cursor[t];
    if (this.cursor[t] >= this.scroll[t] + vis) this.scroll[t] = this.cursor[t] - vis + 1;
  }

  private top() { return TABS[this.tab].search ? TOP + 13 : TOP; }
  private rowH() { return this.tab === 0 ? 16 : ROW; }
  private visible() { return Math.floor((BOTTOM - this.top()) / this.rowH()); }
  private cur(): Row | undefined { return this.rows[this.cursor[this.tab]]; }
  /** Test hook: put the cursor on the first row matching a key (and item id / flag / label for the lists). */
  select(key: string, pick?: string): boolean {
    this.refresh();
    const i = this.rows.findIndex((r) => r.key === key && (pick === undefined || r.item === pick || r.flag === pick || r.label === pick));
    if (i < 0) return false;
    this.cursor[this.tab] = i;
    this.refresh();
    return true;
  }

  // ---------------------------------------------------------------- input
  setTab(n: number) {
    const was = this.tab;
    this.tab = (n + TABS.length) % TABS.length;
    if (this.tab !== was) { this.search.active = false; this.status = null; this.g.sfx.tone(560, 0.04, "square", 0.02); }
    this.refresh();
  }

  private move(d: number) {
    const t = this.tab, n = this.rows.length;
    if (!n) return;
    this.cursor[t] = clamp(this.cursor[t] + d, 0, n - 1);
    this.g.sfx.tone(500, 0.03, "square", 0.015);
    this.refresh();
  }

  private update(dt: number) {
    const g = this.g;
    g.animate(dt);
    if (this.search.active) {
      if (this.search.feed(g.typed)) { this.cursor[this.tab] = 0; this.scroll[this.tab] = 0; }
      if (g.hit("escape")) { this.search.clear(); this.search.active = false; }
      else if (g.hit("enter", "arrowdown", "arrowup")) this.search.active = false;
      this.refresh();
      return;
    }
    if (g.hit("tab")) { g.screens.popToBase(); return; }
    if (g.hit("escape")) { if (this.search.value) { this.search.clear(); this.refresh(); } else g.screens.popToBase(); return; }
    // Tabs: Q / R step, 1-5 jump.
    if (g.hit("q")) return this.setTab(this.tab - 1);
    if (g.hit("r")) return this.setTab(this.tab + 1);
    for (let i = 0; i < TABS.length; i++) if (g.hit(String(i + 1))) return this.setTab(i);
    if (TABS[this.tab].search && g.hit("/")) { this.search.active = true; return; }
    this.refresh();
    if (g.hit("arrowup", "w")) this.move(-1);
    if (g.hit("arrowdown", "s")) this.move(1);
    if (g.hit("pageup")) this.move(-this.visible());
    if (g.hit("pagedown")) this.move(this.visible());
    if (g.hit("home")) this.move(-9999);
    if (g.hit("end")) this.move(9999);
    const row = this.cur();
    if (!row) return;
    const step = g.has("shift") ? 10 : 1;
    if (row.key === "item") {
      if (g.hit("arrowleft", "a")) this.qty = clamp(this.qty - step, 1, 99);
      if (g.hit("arrowright", "d")) this.qty = clamp(this.qty + step, 1, 99);
      if (g.hit("m")) this.qty = Math.min(99, maxStack(row.item!));
      if (g.hit("e", "enter")) this.act(row, 0);
      if (g.hit("g")) this.act(row, 2);
      if (g.hit("x")) this.act(row, 3);
      if (g.hit("f")) this.act(row, 4);
    } else if (g.hit("e", "enter", "arrowright", "d")) this.act(row, 1);
    else if (g.hit("arrowleft", "a")) this.act(row, -1);
    this.refresh();
  }

  // ---------------------------------------------------------------- actions
  /** `how`: items: 0 pack, 2 ground, 3 delete, 4 wear. Others: 1 forward / apply, -1 back. */
  act(row: Row, how: number) {
    const g = this.g, w = g.world, pl = g.pl, sfx = g.sfx;
    const chime = (up = true) => sfx.tone(up ? 560 : 380, 0.08, "triangle", 0.04);
    const buzz = () => sfx.tone(180, 0.1, "square", 0.04);
    switch (row.key) {
      case "item": {
        const id = row.item!, def = ITEMS[id];
        if (how === 0) { const r = summonItem(w, pl, id, this.qty); this.tell(r.text, r.ok); chime(); g.drainEvents(); }
        else if (how === 2) { const r = summonLoose(w, pl, id, this.qty); this.tell(r.text, r.ok); if (r.ok) chime(); else buzz(); }
        else if (how === 3) {
          const n = deleteItem(pl, id, this.qty);
          this.tell(n ? `-${n} ${def.name}` : `NO ${def.name} IN THE PACK`, n > 0);
          if (n) chime(false); else buzz();
        } else if (how === 4) {
          if (!def.wear) { this.tell(`${def.name} IS NOT WEARABLE`, false); buzz(); }
          else if (ensureWorn(w, pl, id)) { this.tell(`${def.name} WORN`); chime(); g.drainEvents(); }
          else { this.tell(`NO FREE SLOT FOR ${def.name}`, false); buzz(); }
        }
        return;
      }
      case "arm": case "eye": {
        const flag = row.key === "arm" ? FLAGS.golemArm : FLAGS.golemEye, on = !flagOn(w, flag);
        g.debugSetFlag(flag, on); this.tell(`${row.label} ${on ? "ON" : "OFF"}`); chime(on); return;
      }
      case "speed": {
        const cur = g.debugSpeed ? DEBUG_SPEEDS.indexOf(g.debugSpeedMult) : 0;
        const next = DEBUG_SPEEDS[(Math.max(0, cur) + (how < 0 ? DEBUG_SPEEDS.length - 1 : 1)) % DEBUG_SPEEDS.length];
        g.debugSpeed = next > 1;
        if (next > 1) g.debugSpeedMult = next;
        this.tell(next > 1 ? `SPEED X${next}` : "SPEED NORMAL"); chime(next > 1); return;
      }
      case "noclip": g.debugNoclip = !g.debugNoclip; this.tell(`NOCLIP ${g.debugNoclip ? "ON" : "OFF"}`); chime(g.debugNoclip); return;
      case "slots": { const on = !allSlotsUnlocked(w, pl); setAllSlots(w, pl, on); this.tell(on ? "ALL GEAR SLOTS UNLOCKED" : "GEAR SLOTS LOCKED AGAIN"); chime(on); return; }
      case "gearkit": { const on = toggleGearKit(w, pl); this.tell(on ? "GEAR KIT ON: ALL SLOTS UNLOCKED" : "GEAR KIT OFF: SLOTS LOCKED AGAIN"); chime(on); g.drainEvents(); return; }
      case "buildkit": grantBuildKit(w, pl); this.tell("BUILD KIT: PLANS, BASKET, MATERIALS"); chime(); g.drainEvents(); return;
      case "storykit": { const n = grantStoryKit(w, pl); this.tell(n ? `STORY KIT: ${n} ITEMS GIVEN` : "ALREADY HAVE THE WHOLE STORY KIT"); chime(); g.drainEvents(); return; }
      case "plans": learnAllPlans(w); this.tell("EVERY PLAN READ"); chime(); return;
      case "mats": fillMaterials(w, pl, 40); this.tell("MATERIALS TOPPED UP TO 40"); chime(); g.drainEvents(); return;
      case "basket": { const ok = ensureWorn(w, pl, "basket"); this.tell(ok ? "BASKET WORN" : "COULD NOT WEAR A BASKET", ok); chime(); g.drainEvents(); return; }
      case "clear": { const n = clearPack(pl); this.tell(`PACK CLEARED: ${n} DELETED`); chime(false); return; }
      case "flag": {
        const on = !flagOn(w, row.flag!);
        g.debugSetFlag(row.flag!, on); this.tell(`${row.label.split(": ").slice(1).join(": ")} ${on ? "ON" : "OFF"}`); chime(on); return;
      }
      case "go": {
        if (g.debugTeleport(row.place!)) { g.screens.popToBase(); g.say(`TELEPORTED: ${row.place!.label}`); }
        else { this.tell("NO FREE SPOT THERE", false); buzz(); }
        return;
      }
      case "hud": g.debugHud = !g.debugHud; this.tell(`COORDINATE HUD ${g.debugHud ? "ON" : "OFF"}`); chime(g.debugHud); return;
      case "zoom": g.debugZoom(); this.tell("ZOOM CHANGED"); chime(); return;
      case "unlock": {
        for (const f of [FLAGS.golemArm, FLAGS.golemEye, FLAGS.knowBuild, FLAGS.knowRepair, FLAGS.knowMasonry, FLAGS.knowSchematic]) if (!flagOn(w, f)) g.debugSetFlag(f, true);
        setFlag(w, FLAGS.tutorialInsight);
        if (!allSlotsUnlocked(w, pl)) toggleGearKit(w, pl);
        grantBuildKit(w, pl); grantStoryKit(w, pl); learnAllPlans(w);
        this.tell("EVERYTHING UNLOCKED"); chime(); g.drainEvents(); return;
      }
      case "save": g.saveGame(); return;
      case "load": if (!g.loadGame()) { this.tell("NO SAVED GAME", false); buzz(); } return;
      case "new": g.debugNewGame(); return;
      case "fixture": g.debugFoundations(); return;
    }
  }

  // ---------------------------------------------------------------- render
  private render() {
    const g = this.g, ctx = g.ctx, t = g.t;
    this.refresh();
    ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(0, 0, W, H);
    panel(ctx, PX, PY, PW, PH);
    drawText(ctx, "DEBUG MENU", PX + 8, PY + 6, UI.gold);
    drawText(ctx, "CTRL+0 / TAB / ESC CLOSE", PX + PW - 8, PY + 6, UI.dim, 1, "right");

    // tabs
    const tw = Math.floor((PW - 16) / TABS.length);
    TABS.forEach((tb, i) => {
      const x = PX + 8 + i * tw, on = i === this.tab;
      frame(ctx, x, 16, tw - 3, 11, on ? "#2a2430" : "#141117", on ? selEdge(t) : "#2a2630", on ? "#e8d8a8" : "#3a3540");
      drawText(ctx, `${i + 1} ${tb.name}`, x + (tw - 3) / 2, 19, on ? UI.title : UI.mid, 1, "center");
    });

    // list
    const tab = TABS[this.tab], top = this.top(), vis = this.visible();
    if (tab.search) this.search.draw(ctx, LX, TOP, LW, t, "/ SEARCH");
    const cur = this.cursor[this.tab], sc = this.scroll[this.tab];
    frame(ctx, LX, top - 1, LW, BOTTOM - top + 2, "#0e0c10", "#2a2630", "#3a3540");
    if (!this.rows.length) drawText(ctx, "NOTHING MATCHES", LX + LW / 2, top + 10, UI.dim, 1, "center");
    for (let i = 0; i < vis; i++) {
      const idx = sc + i, r = this.rows[idx];
      if (!r) break;
      const rh = this.rowH(), y = top + i * rh, sel = idx === cur, ty = y + Math.floor((rh - 5) / 2);
      if (sel) frame(ctx, LX + 2, y, LW - 8, rh - 1, "#262030", selEdge(t), "#e8d8a8");
      let tx = LX + 6;
      if (r.icon) { ctx.drawImage(r.icon.a, LX + 4, y - 1, 16, 16); tx = LX + 22; }
      const vw = r.value ? textWidth(r.value) + 6 : 0;
      drawText(ctx, clipText(r.label, LW - 17 - (tx - LX) - vw), tx, ty, sel ? UI.title : UI.text);
      if (r.value) drawText(ctx, r.value, LX + LW - 11, ty, r.vcol ?? UI.amber, 1, "right");
    }
    if (this.rows.length > vis) {
      const h = BOTTOM - top, bh = Math.max(6, Math.round(h * vis / this.rows.length));
      ctx.fillStyle = "#2a2630"; ctx.fillRect(LX + LW - 4, top, 2, h);
      ctx.fillStyle = "#8a8392"; ctx.fillRect(LX + LW - 4, top + Math.round((h - bh) * sc / (this.rows.length - vis)), 2, bh);
    }

    // detail
    frame(ctx, DX, TOP, DW, BOTTOM - TOP, "#0e0c10", "#2a2630", "#3a3540");
    const row = this.cur();
    if (row) this.detail(row);
    drawText(ctx, `${this.rows.length ? cur + 1 : 0}/${this.rows.length}`, DX + DW - 5, TOP + 4, UI.dim, 1, "right");

    // key line and status
    drawText(ctx, clipText(tab.hint, PW - 16), PX + 8, 158, UI.mid);
    drawText(ctx, "Q/R OR 1-5 TABS", PX + 8, 166, UI.dim);
    if (this.status) drawText(ctx, clipText(this.status.text, PW - 110), PX + PW - 8, 166, this.status.ok ? UI.ok : UI.bad, 1, "right");
  }

  private detail(row: Row) {
    const g = this.g, ctx = g.ctx, x = DX + 5;
    if (row.key === "item") {
      const id = row.item!, def = ITEMS[id], pl = g.pl;
      frame(ctx, x, TOP + 12, 36, 36, "#141117", "#2a2630", "#3a3540");
      ctx.drawImage(row.icon!.a, x + 2, TOP + 14, 32, 32);
      drawText(ctx, clipText(def.name, DW - 56), x + 42, TOP + 15, UI.title);
      drawText(ctx, clipText(def.tags.join(" / ").toUpperCase(), DW - 56), x + 42, TOP + 24, UI.mid);
      drawText(ctx, clipText(`ID: ${id.toUpperCase().replace(/_/g, " ")}`, DW - 56), x + 42, TOP + 33, UI.dim);
      drawText(ctx, `STACK ${maxStack(id)}`, x + 42, TOP + 41, UI.dim);
      let y = TOP + 54;
      for (const l of [...(def.desc ?? []), ...effectLines(id)]) { drawText(ctx, l, x, y, UI.text); y += 8; }
      y = Math.max(y + 3, TOP + 86);
      drawText(ctx, `IN PACK: ${countItem(pl, id)}`, x, y, UI.text);
      drawText(ctx, def.wear ? `WORN: ${wears(pl, id) ? "YES" : "NO"}` : def.equip ? `INSTALLED: ${flagOn(g.world, def.equip.flag) ? "YES" : "NO"}` : "", x + 62, y, UI.text);
      drawText(ctx, `HELD IN TOTAL: ${heldCount(pl, id)}`, x, y + 8, UI.dim);
      const qy = BOTTOM - 19;
      frame(ctx, x, qy, DW - 10, 13, "#1c1820", "#3a3540", "#4e4856");
      drawText(ctx, "QTY", x + 5, qy + 4, UI.mid);
      drawText(ctx, `< ${this.qty} >`, x + 50, qy + 4, UI.amber, 1, "center");
      drawText(ctx, def.equip ? "E INSTALL" : "E GIVE", x + DW - 15, qy + 4, UI.ok, 1, "right");
      return;
    }
    let y = TOP + 12;
    for (const l of wrapText(row.label, COLS).slice(0, 2)) { drawText(ctx, l, x, y, UI.title); y += 8; }
    y += 5;
    for (const l of wrapText(row.desc, COLS)) {
      if (y > BOTTOM - 16) break;
      drawText(ctx, l, x, y, UI.text);
      y += 8;
    }
    if (row.value) drawText(ctx, `NOW: ${row.value}`, x, BOTTOM - 12, row.vcol ?? UI.amber);
  }
}
