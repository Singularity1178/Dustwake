// The worker management screen: an overlay opened by E on a worker golem (the
// `manageActor` effect emits an event; the host pushes this screen).
//
//   left   the worker: its power state, where it is, its order and the phase it
//          is in, why it is blocked if it is, the eight slots it carries and
//          what it wears
//   right  what can be done with it: slot its core in / take it out, give a
//          GATHER, CRAFT or GO TO order (each a small form), pause / resume /
//          cancel the order it has
//   below  what the chosen row does (or why it can't), and the keys
//
//   W / S      choose a row            A / D   change a value in a form
//   E / Enter  do it                   C       slot the core in / take it out
//   Esc        back from a form, then close      I / Tab   close
//
// Presentation only. Orders go through sim/commands.ts: giveWorkerOrder
// (setWorkerOrder, its refusals said in words), controlWorker (pause / resume /
// cancel) and the old orderCoreSwap for the core. Everything a form offers is
// derived from the World (sim/orders.ts), so only valid targets show; nothing
// the screen holds is saved apart from the order the worker is given.
//
// The core goes in and out with the golem's own short reach (CORE_TASK) with the
// world running, like the crafting bench: the screen closes, the work happens,
// and the host reopens it (`pending` / `resume`) when the reach is done.
import type { Screen } from "../ui/screens";
import { type UiHost, UI, frame, panel, selEdge, clipText, TextField } from "../ui/kit";
import { actorDef } from "../content/actors";
import { ITEM_NAMES } from "../content/items";
import { slotDef } from "../content/gear";
import { actorById, type Actor } from "../world/world";
import { capacity } from "../sim/inventory";
import { powered, actorLabel, ACTOR_NAME_MAX } from "../sim/actorStats";
import { wornIn } from "../sim/gear";
import { CORE_TEXT, coreActionFor } from "../sim/power";
import { craftReason } from "../sim/crafting";
import { gatherOrder, craftOrder, walkOrder, workerRefusal } from "../sim/jobs";
import { controlWorker, giveWorkerOrder, orderCoreSwap, renameActor } from "../sim/commands";
import {
  AMOUNTS, areaName, canTake, craftChoices, gatherRefusal, gatherResources, gatherSources, jobView, powerState, stationOptions,
  storageOptions, walkOptions, workerStatus, type Tone,
} from "../sim/orders";
import { itemIcon } from "../art/items";
import { slotIcon } from "../art/slots";
import { BODY_ART, workerPose, workerState } from "../workerArt";
import { drawText } from "../font";
import { BASE_W as W, BASE_H as H } from "../view/zoom";
import { makeCanvas, Pen, clamp } from "../util";

export type ManageView = "main" | "gather" | "craft" | "walk";

const PX = 5, PY = 2, PW = 310, PH = 172;
/** Left column (the worker), right column (the rows). */
const LX = 13, RX = 166, RW = 141, ROW = 11, RY = 27;
const TONE: Record<Tone, string> = { ok: UI.ok, warn: UI.amber, bad: UI.bad, dim: UI.mid };

/** One line of a menu or form. A row with `step` is a choice (A / D change it, E takes the next); one with `act` is a button. */
interface Row {
  label: string;
  /** The chosen value of a choice row. */
  value?: string;
  /** False: greyed out, and E says why instead. */
  ok: boolean;
  /** Up to three lines for the panel below: what it does, or why it can't. */
  note: string[];
  act?: () => void;
  step?: (d: number) => void;
}

const wrap = (i: number, d: number, n: number) => (n ? (((i + d) % n) + n) % n : 0);

export class ManageUi {
  readonly screen: Screen;
  /** The worker being managed. */
  targetId: string | null = null;
  /** A core swap was ordered: the host reopens the screen once the reach is done (see resume). */
  pending = false;
  view: ManageView = "main";
  /** Chosen row, per view (cursor memory). */
  rows: Record<ManageView, number> = { main: 0, gather: 0, craft: 0, walk: 0 };
  /** Form choices: indexes into the lists derived from the world, clamped on every refresh. */
  gather = { res: 0, from: 0, to: 0, amt: 4 };
  craft = { station: 0, recipe: 0, amt: 0 };
  walk = { where: 0 };
  /** The rename field: active while the worker's name is being typed. */
  readonly nameField = new TextField(ACTOR_NAME_MAX);
  /** Opens the transfer screen for a worker (wired by the host; this screen steps aside for it). */
  openTransfer: ((targetId: string) => void) | null = null;
  private list: Row[] = [];
  private fresh = false;
  private fig: ReturnType<typeof makeCanvas> | null = null;

