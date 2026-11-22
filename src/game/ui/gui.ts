// UI framework v2: an immediate-mode widget kit for the high-resolution UI layer
// (no DOM: it draws on whatever 2D context the host hands it, and the tests use
// the fake canvas). Each frame the host calls begin(), screens call widgets
// (each draws itself and returns what happened), then end() draws the tooltip
// and moves the keyboard focus.
//
// Mouse: hover, click (press and release on the same widget), drag (sliders,
// scrollbars), wheel (lists, sliders), right-click is the host's (context menus).
// Keyboard and gamepad parity: every interactive widget joins the focus order;
// Up / Down move the focus, Left / Right change a focused slider, choice or tab
// bar, Enter / E / Space activate, Esc is "back" (the screen decides what that
// closes). A list keeps Up / Down for its own rows until its first or last row.
import { drawText2, textWidth2, wrapText2, clipText2, CELL_H2, LINE_H2, type Align } from "./font2";

export interface Rect { x: number; y: number; w: number; h: number }
export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const inside = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

export interface GuiKeys { up: boolean; down: boolean; left: boolean; right: boolean; activate: boolean; back: boolean; prevTab: boolean; nextTab: boolean }
export interface GuiInput {
  /** Pointer in the layer's logical px (NaN when it is off the canvas). */
  mx: number; my: number;
  down: boolean; pressed: boolean; released: boolean; rpressed: boolean;
  /** Wheel this frame (+ is down / toward the user). */
  wheel: number;
  keys: GuiKeys;
  t: number; dt: number;
}
export const noKeys = (): GuiKeys => ({ up: false, down: false, left: false, right: false, activate: false, back: false, prevTab: false, nextTab: false });
export const noInput = (): GuiInput => ({ mx: NaN, my: NaN, down: false, pressed: false, released: false, rpressed: false, wheel: 0, keys: noKeys(), t: 0, dt: 0 });

export const THEME = {
  shade: "rgba(4,3,6,0.62)", bg: "#0e0c11", panel: "#17141b", panel2: "#211d27", row: "#1b1820", rowAlt: "#16131a",
  edge: "#3a3540", hi: "#5a5262", text: "#ece4d0", dim: "#9a92a2", faint: "#5a5462", accent: "#e8b85a",
  accentDim: "#8a6a2a", accent2: "#7fd0d8", ok: "#7ae08a", bad: "#e08a7a", focus: "#f2dc94", sel: "#3a3044", track: "#2a2530",
};

export interface ListResult { sel: number; clicked: number; activated: number }
export interface Column { label: string; w: number; align?: Align }
export interface TableResult extends ListResult { order: number[] }

export class Gui {
  ctx: CanvasRenderingContext2D | null = null;
  w = 640; h = 360;
  input: GuiInput = noInput();
  /** Widget under the pointer this frame, and the one holding the mouse (pressed on, being dragged). */
  hot: string | null = null;
  active: string | null = null;
  /** Keyboard / gamepad focus. */
  focus: string | null = null;
  /** Pointer over any panel or widget this frame / last frame (the world must not take that click). */
  over = false;
  overPrev = false;
  /** Something under the pointer scrolls with the wheel (the host does not zoom then). */
  wantsWheel = false;
  /** The open modal's id (widgets outside it are inert while it is drawn). */
  modal: string | null = null;
  palette = { alert: "#ff6a5a", warn: "#f0c060", info: "#8ac8e8", select: "#f0d890" };
  private order: string[] = [];
  private navTaken = false;
  private inModal = false;
  private modalSeen = false;
  private modalFresh = false;
  private tipText: string | null = null;
  private hoverId: string | null = null;
  private hoverT = 0;
  private scrolls = new Map<string, number>();
  private sorts = new Map<string, { col: number; dir: 1 | -1 }>();
  private lastClick = { id: "", t: -9 };

  begin(ctx: CanvasRenderingContext2D, w: number, h: number, input: GuiInput) {
    this.ctx = ctx; this.w = w; this.h = h; this.input = input;
    this.overPrev = this.over; this.over = false; this.wantsWheel = false;
    this.order = []; this.navTaken = false; this.hot = null; this.tipText = null; this.modalSeen = false;
  }

