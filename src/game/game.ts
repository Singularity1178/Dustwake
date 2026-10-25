import { buildMap, MapData, MW, MH, TS, T, isSolidT, ItemId, PropDef, LooseItem } from "./map";
import { bakeRegion, propSprite, rubbleSprite, pillarSprite, doorSprite, barsSprite, PROP_BOX, itemIcon, ITEM_NAMES, GLYPHS, glyphPattern } from "./art";
import { makeCanvas, Pen, Sprite, hash2, clamp, lerp, makeSprite } from "./util";
import { drawGolem, Facing, GolemPose } from "./golem";
import { Light, makeLight, computeVis, Lighting } from "./light";
import { Sfx } from "./audio";
import { buildCircle, CircleArt, CR, SOCKET_R } from "./circle";
import { buildSchematic, PLAN_X, PLAN_Y, PLAN_S } from "./schematic";
import { drawText, drawTextS } from "./font";

export const W = 320, H = 180;
type State = "title" | "intro" | "play" | "inv" | "schem" | "tele" | "end";

interface PropInst extends PropDef { open: boolean; taken: boolean; box: [number, number, number, number] | null; light?: Light }
interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; kind: "spark" | "ember" | "dust" | "debris" | "drip" | "splash" | "rune" | "mote" | "glint" | "smoke";
  col: string; emit: boolean; g: number; size: number;
}
interface Inter { kind: string; x: number; y: number; r: number; prop?: PropInst; loose?: LooseItem & { taken?: boolean; light?: Light }; idx?: number }
interface Action { type: string; t: number; dur: number; fired: boolean; cb?: () => void; data?: number }

const RELICS: ItemId[] = ["crown", "goblet", "coin"];

export class Game {
  ctx: CanvasRenderingContext2D;
  scene = makeCanvas(W, H);
  emit = makeCanvas(W, H);
  bg = makeCanvas(MW * TS, MH * TS);
  lighting = new Lighting(W, H);
  sfx = new Sfx();
  circle: CircleArt = buildCircle();
  shaft!: Sprite;