  constructor(private g: UiHost) {
    this.screen = { id: "manage", opaque: false, t: 0, update: () => this.update(), render: () => this.render() };
  }

  /** New session (a world was loaded or restarted): nothing remembered, no swap pending. */
  reset() { this.targetId = null; this.pending = false; this.nameField.active = false; this.nameField.clear(); this.view = "main"; this.rows = { main: 0, gather: 0, craft: 0, walk: 0 }; }

  get target(): Actor | undefined { return this.targetId ? actorById(this.g.world, this.targetId) : undefined; }
  get row() { return this.rows[this.view]; }
  get current(): Row | undefined { return this.list[this.row]; }
  /** The rows of the current view, for tests. */
  get menu(): readonly Row[] { this.refresh(); return this.list; }

  open(targetId: string) {
    if (targetId !== this.targetId) { this.rows = { main: 0, gather: 0, craft: 0, walk: 0 }; }
    this.targetId = targetId; this.view = "main"; this.pending = false;
    this.nameField.active = false; this.nameField.clear();
    this.refresh();
    this.g.screens.push(this.screen);
    this.g.sfx.open();
  }

  /** The ordered core swap is done: back to the worker, if it is still within reach. */
  resume() {
    this.pending = false;
    if (!this.targetId || workerRefusal(this.g.world, this.g.pl, this.targetId)) return;
    this.view = "main";
    this.refresh();
    this.g.screens.push(this.screen);
  }

  // ---------------------------------------------------------------- rows
  private refresh() {
    const a = this.target;
    this.fresh = true;
    if (!a) { this.list = []; return; }
    this.list = this.view === "main" ? this.mainRows(a) : this.view === "gather" ? this.gatherRows(a) : this.view === "craft" ? this.craftRows(a) : this.walkRows(a);
    this.rows[this.view] = clamp(this.rows[this.view], 0, Math.max(0, this.list.length - 1));
  }

  private mainRows(a: Actor): Row[] {
    const g = this.g, pl = g.pl, job = a.job;
    const core = coreActionFor(pl, a), needs = !!actorDef(a).power;
    const coreRow: Row = !needs
      ? { label: "NEEDS NO CORE", ok: false, note: ["THIS BODY RUNS WITHOUT A POWER CORE."] }
      : core.op === "remove"
        ? { label: `TAKE OUT ${ITEM_NAMES[core.item]}`, ok: true, note: ["TAKE ITS CORE OUT. IT POWERS DOWN AND ITS ORDER", "WAITS UNTIL A CORE GOES BACK IN."], act: () => this.swapCore() }
        : core.op === "insert"
          ? { label: `SLOT IN ${ITEM_NAMES[core.item]}`, ok: true, note: ["SLOT A CORE FROM YOUR PACK INTO ITS CHEST.", "IT POWERS ON AND GETS BACK TO ITS ORDER."], act: () => this.swapCore() }
          : { label: "NO CORE TO SLOT IN", ok: false, note: [CORE_TEXT.noCore + "."], act: () => this.swapCore() };
    const kindRow = (label: string, kind: string, view: ManageView, note: string[]): Row =>
      canTake(a, kind) ? { label, ok: true, note, act: () => this.go(view) } : { label, ok: false, note: ["IT CANNOT DO THAT WORK."] };
    const live = !!job && job.status !== "done";
    const resume = !!job && (job.status === "blocked" || (job.status === "paused" && job.reason === "manual"));
    return [
      coreRow,
      kindRow("GATHER...", "gatherDeposit", "gather", ["SEND IT TO HARVEST A RESOURCE AND CARRY IT TO A", "STORAGE CHEST, ONCE OR UNTIL TOLD TO STOP."]),
      kindRow("CRAFT...", "craftAt", "craft", ["HAVE IT CRAFT AT A BENCH FROM ITS PACK AND THE", "STORAGE BESIDE THE BENCH, ONCE OR ON REPEAT."]),
      kindRow("GO TO...", "walk", "walk", ["SEND IT SOMEWHERE AND LEAVE IT STANDING THERE."]),
      { label: "TRANSFER...", ok: true, note: ["SEE YOUR PACK BESIDE ITS PACK: GIVE IT ITEMS, TAKE", "THEM BACK, OR PUT A RUNE ON IT."], act: () => this.openTransfer?.(a.id) },
      { label: "RENAME...", ok: true, note: [a.name ? `IT IS CALLED ${actorLabel(a)}. GIVE IT A NEW NAME,` : "GIVE IT A NAME OF YOUR OWN. IT GOES BEFORE ITS KIND:", a.name ? "OR LEAVE IT EMPTY TO CLEAR IT." : `${actorDef(a).name} BECOMES BOB - ${actorDef(a).name}.`], act: () => this.startRename() },
      resume
        ? { label: job!.status === "blocked" ? "RETRY ORDER" : "RESUME ORDER", ok: true, note: ["LET IT TRY AGAIN, FROM WHERE IT STANDS."], act: () => this.control("resume") }
        : { label: "PAUSE ORDER", ok: live, note: [live ? "HOLD ITS ORDER WHERE IT IS. NOTHING IS LOST." : "IT HAS NO ORDER TO PAUSE."], act: () => this.control("pause") },
      { label: "CANCEL ORDER", ok: !!job, note: [job ? "DROP ITS ORDER. WHAT IT CARRIES STAYS WITH IT." : "IT HAS NO ORDER TO CANCEL."], act: () => this.control("cancel") },
    ];
  }