  end() {
    const k = this.input.keys;
    if (!this.navTaken && (k.up || k.down) && this.order.length) {
      let i = this.focus ? this.order.indexOf(this.focus) : -1;
      i = i < 0 ? (k.down ? 0 : this.order.length - 1) : (i + (k.down ? 1 : -1) + this.order.length) % this.order.length;
      this.focus = this.order[i];
    }
    if (this.focus && !this.order.includes(this.focus)) this.focus = null;
    if (!this.modalSeen) this.modal = null;
    if (this.hot && this.hot === this.hoverId) this.hoverT += this.input.dt;
    else { this.hoverId = this.hot; this.hoverT = 0; }
    if (this.tipText && this.hoverT > 0.4 && this.ctx) this.drawTip(this.tipText);
    if (!this.input.down) this.active = null;
  }

  /** Pointer over the UI (this frame or the last): the host keeps world clicks away from it. */
  get pointerOver() { return this.over || this.overPrev || this.modal !== null; }

  // ------------------------------------------------------------ drawing helpers
  fill(r: Rect, c: string) { const x = this.ctx!; x.fillStyle = c; x.fillRect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)); }
  stroke(r: Rect, c: string) {
    const x = this.ctx!, X = Math.round(r.x), Y = Math.round(r.y), W = Math.round(r.w), H = Math.round(r.h);
    x.fillStyle = c; x.fillRect(X, Y, W, 1); x.fillRect(X, Y + H - 1, W, 1); x.fillRect(X, Y, 1, H); x.fillRect(X + W - 1, Y, 1, H);
  }
  text(s: string, x: number, y: number, color: string = THEME.text, align: Align = "left") { drawText2(this.ctx!, s, x, y, color, align); }
  /** Text clipped to `w` px. */
  textIn(s: string, x: number, y: number, w: number, color: string = THEME.text, align: Align = "left") {
    const t = clipText2(s, w);
    drawText2(this.ctx!, t, align === "left" ? x : align === "center" ? x + w / 2 : x + w, y, color, align);
  }
  /** Wrapped text inside `r`; returns the height used. */
  para(s: string, r: Rect, color: string = THEME.dim): number {
    const lines = wrapText2(s, r.w);
    lines.forEach((l, i) => { if (i * LINE_H2 < r.h) drawText2(this.ctx!, l, r.x, r.y + i * LINE_H2, color); });
    return lines.length * LINE_H2;
  }
  measure(s: string) { return textWidth2(s); }

  /** A framed panel, optionally titled. The pointer over it is the UI's, not the world's. */
  panel(r: Rect, title?: string) {
    if (inside(r, this.input.mx, this.input.my) && this.live()) this.over = true;
    this.fill({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, "#060507");
    this.fill(r, THEME.panel);
    this.stroke(r, THEME.edge);
    this.fill({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: 1 }, THEME.hi);
    if (title) {
      this.fill({ x: r.x + 1, y: r.y + 2, w: r.w - 2, h: 13 }, THEME.panel2);
      this.text(title, r.x + 6, r.y + 4, THEME.accent);
    }
  }

  // ------------------------------------------------------------ widgets
  private live() { return this.modal === null || this.inModal; }

  private reg(id: string, r: Rect, focusable = true) {
    const inp = this.input, live = this.live() && !(this.inModal && this.modalFresh);
    if (focusable && live) this.order.push(id);
    const hover = live && inside(r, inp.mx, inp.my) && (this.active === null || this.active === id);
    if (hover) { this.hot = id; this.over = true; if (inp.pressed) this.active = id; }
    const clicked = hover && inp.released && this.active === id;
    const focused = live && this.focus === id;
    return { hover, focused, held: live && this.active === id && inp.down, clicked, live };
  }

  private tip(hover: boolean, tip?: string) { if (hover && tip) this.tipText = tip; }

  button(id: string, r: Rect, label: string, o: { tip?: string; disabled?: boolean; selected?: boolean; color?: string } = {}): boolean {
    const s = this.reg(id, r, !o.disabled);
    this.tip(s.hover, o.tip);
    const bg = o.disabled ? THEME.rowAlt : s.held ? THEME.sel : o.selected ? THEME.accentDim : s.hover ? THEME.panel2 : THEME.row;
    this.fill(r, bg);
    this.stroke(r, s.focused ? THEME.focus : o.selected ? THEME.accent : s.hover && !o.disabled ? THEME.hi : THEME.edge);
    this.textIn(label, r.x + 3, r.y + Math.round((r.h - CELL_H2) / 2) + 1, r.w - 6, o.disabled ? THEME.faint : o.color ?? THEME.text, "center");
    if (o.disabled) return false;
    return s.clicked || (s.focused && this.input.keys.activate);
  }

  toggle(id: string, r: Rect, label: string, value: boolean, tip?: string): boolean {
    const s = this.reg(id, r);
    this.tip(s.hover, tip);
    if (s.hover || s.focused) this.fill(r, THEME.row);
    if (s.focused) this.stroke(r, THEME.focus);
    const b = { x: r.x + 3, y: r.y + Math.round((r.h - 9) / 2), w: 9, h: 9 };
    this.fill(b, THEME.track); this.stroke(b, s.hover ? THEME.hi : THEME.edge);
    if (value) this.fill({ x: b.x + 2, y: b.y + 2, w: 5, h: 5 }, THEME.ok);
    this.textIn(label, r.x + 17, r.y + Math.round((r.h - CELL_H2) / 2) + 1, r.w - 20);
    const k = this.input.keys;
    if (s.clicked || (s.focused && (k.activate || k.left || k.right))) return !value;
    return value;
  }

  slider(id: string, r: Rect, label: string, value: number, min: number, max: number, step = 1, fmt: (v: number) => string = (v) => `${Math.round(v)}`, tip?: string): number {
    const s = this.reg(id, r);
    this.tip(s.hover, tip);
    if (s.focused) this.stroke(r, THEME.focus);
    const lw = Math.min(110, Math.round(r.w * 0.42)), vw = 30;
    this.textIn(label, r.x + 3, r.y + Math.round((r.h - CELL_H2) / 2) + 1, lw - 6);
    const tr = { x: r.x + lw, y: r.y + Math.round(r.h / 2) - 2, w: r.w - lw - vw - 6, h: 4 };
    const k = (value - min) / Math.max(1e-9, max - min);
    this.fill(tr, THEME.track);
    this.fill({ x: tr.x, y: tr.y, w: Math.round(tr.w * k), h: tr.h }, s.hover || s.held ? THEME.accent : THEME.accentDim);
    this.fill({ x: tr.x + Math.round(tr.w * k) - 2, y: tr.y - 3, w: 5, h: 10 }, s.held ? THEME.focus : THEME.text);
    this.text(fmt(value), r.x + r.w - 3, r.y + Math.round((r.h - CELL_H2) / 2) + 1, THEME.dim, "right");
    let v = value;
    if (s.held && tr.w > 0) v = min + Math.max(0, Math.min(1, (this.input.mx - tr.x) / tr.w)) * (max - min);
    if (s.hover && this.input.wheel) { v -= Math.sign(this.input.wheel) * step; this.wantsWheel = true; }
    if (s.focused && this.input.keys.left) v -= step;
    if (s.focused && this.input.keys.right) v += step;
    v = Math.max(min, Math.min(max, Math.round(v / step) * step));
    return v;
  }

  /** A row of buttons, one per option (segmented). Left / Right step it while focused. */
  choice(id: string, r: Rect, label: string, options: readonly { value: string; label: string }[], value: string, tip?: string): string {
    const s = this.reg(id, r);
    this.tip(s.hover, tip);
    if (s.focused) this.stroke(r, THEME.focus);
    const lw = Math.min(110, Math.round(r.w * 0.42));
    this.textIn(label, r.x + 3, r.y + Math.round((r.h - CELL_H2) / 2) + 1, lw - 6);
    const bw = (r.w - lw - 3) / Math.max(1, options.length);
    let out = value;
    options.forEach((o, i) => {
      const br = { x: Math.round(r.x + lw + i * bw), y: r.y + 1, w: Math.round(bw) - 2, h: r.h - 2 };
      const hov = s.live && inside(br, this.input.mx, this.input.my), sel = o.value === value;
      this.fill(br, sel ? THEME.accentDim : hov ? THEME.panel2 : THEME.row);
      this.stroke(br, sel ? THEME.accent : THEME.edge);
      this.textIn(o.label, br.x + 2, br.y + Math.round((br.h - CELL_H2) / 2) + 1, br.w - 4, sel ? THEME.text : THEME.dim, "center");
      if (hov && s.clicked) out = o.value;
    });
    const i = options.findIndex((o) => o.value === value), k = this.input.keys;
    if (s.focused && k.left && i > 0) out = options[i - 1].value;
    if (s.focused && k.right && i < options.length - 1) out = options[i + 1].value;
    if (s.focused && k.activate && options.length) out = options[(i + 1) % options.length].value;
    return out;
  }

  /** A tab bar. `hotkeys`: Q / R (prevTab / nextTab) switch it from anywhere on the screen. */
  tabs(id: string, r: Rect, labels: readonly string[], index: number, hotkeys = true): number {
    const s = this.reg(id, r);
    const tw = r.w / Math.max(1, labels.length);
    let out = index;
    labels.forEach((l, i) => {
      const tr = { x: Math.round(r.x + i * tw), y: r.y, w: Math.round(tw) - 1, h: r.h };
      const hov = s.live && inside(tr, this.input.mx, this.input.my), sel = i === index;
      this.fill(tr, sel ? THEME.panel2 : hov ? THEME.row : THEME.bg);
      this.fill({ x: tr.x, y: tr.y + tr.h - 2, w: tr.w, h: 2 }, sel ? THEME.accent : THEME.edge);
      this.textIn(l, tr.x + 2, tr.y + Math.round((tr.h - CELL_H2) / 2), tr.w - 4, sel ? THEME.accent : hov ? THEME.text : THEME.dim, "center");
      if (hov && s.clicked) out = i;
    });
    if (s.focused) this.stroke(r, THEME.focus);
    const k = this.input.keys, n = labels.length;
    if ((hotkeys && k.prevTab) || (s.focused && k.left)) out = (index - 1 + n) % n;
    if ((hotkeys && k.nextTab) || (s.focused && k.right)) out = (index + 1) % n;
    return out;
  }

  /** A scrolling list of `count` rows `rowH` high; `draw` paints one row. Clicked / activated are row indices or -1. */
  list(id: string, r: Rect, count: number, rowH: number, sel: number, draw: (i: number, row: Rect, selected: boolean, hover: boolean) => void): ListResult {
    const s = this.reg(id, r);
    const inp = this.input, visible = Math.max(1, Math.floor(r.h / rowH)), maxScroll = Math.max(0, count - visible);
    let scroll = Math.min(this.scrolls.get(id) ?? 0, maxScroll);
    if (s.hover || (s.live && inside(r, inp.mx, inp.my))) { this.over = true; if (count > visible) this.wantsWheel = true; }
    if (s.live && inside(r, inp.mx, inp.my) && inp.wheel) scroll = Math.max(0, Math.min(maxScroll, scroll + Math.sign(inp.wheel) * 2));
    this.fill(r, THEME.bg);
    this.stroke(r, s.focused ? THEME.focus : THEME.edge);
    let clicked = -1, activated = -1, out = sel;
    const sbw = count > visible ? 5 : 0;
    for (let v = 0; v < visible && scroll + v < count; v++) {
      const i = scroll + v, row = { x: r.x + 1, y: r.y + 1 + v * rowH, w: r.w - 2 - sbw, h: rowH };
      const hov = s.live && inside(row, inp.mx, inp.my) && (this.active === null || this.active === id);
      this.fill(row, i === sel ? THEME.sel : hov ? THEME.panel2 : i % 2 ? THEME.rowAlt : THEME.row);
      draw(i, row, i === sel, hov);
      if (hov && s.clicked) {
        clicked = i; out = i;
        if (this.lastClick.id === `${id}:${i}` && inp.t - this.lastClick.t < 0.35) activated = i;
        this.lastClick = { id: `${id}:${i}`, t: inp.t };
      }
    }
    if (sbw) {
      const tr = { x: r.x + r.w - sbw - 1, y: r.y + 1, w: sbw, h: r.h - 2 };
      this.fill(tr, THEME.track);
      const th = Math.max(8, Math.round((tr.h * visible) / count)), ty = tr.y + Math.round(((tr.h - th) * scroll) / Math.max(1, maxScroll));
      this.fill({ x: tr.x, y: ty, w: tr.w, h: th }, s.held && inp.mx >= tr.x ? THEME.accent : THEME.hi);
      if (s.held && inp.mx >= tr.x - 2) scroll = Math.round(Math.max(0, Math.min(1, (inp.my - tr.y - th / 2) / Math.max(1, tr.h - th))) * maxScroll);
    }
    const k = inp.keys;
    if (s.focused && count) {
      if (k.down && sel < count - 1) { out = sel < 0 ? 0 : sel + 1; this.navTaken = true; }
      else if (k.up && sel > 0) { out = sel - 1; this.navTaken = true; }
      if (k.activate && sel >= 0) activated = sel;
      if (out < scroll) scroll = out;
      if (out >= scroll + visible) scroll = out - visible + 1;
    }
    this.scrolls.set(id, scroll);
    return { sel: out, clicked, activated };
  }

  /** A table: a header (click a column to sort by it, again to reverse) over a list. Indices are into `rows`. */
  table(id: string, r: Rect, cols: readonly Column[], rows: readonly (readonly string[])[], sel: number, o: { rowH?: number; color?: (row: number) => string | undefined } = {}): TableResult {
    const rowH = o.rowH ?? 12, head = { x: r.x, y: r.y, w: r.w, h: 13 };
    const sort = this.sorts.get(id);
    const order = rows.map((_, i) => i);
    if (sort) order.sort((a, b) => sort.dir * cmp(rows[a][sort.col] ?? "", rows[b][sort.col] ?? ""));
    this.fill(head, THEME.panel2);
    const total = cols.reduce((n, c) => n + c.w, 0), k = (r.w - 8) / Math.max(1, total);
    let x = r.x + 4;
    cols.forEach((c, ci) => {
      const cw = c.w * k, hr = { x, y: head.y, w: cw, h: head.h };
      const hov = this.live() && inside(hr, this.input.mx, this.input.my);
      if (hov) { this.over = true; this.hot = `${id}:h${ci}`; }
      if (hov && this.input.released) this.sorts.set(id, { col: ci, dir: sort?.col === ci ? (sort.dir === 1 ? -1 : 1) : 1 });
      const mark = sort?.col === ci ? (sort.dir === 1 ? " v" : " ^") : "";
      this.textIn(c.label + mark, x, head.y + 3, cw - 3, hov ? THEME.text : THEME.dim, c.align ?? "left");
      x += cw;
    });
    const pos = order.indexOf(sel);
    const res = this.list(id, { x: r.x, y: r.y + head.h, w: r.w, h: r.h - head.h }, rows.length, rowH, pos, (i, row) => {
      const ri = order[i];
      let cx = row.x + 3;
      cols.forEach((c, ci) => { const cw = c.w * k; this.textIn(rows[ri][ci] ?? "", cx, row.y + Math.round((rowH - CELL_H2) / 2) + 1, cw - 3, o.color?.(ri) ?? THEME.text, c.align ?? "left"); cx += cw; });
    });
    const back = (i: number) => (i >= 0 ? order[i] : -1);
    return { sel: back(res.sel), clicked: back(res.clicked), activated: back(res.activated), order };
  }

  /** A line graph of `series` (oldest first), with an optional budget line. */
  graph(r: Rect, series: readonly number[], o: { min?: number; max?: number; color?: string; label?: string; budget?: number; unit?: string } = {}) {
    this.fill(r, THEME.bg);
    this.stroke(r, THEME.edge);
    const vals = series.length ? series : [0];
    const lo = o.min ?? Math.min(0, ...vals), hi = Math.max(o.max ?? 0, ...vals, o.budget ?? 0, lo + 1e-6);
    const y = (v: number) => r.y + r.h - 2 - ((v - lo) / (hi - lo)) * (r.h - 4);
    for (let g = 1; g < 4; g++) this.fill({ x: r.x + 1, y: Math.round(r.y + (r.h * g) / 4), w: r.w - 2, h: 1 }, THEME.rowAlt);
    if (o.budget !== undefined) for (let gx = r.x + 2; gx < r.x + r.w - 2; gx += 4) this.fill({ x: gx, y: Math.round(y(o.budget)), w: 2, h: 1 }, THEME.bad);
    const n = vals.length, c = o.color ?? THEME.accent2;
    let py = -1;
    for (let i = 0; i < n; i++) {
      const px = Math.round(r.x + 2 + ((r.w - 4) * i) / Math.max(1, n - 1)), vy = Math.round(y(vals[i]));
      if (py >= 0) this.fill({ x: px, y: Math.min(py, vy), w: 1, h: Math.abs(vy - py) + 1 }, c);
      else this.fill({ x: px, y: vy, w: 1, h: 1 }, c);
      py = vy;
    }
    if (o.label) this.text(o.label, r.x + 4, r.y + 3, THEME.dim);
    const last = vals[vals.length - 1];
    this.text(`${last.toFixed(last < 10 ? 2 : 0)}${o.unit ?? ""}`, r.x + r.w - 4, r.y + 3, THEME.text, "right");
  }

  /**
   * A modal box over everything: a title, lines of text and a row of buttons. Returns the index of the button pressed,
   * the last one on Esc (cancel), or -1 while it stays open. While it is drawn nothing outside it reacts.
   */
  modalBox(id: string, title: string, lines: readonly string[], buttons: readonly string[], width = 260): number {
    if (this.modal !== id) { this.modal = id; this.modalFresh = true; this.focus = `${id}:b0`; } else this.modalFresh = false;
    this.modalSeen = true;
    this.fill({ x: 0, y: 0, w: this.w, h: this.h }, THEME.shade);
    const body = lines.flatMap((l) => wrapText2(l, width - 16));
    const h = 26 + body.length * LINE_H2 + 26, r = { x: Math.round((this.w - width) / 2), y: Math.round((this.h - h) / 2), w: width, h };
    this.inModal = true;
    this.panel(r, title);
    body.forEach((l, i) => this.text(l, r.x + 8, r.y + 20 + i * LINE_H2, THEME.text));
    let out = -1;
    const bw = Math.min(90, (width - 16) / buttons.length - 4);
    buttons.forEach((b, i) => {
      const br = { x: Math.round(r.x + r.w - 8 - (buttons.length - i) * (bw + 4) + 4), y: r.y + r.h - 20, w: Math.round(bw), h: 14 };
      if (this.button(`${id}:b${i}`, br, b)) out = i;
    });
    this.inModal = false;
    this.over = true;
    if (!this.modalFresh && this.input.keys.back) out = buttons.length - 1;
    if (out >= 0) { this.modal = null; this.modalSeen = false; this.focus = null; }
    return out;
  }

  private drawTip(text: string) {
    const lines = wrapText2(text, 200), w = Math.max(...lines.map((l) => textWidth2(l))) + 8, h = lines.length * LINE_H2 + 5;
    let x = this.input.mx + 10, y = this.input.my + 12;
    if (!Number.isFinite(x)) return;
    if (x + w > this.w - 2) x = this.w - 2 - w;
    if (y + h > this.h - 2) y = this.input.my - h - 4;
    const r = { x, y, w, h };
    this.fill(r, "#08070a"); this.stroke(r, THEME.hi);
    lines.forEach((l, i) => this.text(l, x + 4, y + 3 + i * LINE_H2, THEME.text));
  }
}

const cmp = (a: string, b: string) => {
  const na = parseFloat(a), nb = parseFloat(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && /^[-\d.]/.test(a) && /^[-\d.]/.test(b)) return na - nb;
  return a.localeCompare(b);
};