  m!: MapData;
  state: State = "title";
  t = 0;
  stateT = 0;
  playTime = 0;
  props: PropInst[] = [];
  loose: (LooseItem & { taken?: boolean; light?: Light })[] = [];
  lights: Light[] = [];
  glight!: Light;
  inters: Inter[] = [];
  particles: Particle[] = [];
  inv: ItemId[] = [];
  invCursor = 0;
  invMode: "view" | "select" = "view";
  selSocket = -1;
  schemCanvas!: HTMLCanvasElement;
  schemRead = false;
  schemOpenT = 0;
  schemFirstClose = false;
  toast: { icon: Sprite; name: string; t: number } | null = null;
  cam = { x: 0, y: 0 };
  shakeT = 0; shakeMag = 0;
  rumbleT = 50;
  eyeBoost = 0;
  solution: number[] = [];
  rune = { sockets: [-1, -1, -1, -1], core: false, carved: false, active: false, actT: 0, fizzT: 0, wrong: [false, false, false, false] };
  socketLights: (Light | null)[] = [null, null, null, null];
  coreLight: Light | null = null;
  pl = {
    x: 0, y: 0, vx: 0, vy: 0, facing: "down" as Facing, phase: 0, moving: false, steps: 0,
    hasArm: false, eye: 0, core: 0, dormant: 1, sparkT: 2, z: 0, action: null as Action | null, sputter: 0,
  };
  keys = new Set<string>();
  pressed = new Set<string>();
  dripT: number[] = [];
  target: Inter | null = null;
  outImg: ImageData;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.outImg = this.ctx.createImageData(W, H);
    this.shaft = this.buildShaft();
    this.reset();
  }

  // ---------------------------------------------------------------- setup
  reset() {
    this.m = buildMap(1337);
    const m = this.m;
    bakeRegion(this.bg.ctx, m, 0, 0, MW - 1, MH - 1);
    // solution
    const perm = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    this.solution = perm;
    this.schemCanvas = buildSchematic(m, this.solution);
    // props
    this.props = m.props.map((p) => {
      const bx = PROP_BOX[p.kind];
      return { ...p, open: false, taken: false, box: bx ? [p.x - bx[0] / 2, p.y - bx[1], p.x + bx[0] / 2, p.y] : null } as PropInst;
    });
    // pedestals
    const c = m.ritual;
    const sp = this.socketPos();
    sp.forEach((s, i) => this.props.push({ kind: "pedestal", x: s.x, y: s.y + 4, v: 0, id: "ped" + i, open: false, taken: false, box: [s.x - 5, s.y - 1, s.x + 5, s.y + 4] }));
    // lights
    this.lights = m.lights.map((l) => makeLight(l.x, l.y, l.rad, l.col, l.int, l.flick, l.id));
    this.glight = makeLight(m.start.x, m.start.y - 6, 108, [1, 0.78, 0.5], 0, 0.05, "golem");
    for (const L of this.lights) computeVis(L, m.grid);
    this.loose = m.loose.map((l) => ({ ...l }));
    // glowing glyph items get small lights
    for (const p of this.props) {
      if (p.item && p.item.startsWith("glyph") && !p.container) {
        const g = GLYPHS[Number(p.item.slice(5))];
        const col = hexToCol(g.color);
        p.light = makeLight(p.x, p.y - 8, 30, col, 0.55, 0.05);
        computeVis(p.light, m.grid);
        this.lights.push(p.light);
      }
    }
    this.dripT = m.drips.map(() => Math.random() * 4);
    // player
    Object.assign(this.pl, { x: m.start.x, y: m.start.y, vx: 0, vy: 0, facing: "down", phase: 0, moving: false, steps: 0, hasArm: false, eye: 0, core: 0, dormant: 1, sparkT: 1.5, z: 0, action: null, sputter: 0 });
    this.cam.x = this.pl.x - W / 2; this.cam.y = this.pl.y - H / 2 - 10;
    this.inv = [];
    this.invCursor = 0;
    this.schemRead = false;
    this.schemFirstClose = false;
    this.rune = { sockets: [-1, -1, -1, -1], core: false, carved: false, active: false, actT: 0, fizzT: 0, wrong: [false, false, false, false] };
    this.socketLights = [null, null, null, null];
    this.coreLight = null;
    this.particles = [];
    this.toast = null;
    this.playTime = 0;
    this.rumbleT = 45 + Math.random() * 30;
    void c;
    this.buildInters();
  }

  socketPos() {
    const c = this.m.ritual;
    return [
      { x: c.x, y: c.y - SOCKET_R },
      { x: c.x + SOCKET_R, y: c.y },
      { x: c.x, y: c.y + SOCKET_R },
      { x: c.x - SOCKET_R, y: c.y },
    ];
  }

  buildInters() {
    const I: Inter[] = [];
    for (const p of this.props) {
      if (p.kind === "pedestal") continue;
      const bw = PROP_BOX[p.kind]?.[0] ?? 12;
      if (p.container && !p.open) I.push({ kind: "container", x: p.x, y: p.y + 2, r: Math.min(30, 12 + bw / 2), prop: p });
      else if (p.item && !p.container && !p.taken) I.push({ kind: "propItem", x: p.x, y: p.y + 2, r: Math.min(30, 12 + bw / 2), prop: p });
    }
    for (const l of this.loose) if (!l.taken) I.push({ kind: "item", x: l.x, y: l.y, r: 16, loose: l });
    const g = this.m.grid;
    if (g[5 * MW + 51] === T.LOCKED) I.push({ kind: "door", x: 51 * TS - 2, y: 5 * TS + 10, r: 18 });
    if (g[10 * MW + 47] === T.CRACKED) I.push({ kind: "cracked", x: 47 * TS + 8, y: 11 * TS, r: 22 });
    const sp = this.socketPos();
    sp.forEach((s, i) => I.push({ kind: "socket", x: s.x, y: s.y + 6, r: 18, idx: i }));
    const c = this.m.ritual;
    if (!this.rune.core) I.push({ kind: "center", x: c.x, y: c.y, r: 13 });
    if (!this.rune.carved) I.push({ kind: "gap", x: c.x + 38, y: c.y + 38, r: 20 });
    this.inters = I;
  }

  buildShaft(): Sprite {
    return makeSprite(80, 110, 40, 100, 1, (p) => {
      for (let y = 0; y < 110; y++) {
        const t = y / 100;
        const cx = lerp(28, 40, t), hw = lerp(12, 24, t);
        for (let x = 0; x < 80; x++) {
          const d = Math.abs(x - cx) / hw;
          if (y > 100) {
            const e = ((x - 40) / 26) ** 2 + ((y - 102) / 7) ** 2;
            if (e < 1 && (x + y) % 2 === 0) p.g(x, y, 1, 1, "#26324a");
            continue;
          }
          if (d < 1 && (x + y) % 2 === 0 && hash2(x, y, 2) > d * 0.8) p.g(x, y, 1, 1, d < 0.5 ? "#1c2638" : "#121a28");
        }
      }
    });
  }

  // ---------------------------------------------------------------- input
  keyDown(k: string) {
    k = k.toLowerCase();
    if (!this.keys.has(k)) this.pressed.add(k);
    this.keys.add(k);
  }
  keyUp(k: string) { this.keys.delete(k.toLowerCase()); }
  pointer() { this.pressed.add("click"); }
  has(...k: string[]) { return k.some((x) => this.keys.has(x)); }
  hit(...k: string[]) { return k.some((x) => this.pressed.has(x)); }

  // ---------------------------------------------------------------- helpers
  tileAt(px: number, py: number) {
    const tx = Math.floor(px / TS), ty = Math.floor(py / TS);
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return T.WALL;
    return this.m.grid[ty * MW + tx];
  }
  boxFree(x: number, y: number) {
    const x0 = x - 5, x1 = x + 5, y0 = y - 5, y1 = y;
    for (let ty = Math.floor(y0 / TS); ty <= Math.floor((y1 - 0.01) / TS); ty++)
      for (let tx = Math.floor(x0 / TS); tx <= Math.floor((x1 - 0.01) / TS); tx++) {
        if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false;
        if (isSolidT(this.m.grid[ty * MW + tx])) return false;
      }
    for (const p of this.props) {
      const b = p.box;
      if (!b) continue;
      if (x1 > b[0] && x0 < b[2] && y1 > b[1] && y0 < b[3]) return false;
    }
    return true;
  }
  addItem(id: ItemId) {
    this.inv.push(id);
    this.toast = { icon: itemIcon(id), name: ITEM_NAMES[id], t: 0 };
    this.sfx.pickup();
    for (let i = 0; i < 10; i++) this.spawn({ x: this.pl.x, y: this.pl.y - 4, z: 14, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 20, vz: 20 + Math.random() * 20, life: 0.6, kind: "glint", col: "#fff0c0", emit: true, g: 40 });
  }
  removeItem(id: ItemId) {
    const i = this.inv.indexOf(id);
    if (i >= 0) this.inv.splice(i, 1);
  }
  spawn(p: Partial<Particle> & { x: number; y: number }) {
    if (this.particles.length > 900) return;
    this.particles.push({ z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: p.life ?? 1, kind: "dust", col: "#888", emit: false, g: 0, size: 1, ...p } as Particle);
  }
  shake(t: number, m: number) { this.shakeT = Math.max(this.shakeT, t); this.shakeMag = Math.max(this.shakeMag, m); }
  dist2(x: number, y: number) { const dx = x - this.pl.x, dy = y - this.pl.y; return dx * dx + dy * dy; }
  volAt(x: number, y: number) { return clamp(1 - Math.sqrt(this.dist2(x, y)) / 220, 0, 1); }
  refreshLightsNear(tx: number, ty: number) {
    for (const L of this.lights) if (Math.abs(L.x / TS - tx) < 12 && Math.abs(L.y / TS - ty) < 12) computeVis(L, this.m.grid);
    this.glight.vx = -999;
  }
  startAction(type: string, dur: number, cb?: () => void, data?: number) {
    this.pl.action = { type, t: 0, dur, fired: false, cb, data };
    this.pl.vx = 0; this.pl.vy = 0;
  }
  faceTo(x: number, y: number) {
    const dx = x - this.pl.x, dy = y - (this.pl.y - 4);
    this.pl.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  }

  // ---------------------------------------------------------------- update
  update(dt: number) {
    this.t += dt;
    this.stateT += dt;
    switch (this.state) {
      case "title":
        if (this.pressed.size) { this.sfx.init(); this.state = "intro"; this.stateT = 0; }
        if (Math.random() < 0.3) this.spawn({ x: Math.random() * W, y: H + 2, vy: -10 - Math.random() * 12, vx: (Math.random() - 0.5) * 4, life: 6, kind: "ember", col: Math.random() < 0.5 ? "#ff8a3a" : "#c84a10", emit: true });
        this.updateParticles(dt);
        break;
      case "intro": this.updateIntro(dt); this.updateWorld(dt); break;
      case "play": this.playTime += dt; this.updatePlay(dt); this.updateWorld(dt); break;
      case "inv": this.updateInv(); break;
      case "schem":
        this.schemOpenT += dt;
        if (this.schemOpenT > 0.4 && this.hit("e", "escape", "enter", " ", "m", "i", "tab", "click")) {
          this.state = "play";
          if (!this.schemFirstClose) {
            this.schemFirstClose = true;
            this.sfx.insight();
            this.eyeBoost = 1.5;
          }
        }
        break;
      case "tele": this.updateTele(dt); this.updateWorld(dt); break;
      case "end":
        if (this.stateT > 5 && this.hit("r")) { this.reset(); this.state = "intro"; this.stateT = 0; }
        if (Math.random() < 0.2) this.spawn({ x: Math.random() * W, y: H * 0.4 + Math.random() * 60, vy: -3, vx: 4, life: 5, kind: "mote", col: "#ffd8a0", emit: true });
        this.updateParticles(dt);
        break;
    }
    this.pressed.clear();
  }

  updateIntro(dt: number) {
    const t = this.stateT, pl = this.pl;
    if (t > 0.8 && t - dt <= 0.8) { this.sparkBurst(8); this.sfx.spark(); }
    if (t > 1.2 && t - dt <= 1.2) this.sfx.boot();
    if (t > 1.6 && t - dt <= 1.6) { this.sparkBurst(6); this.sfx.spark(); }
    pl.core = t < 1.2 ? 0 : t < 2.6 ? (Math.random() < (t - 1.2) / 1.4 ? (t - 1.2) / 1.4 : 0.1) : 1;
    pl.eye = t < 2.9 ? 0 : t < 3.5 ? (Math.sin(t * 40) > 0 ? 1 : 0.2) : 1;
    pl.dormant = t < 3.6 ? 1 : clamp(1 - (t - 3.6) / 1.4, 0, 1);
    if (t > 4.2 && t - dt <= 4.2) this.sfx.thud();
    if (t > 5.2) { this.state = "play"; this.stateT = 0; }
  }

  sparkBurst(n: number) {
    const pl = this.pl;
    const right = pl.facing === "down" || pl.facing === "left";
    const sx = pl.x + (pl.facing === "up" ? -8 : pl.facing === "down" ? 8 : right ? -1 : 1), sy = pl.y - 9 + Math.round(pl.dormant * 4);
    for (let i = 0; i < n; i++)
      this.spawn({ x: sx + (right ? 0 : 0), y: sy + 9, z: 9, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.3) * 20, vz: 10 + Math.random() * 30, life: 0.3 + Math.random() * 0.4, kind: "spark", col: Math.random() < 0.5 ? "#fff2a0" : "#ffb040", emit: true, g: 120 });
  }

  updatePlay(dt: number) {
    const pl = this.pl;
    // overlays
    if (!pl.action) {
      if (this.hit("i", "tab")) { this.openInv("view"); return; }
      if (this.hit("m") && this.inv.includes("schematic")) { this.openSchem(); return; }
    }
    // action
    if (pl.action) {
      const a = pl.action;
      a.t += dt;
      this.actionTick(a, dt);
      if (a.t >= a.dur) { pl.action = null; }
    }
    // movement
    let ix = 0, iy = 0;
    if (!pl.action) {
      if (this.has("arrowleft", "a")) ix -= 1;
      if (this.has("arrowright", "d")) ix += 1;
      if (this.has("arrowup", "w")) iy -= 1;
      if (this.has("arrowdown", "s")) iy += 1;
    }
    const mag = Math.hypot(ix, iy);
    if (mag > 0) { ix /= mag; iy /= mag; pl.facing = Math.abs(ix) > Math.abs(iy) ? (ix > 0 ? "right" : "left") : iy > 0 ? "down" : "up"; }
    const base = pl.hasArm ? 30 : 24;
    const limp = 0.55 + 0.6 * Math.abs(Math.sin(pl.phase));
    const tx = ix * base * limp, ty = iy * base * limp;
    const acc = mag > 0 ? 7 : 10;
    pl.vx += (tx - pl.vx) * Math.min(1, acc * dt);
    pl.vy += (ty - pl.vy) * Math.min(1, acc * dt);
    const sp = Math.hypot(pl.vx, pl.vy);
    pl.moving = sp > 4;
    // integrate with sliding + corner nudge
    const nx = pl.x + pl.vx * dt;
    if (this.boxFree(nx, pl.y)) pl.x = nx;
    else {
      if (Math.abs(iy) < 0.3 && ix !== 0) for (const d of [2, 4, 6, 8]) {
        if (this.boxFree(nx, pl.y - d)) { pl.y -= Math.min(d, 20 * dt); break; }
        if (this.boxFree(nx, pl.y + d)) { pl.y += Math.min(d, 20 * dt); break; }
      }
      pl.vx *= 0.3;
    }
    const ny = pl.y + pl.vy * dt;
    if (this.boxFree(pl.x, ny)) pl.y = ny;
    else {
      if (Math.abs(ix) < 0.3 && iy !== 0) for (const d of [2, 4, 6, 8]) {
        if (this.boxFree(pl.x - d, ny)) { pl.x -= Math.min(d, 20 * dt); break; }
        if (this.boxFree(pl.x + d, ny)) { pl.x += Math.min(d, 20 * dt); break; }
      }
      pl.vy *= 0.3;
    }
    // walk cycle & steps
    if (pl.moving) {
      const before = Math.sin(pl.phase);
      pl.phase += dt * (3.2 + sp * 0.09);
      const after = Math.sin(pl.phase);
      if ((before < 0) !== (after < 0)) {
        pl.steps++;
        const heavy = pl.steps % 2 === 0;
        this.sfx.step(heavy);
        for (let i = 0; i < (heavy ? 4 : 2); i++)
          this.spawn({ x: pl.x + (Math.random() - 0.5) * 10, y: pl.y, z: 1, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 6, vz: 8, life: 0.6, kind: "dust", col: "#8a8478", g: 20 });
        if (!heavy && !pl.hasArm) { this.sfx.scrape(); }
      }
    } else pl.phase = pl.phase % Math.PI < 0.2 ? pl.phase : pl.phase + dt * 2;
    // golem damage sparks
    pl.sparkT -= dt;
    if (pl.sparkT <= 0) {
      pl.sparkT = 1.5 + Math.random() * 4;
      if (!pl.hasArm) { this.sparkBurst(3 + ((Math.random() * 4) | 0)); if (Math.random() < 0.6) this.sfx.spark(); }
      if (Math.random() < 0.12) pl.sputter = 0.25;
    }
    pl.sputter = Math.max(0, pl.sputter - dt);
    pl.core = pl.sputter > 0 ? (Math.random() < 0.5 ? 0.3 : 0.8) : 1;
    pl.eye = pl.sputter > 0 ? 0.3 : 1;
    pl.dormant = 0;
    this.eyeBoost = Math.max(0, this.eyeBoost - dt);
    // interaction target
    this.target = pl.action ? null : this.findTarget();
    if (!pl.action && this.target && this.hit("e", " ", "enter")) this.interact(this.target);
    // teleport
    const c = this.m.ritual;
    if (this.rune.active && this.rune.actT > 3 && this.dist2(c.x, c.y + 2) < 81 && !pl.action) {
      this.state = "tele"; this.stateT = 0;
      this.sfx.teleport();
      pl.facing = "down";
    }
    // rumble events
    this.rumbleT -= dt;
    if (this.rumbleT <= 0) {
      this.rumbleT = 50 + Math.random() * 50;
      this.sfx.rumble();
      this.shake(2.2, 1.5);
      for (let i = 0; i < 30; i++) this.spawn({ x: this.cam.x + Math.random() * W, y: this.cam.y + Math.random() * H, z: 60 + Math.random() * 40, vz: -10, life: 4, kind: "debris", col: Math.random() < 0.5 ? "#6a6372" : "#4b4552", g: 60 });
    }
  }

  findTarget(): Inter | null {
    const pl = this.pl;
    const fx = pl.facing === "left" ? -1 : pl.facing === "right" ? 1 : 0;
    const fy = pl.facing === "up" ? -1 : pl.facing === "down" ? 1 : 0;
    const px = pl.x + fx * 6, py = pl.y - 3 + fy * 6;
    let best: Inter | null = null, bd = 1;
    for (const it of this.inters) {
      const d = Math.hypot(it.x - px, it.y - py) / it.r;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  interact(it: Inter) {
    const pl = this.pl;
    this.faceTo(it.x, it.y - 4);
    switch (it.kind) {
      case "item":
        this.startAction("reach", 0.45, () => {
          const l = it.loose!;
          l.taken = true;
          if (l.light) l.light.on = false;
          this.addItem(l.item);
          this.buildInters();
        });
        break;
      case "propItem":
        this.startAction("reach", 0.45, () => {
          const p = it.prop!;
          p.taken = true;
          if (p.light) p.light.on = false;
          const id = p.item!;
          if (id === "arm") {
            this.buildInters();
            this.toast = { icon: itemIcon("arm"), name: ITEM_NAMES.arm, t: 0 };
            this.sfx.pickup();
            this.startAction("attach", 1.8);
            return;
          }
          this.addItem(id);
          this.buildInters();
          if (id === "schematic") setTimeout(() => { if (this.state === "play") this.openSchem(); }, 500);
        });
        break;
      case "container":
        this.startAction("reach", 0.6, () => {
          const p = it.prop!;
          p.open = true;
          this.sfx.open();
          for (let i = 0; i < 8; i++) this.spawn({ x: p.x + (Math.random() - 0.5) * 12, y: p.y, z: 6, vx: (Math.random() - 0.5) * 20, vz: 10, life: 1, kind: "dust", col: "#7a7468", g: 10 });
          if (p.item) { const id = p.item; p.item = undefined; setTimeout(() => this.addItem(id), 250); }
          this.buildInters();
        });
        break;
      case "door":
        if (this.inv.includes("key")) {
          this.startAction("reach", 0.9, () => {
            this.removeItem("key");
            this.m.grid[5 * MW + 51] = T.FLOOR;
            this.m.decals.push({ kind: "door_open", x: 51 * TS + 11, y: 5 * TS - 12, v: 0 });
            bakeRegion(this.bg.ctx, this.m, 49, 3, 53, 7);
            this.refreshLightsNear(51, 5);
            this.sfx.unlock();
            this.buildInters();
          });
        } else this.startAction("reach", 0.5, () => { this.sfx.clank(); this.shake(0.1, 1); });
        break;
      case "cracked":
        if (pl.hasArm) this.startAction("smash", 1.2);
        else this.startAction("push", 0.7);
        break;
      case "socket": {
        const i = it.idx!;
        if (this.rune.sockets[i] >= 0) {
          this.startAction("reach", 0.45, () => {
            const g = this.rune.sockets[i];
            this.rune.sockets[i] = -1;
            if (this.socketLights[i]) this.socketLights[i]!.on = false;
            this.rune.wrong[i] = false;
            this.addItem(("glyph" + g) as ItemId);
            if (this.rune.active) this.deactivate();
          });
        } else if (this.inv.some((x) => x.startsWith("glyph"))) {
          this.openInv("select", i);
        } else this.startAction("reach", 0.4, () => this.sfx.scrape());
        break;
      }
      case "center":
        if (this.inv.includes("core")) {
          this.startAction("reach", 0.6, () => {
            this.removeItem("core");
            this.rune.core = true;
            const c = this.m.ritual;
            this.coreLight = makeLight(c.x, c.y - 6, 54, [0.4, 0.85, 1], 0.8, 0.08);
            computeVis(this.coreLight, this.m.grid);
            this.lights.push(this.coreLight);
            this.sfx.place();
            this.sfx.tone(660, 1, "sine", 0.06);
            this.buildInters();
            this.checkRune();
          });
        } else this.startAction("reach", 0.4, () => this.sfx.scrape());
        break;
      case "gap":
        if (this.inv.includes("chisel") && this.schemRead) this.startAction("carve", 3.2);
        else this.startAction("reach", 0.5, () => {
          this.sfx.scrape();
          for (let i = 0; i < 4; i++) this.spawn({ x: it.x, y: it.y, z: 2, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.8, kind: "dust", col: "#9a96a0", g: 20 });
        });
        break;
    }
  }

  actionTick(a: Action, dt: number) {
    const pl = this.pl;
    if (a.type === "reach" || a.type === "push") {
      if (!a.fired && a.t >= a.dur * 0.55) {
        a.fired = true;
        if (a.type === "push") {
          this.sfx.thud();
          this.shake(0.2, 1);
          for (let i = 0; i < 6; i++) this.spawn({ x: 47 * TS + 8 + (Math.random() - 0.5) * 16, y: 11 * TS + 2, z: 20 + Math.random() * 10, vx: (Math.random() - 0.5) * 10, life: 1.5, kind: "debris", col: "#6a6372", g: 80 });
          this.crackFlash = 1;
        }
        a.cb?.();
      }
    } else if (a.type === "attach") {
      if (Math.random() < 0.5) this.sparkBurst(2);
      if (!a.fired && a.t > 0.9) {
        a.fired = true;
        pl.hasArm = true;
        this.sfx.clank();
        this.shake(0.15, 1);
        this.sparkBurst(14);
      }
    } else if (a.type === "smash") {
      if (!a.fired && a.t >= 0.62) {
        a.fired = true;
        this.breakCracked();
      }
    } else if (a.type === "carve") {
      const c = this.m.ritual;
      const k = Math.floor(a.t / 0.22);
      const kp = Math.floor((a.t - dt) / 0.22);
      if (k !== kp && a.t < a.dur - 0.3) {
        this.sfx.clink();
        const ang = 0.26 + Math.random() * 1.05, r = 44 + Math.random() * 13;
        for (let i = 0; i < 4; i++) this.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, vz: 20 + Math.random() * 20, life: 0.4, kind: "spark", col: "#d0c0ff", emit: true, g: 120 });
        this.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vz: 6, life: 1, kind: "dust", col: "#8a8690", g: 4 });
      }
      if (!a.fired && a.t >= a.dur - 0.2) {
        a.fired = true;
        this.rune.carved = true;
        this.sfx.tone(392, 1.2, "sine", 0.07);
        this.buildInters();
        this.checkRune();
      }
    }
  }

  crackFlash = 0;

  breakCracked() {
    const g = this.m.grid;
    g[10 * MW + 47] = T.FLOOR;
    g[11 * MW + 47] = T.FLOOR;
    for (let i = 0; i < 26; i++) this.m.decals.push({ kind: "debris", x: 45 * TS + Math.random() * 64, y: 9.6 * TS + Math.random() * 40, v: (Math.random() * 4) | 0 });
    bakeRegion(this.bg.ctx, this.m, 44, 8, 50, 13);
    this.refreshLightsNear(47, 10);
    this.sfx.smash();
    this.shake(0.7, 3.5);
    const cx = 47 * TS + 8, cy = 11 * TS;
    for (let i = 0; i < 40; i++)
      this.spawn({ x: cx + (Math.random() - 0.5) * 16, y: cy + (Math.random() - 0.5) * 20, z: 4 + Math.random() * 18, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 60, vz: 20 + Math.random() * 60, life: 1.6 + Math.random(), kind: "debris", col: ["#8a8392", "#6a6372", "#4b4552"][(Math.random() * 3) | 0], g: 160, size: Math.random() < 0.4 ? 2 : 1 });
    for (let i = 0; i < 40; i++)
      this.spawn({ x: cx + (Math.random() - 0.5) * 24, y: cy + (Math.random() - 0.5) * 24, z: Math.random() * 20, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, vz: Math.random() * 10, life: 2 + Math.random() * 2, kind: "smoke", col: "#7a7470", g: -2, size: 2 });
    this.buildInters();
  }

  checkRune() {
    const r = this.rune;
    if (r.sockets.some((s) => s < 0) || !r.core || !r.carved) return;
    const ok = r.sockets.every((s, i) => s === this.solution[i]);
    if (ok) {
      r.active = true; r.actT = 0;
      this.sfx.activate();
      this.shake(1.5, 1.5);
      r.wrong = [false, false, false, false];
    } else {
      r.fizzT = 1.2;
      r.wrong = r.sockets.map((s, i) => s !== this.solution[i]);
      this.sfx.fizzle();
      this.shake(0.4, 2);
      const c = this.m.ritual;
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, rr = 44 + Math.random() * 13;
        this.spawn({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr, z: 1, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 40, vz: 30 + Math.random() * 30, life: 0.5, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
      }
    }
  }
  deactivate() {
    this.rune.active = false;
    this.rune.actT = 0;
    this.sfx.setHum(0);
  }

  placeGlyph(sock: number, gi: number) {
    this.removeItem(("glyph" + gi) as ItemId);
    this.rune.sockets[sock] = gi;
    this.rune.wrong[sock] = false;
    const s = this.socketPos()[sock];
    const L = makeLight(s.x, s.y - 4, 30, hexToCol(GLYPHS[gi].color), 0.5, 0.05);
    computeVis(L, this.m.grid);
    if (this.socketLights[sock]) this.lights.splice(this.lights.indexOf(this.socketLights[sock]!), 1);
    this.socketLights[sock] = L;
    this.lights.push(L);
    this.sfx.place();
    this.faceTo(s.x, s.y);
    this.startAction("reach", 0.45, () => this.checkRune());
  }

  updateTele(_dt: number) {
    const t = this.stateT, pl = this.pl;
    pl.z = Math.min(t, 3) * 4 + Math.sin(t * 3) * 1;
    pl.eye = 1; pl.core = 1;
    this.shake(0.1, Math.min(4, t * 1.2));
    const c = this.m.ritual;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 50;
      this.spawn({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: 2, vx: -Math.cos(a) * r * 0.8, vy: -Math.sin(a) * r * 0.8, vz: 10 + Math.random() * 20, life: 1.2, kind: "rune", col: Math.random() < 0.5 ? "#c0a0ff" : "#80e0ff", emit: true, g: -5 });
    }
    this.glight.int = 0.9 + t * 0.4;
    if (t > 4.6) { this.state = "end"; this.stateT = 0; this.particles = []; this.sfx.setHum(0); }
  }

  updateWorld(dt: number) {
    const pl = this.pl;
    // camera
    const tx = clamp(pl.x - W / 2, 0, MW * TS - W), ty = clamp(pl.y - 12 - H / 2, 0, MH * TS - H);
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 3.5);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 3.5);
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT <= 0) this.shakeMag = 0;
    this.crackFlash = Math.max(0, this.crackFlash - dt);
    // golem light
    const gl = this.glight;
    gl.x = pl.x; gl.y = pl.y - 6;
    if (Math.abs(gl.x - gl.vx) > 2 || Math.abs(gl.y - gl.vy) > 2) computeVis(gl, this.m.grid);
    const base = this.state === "tele" ? gl.int : 1.0;
    gl.cur = base * pl.core * (0.95 + 0.05 * Math.sin(this.t * 13) * Math.sin(this.t * 3.1)) + this.eyeBoost * 0.3;
    // light flicker
    for (const L of this.lights) {
      const n = Math.sin(this.t * 9 + L.seed) * 0.5 + Math.sin(this.t * 23.7 + L.seed * 2) * 0.3 + Math.sin(this.t * 3.3 + L.seed) * 0.2;
      L.cur = L.int * (1 - L.flick * (0.5 + 0.5 * n));
    }
    // rune
    const r = this.rune;
    const cl = this.lights.find((l) => l.id === "circle");
    if (r.active) {
      r.actT += dt;
      this.sfx.setHum(Math.min(1, r.actT / 2));
      if (cl) {
        const target = 120;
        if (cl.rad < target) { cl.rad = Math.min(target, cl.rad + dt * 30); if (Math.abs(cl.rad - cl.vx) > 0) computeVis(cl, this.m.grid); }
        cl.int = 0.6 + Math.min(1, r.actT / 3) * 0.6;
        cl.cur = cl.int * (0.85 + 0.15 * Math.sin(this.t * 3));
      }
      const c = this.m.ritual;
      if (Math.random() < dt * 30) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: c.x + p.x, y: c.y + p.y, z: 0, vz: 8 + Math.random() * 12, life: 1.5, kind: "rune", col: Math.random() < 0.6 ? "#a070ff" : "#70d0ff", emit: true, g: -2 });
      }
    } else if (cl) {
      cl.cur = cl.int * (0.8 + 0.2 * Math.sin(this.t * 1.3)) + (r.fizzT > 0 ? Math.random() * 0.6 : 0);
    }
    r.fizzT = Math.max(0, r.fizzT - dt);
    // drips
    this.m.drips.forEach((d, i) => {
      this.dripT[i] -= dt;
      if (this.dripT[i] <= 0) {
        this.dripT[i] = 1.5 + Math.random() * 4;
        if (Math.abs(d.x - this.cam.x - W / 2) < 260 && Math.abs(d.y - this.cam.y - H / 2) < 180)
          this.spawn({ x: d.x, y: d.y, z: 70, vz: -20, life: 3, kind: "drip", col: "#6a8aa8", g: 140 });
      }
    });
    // torch embers
    for (const p of this.props) {
      if (!p.lit) continue;
      if (Math.abs(p.x - this.cam.x - W / 2) > 200 || Math.abs(p.y - this.cam.y - H / 2) > 140) continue;
      if (Math.random() < dt * (p.kind === "brazier" ? 4 : 1.5))
        this.spawn({ x: p.x + (Math.random() - 0.5) * 4, y: p.y + (p.kind === "torch" ? 1 : 0), z: p.kind === "torch" ? 14 : 14, vx: (Math.random() - 0.5) * 6, vz: 10 + Math.random() * 10, life: 1 + Math.random(), kind: "ember", col: Math.random() < 0.5 ? "#ffb040" : "#ff6a1a", emit: true, g: -4 });
    }
    // ambient dust motes
    if (Math.random() < dt * 8)
      this.spawn({ x: this.cam.x + Math.random() * W, y: this.cam.y + Math.random() * H, z: 4 + Math.random() * 30, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 5, kind: "mote", col: "#b8b0a0", emit: false, g: 0 });
    // moonbeam motes
    const moon = this.lights.find((l) => l.id === "moon");
    if (moon && Math.random() < dt * 5)
      this.spawn({ x: moon.x - 14 + Math.random() * 30, y: moon.y + 2, z: 10 + Math.random() * 70, vx: (Math.random() - 0.5) * 2, vz: -3 - Math.random() * 3, life: 6, kind: "mote", col: "#a8c0ff", emit: true, g: 0 });
    // item glints
    if (Math.random() < dt * 2) {
      const cands: [number, number][] = [];
      for (const it of this.inters) if (it.kind === "item" || it.kind === "propItem" || (it.kind === "container" && it.prop?.item)) cands.push([it.x, it.y - (it.prop?.itemZ ?? 6) - 2]);
      const near = cands.filter(([x, y]) => Math.abs(x - this.cam.x - W / 2) < 170 && Math.abs(y - this.cam.y - H / 2) < 100);
      if (near.length) {
        const [x, y] = near[(Math.random() * near.length) | 0];
        this.spawn({ x: x + (Math.random() - 0.5) * 8, y: y + 2, z: 2 + Math.random() * 4, life: 0.45, kind: "glint", col: "#fff4d0", emit: true });
      }
    }
    // toast
    if (this.toast) { this.toast.t += dt; if (this.toast.t > 3) this.toast = null; }
    this.updateParticles(dt);
  }

  updateParticles(dt: number) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt / p.max;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vz -= p.g * dt;
      p.z += p.vz * dt;
      if (p.kind === "debris" || p.kind === "spark" || p.kind === "dust") {
        if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.35; p.vx *= 0.6; p.vy *= 0.6; }
      }
      if (p.kind === "drip" && p.z <= 0) {
        for (let k = 0; k < 5; k++) this.spawn({ x: p.x, y: p.y, z: 0, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 8, vz: 12 + Math.random() * 8, life: 0.35, kind: "splash", col: "#7a9ab8", g: 80 });
        this.sfx.drip(this.volAt(p.x, p.y));
        p.life = 0;
      }
      if (p.kind === "mote") { p.vx += (Math.random() - 0.5) * dt * 4; p.vz += (Math.random() - 0.5) * dt * 4; }
      if (p.kind === "smoke") { p.vx *= 0.97; p.vy *= 0.97; }
      if (p.life <= 0) ps.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- inventory
  openInv(mode: "view" | "select", sock = -1) {
    this.state = "inv";
    this.invMode = mode;
    this.selSocket = sock;
    if (mode === "select") {
      const i = this.inv.findIndex((x) => x.startsWith("glyph"));
      this.invCursor = Math.max(0, i);
    }
    this.invCursor = clamp(this.invCursor, 0, 11);
    this.sfx.tone(300, 0.08, "triangle", 0.05);
  }
  openSchem() {
    this.state = "schem";
    this.schemOpenT = 0;
    this.schemRead = true;
    this.sfx.noise(0.4, 0.12, "bandpass", 2500, 1, 0, 800);
  }
  updateInv() {
    if (this.hit("escape", "i", "tab")) { this.state = "play"; return; }
    const c = this.invCursor;
    if (this.hit("arrowleft", "a")) this.invCursor = (c + 11) % 12;
    if (this.hit("arrowright", "d")) this.invCursor = (c + 1) % 12;
    if (this.hit("arrowup", "w")) this.invCursor = (c + 8) % 12;
    if (this.hit("arrowdown", "s")) this.invCursor = (c + 4) % 12;
    if (this.invCursor !== c) this.sfx.tone(500, 0.04, "square", 0.02);
    if (this.hit("e", "enter", " ")) {
      const id = this.inv[this.invCursor];
      if (!id) return;
      if (this.invMode === "select") {
        if (id.startsWith("glyph")) {
          this.state = "play";
          this.placeGlyph(this.selSocket, Number(id.slice(5)));
        } else this.sfx.thud();
      } else if (id === "schematic") this.openSchem();
      else this.sfx.tone(180, 0.1, "square", 0.04);
    }
  }

  // ---------------------------------------------------------------- render
  render() {
    const ctx = this.ctx;
    if (this.state === "title") return this.renderTitle();
    if (this.state === "end") return this.renderEnd();
    this.renderWorld();
    // UI
    this.renderHud();
    if (this.state === "inv") this.renderInv();
    if (this.state === "schem") this.renderSchem();
    if (this.state === "intro" && this.stateT < 1.5) {
      ctx.fillStyle = `rgba(0,0,0,${1 - this.stateT / 1.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.state === "tele" && this.stateT > 3) {
      const a = clamp((this.stateT - 3) / 1.4, 0, 1);
      ctx.fillStyle = `rgba(235,240,255,${a})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  renderWorld() {
    const sc = this.scene.ctx, ec = this.emit.ctx;
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { sx = (Math.random() - 0.5) * this.shakeMag * 2; sy = (Math.random() - 0.5) * this.shakeMag * 2; }
    const camX = Math.round(this.cam.x + sx), camY = Math.round(this.cam.y + sy);
    sc.fillStyle = "#000"; sc.fillRect(0, 0, W, H);
    ec.fillStyle = "#000"; ec.fillRect(0, 0, W, H);
    sc.drawImage(this.bg.c, camX, camY, W, H, 0, 0, W, H);
    const spr = (s: Sprite, x: number, y: number) => {
      const dx = Math.round(x - s.ax - camX), dy = Math.round(y - s.ay - camY);
      if (dx > W || dy > H || dx + s.w < 0 || dy + s.h < 0) return;
      sc.drawImage(s.a, dx, dy);
      ec.drawImage(s.e, dx, dy);
    };
    // ---- rune circle (floor layer)
    const c = this.m.ritual, r = this.rune;
    const ccx = c.x - CR - camX, ccy = c.y - CR - camY;
    if (ccx > -140 && ccx < W + 10 && ccy > -140 && ccy < H + 10) {
      sc.drawImage(this.circle.base, ccx, ccy);
      sc.drawImage(r.carved ? this.circle.gapCarved : this.circle.chalk, ccx, ccy);
      let lvl = r.active ? 0.55 + 0.35 * Math.sin(this.t * 3) + Math.min(0.3, r.actT * 0.1) : 0.16 + 0.06 * Math.sin(this.t * 1.3);
      if (r.fizzT > 0) lvl = Math.random() * 0.8;
      ec.globalAlpha = clamp(lvl, 0, 1);
      ec.drawImage(this.circle.glow, ccx, ccy);
      if (r.carved) ec.drawImage(this.circle.glowGap, ccx, ccy);
      if (!r.carved && this.schemRead) { ec.globalAlpha = 0.45 + 0.3 * Math.sin(this.t * 4); ec.drawImage(this.circle.ghost, ccx, ccy); }
      if (r.active) {
        ec.globalCompositeOperation = "lighter";
        ec.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 5);
        ec.drawImage(this.circle.glow, ccx, ccy);
        ec.drawImage(this.circle.glowGap, ccx, ccy);
        ec.globalCompositeOperation = "source-over";
      }
      ec.globalAlpha = 1;
    }
    // ---- sortables
    type D = { y: number; f: () => void };
    const list: D[] = [];
    const vx0 = camX - 48, vx1 = camX + W + 48, vy0 = camY - 16, vy1 = camY + H + 60;
    for (const p of this.props) {
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      if (p.kind === "pedestal") {
        const i = Number(p.id!.slice(3));
        list.push({ y: p.y, f: () => this.drawPedestal(p, i, spr, camX, camY) });
        continue;
      }
      const alt = p.kind === "torch" || p.kind === "brazier" ? !!p.lit : p.kind === "maptable" || p.kind === "limbrack" ? p.taken : p.open;
      const s = propSprite(p.kind, p.v, alt);
      if (!s) continue;
      const wallMounted = p.kind === "torch" || p.kind === "banner" || p.kind === "chains";
      list.push({
        y: wallMounted ? p.y - 0.5 : p.y,
        f: () => {
          spr(s, p.x, p.y);
          if (p.lit) this.drawFlame(p, camX, camY);
          if (p.item && !p.container && !p.taken && p.item !== "schematic") {
            const ic = itemIcon(p.item);
            const bob = p.item.startsWith("glyph") ? Math.round(Math.sin(this.t * 2) * 0.6) : 0;
            spr(ic, p.x + (p.kind === "workbench" ? -6 : 0), p.y - (p.itemZ ?? 8) + bob);
          }
        },
      });
    }
    for (const l of this.loose) {
      if (l.taken || l.x < vx0 || l.x > vx1 || l.y < vy0 || l.y > vy1) continue;
      list.push({ y: l.y, f: () => spr(itemIcon(l.item), l.x, l.y + 2) });
    }
    const tx0 = Math.max(0, Math.floor(camX / TS) - 1), tx1 = Math.min(MW - 1, Math.floor((camX + W) / TS) + 1);
    const ty0 = Math.max(0, Math.floor(camY / TS) - 1), ty1 = Math.min(MH - 1, Math.floor((camY + H) / TS) + 3);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = this.m.grid[ty * MW + tx];
        const x = tx * TS + 8, y = ty * TS + 16;
        if (t === T.RUBBLE) { const s = rubbleSprite(Math.floor(hash2(tx, ty, 5) * 3), false); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.CRACKED) {
          const s = rubbleSprite(0, true);
          list.push({ y, f: () => { spr(s, x, y); if (this.crackFlash > 0) { ec.globalAlpha = this.crackFlash; ec.drawImage(s.e, Math.round(x - s.ax - camX), Math.round(y - s.ay - camY)); ec.globalAlpha = 1; } } });
        }
        else if (t === T.PILLAR) { const s = pillarSprite(this.m.tvar[ty * MW + tx] === 1); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.LOCKED) { const s = doorSprite(); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.BARS) { const s = barsSprite(); list.push({ y, f: () => spr(s, x, y) }); }
      }
    // player
    const pl = this.pl;
    list.push({ y: pl.y, f: () => this.drawPlayer(camX, camY) });
    // world particles
    for (const p of this.particles) {
      if (p.kind === "debris" || p.kind === "dust" || p.kind === "smoke" || p.kind === "splash") {
        list.push({ y: p.y, f: () => { sc.fillStyle = p.col; const s = p.size; sc.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), s, s); if (p.emit === false) { ec.fillStyle = "#000"; ec.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), s, s); } } });
      }
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    // moonbeam
    const moon = this.lights.find((l) => l.id === "moon");
    if (moon) { const s = this.shaft; ec.globalCompositeOperation = "lighter"; ec.drawImage(s.e, Math.round(moon.x - s.ax - camX), Math.round(moon.y + 2 - s.ay - camY)); ec.globalCompositeOperation = "source-over"; }
    // floating particles
    for (const p of this.particles) {
      if (p.kind === "debris" || p.kind === "dust" || p.kind === "smoke" || p.kind === "splash") continue;
      const x = Math.round(p.x - camX), y = Math.round(p.y - p.z - camY);
      if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
      if (p.kind === "glint") {
        const a = Math.sin(clamp(p.life, 0, 1) * Math.PI);
        ec.globalCompositeOperation = "lighter";
        ec.fillStyle = `rgba(255,240,200,${a})`;
        ec.fillRect(x, y, 1, 1);
        if (a > 0.5) { ec.fillStyle = `rgba(255,240,200,${a * 0.5})`; ec.fillRect(x - 1, y, 3, 1); ec.fillRect(x, y - 1, 1, 3); }
        ec.globalCompositeOperation = "source-over";
        continue;
      }
      if (p.emit) {
        ec.globalCompositeOperation = "lighter";
        ec.globalAlpha = clamp(p.life * 1.5, 0, 1);
        ec.fillStyle = p.col; ec.fillRect(x, y, p.size, p.size);
        ec.globalAlpha = 1;
        ec.globalCompositeOperation = "source-over";
      } else if (p.kind === "mote") {
        sc.fillStyle = p.col; sc.fillRect(x, y, 1, 1);
      } else { sc.fillStyle = p.col; sc.fillRect(x, y, p.size, p.size); }
    }
    // ---- lighting
    const sImg = sc.getImageData(0, 0, W, H);
    const eImg = ec.getImageData(0, 0, W, H);
    const active: Light[] = [this.glight];
    for (const L of this.lights) if (L.on) active.push(L);
    this.lighting.accumulate(active, camX, camY);
    this.lighting.compose(sImg.data, eImg.data, this.outImg.data, [0.05, 0.045, 0.065]);
    this.ctx.putImageData(this.outImg, 0, 0);
  }

  drawFlame(p: PropInst, camX: number, camY: number) {
    const ec = this.emit.ctx;
    const big = p.kind === "brazier";
    const bx = Math.round(p.x - camX), by = Math.round(p.y - camY - (big ? 15 : 15));
    const t = this.t * 12 + p.x;
    const cols = ["#ff5a10", "#ff9a30", "#ffd060", "#fff0b0"];
    const w = big ? 8 : 3;
    for (let i = 0; i < w; i++) {
      const hgt = Math.max(1, Math.round((big ? 7 : 4) * (1 - Math.abs(i - (w - 1) / 2) / w) + Math.sin(t + i * 1.7) * 1.5 + Math.sin(t * 1.7 + i) * 0.8));
      for (let j = 0; j < hgt; j++) {
        const k = Math.min(3, Math.floor((j / hgt) * 4));
        ec.fillStyle = cols[3 - k];
        if (j === hgt - 1) ec.fillStyle = cols[0];
        ec.fillRect(bx - Math.floor(w / 2) + i + (big ? 0 : 0), by - j + (big ? 2 : 0), 1, 1);
      }
    }
  }

  drawPedestal(p: PropInst, i: number, spr: (s: Sprite, x: number, y: number) => void, camX: number, camY: number) {
    const s = propSprite("pedestal", 0, false)!;
    spr(s, p.x, p.y);
    const g = this.rune.sockets[i];
    const ec = this.emit.ctx;
    const topY = p.y - 15;
    if (g >= 0) {
      spr(itemIcon(("glyph" + g) as ItemId), p.x, topY + 4);
      if (this.rune.active) {
        const pen = new Pen(ec, true);
        glyphPattern(pen, g, Math.round(p.x - camX) - 4, Math.round(topY - camY) - 7, GLYPHS[g].color, true);
      }
      if (this.rune.wrong[i] && this.rune.fizzT > 0 && Math.sin(this.t * 30) > 0) {
        ec.fillStyle = "#ff2040";
        ec.globalAlpha = 0.6;
        ec.fillRect(Math.round(p.x - camX) - 6, Math.round(topY - camY) - 8, 12, 12);
        ec.globalAlpha = 1;
      }
    }
    if (this.schemRead && g !== this.solution[i] && !this.rune.active) {
      const pen = new Pen(ec, true);
      ec.globalAlpha = 0.35 + 0.2 * Math.sin(this.t * 3 + i);
      const bob = Math.round(Math.sin(this.t * 2 + i) * 1.5);
      glyphPattern(pen, this.solution[i], Math.round(p.x - camX) - 3, Math.round(topY - camY) - 16 + bob - (g >= 0 ? 4 : 0), GLYPHS[this.solution[i]].color, true);
      ec.globalAlpha = 1;
    }
    if (i === 0 && this.rune.core) {
      // core floating above center
      const c = this.m.ritual;
      const bob = Math.round(Math.sin(this.t * 2) * 1.5) + (this.rune.active ? -3 : 0);
      spr(itemIcon("core"), c.x, c.y - 4 + bob);
    }
  }

  drawPlayer(camX: number, camY: number) {
    const pl = this.pl, sc = this.scene.ctx;
    // shadow
    sc.fillStyle = "rgba(0,0,0,0.45)";
    const sx = Math.round(pl.x - camX), sy = Math.round(pl.y - camY);
    const sw = Math.max(4, 8 - Math.round(pl.z / 3));
    sc.fillRect(sx - sw, sy - 1, sw * 2, 2);
    sc.fillRect(sx - sw + 2, sy - 2, sw * 2 - 4, 4);
    const a = pl.action;
    let raise = 0, reach = 0;
    if (a) {
      const k = a.t / a.dur;
      if (a.type === "reach" || a.type === "push") reach = Math.sin(Math.min(1, k) * Math.PI);
      if (a.type === "smash") raise = a.t < 0.5 ? a.t / 0.5 : a.t < 0.62 ? lerp(1, -1, (a.t - 0.5) / 0.12) : lerp(-1, 0, clamp((a.t - 0.62) / 0.5, 0, 1));
      if (a.type === "carve") reach = 0.4 + 0.6 * Math.abs(Math.sin(a.t * 14));
      if (a.type === "attach") reach = 0.3;
    }
    const pose: GolemPose = {
      facing: pl.facing, phase: pl.phase, moving: pl.moving && !a, hasArm: pl.hasArm, dormant: pl.dormant,
      eye: clamp(pl.eye + this.eyeBoost, 0, 1.6) / (this.eyeBoost > 0 ? 1 : 1), core: pl.core, raise, reach, t: this.t,
    };
    const ox = pl.x - camX + (a?.type === "push" ? Math.round(Math.sin(a.t * 40)) : 0), oy = pl.y - camY - pl.z;
    drawGolem(new Pen(sc, false), ox, oy, pose);
    drawGolem(new Pen(this.emit.ctx, true), ox, oy, pose);
  }

  renderHud() {
    const ctx = this.ctx;
    // interaction marker
    if (this.state === "play" && this.target) {
      const it = this.target;
      const x = Math.round(it.x - this.cam.x), y = Math.round(it.y - this.cam.y - (it.prop?.itemZ ?? 10) - 14 + Math.sin(this.t * 4) * 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - 3, y, 7, 1); ctx.fillRect(x - 2, y + 1, 5, 1); ctx.fillRect(x - 1, y + 2, 3, 1);
      ctx.fillStyle = "#d8cfa8";
      ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y + 1, 1, 1);
    }
    // toast
    if (this.toast && this.state !== "schem") {
      const t = this.toast.t;
      const a = t < 0.2 ? t / 0.2 : t > 2.5 ? 1 - (t - 2.5) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      const name = this.toast.name;
      const w = name.length * 4 + 30;
      const x = Math.round(W / 2 - w / 2), y = H - 26;
      ctx.fillStyle = "#0c0a0e"; ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = "#3a3540"; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + 19, w, 1); ctx.fillRect(x, y, 1, 20); ctx.fillRect(x + w - 1, y, 1, 20);
      ctx.drawImage(this.toast.icon.a, x + 3, y + 2);
      drawText(ctx, name, x + 23, y + 8, "#d8d0b8");
      ctx.globalAlpha = 1;
    }
  }

  renderInv() {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    const px = 40, py = 24, pw = 240, ph = 132;
    const frame = (x: number, y: number, w: number, h: number, fill: string, edge = "#3a3540", hi = "#4e4856") => {
      ctx.fillStyle = "#08070a"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = edge; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = hi; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = fill; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    };
    frame(px, py, pw, ph, "#141117");
    for (const [cx, cy] of [[px + 3, py + 3], [px + pw - 5, py + 3], [px + 3, py + ph - 5], [px + pw - 5, py + ph - 5]]) { ctx.fillStyle = "#6a6372"; ctx.fillRect(cx, cy, 2, 2); }
    // golem figure
    frame(px + 8, py + 8, 80, 116, "#0e0c10");
    const fig = makeCanvas(40, 40);
    const pose: GolemPose = { facing: "down", phase: 0, moving: false, hasArm: this.pl.hasArm, dormant: 0, eye: 1, core: 0.8 + 0.2 * Math.sin(this.t * 3), raise: 0, reach: 0, t: this.t };
    drawGolem(new Pen(fig.ctx, false), 20, 34, pose);
    ctx.drawImage(fig.c, px + 8, py + 22, 80, 80);
    if (!this.pl.hasArm && Math.sin(this.t * 4) > -0.2) {
      ctx.fillStyle = "#8a4040";
      const ax = px + 8 + (20 + 6) * 2, ay = py + 22 + (34 - 13) * 2;
      for (let i = 0; i < 20; i += 2) { ctx.fillRect(ax + i % 8, ay, 1, 1); ctx.fillRect(ax, ay + i, 1, 1); ctx.fillRect(ax + 8, ay + i, 1, 1); ctx.fillRect(ax + (i % 8), ay + 20, 1, 1); }
    }
    // relics
    const rel = RELICS.filter((r) => this.inv.includes(r)).length;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < rel ? "#c9a040" : "#2a2630";
      ctx.fillRect(px + 34 + i * 6, py + 114, 4, 4);
    }
    // grid
    const gx = px + 100, gy = py + 12;
    if (this.invMode === "select") {
      const s = propSprite("pedestal", 0, false)!;
      ctx.drawImage(s.a, px + pw - 22, py + 6);
      drawText(ctx, "?", px + pw - 24, py + 8, "#a070ff");
    }
    for (let i = 0; i < 12; i++) {
      const cx = gx + (i % 4) * 30, cy = gy + Math.floor(i / 4) * 30;
      const sel = i === this.invCursor;
      frame(cx, cy, 26, 26, sel ? "#221d26" : "#100e12", sel ? (Math.sin(this.t * 6) > 0 ? "#c8b88a" : "#9a8c66") : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
      const id = this.inv[i];
      if (id) {
        const ic = itemIcon(id);
        const dim = this.invMode === "select" && !id.startsWith("glyph");
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.drawImage(ic.a, cx + 5, cy + 5);
        ctx.globalAlpha = 1;
      }
    }
    const id = this.inv[this.invCursor];
    if (id) drawTextS(ctx, ITEM_NAMES[id], gx + 58, py + ph - 16, "#d8d0b8", 1, "center");
  }

  renderSchem() {
    const ctx = this.ctx;
    const k = clamp(this.schemOpenT / 0.45, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, 0, W, H);
    const w = Math.round(W * e);
    const x = Math.round((W - w) / 2);
    ctx.drawImage(this.schemCanvas, x, 0, w, H, x, 0, w, H);
    if (w < W) { ctx.fillStyle = "#d0d8e8"; ctx.fillRect(x - 3, 0, 3, H); ctx.fillRect(x + w, 0, 3, H); }
    if (k >= 1 && Math.sin(this.t * 6) > 0) {
      const mx = Math.round(PLAN_X + (this.pl.x / TS) * PLAN_S), my = Math.round(PLAN_Y + (this.pl.y / TS) * PLAN_S);
      ctx.fillStyle = "#ffcc55"; ctx.fillRect(mx - 1, my - 1, 3, 3);
      ctx.fillStyle = "#000"; ctx.fillRect(mx, my, 1, 1);
    }
  }

  renderTitle() {
    const ctx = this.ctx;
    ctx.fillStyle = "#060508"; ctx.fillRect(0, 0, W, H);
    // dithered vignette glow
    for (let y = 0; y < H; y += 1) for (let x = (y & 1); x < W; x += 2) {
      const d = Math.hypot((x - W / 2) / W, (y - 70) / H);
      if (hash2(x, y, 1) > d * 2.2) { ctx.fillStyle = "#120e16"; ctx.fillRect(x, y, 1, 1); }
    }
    for (const p of this.particles) { ctx.fillStyle = p.col; ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    ctx.globalAlpha = 1;
    const ty = 46;
    drawText(ctx, "DUSTWAKE", W / 2 + 2, ty + 2, "#000", 5, "center");
    drawText(ctx, "DUSTWAKE", W / 2, ty, "#4b4552", 5, "center");
    drawText(ctx, "DUSTWAKE", W / 2, ty - 1, "#8a8392", 5, "center");
    ctx.fillStyle = "#4b4552";
    for (let i = 0; i < 40; i++) { const x = W / 2 - 78 + ((hash2(i, 3, 3) * 156) | 0), y = ty - 1 + ((hash2(i, 4, 3) * 25) | 0); ctx.fillRect(x, y, 1, 1); }
    // eye
    const blink = Math.sin(this.t * 1.7) > -0.95;
    if (blink) { ctx.fillStyle = "#7fe8ff"; ctx.fillRect(W / 2 - 3, ty + 34, 6, 1); ctx.fillStyle = "#2a6a7a"; ctx.fillRect(W / 2 - 5, ty + 34, 2, 1); ctx.fillRect(W / 2 + 3, ty + 34, 2, 1); }
    // controls
    const key = (x: number, y: number, s: string, w = 9) => {
      ctx.fillStyle = "#08070a"; ctx.fillRect(x - 1, y - 1, w + 2, 11);
      ctx.fillStyle = "#3a3540"; ctx.fillRect(x, y, w, 9);
      ctx.fillStyle = "#4e4856"; ctx.fillRect(x, y, w, 1);
      ctx.fillStyle = "#1a171e"; ctx.fillRect(x, y + 8, w, 1);
      drawText(ctx, s, x + w / 2, y + 2, "#c8c0b0", 1, "center");
    };
    const cy = 112;
    key(90, cy, "W"); key(80, cy + 11, "A"); key(90, cy + 11, "S"); key(100, cy + 11, "D");
    drawText(ctx, "MOVE", 95, cy + 25, "#6a6372", 1, "center");
    key(150, cy + 11, "E");
    drawText(ctx, "USE", 155, cy + 25, "#6a6372", 1, "center");
    key(200, cy + 11, "I"); key(212, cy + 11, "TAB", 17);
    drawText(ctx, "PACK", 213, cy + 25, "#6a6372", 1, "center");
    if (Math.sin(this.t * 3) > -0.3) drawText(ctx, "PRESS ANY KEY", W / 2, 164, "#8a8392", 1, "center");
  }

  renderEnd() {
    const ctx = this.ctx;
    const t = this.stateT;
    // sky bands, dithered
    const bands = ["#0a0c22", "#141634", "#26204a", "#43285a", "#6a3458", "#9a4a50", "#d07448", "#f0a85a"];
    const hz = 120;
    for (let y = 0; y < H; y++) {
      const f = clamp(y / hz, 0, 1) * (bands.length - 1);
      const i0 = Math.floor(f), fr = f - i0;
      for (let x = 0; x < W; x++) {
        const b = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y & 3) * 4 + (x & 3)] / 16;
        ctx.fillStyle = bands[Math.min(bands.length - 1, i0 + (fr > b ? 1 : 0))];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // stars
    for (let i = 0; i < 90; i++) {
      const x = (hash2(i, 1, 4) * W) | 0, y = (hash2(i, 2, 4) * 70) | 0;
      const tw = Math.sin(this.t * 2 + i) > 0.3;
      ctx.fillStyle = tw ? "#e8e8ff" : "#8a8ab0";
      ctx.fillRect(x, y, 1, 1);
    }
    // sun
    const sunY = hz + 6 - Math.min(t, 12) * 2.6;
    for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) {
      const d = x * x + y * y;
      if (d <= 196) { ctx.fillStyle = d < 120 ? "#fff0c0" : "#ffd080"; ctx.fillRect(W / 2 + 40 + x, Math.round(sunY + y), 1, 1); }
    }
    // mountains
    const ridge = (base: number, amp: number, freq: number, seed: number, col: string) => {
      ctx.fillStyle = col;
      for (let x = 0; x < W; x++) {
        const h = base - Math.abs(Math.sin(x * freq + seed)) * amp - Math.sin(x * freq * 2.7 + seed * 2) * amp * 0.3 - hash2(x >> 2, seed, 1) * 2;
        ctx.fillRect(x, Math.round(h), 1, H - Math.round(h));
      }
    };
    ridge(hz + 4, 26, 0.018, 1, "#3a2440");
    ridge(hz + 16, 18, 0.03, 4, "#24182c");
    // hill with ruins entrance
    ctx.fillStyle = "#120c16";
    for (let x = 0; x < W; x++) {
      const h = 150 - Math.max(0, 22 - Math.abs(x - 110) * 0.18) - Math.sin(x * 0.05) * 3;
      ctx.fillRect(x, Math.round(h), 1, H);
    }
    // broken pillars silhouettes
    for (const [x, h] of [[60, 18], [72, 10], [150, 14], [162, 22]] as [number, number][]) { ctx.fillStyle = "#0c080e"; ctx.fillRect(x, 150 - h - 6, 5, h + 10); ctx.fillRect(x - 1, 150 - h - 6, 7, 2); }
    // rune circle on hilltop
    const cx = 110, cy = 130;
    const glow = 0.4 + 0.3 * Math.sin(this.t * 2);
    ctx.fillStyle = `rgba(160,112,255,${glow * Math.max(0, 1 - t / 8)})`;
    for (let a = 0; a < Math.PI * 2; a += 0.05) ctx.fillRect(Math.round(cx + Math.cos(a) * 14), Math.round(cy + Math.sin(a) * 4), 1, 1);
    // golem looking at sunrise
    const pose: GolemPose = { facing: "up", phase: 0, moving: false, hasArm: this.pl.hasArm, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: this.t };
    drawGolem(new Pen(ctx, false), cx, cy, pose);
    // light motes
    for (const p of this.particles) { ctx.fillStyle = p.col; ctx.globalAlpha = clamp(p.life, 0, 1) * 0.7; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    ctx.globalAlpha = 1;
    if (t > 3) {
      ctx.globalAlpha = clamp((t - 3) / 1.5, 0, 1);
      drawTextS(ctx, "DUSTWAKE", W / 2, 20, "#f0e0c8", 3, "center", "#2a1a2a");
      ctx.globalAlpha = 1;
    }
    if (t > 4.5) {
      ctx.globalAlpha = clamp((t - 4.5) / 1, 0, 1);
      const s = Math.floor(this.playTime);
      const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
      const rel = RELICS.filter((r) => this.inv.includes(r)).length;
      drawTextS(ctx, `TIME ${mm}:${ss}`, W / 2, 44, "#d8c8b0", 1, "center", "#2a1a2a");
      drawTextS(ctx, `RELICS ${rel}/3`, W / 2, 52, "#d8c8b0", 1, "center", "#2a1a2a");
      ctx.globalAlpha = 1;
    }
    if (t > 6 && Math.sin(this.t * 3) > -0.3) drawTextS(ctx, "R - WAKE AGAIN", W / 2, 168, "#c8b8a0", 1, "center", "#000");
    if (t < 1.6) { ctx.fillStyle = `rgba(235,240,255,${1 - t / 1.6})`; ctx.fillRect(0, 0, W, H); }
  }
}

function hexToCol(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