  private amountRow(st: { amt: number }): Row {
    const v = AMOUNTS[st.amt];
    return {
      label: "AMOUNT", value: String(v), ok: true, step: (d) => { st.amt = wrap(st.amt, d, AMOUNTS.length); },
      note: v === "REPEAT" ? ["IT KEEPS AT IT UNTIL YOU CANCEL THE ORDER."] : [`IT STOPS AFTER ${v}.`],
    };
  }

  private gatherRows(a: Actor): Row[] {
    const w = this.g.world, st = this.gather;
    const resources = gatherResources();
    st.res = clamp(st.res, 0, resources.length - 1);
    const item = resources[st.res];
    const sources = gatherSources(w, a, item), stores = storageOptions(w, a);
    st.from = clamp(st.from, 0, Math.max(0, sources.length - 1));
    st.to = clamp(st.to, 0, Math.max(0, stores.length - 1));
    const from = sources[st.from], to = stores[st.to];
    const why = gatherRefusal(w, a, item, from?.area, to?.ref);
    const amount = AMOUNTS[st.amt], repeat = amount === "REPEAT";
    return [
      { label: "RESOURCE", value: ITEM_NAMES[item], ok: true, step: (d) => { st.res = wrap(st.res, d, resources.length); st.from = 0; }, note: [`WHAT TO GATHER: ${resources.map((i) => ITEM_NAMES[i]).join(", ")}.`] },
      { label: "FROM", value: from ? from.label : "NONE", ok: !!from, step: (d) => { st.from = wrap(st.from, d, sources.length); }, note: from ? [`${from.count} SOURCES OF ${ITEM_NAMES[item]} LEFT IN ${from.label}.`] : [`NO ${ITEM_NAMES[item]} LEFT IN ANY AREA IT CAN REACH.`] },
      { label: "TO", value: to ? to.label : "NONE", ok: !!to, step: (d) => { st.to = wrap(st.to, d, stores.length); }, note: to ? [`IT STORES WHAT IT GATHERS IN ${to.label}.`] : ["NO STORAGE YET. BUILD A STORAGE CHEST."] },
      this.amountRow(st),
      {
        label: "ISSUE ORDER", ok: !why, note: [why ? `${why}.` : `GATHER ${repeat ? "WITHOUT END" : String(amount)} ${ITEM_NAMES[item]} FROM ${from!.label}, TO ${to!.label}.`],
        act: () => this.issue(gatherOrder(item, from!.area, { ...to!.ref }, repeat ? 1 : (amount as number), repeat)),
      },
    ];
  }

  private craftRows(a: Actor): Row[] {
    const w = this.g.world, st = this.craft;
    const stations = stationOptions(w, a);
    st.station = clamp(st.station, 0, Math.max(0, stations.length - 1));
    const station = stations[st.station], entries = craftChoices(w, a, station);
    st.recipe = clamp(st.recipe, 0, Math.max(0, entries.length - 1));
    const e = entries[st.recipe], amount = AMOUNTS[st.amt], repeat = amount === "REPEAT";
    const why = !station ? "BUILD A CRAFTING BENCH FIRST" : !e ? "IT KNOWS NO RECIPE HERE" : null;
    const r = e?.recipe;
    const recipeNote = r ? [
      `MAKES ${r.output.n} ${ITEM_NAMES[r.output.item]}. NEEDS ${r.inputs.map((c) => `${c.n} ${ITEM_NAMES[c.item]}`).join(", ")}.`,
      e.status === "ok" ? "IT HAS WHAT IT NEEDS RIGHT NOW." : `NOW: ${craftReason(e)}. THE ORDER WAITS.`,
    ] : ["NOTHING TO CRAFT."];
    return [
      { label: "STATION", value: station ? station.label : "NONE", ok: !!station, step: (d) => { st.station = wrap(st.station, d, stations.length); st.recipe = 0; }, note: station ? [`IT CRAFTS AT ${station.label}, FROM ITS PACK AND THE STORAGE BESIDE IT.`] : ["NO STATION YET. BUILD A CRAFTING BENCH."] },
      { label: "RECIPE", value: r ? r.name : "NONE", ok: !!e, step: (d) => { st.recipe = wrap(st.recipe, d, entries.length); }, note: recipeNote },
      this.amountRow(st),
      {
        label: "ISSUE ORDER", ok: !why, note: [why ? `${why}.` : `CRAFT ${repeat ? "WITHOUT END" : String(amount)} ${r!.name} AT ${station!.label}.`],
        act: () => this.issue(craftOrder({ ...station!.ref }, r!.id, repeat ? 1 : (amount as number), repeat)),
      },
    ];
  }

  private walkRows(a: Actor): Row[] {
    const st = this.walk, spots = walkOptions(this.g.world, a);
    st.where = clamp(st.where, 0, Math.max(0, spots.length - 1));
    const s = spots[st.where];
    return [
      { label: "WHERE", value: s ? s.label : "NONE", ok: !!s, step: (d) => { st.where = wrap(st.where, d, spots.length); }, note: s ? [`IT WALKS THERE, BY RUNE IF IT MUST, AND STANDS.`, `${areaName(s.area)} AT ${Math.round(s.x)},${Math.round(s.y)}.`] : ["THERE IS NOWHERE FOR IT TO GO."] },
      { label: "ISSUE ORDER", ok: !!s, note: [s ? `SEND IT TO ${s.label}.` : "THERE IS NOWHERE FOR IT TO GO."], act: () => this.issue(walkOrder(s!.area, s!.x, s!.y)) },
    ];
  }

  // ---------------------------------------------------------------- doing
  private go(view: ManageView) { this.view = view; this.refresh(); }

  private issue(order: ReturnType<typeof gatherOrder>) {
    const g = this.g;
    if (!this.targetId) return;
    const r = giveWorkerOrder(g.world, g.pl, this.targetId, order);
    if (r.ok) { g.sfx.tone(520, 0.06, "triangle", 0.04); this.view = "main"; this.rows.main = 0; } else g.sfx.thud();
    g.drainEvents();
    this.refresh();
  }

  private control(what: "pause" | "resume" | "cancel") {
    const g = this.g;
    if (!this.targetId) return;
    const r = controlWorker(g.world, g.pl, this.targetId, what);
    if (r.ok) g.sfx.tone(440, 0.05, "triangle", 0.04); else g.sfx.thud();
    g.drainEvents();
    this.refresh();
  }

  /** Start typing a new name, the current one as the starting text. */
  startRename() {
    const a = this.target;
    if (!a) return;
    this.nameField.value = (a.name ?? "").slice(0, ACTOR_NAME_MAX); this.nameField.active = true;
    this.g.sfx.tone(520, 0.05, "triangle", 0.04);
  }
  /** Keep what was typed (empty clears the name). Returns whether the worker took it. */
  commitRename(): boolean {
    const g = this.g, f = this.nameField;
    f.active = false;
    const r = this.targetId ? renameActor(g.world, g.pl, this.targetId, f.value) : { ok: false, text: "" };
    f.clear();
    if (r.ok) g.sfx.tone(420, 0.05, "triangle", 0.04); else g.sfx.thud();
    g.drainEvents();
    this.refresh();
    return r.ok;
  }
  cancelRename() { this.nameField.active = false; this.nameField.clear(); }

  /** Slot a core in or take it out: the same order the C key gives. The golem does it with the world running, then this screen comes back. */
  swapCore() {
    const g = this.g, a = this.target;
    if (!a) return;
    const act = coreActionFor(g.pl, a);
    if (act.op === "none") { g.say(CORE_TEXT.noCore); g.sfx.thud(); return; }
    if (orderCoreSwap(g.world, g.pl, a.id, act.op === "insert" ? act.item : null)) { this.pending = true; g.screens.popToBase(); } else g.sfx.thud();
    g.drainEvents();
  }

  private update() {
    const g = this.g;
    const a = this.target;
    if (this.nameField.active) {
      // Typing mode: letters go to the field, never to the rows or the core key.
      if (!a) { this.cancelRename(); g.screens.popToBase(); return; }
      if (this.nameField.feed(g.typed)) g.sfx.tone(620, 0.02, "square", 0.015);
      if (g.hit("enter")) this.commitRename();
      else if (g.hit("escape")) this.cancelRename();
      return;
    }
    if (g.hit("i", "tab")) { g.screens.popToBase(); return; }
    if (!a) { g.screens.popToBase(); return; }
    if (g.hit("escape")) { if (this.view === "main") g.screens.popToBase(); else { this.go("main"); g.sfx.tone(400, 0.04, "square", 0.02); } return; }
    this.refresh();
    const before = `${this.view}:${this.row}`;
    if (g.hit("arrowup", "w")) this.rows[this.view] = Math.max(0, this.row - 1);
    if (g.hit("arrowdown", "s")) this.rows[this.view] = Math.min(this.list.length - 1, this.row + 1);
    if (`${this.view}:${this.row}` !== before) g.sfx.tone(500, 0.04, "square", 0.02);
    const r = this.current;
    if (g.hit("c")) { this.swapCore(); return; }
    if (this.view === "main" && g.hit("r")) { this.startRename(); return; }
    if (!r) return;
    const d = g.hit("arrowleft", "a") ? -1 : g.hit("arrowright", "d") ? 1 : 0;
    if (d && r.step) { r.step(d); g.sfx.tone(480, 0.04, "square", 0.02); this.refresh(); return; }
    if (g.hit("e", "enter", " ")) {
      if (r.act && r.ok) r.act();
      else if (r.step) { r.step(1); g.sfx.tone(480, 0.04, "square", 0.02); this.refresh(); }
      else { g.say(r.note[0].replace(/\.$/, "")); g.sfx.thud(); }
    }
  }

  // ---------------------------------------------------------------- drawing
  private render() {
    const g = this.g, ctx = g.ctx, a = this.target;
    if (!this.fresh || this.view !== "walk") this.refresh();
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    panel(ctx, PX, PY, PW, PH);
    if (!a) return;
    const st = workerStatus(g.world, a);
    if (this.nameField.active) this.nameField.draw(ctx, LX - 1, PY + 3, 150, g.t, "NAME");
    else {
      drawText(ctx, clipText(actorLabel(a), 150), LX, PY + 6, UI.title);
      drawText(ctx, clipText(st.text, 120), PX + PW - 8, PY + 6, TONE[st.tone], 1, "right");
    }
    this.renderWorker(a);
    this.renderRows();
    this.renderNotes();
    g.renderNote(PY + PH + 1);
  }

  private renderWorker(a: Actor) {
    const g = this.g, ctx = g.ctx, w = g.world;
    // portrait
    frame(ctx, LX, 17, 46, 48, "#0e0c10", "#26222c", "#34303c");
    const art = BODY_ART[actorDef(a).art.key];
    if (art) {
      this.fig ??= makeCanvas(21, 22);
      this.fig.ctx.clearRect(0, 0, 21, 22);
      const on = powered(a), busy = on && (!!a.task || a.job?.status === "running");
      art(new Pen(this.fig.ctx, false), 10, 20, workerPose(workerState(on, busy), { facing: "down", phase: 0, moving: false, t: g.t, hasCore: !!a.powerCore }));
      ctx.drawImage(this.fig.c, LX + 2, 19, 42, 44);
    }
    // state, beside it
    const x = LX + 52, tw = 100, pw = powerState(a), v = jobView(w, a);
    drawText(ctx, clipText(`POWER: ${pw.text}`, tw), x, 20, TONE[pw.tone]);
    drawText(ctx, clipText(`AT: ${areaName(a.area)}`, tw), x, 29, UI.mid);
    if (v) {
      drawText(ctx, clipText(`${v.title}${v.progress ? ` ${v.progress}` : ""}`, tw), x, 38, UI.text);
      drawText(ctx, clipText(`PHASE: ${v.phase}`, tw), x, 47, UI.mid);
      drawText(ctx, clipText(v.status, tw), x, 56, TONE[v.tone]);
      v.lines.slice(0, 2).forEach((l, i) => drawText(ctx, clipText(l, 148), LX, 69 + i * 8, UI.dim));
    } else {
      drawText(ctx, "NO ORDER", x, 38, UI.mid);
      drawText(ctx, powered(a) ? "IT STANDS AND WAITS" : "IT IS SWITCHED OFF", x, 47, UI.dim);
      drawText(ctx, clipText(workerStatus(w, a).text, tw), x, 56, TONE[workerStatus(w, a).tone]);
    }
    // what it carries
    const cap = capacity(w, a), used = a.inventory.slice(0, cap).filter(Boolean).length;
    drawText(ctx, `CARRIES ${used}/${cap}`, LX, 87, UI.mid);
    for (let i = 0; i < cap; i++) {
      const cx = LX + (i % 4) * 19, cy = 95 + Math.floor(i / 4) * 19, s = a.inventory[i] ?? null;
      frame(ctx, cx, cy, 18, 18, s ? "#17141b" : "#100e12", s ? "#3a3540" : "#2a2630", "#4a4552");
      if (!s) continue;
      ctx.drawImage(itemIcon(s.item).a, cx + 1, cy + 1);
      if (s.n > 1) drawText(ctx, String(s.n), cx + 17 - (String(s.n).length * 4 - 1), cy + 11, "#f0e8d0");
    }
    // what it wears
    drawText(ctx, "WORN", LX + 84, 87, UI.mid);
    const slots = actorDef(a).gearSlots.slice(0, 3);
    slots.forEach((id, i) => {
      const sx = LX + 84 + i * 24, item = wornIn(a, id);
      frame(ctx, sx, 95, 20, 20, item ? "#1c1722" : "#100e12", item ? "#6a5634" : "#2a2630", item ? "#a88a4c" : "#3a3540");
      if (item) ctx.drawImage(itemIcon(item).a, sx + 2, 97);
      else { ctx.globalAlpha = 0.28; ctx.drawImage(slotIcon(slotDef(id).kind).a, sx + 2, 97); ctx.globalAlpha = 1; }
      drawText(ctx, slotDef(id).name, sx + 10, 118, item ? UI.dim : UI.lock, 1, "center");
    });
    if (!slots.length) drawText(ctx, "NOTHING", LX + 84, 99, UI.dim);
  }

  private renderRows() {
    const g = this.g, ctx = g.ctx, t = g.t;
    const title = this.view === "main" ? "ORDERS" : this.view === "gather" ? "GATHER ORDER" : this.view === "craft" ? "CRAFT ORDER" : "GO TO ORDER";
    drawText(ctx, title, RX + 2, 18, UI.mid);
    ctx.fillStyle = "#26222c"; ctx.fillRect(RX - 4, 16, 1, 114);
    this.list.forEach((r, i) => {
      const y = RY + i * ROW, sel = i === this.row;
      if (sel) frame(ctx, RX, y - 2, RW, ROW, "#221d26", selEdge(t), "#3a3540");
      const col = sel ? UI.title : r.ok ? UI.text : UI.lock;
      drawText(ctx, clipText(r.label, r.value !== undefined ? 36 : RW - 10), RX + 5, y + 1, col);
      if (r.value !== undefined) {
        const arrows = sel && r.step ? ["<", ">"] : [" ", " "];
        drawText(ctx, `${arrows[0]} ${clipText(r.value, 88)} ${arrows[1]}`.replace(/^ {1,2}/, ""), RX + RW - 5, y + 1, r.ok ? (sel ? UI.title : UI.amber) : UI.lock, 1, "right");
      }
    });
  }

  private renderNotes() {
    const g = this.g, ctx = g.ctx;
    const bx = PX + 4, by = PY + PH - 38, bw = PW - 8, bh = 34;
    frame(ctx, bx, by, bw, bh, "#0e0c10", "#2a2630", "#3a3540");
    const r = this.current;
    (r?.note ?? []).slice(0, 3).forEach((l, i) => drawText(ctx, clipText(l, bw - 12), bx + 6, by + 5 + i * 7, r!.ok ? "#a89c80" : UI.mid));
    const keys = this.nameField.active ? "TYPE A NAME   ENTER KEEP   ESC CANCEL   EMPTY: NO NAME" : this.view === "main" ? "W/S CHOOSE   E SELECT   R RENAME   C CORE   ESC CLOSE" : "W/S CHOOSE   A/D CHANGE   E CONFIRM   C CORE   ESC BACK";
    drawText(ctx, clipText(keys, bw - 12), bx + 6, by + bh - 9, UI.dim);
  }
}
