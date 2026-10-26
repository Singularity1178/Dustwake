// Host + presentation. Owns the canvas, input, screens, camera, particles,
// audio and rendering. It never mutates the World directly except through sim
// entry points; it reacts to the World's events for sound and particles.
import { TS, T } from "./content/tiles";
import { ITEMS, ITEM_NAMES, isGlyph, glyphItem, type ItemId } from "./content/items";
import { hasItem, addItems } from "./sim/inventory";
import { BuildUi } from "./screens/buildMenu";
import { CraftingUi } from "./screens/crafting";
import { PackUi } from "./screens/pack";
import { BookUi } from "./screens/book";
import { SchematicUi } from "./screens/schematic";
import { DialogueUi } from "./screens/dialogue";
import { renderTitle, renderEnd } from "./screens/cards";
import { propDef } from "./content/props";
import { GLYPHS } from "./content/glyphs";
import { FLAGS } from "./content/flags";
import { propSprite } from "./art/props";
import { rubbleSprite, pillarSprite, doorSprite, barsSprite } from "./art/tiles";
import { itemIcon, glyphPattern } from "./art/items";
import { makeCanvas, Pen, Sprite, hash2, clamp, lerp, makeSprite } from "./util";
import { drawGolem, GolemPose } from "./golem";
import { Light, makeLight, computeVis, Lighting } from "./light";
import { Sfx } from "./audio";
import { buildCircle, CircleArt, CR } from "./circle";
import { SurfaceRuneArt } from "./surfaceRune";
import { carvingVisible, clumpCleared } from "./runeReveal";
import { RUNE_NODES } from "./content/runes";
import { drawText, drawTextS } from "./font";
import { createWorld, player, currentArea, hasFlag, setFlag, type World, type SimEvent } from "./world/world";
import type { PropInst } from "./world/area";
import { stepPlayer, stepWorld, addPlayTime } from "./sim/step";
import { interactables, type Interactable } from "./sim/interact";
import { AreaView } from "./view/areaView";
import { ScreenStack, type Screen } from "./ui/screens";
import { BASE_W, BASE_H, ZOOM_STEPS, ZOOM_DEFAULT, viewSize, nextZoomStep } from "./view/zoom";
import { npcDef } from "./content/npcs";
import { NPC_ART, type NpcPose } from "./npcArt";
import { isAwake, npcActor } from "./sim/dialogue";
import { saveToStorage, loadFromStorage } from "./world/save";
import type { Actor } from "./world/world";

/** Debug super-speed multiplier. 200% faster = base + 2x base = 3x. */
const DEBUG_SPEED_MULT = 3;

/** Base logical size. HUD and overlay screens are laid out for it (they draw on a base-size UI layer). */
export const W = BASE_W, H = BASE_H;
export { ZOOM_STEPS, ZOOM_DEFAULT, viewSize };

/** Presentation state of one NPC (eased pose, eye, flare). Not saved: derived from flags on load. */
interface NpcLook { awake: number; eye: number; wakeT: number; sleepT: number; reach: number; flare: number }

/**
 * First arrival on the surface, in seconds since the arrive screen opened. The
 * overgrown rune wakes: its surviving carvings glow, the glow sweeps round the
 * circle redrawing what eroded while the plants over it wither away, the
 * circle pulses to full power, and then the golem is summoned onto it. The
 * player can't act until END (the arrive screen never steps the player).
 */
export const ARRIVE = {
  /** Fade in from black. */
  FADE: 1.0,
  /** The surviving carvings begin to glow; a low hum starts. */
  GLOW: 1.3,
  /** The redraw sweep runs SWEEP -> SWEEP_END; the hum rises. */
  SWEEP: 2.9,
  SWEEP_END: 6.3,
  /** Full activation pulse ends. */
  PULSE_END: 7.1,
  /** Summon: converging motes and a light column build until FLASH, which reveals the golem. */
  FLASH: 8.3,
  /** Back to play. */
  END: 9.8,
} as const;

interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; kind: "spark" | "ember" | "dust" | "debris" | "drip" | "splash" | "rune" | "mote" | "glint" | "smoke";
  col: string; emit: boolean; g: number; size: number;
}

/** Presentation-only state of the golem's body: boot-up, flicker, hover. */
interface GolemLook { eye: number; core: number; dormant: number; sparkT: number; sputter: number; z: number }

const newSeed = () => (Math.random() * 4294967296) >>> 0;

export class Game {
  /** Base-size (W x H) UI layer: HUD, overlays, title and end cards. */
  ctx: CanvasRenderingContext2D;
  /** World layer: the lit scene, sized to the current view (vw x vh). */
  wctx: CanvasRenderingContext2D;
  /** Current view size in world pixels (W x H at 1x). */
  vw = W; vh = H;
  /** Current (possibly easing) zoom and its animation. */
  zoom = 1;
  zoomAnim: { from: number; to: number; t: number; dur: number } | null = null;
  /** Called when the view size changes (App refits the world canvas). */
  onView: ((w: number, h: number) => void) | null = null;
  scene = makeCanvas(W, H);
  emit = makeCanvas(W, H);
  lighting = new Lighting(W, H);
  npcLooks = new Map<string, NpcLook>();
  sfx = new Sfx();
  circle: CircleArt = buildCircle();
  shaft: Sprite;

  world!: World;
  view!: AreaView;
  screens = new ScreenStack();
  /** Real (presentation) clock: animations run on it even while the world is paused. */
  t = 0;
  particles: Particle[] = [];
  toast: { icon: Sprite; name: string; t: number } | null = null;
  /** Debug/testing state (not saved, not part of the sim). */
  debugSpeed = false;
  debugMsg: { text: string; t: number } | null = null;
  cam = { x: 0, y: 0 };
  shakeT = 0; shakeMag = 0;
  rumbleT = 50;
  eyeBoost = 0;
  crackFlash = 0;
  fizzT = 0;
  look: GolemLook = { eye: 0, core: 0, dormant: 1, sparkT: 2, sputter: 0, z: 0 };
  glight!: Light;
  keys = new Set<string>();
  pressed = new Set<string>();
  dripT: number[] = [];
  target: Interactable | null = null;
  outImg: ImageData;
  private uiTimers: { at: number; fn: () => void }[] = [];
  private S!: Record<"title" | "intro" | "play" | "tele" | "end" | "arrive" | "inv" | "schem" | "book" | "build" | "crafting" | "dialogue", Screen>;
  /** Feedback line (blocked actions, pack full, rune dark...). */
  note: { text: string; t: number } | null = null;
  /** Current rune jump: where the effect plays, how long, and whether it's the first (cinematic) one. */
  tele = { x: 0, y: 0, dur: 4.6, first: true, travelled: false };
  /** White fade after a short rune hop (1 -> 0). */
  arriveFade = 0;
  hideGolem = false;
  /**
   * Surface rune override during the arrival cutscene (null: follow its flag).
   * t: redraw progress 0..1, glow: emissive level (>1 = overdriven pulse), column: summon beam 0..1.
   */
  runeAnim: { t: number; glow: number; column: number } | null = null;
  private runeArtCache: SurfaceRuneArt | null = null;
  /** The surface rune's layered art (dormant / awakening / restored), built on first use. */
  get runeArt() { return (this.runeArtCache ??= new SurfaceRuneArt(this.circle.pixels)); }
  /** Build menu, placement and deconstruct tools (screens/buildMenu.ts). */
  buildUi!: BuildUi;
  /** Crafting bench screen (screens/crafting.ts). */
  craftUi!: CraftingUi;
  /** Pack / inventory overlay (screens/pack.ts). */
  packUi!: PackUi;
  /** Book reading screen (screens/book.ts). */
  bookUi!: BookUi;
  /** Schematic overlay (screens/schematic.ts). */
  schemUi!: SchematicUi;
  /** Dialogue box overlay (screens/dialogue.ts). */
  dialogueUi!: DialogueUi;
  /** Printable characters typed this frame (raw case) and "\b" for Backspace: text fields read these. */
  typed: string[] = [];

  constructor(public canvas: HTMLCanvasElement, public uiCanvas: HTMLCanvasElement) {
    this.wctx = canvas.getContext("2d")!;
    this.wctx.imageSmoothingEnabled = false;
    this.ctx = uiCanvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.outImg = this.wctx.createImageData(W, H);
    this.shaft = this.buildShaft();
    this.makeScreens();
    this.reset();
    this.screens.set(this.S.title);
  }

  // ---------------------------------------------------------------- session
  /** Start presenting a world (a fresh session by default, or a loaded one). */
  reset(world: World = createWorld(newSeed())) {
    this.world = world;
    this.view?.dispose();
    const area = currentArea(world);
    this.view = new AreaView(area);
    // The schematic is of the dungeon, wherever the golem is.
    this.schemUi.reset(world);
    const pl = player(world);
    this.glight = makeLight(pl.x, pl.y - 6, 108, [1, 0.78, 0.5], 0, 0.05, "golem");
    this.dripT = area.drips.map(() => Math.random() * 4);
    this.look = { eye: 0, core: 0, dormant: 1, sparkT: 1.5, sputter: 0, z: 0 };
    // Zoom is not saved: a world with a mended eye starts at the default zoomed-out view.
    this.zoomAnim = null;
    this.setZoom(hasFlag(world, FLAGS.golemEye) ? ZOOM_DEFAULT : 1);
    this.cam.x = pl.x - this.vw / 2; this.cam.y = pl.y - this.vh / 2 - 10;
    this.npcLooks.clear();
    this.dialogueUi.reset();
    this.packUi.reset();
    this.particles = [];
    this.toast = null;
    this.fizzT = 0;
    this.uiTimers = [];
    this.rumbleT = 45 + Math.random() * 30;
    this.note = null; this.arriveFade = 0; this.hideGolem = false; this.runeAnim = null;
  }

  /** Present a saved world, resuming straight into play. */
  resume(world: World) {
    this.reset(world);
    this.look.dormant = 0;
    this.screens.set(this.S.play);
  }

  /** Save the world to the single localStorage slot (K on the play screen). */
  saveGame() {
    try { saveToStorage(this.world); this.say("GAME SAVED"); this.sfx.tone(520, 0.1, "triangle", 0.05); }
    catch { this.say("COULD NOT SAVE"); this.sfx.tone(180, 0.1, "square", 0.04); }
  }
  /** Load the saved world and resume play (L on the play or title screen). False if there is none. */
  loadGame(): boolean {
    let w: World | null = null;
    try { w = loadFromStorage(); } catch { w = null; }
    if (!w) { this.say("NO SAVED GAME"); this.sfx.tone(180, 0.1, "square", 0.04); return false; }
    this.resume(w);
    this.say("GAME LOADED");
    return true;
  }

  /** Rebuild the area view when the player has travelled to another area. */
  private syncView() {
    const area = currentArea(this.world);
    if (this.view.area === area) return;
    this.view.dispose();
    this.view = new AreaView(area);
    this.dripT = area.drips.map(() => Math.random() * 4);
    this.glight.vx = -999;
    // new area: snap the camera instead of panning across the map
    const pl = this.pl;
    this.cam.x = clamp(pl.x - this.vw / 2, 0, area.w * TS - this.vw); this.cam.y = clamp(pl.y - 12 - this.vh / 2, 0, area.h * TS - this.vh);
  }

  // ---------------------------------------------------------------- zoom
  /** Apply a zoom level now: resize the world canvas and the scene/emissive/lighting buffers if the view size changes. */
  setZoom(z: number) {
    this.zoom = z;
    const { w, h } = viewSize(z);
    if (w === this.vw && h === this.vh) return;
    // keep the view centred on the same point while it grows/shrinks
    this.cam.x -= (w - this.vw) / 2; this.cam.y -= (h - this.vh) / 2;
    this.vw = w; this.vh = h;
    this.scene = makeCanvas(w, h);
    this.emit = makeCanvas(w, h);
    this.lighting = new Lighting(w, h);
    this.canvas.width = w; this.canvas.height = h;
    this.wctx.imageSmoothingEnabled = false;
    this.outImg = this.wctx.createImageData(w, h);
    if (this.view) {
      const a = this.area;
      this.cam.x = clamp(this.cam.x, 0, a.w * TS - w); this.cam.y = clamp(this.cam.y, 0, a.h * TS - h);
    }
    this.onView?.(w, h);
  }
  /** Ease to a zoom level over `dur` seconds (presentation clock). */
  zoomTo(z: number, dur: number) {
    if (z === this.zoom && !this.zoomAnim) return;
    this.zoomAnim = { from: this.zoom, to: z, t: 0, dur };
  }
  private stepZoom(dt: number) {
    const a = this.zoomAnim;
    if (!a) return;
    a.t += dt;
    const k = clamp(a.t / a.dur, 0, 1), e = k * k * (3 - 2 * k);
    this.setZoom(lerp(a.from, a.to, e));
    if (k >= 1) this.zoomAnim = null;
  }
  /** Mouse wheel (App.tsx): discrete zoom steps, on the play screen only, once the eye is mended. */
  wheel(deltaY: number) {
    if (!this.screens.is("play") || !hasFlag(this.world, FLAGS.golemEye) || deltaY === 0) return;
    const cur = this.zoomAnim?.to ?? this.zoom;
    const next = nextZoomStep(cur, deltaY);
    if (next === cur) return;
    this.zoomTo(next, 0.25);
    this.sfx.tone(next > cur ? 420 : 560, 0.05, "triangle", 0.03);
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
    const raw = k;
    k = k.toLowerCase();
    if (!this.keys.has(k)) this.pressed.add(k);
    this.keys.add(k);
    if (raw.length === 1) this.typed.push(raw);
    else if (k === "backspace") this.typed.push("\b");
  }
  keyUp(k: string) { this.keys.delete(k.toLowerCase()); }
  pointer() { this.pressed.add("click"); }

  /** Debug keybinds (Ctrl+1/2/3), wired up in App.tsx. */
  debugKey(n: number) {
    const w = this.world, pl = this.pl;
    const say = (text: string) => { this.debugMsg = { text, t: 0 }; };
    if (n === 1) {
      // Toggle the iron arm.
      if (this.hasArm) { w.flags.delete(FLAGS.golemArm); say("DEBUG: IRON ARM OFF"); }
      else { setFlag(w, FLAGS.golemArm); say("DEBUG: IRON ARM ON"); }
    } else if (n === 2) {
      // Give every rune glyph, the aether core, the rune chisel and the schematic
      // (skipping any already held or already placed).
      const r = this.area.ritual;
      const held = (id: ItemId) => hasItem(pl, id);
      let given = 0;
      for (let g = 0; g < GLYPHS.length; g++) {
        const id = glyphItem(g);
        if (held(id) || r?.sockets.includes(g)) continue;
        addItems(w, pl, id, 1); given++;
      }
      if (!held("core") && !r?.core) { addItems(w, pl, "core", 1); given++; }
      for (const id of ["chisel", "schematic"] as ItemId[]) {
        if (held(id)) continue;
        addItems(w, pl, id, 1); given++;
      }
      this.sfx.tone(520, 0.1, "triangle", 0.05);
      say(given ? "DEBUG: RUNES + CORE + TOOLS GRANTED" : "DEBUG: ALREADY HAVE ALL RUNES + CORE + TOOLS");
    } else if (n === 3) {
      this.debugSpeed = !this.debugSpeed;
      say(this.debugSpeed ? "DEBUG: SUPER SPEED ON" : "DEBUG: SUPER SPEED OFF");
    } else if (n === 4) {
      // Building tests: every build knowledge flag (incl. masonry for the brazier),
      // the basket, and enough materials to build one of everything several times.
      setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.knowMasonry); setFlag(w, FLAGS.golemBasket);
      addItems(w, pl, "wood", 40); addItems(w, pl, "stone", 40);
      say("DEBUG: BUILD + MASONRY + BASKET + MATERIALS");
    } else if (n === 5) {
      // Toggle the mended eye (golem.eye) and the zoom it unlocks.
      if (hasFlag(w, FLAGS.golemEye)) { w.flags.delete(FLAGS.golemEye); this.zoomTo(1, 0.4); say("DEBUG: EYE REPAIR OFF"); }
      else { setFlag(w, FLAGS.golemEye); this.zoomTo(ZOOM_DEFAULT, 1); this.eyeBoost = 1.5; say("DEBUG: EYE REPAIR ON (SCROLL TO ZOOM)"); }
    }
  }
  has(...k: string[]) { return k.some((x) => this.keys.has(x)); }
  hit(...k: string[]) { return k.some((x) => this.pressed.has(x)); }

  // ---------------------------------------------------------------- helpers
  get pl() { return player(this.world); }
  get area() { return currentArea(this.world); }
  get hasArm() { return hasFlag(this.world, FLAGS.golemArm); }
  spawn(p: Partial<Particle> & { x: number; y: number }) {
    if (this.particles.length > 900) return;
    this.particles.push({ z: 0, vx: 0, vy: 0, vz: 0, life: 1, max: p.life ?? 1, kind: "dust", col: "#888", emit: false, g: 0, size: 1, ...p } as Particle);
  }
  shake(t: number, m: number) { this.shakeT = Math.max(this.shakeT, t); this.shakeMag = Math.max(this.shakeMag, m); }
  dist2(x: number, y: number) { const pl = this.pl, dx = x - pl.x, dy = y - pl.y; return dx * dx + dy * dy; }
  volAt(x: number, y: number) { return clamp(1 - Math.sqrt(this.dist2(x, y)) / 220, 0, 1); }
  later(delay: number, fn: () => void) { this.uiTimers.push({ at: this.t + delay, fn }); }

  sparkBurst(n: number) {
    const pl = this.pl;
    const right = pl.facing === "down" || pl.facing === "left";
    const sx = pl.x + (pl.facing === "up" ? -8 : pl.facing === "down" ? 8 : right ? -1 : 1), sy = pl.y - 9 + Math.round(this.look.dormant * 4);
    for (let i = 0; i < n; i++)
      this.spawn({ x: sx, y: sy + 9, z: 9, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.3) * 20, vz: 10 + Math.random() * 30, life: 0.3 + Math.random() * 0.4, kind: "spark", col: Math.random() < 0.5 ? "#fff2a0" : "#ffb040", emit: true, g: 120 });
  }

  // ---------------------------------------------------------------- screens
  private makeScreens() {
    const g = this;
    const scr = (id: string, opaque: boolean, update: (dt: number) => void, render: () => void): Screen => ({ id, opaque, t: 0, update, render });
    this.buildUi = new BuildUi(this);
    this.craftUi = new CraftingUi(this);
    this.packUi = new PackUi(this);
    this.bookUi = new BookUi(this);
    this.schemUi = new SchematicUi(this);
    this.dialogueUi = new DialogueUi(this);
    this.S = {
      title: scr("title", true, (dt) => {
        if (g.hit("l") && g.loadGame()) { g.sfx.init(); return; }
        if (g.pressed.size) { g.sfx.init(); g.screens.set(g.S.intro); }
        if (Math.random() < 0.3) g.spawn({ x: Math.random() * W, y: H + 2, vy: -10 - Math.random() * 12, vx: (Math.random() - 0.5) * 4, life: 6, kind: "ember", col: Math.random() < 0.5 ? "#ff8a3a" : "#c84a10", emit: true });
        g.updateParticles(dt);
      }, () => renderTitle(g.ctx, g.t, g.particles)),
      intro: scr("intro", true, (dt) => { g.updateIntro(dt); g.worldFrame(dt); }, () => {
        g.renderWorldScene();
        const t = g.S.intro.t;
        if (t < 1.5) { g.ctx.fillStyle = `rgba(0,0,0,${1 - t / 1.5})`; g.ctx.fillRect(0, 0, W, H); }
      }),
      play: scr("play", true, (dt) => g.updatePlay(dt), () => g.renderWorldScene()),
      tele: scr("tele", true, (dt) => {
        if (g.updateTele(dt)) return;
        stepPlayer(g.world, dt, { ix: 0, iy: 0, use: false });
        g.drainEvents();
        g.worldFrame(dt);
      }, () => {
        g.renderWorldScene();
        const t = g.S.tele.t, w0 = g.tele.dur - 1.6;
        if (t > w0) { g.ctx.fillStyle = `rgba(235,240,255,${clamp((t - w0) / 1.4, 0, 1)})`; g.ctx.fillRect(0, 0, W, H); }
      }),
      arrive: scr("arrive", true, (dt) => { g.updateArrive(dt); g.worldFrame(dt); }, () => g.renderArrive()),
      book: this.bookUi.screen,
      build: this.buildUi.screen,
      crafting: this.craftUi.screen,
      dialogue: this.dialogueUi.screen,
      end: scr("end", true, (dt) => {
        const et = g.S.end.t;
        if (et > 5 && g.hit("r")) { g.reset(); g.screens.set(g.S.intro); }
        else if ((et > 5 && g.pressed.size) || et > 14) { g.particles = []; g.screens.set(g.S.arrive); }
        if (Math.random() < 0.2) g.spawn({ x: Math.random() * W, y: H * 0.4 + Math.random() * 60, vy: -3, vx: 4, life: 5, kind: "mote", col: "#ffd8a0", emit: true });
        g.updateParticles(dt);
      }, () => renderEnd(g.ctx, g.t, g.S.end.t, g.particles, g.world, g.pl)),
      inv: this.packUi.screen,
      schem: this.schemUi.screen,
    };
  }

  // ---------------------------------------------------------------- update
  update(dt: number) {
    this.t += dt;
    if (this.uiTimers.length) {
      const due = this.uiTimers.filter((u) => u.at <= this.t);
      this.uiTimers = this.uiTimers.filter((u) => u.at > this.t);
      for (const u of due) u.fn();
    }
    this.stepZoom(dt);
    this.screens.update(dt);
    this.pressed.clear();
    this.typed.length = 0;
  }

  /** One frame of world simulation plus its presentation. */
  private worldFrame(dt: number) {
    stepWorld(this.world, dt);
    this.drainEvents();
    this.syncView();
    if (this.view.flush()) this.glight.vx = -999;
    this.updateWorldFx(dt);
  }

  drainEvents() {
    const evs = this.world.events;
    if (!evs.length) return;
    this.world.events = [];
    for (const e of evs) this.onEvent(e);
  }

  /** Sound, particles and UI reactions to simulation events. */
  private onEvent(e: SimEvent) {
    const pl = this.pl;
    switch (e.t) {
      case "itemGained": {
        const n = e.n ?? 1;
        this.toast = { icon: itemIcon(e.item), name: ITEM_NAMES[e.item] + (n > 1 ? ` x${n}` : ""), t: 0 };
        this.sfx.pickup();
        if (e.stored) for (let i = 0; i < 10; i++) this.spawn({ x: pl.x, y: pl.y - 4, z: 14, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 20, vz: 20 + Math.random() * 20, life: 0.6, kind: "glint", col: "#fff0c0", emit: true, g: 40 });
        const def = ITEMS[e.item], id = e.item;
        if (def.opensOnPickup) this.later(0.5, () => { if (this.screens.is("play")) def.opens === "book" ? this.bookUi.open(id) : this.schemUi.open(); });
        break;
      }
      case "itemDropped":
        this.sfx.thud();
        for (let i = 0; i < 6; i++) this.spawn({ x: e.x + (Math.random() - 0.5) * 8, y: e.y, z: 2, vx: (Math.random() - 0.5) * 14, vz: 8, life: 0.6, kind: "dust", col: "#8a8478", g: 20 });
        if (e.reason !== "drop") this.say(e.reason === "full" ? "PACK FULL - LEFT ON THE GROUND" : "NO ROOM - DROPPED ON THE GROUND");
        break;
      case "packFull": this.say("YOUR PACK IS FULL"); this.sfx.tone(180, 0.1, "square", 0.04); break;
      case "message": this.say(e.text); break;
      case "learned":
        this.sfx.insight(); this.eyeBoost = 1.5;
        this.say("YOU LEARNED " + ({ [FLAGS.knowBuild]: "THE ART OF BUILDING", [FLAGS.knowRepair]: "THE ART OF MENDING", [FLAGS.knowMasonry]: "THE MASON'S CRAFT" }[e.flag] ?? e.flag));
        break;
      case "harvestHit": {
        const tree = e.kind === "tree" || e.kind === "log";
        if (tree) this.sfx.thud(); else this.sfx.clink();
        this.shake(e.depleted ? 0.35 : 0.12, e.depleted ? 2 : 1);
        if (e.depleted && !tree) this.sfx.smash();
        const cols = tree ? ["#5b3d24", "#7a5634", "#3e6a30", "#5a8a40"] : ["#8a8392", "#6a6372", "#4b4552"];
        for (let i = 0; i < (e.depleted ? 26 : 10); i++)
          this.spawn({ x: e.x + (Math.random() - 0.5) * 12, y: e.y, z: tree && i % 2 ? 20 + Math.random() * 14 : 6 + Math.random() * 6, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 10 + Math.random() * 30, life: 1 + Math.random(), kind: "debris", col: cols[(Math.random() * cols.length) | 0], g: tree && i % 2 ? 30 : 120 });
        break;
      }
      case "deconstructed":
        this.sfx.clink(); this.sfx.noise(0.2, 0.1, "bandpass", 900, 2);
        for (let i = 0; i < 12; i++) this.spawn({ x: e.x + (Math.random() - 0.5) * 10, y: e.y, z: e.kind === "torch" || e.kind === "banner" ? 10 : 4, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 16, vz: 10 + Math.random() * 20, life: 0.7, kind: "debris", col: Math.random() < 0.5 ? "#7a5634" : "#6a6372", g: 120 });
        break;
      case "openStation":
        if (e.actor === this.world.playerId && this.screens.is("play") && e.station === "crafting") this.craftUi.open(e.station, e.prop);
        break;
      case "built":
        this.sfx.place(); this.sfx.tone(520, 0.2, "triangle", 0.05);
        for (let i = 0; i < 10; i++) this.spawn({ x: e.x, y: e.y - 14, z: 2, vx: (Math.random() - 0.5) * 30, vz: 10 + Math.random() * 20, life: 0.6, kind: "spark", col: "#ffb040", emit: true, g: 80 });
        break;
      case "runeAwakened": case "travelled":
        this.tele.travelled = true;
        break;
      case "step":
        this.sfx.step(e.heavy);
        for (let i = 0; i < (e.heavy ? 4 : 2); i++)
          this.spawn({ x: pl.x + (Math.random() - 0.5) * 10, y: pl.y, z: 1, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 6, vz: 8, life: 0.6, kind: "dust", col: "#8a8478", g: 20 });
        if (!e.heavy && !this.hasArm) this.sfx.scrape();
        break;
      case "taskTick": {
        const a = e.task;
        if (a.kind === "attach") { if (Math.random() < 0.5) this.sparkBurst(2); }
        else if (a.kind === "dismantle" && a.target) {
          if (Math.floor(a.t / 0.3) !== Math.floor((a.t - e.dt) / 0.3)) this.sfx.clink();
          if (Math.random() < 0.3) this.spawn({ x: a.target.x + (Math.random() - 0.5) * 10, y: a.target.y, z: 4 + Math.random() * 8, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.5, kind: "dust", col: "#8a8478", g: 30 });
        }
        else if (a.kind === "carve") {
          const c = this.area.ritualPos;
          const k = Math.floor(a.t / 0.22), kp = Math.floor((a.t - e.dt) / 0.22);
          if (k !== kp && a.t < a.dur - 0.3) {
            this.sfx.clink();
            const ang = 0.26 + Math.random() * 1.05, r = 44 + Math.random() * 13;
            for (let i = 0; i < 4; i++) this.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, vz: 20 + Math.random() * 20, life: 0.4, kind: "spark", col: "#d0c0ff", emit: true, g: 120 });
            this.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vz: 6, life: 1, kind: "dust", col: "#8a8690", g: 4 });
          }
        }
        break;
      }
      case "cue":
        if (e.cue === "clank") { this.sfx.clank(); this.shake(0.1, 1); }
        else if (e.cue === "scrape") this.sfx.scrape();
        else if (e.cue === "dud") { this.sfx.fizzle(); this.fizzT = 0.5; }
        else if (e.cue === "scrapeDust") {
          this.sfx.scrape();
          for (let i = 0; i < 4; i++) this.spawn({ x: e.x, y: e.y, z: 2, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.8, kind: "dust", col: "#9a96a0", g: 20 });
        } else if (e.cue === "push") {
          this.sfx.thud();
          this.shake(0.2, 1);
          for (let i = 0; i < 6; i++) this.spawn({ x: e.x + (Math.random() - 0.5) * 16, y: e.y + 2, z: 20 + Math.random() * 10, vx: (Math.random() - 0.5) * 10, life: 1.5, kind: "debris", col: "#6a6372", g: 80 });
          this.crackFlash = 1;
        }
        break;
      case "equipped":
        this.sfx.clank();
        this.shake(0.15, 1);
        this.sparkBurst(14);
        break;
      case "containerOpened":
        this.sfx.open();
        for (let i = 0; i < 8; i++) this.spawn({ x: e.x + (Math.random() - 0.5) * 12, y: e.y, z: 6, vx: (Math.random() - 0.5) * 20, vz: 10, life: 1, kind: "dust", col: "#7a7468", g: 10 });
        break;
      case "doorUnlocked": this.sfx.unlock(); break;
      case "wallBroken": {
        this.sfx.smash();
        this.shake(0.7, 3.5);
        const cx = e.x, cy = e.y;
        for (let i = 0; i < 40; i++)
          this.spawn({ x: cx + (Math.random() - 0.5) * 16, y: cy + (Math.random() - 0.5) * 20, z: 4 + Math.random() * 18, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 60, vz: 20 + Math.random() * 60, life: 1.6 + Math.random(), kind: "debris", col: ["#8a8392", "#6a6372", "#4b4552"][(Math.random() * 3) | 0], g: 160, size: Math.random() < 0.4 ? 2 : 1 });
        for (let i = 0; i < 40; i++)
          this.spawn({ x: cx + (Math.random() - 0.5) * 24, y: cy + (Math.random() - 0.5) * 24, z: Math.random() * 20, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, vz: Math.random() * 10, life: 2 + Math.random() * 2, kind: "smoke", col: "#7a7470", g: -2, size: 2 });
        break;
      }
      case "corePlaced": this.sfx.place(); this.sfx.tone(660, 1, "sine", 0.06); break;
      case "carved": this.sfx.tone(392, 1.2, "sine", 0.07); break;
      case "glyphPlaced": this.sfx.place(); break;
      case "runeActivated": this.sfx.activate(); this.shake(1.5, 1.5); break;
      case "runeFizzled": {
        this.fizzT = 1.2;
        this.sfx.fizzle();
        this.shake(0.4, 2);
        const c = this.area.ritualPos;
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2, rr = 44 + Math.random() * 13;
          this.spawn({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr, z: 1, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 40, vz: 30 + Math.random() * 30, life: 0.5, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
        }
        break;
      }
      case "runeDeactivated": this.sfx.setHum(0); break;
      case "teleport":
        this.tele = { x: e.x, y: e.y, dur: pl.task?.dur ?? 4.6, first: e.first, travelled: false };
        this.screens.set(this.S.tele); this.sfx.teleport();
        break;
      case "areaEntered": break;
      case "dialogue":
        if (this.screens.is("play")) this.dialogueUi.open(e.npc, e.script, e.segment);
        break;
      case "npcState": {
        const a = npcActor(this.world, e.npc);
        if (!a) break;
        const L = this.npcLook(a);
        if (e.awake) {
          L.wakeT = 0;
          this.sfx.wakeSputter();
          this.npcSparks(a, 10);
          this.later(0.5, () => this.npcSparks(a, 6));
        } else {
          L.sleepT = 0;
          this.sfx.powerDown();
          this.later(1.1, () => { this.shake(0.2, 1); this.npcDust(a); });
        }
        break;
      }
      case "eyeRepaired": {
        const lk = this.look;
        lk.sputter = 0; lk.eye = 1;
        this.eyeBoost = 2.2;
        this.sfx.eyeRepair();
        this.shake(0.25, 1);
        this.sparkBurst(10);
        for (let i = 0; i < 24; i++)
          this.spawn({ x: pl.x + (Math.random() - 0.5) * 4, y: pl.y, z: 18, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 24, vz: 10 + Math.random() * 40, life: 0.4 + Math.random() * 0.5, kind: "spark", col: Math.random() < 0.5 ? "#bff4ff" : "#7fe8ff", emit: true, g: 110 });
        const by = e.by ? npcActor(this.world, e.by) : undefined;
        if (by) this.npcLook(by).reach = 1.8; // the guardian's hand holds still, then lowers
        // the camera pulls out as the eye clears; the wheel takes over from here
        this.later(0.5, () => this.zoomTo(ZOOM_DEFAULT, 1.1));
        this.dialogueUi.zoomHint = true;
        break;
      }
    }
  }

  updateIntro(dt: number) {
    const t = this.S.intro.t, lk = this.look;
    if (t > 0.8 && t - dt <= 0.8) { this.sparkBurst(8); this.sfx.spark(); }
    if (t > 1.2 && t - dt <= 1.2) this.sfx.boot();
    if (t > 1.6 && t - dt <= 1.6) { this.sparkBurst(6); this.sfx.spark(); }
    lk.core = t < 1.2 ? 0 : t < 2.6 ? (Math.random() < (t - 1.2) / 1.4 ? (t - 1.2) / 1.4 : 0.1) : 1;
    lk.eye = t < 2.9 ? 0 : t < 3.5 ? (Math.sin(t * 40) > 0 ? 1 : 0.2) : 1;
    lk.dormant = t < 3.6 ? 1 : clamp(1 - (t - 3.6) / 1.4, 0, 1);
    if (t > 4.2 && t - dt <= 4.2) this.sfx.thud();
    if (t > 5.2) this.screens.set(this.S.play);
  }

  updatePlay(dt: number) {
    const w = this.world, pl = this.pl, lk = this.look;
    addPlayTime(w, dt);
    // save / load (one slot in localStorage, the versioned format of world/save.ts)
    if (this.hit("k")) this.saveGame();
    if (this.hit("l") && this.loadGame()) return;
    // overlays
    if (!pl.task) {
      if (this.hit("i", "tab")) { this.packUi.open("view"); return this.worldFrame(dt); }
      if (this.hit("m") && hasItem(pl, "schematic")) { this.schemUi.open(); return this.worldFrame(dt); }
      if (this.hit("b")) { this.buildUi.open(); return this.worldFrame(dt); }
      if (this.hit("v")) { this.buildUi.quickPlace(); return this.worldFrame(dt); }
      // Repeat placement / deconstruction: reopen the tool once the ordered work is done.
      if (this.buildUi.pending) { this.buildUi.resumeAfterWork(); if (!this.screens.is("play")) return this.worldFrame(dt); }
    }
    let ix = 0, iy = 0;
    if (this.has("arrowleft", "a")) ix -= 1;
    if (this.has("arrowright", "d")) ix += 1;
    if (this.has("arrowup", "w")) iy -= 1;
    if (this.has("arrowdown", "s")) iy += 1;
    const res = stepPlayer(w, dt, { ix, iy, use: this.hit("e", " ", "enter"), speed: this.debugSpeed ? DEBUG_SPEED_MULT : 1 });
    this.drainEvents();
    // golem damage sparks
    lk.sparkT -= dt;
    if (lk.sparkT <= 0) {
      lk.sparkT = 1.5 + Math.random() * 4;
      if (!this.hasArm) { this.sparkBurst(3 + ((Math.random() * 4) | 0)); if (Math.random() < 0.6) this.sfx.spark(); }
      if (Math.random() < 0.12) lk.sputter = 0.25;
    }
    lk.sputter = Math.max(0, lk.sputter - dt);
    // The sputter is the damaged body's: the core keeps flickering (the golem is
    // still damaged), but once the guardian mends the eye it no longer gutters.
    lk.core = lk.sputter > 0 ? (Math.random() < 0.5 ? 0.3 : 0.8) : 1;
    lk.eye = lk.sputter > 0 && !hasFlag(w, FLAGS.golemEye) ? 0.3 : 1;
    lk.dormant = 0;
    this.eyeBoost = Math.max(0, this.eyeBoost - dt);
    this.target = res.target;
    if (res.ui) this.packUi.open("select", res.ui.socket);
    // rumble events
    if (!this.area.base.outdoor) this.rumbleT -= dt;
    if (this.rumbleT <= 0) {
      this.rumbleT = 50 + Math.random() * 50;
      this.sfx.rumble();
      this.shake(2.2, 1.5);
      for (let i = 0; i < 30 * this.zoom * this.zoom; i++) this.spawn({ x: this.cam.x + Math.random() * this.vw, y: this.cam.y + Math.random() * this.vh, z: 60 + Math.random() * 40, vz: -10, life: 4, kind: "debris", col: Math.random() < 0.5 ? "#6a6372" : "#4b4552", g: 60 });
    }
    this.worldFrame(dt);
  }

  /** The rune-jump effect (first jump: long, then the duskfall card; later hops: short). Returns true if it ended. */
  updateTele(_dt: number): boolean {
    const t = this.S.tele.t, lk = this.look, tl = this.tele, pl = this.pl;
    if (!pl.task && t > 0.2) {
      this.sfx.setHum(0);
      if (tl.first && tl.travelled) { this.screens.set(this.S.end); this.particles = []; }
      else { this.screens.set(this.S.play); this.arriveFade = tl.travelled ? 1 : 0; lk.z = tl.travelled ? 16 : 0; }
      return true;
    }
    const lift = tl.dur - 1.6;
    lk.z = Math.min(t, lift) * (tl.first ? 4 : 6) + Math.sin(t * 3) * 1;
    lk.eye = 1; lk.core = 1;
    this.shake(0.1, Math.min(4, t * 1.2));
    const c = tl;
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 50;
      this.spawn({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: 2, vx: -Math.cos(a) * r * 0.8, vy: -Math.sin(a) * r * 0.8, vz: 10 + Math.random() * 20, life: 1.2, kind: "rune", col: Math.random() < 0.5 ? "#c0a0ff" : "#80e0ff", emit: true, g: -5 });
    }
    this.glight.int = 0.9 + t * 0.4;
    return false;
  }

  /** The surface rune's presentation state: the arrival cutscene's, else its flag's. */
  surfaceRuneState(): { t: number; glow: number; column: number } {
    if (this.runeAnim) return this.runeAnim;
    const on = hasFlag(this.world, RUNE_NODES.surface.flag);
    return { t: on ? 1 : 0, glow: on ? 0.62 + 0.28 * Math.sin(this.t * 3) : 0, column: 0 };
  }

  /** First arrival on the surface: the overgrown rune wakes and redraws itself, then summons the golem. */
  updateArrive(dt: number) {
    const A = ARRIVE, t = this.S.arrive.t, t0 = t - dt, lk = this.look;
    const rp = this.area.prop("rune.surface");
    const c = rp ?? this.pl;
    const crossed = (at: number) => t >= at && t0 < at;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const prog = ease(clamp((t - A.SWEEP) / (A.SWEEP_END - A.SWEEP), 0, 1));
    let glow = 0;
    if (t >= A.GLOW && t < A.SWEEP) glow = 0.4 * ease(clamp((t - A.GLOW) / (A.SWEEP - A.GLOW), 0, 1)) * (0.85 + 0.15 * Math.sin(t * 7));
    else if (t >= A.SWEEP && t < A.SWEEP_END) glow = 0.4 + 0.25 * prog + 0.06 * Math.sin(t * 6);
    else if (t >= A.SWEEP_END && t < A.PULSE_END) glow = 0.65 + 0.95 * Math.sin((Math.PI * (t - A.SWEEP_END)) / (A.PULSE_END - A.SWEEP_END));
    else if (t >= A.PULSE_END) glow = 0.75 + 0.2 * Math.sin(t * 5);
    const column = t < A.PULSE_END ? 0 : t < A.FLASH ? ease((t - A.PULSE_END) / (A.FLASH - A.PULSE_END)) : Math.max(0, 1 - (t - A.FLASH) / 0.9);
    const prev = this.runeAnim?.t ?? 0;
    this.runeAnim = { t: prog, glow, column };
    this.hideGolem = t < A.FLASH;

    // sound follows the phases: a low hum, rising through the sweep; the pulse; the summon
    if (crossed(A.GLOW)) { this.sfx.setHum(0.25); this.sfx.tone(98, 2.2, "sine", 0.05, 110); }
    if (t >= A.SWEEP && t < A.SWEEP_END) this.sfx.setHum(0.25 + prog * 0.75);
    if (crossed(A.SWEEP)) this.sfx.tone(110, A.SWEEP_END - A.SWEEP, "sine", 0.05, 220);
    if (crossed(A.SWEEP_END)) { this.sfx.activate(); this.shake(0.6, 2); }
    if (crossed(A.PULSE_END)) this.sfx.tone(196, A.FLASH - A.PULSE_END, "triangle", 0.04, 392);
    if (crossed(A.FLASH)) { this.sfx.teleport(); this.shake(0.9, 3.5); this.sfx.setHum(0.2); }
    if (crossed(A.END - 0.5)) this.sfx.setHum(0);

    const px = this.circle.pixels;
    // motes rising from the lit carvings
    if (glow > 0 && t < A.FLASH && Math.random() < dt * 14 * Math.min(1, glow)) {
      const q = this.runeArt.model.pixels[(Math.random() * px.length) | 0];
      if (carvingVisible(q, prog)) this.spawn({ x: c.x + q.x, y: c.y + q.y, z: 0, vz: 6 + Math.random() * 10, life: 1.2, kind: "rune", col: Math.random() < 0.6 ? "#a070ff" : "#70d0ff", emit: true, g: -2 });
    }
    // the plants over each stretch the glow reaches wither and blow away
    if (prog > prev) {
      for (const cl of this.runeArt.model.clumps) if (clumpCleared(cl, prog) && !clumpCleared(cl, prev)) this.witherClump(c.x + cl.x, c.y + cl.y, cl.px.length);
      if (t < A.SWEEP_END) this.shake(0.1, 0.3 + prog * 0.8);
    }
    // summon: motes converge on the dais while the column of light builds
    if (t >= A.PULSE_END && t < A.FLASH) {
      this.shake(0.1, 0.4 + column * 2.6);
      for (let i = 0; i < 2 + column * 8; i++) {
        const a = Math.random() * Math.PI * 2, r = 50 + Math.random() * 40;
        this.spawn({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r, z: 2 + Math.random() * 6, vx: -Math.cos(a) * r * 1.1, vy: -Math.sin(a) * r * 1.1, vz: 4 + column * 30, life: 0.9, kind: "rune", col: Math.random() < 0.5 ? "#c0a0ff" : "#80e0ff", emit: true, g: -4 });
      }
    }
    if (crossed(A.FLASH)) for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 70;
      this.spawn({ x: c.x, y: c.y + 4, z: 4 + Math.random() * 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: 20 + Math.random() * 40, life: 0.8 + Math.random() * 0.6, kind: "spark", col: Math.random() < 0.5 ? "#e8e0ff" : "#a070ff", emit: true, g: 90 });
    }
    const fall = clamp((t - A.FLASH) / 1.2, 0, 1);
    lk.z = 30 * (1 - fall) ** 2;
    lk.eye = 1; lk.core = 1; lk.dormant = 0;
    this.cam.x = clamp(c.x - this.vw / 2, 0, this.area.w * TS - this.vw); this.cam.y = clamp(c.y - 12 - this.vh / 2, 0, this.area.h * TS - this.vh);
    if (t > A.END) {
      this.runeAnim = null; this.hideGolem = false; lk.z = 0;
      this.screens.set(this.S.play);
      this.say("THE SURFACE. THE WILD HAS SWALLOWED ALL TRACE OF THE HALLS.");
    }
  }

  /** A clump of plants on the rune withers and blows off as the glow reaches it. */
  witherClump(x: number, y: number, size: number) {
    const cols = ["#3e5e2a", "#527636", "#6e8e34", "#7a6a3a", "#5a4630"];
    for (let i = 0; i < 1 + Math.min(4, size / 6); i++)
      this.spawn({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 4, z: 1, vx: 10 + Math.random() * 22, vy: (Math.random() - 0.5) * 10, vz: 12 + Math.random() * 18, life: 0.7 + Math.random() * 0.7, kind: "debris", col: cols[(Math.random() * cols.length) | 0], g: 26 });
    if (Math.random() < 0.6) this.spawn({ x, y, z: 1, vz: 10 + Math.random() * 8, life: 0.8, kind: "rune", col: "#c0a0ff", emit: true, g: -3 });
  }

  renderArrive() {
    this.renderWorldScene();
    const A = ARRIVE, t = this.S.arrive.t, ctx = this.ctx;
    if (t < A.FADE) { ctx.fillStyle = `rgba(0,0,0,${1 - t / A.FADE})`; ctx.fillRect(0, 0, W, H); }
    if (t > A.FLASH && t < A.FLASH + 1) { ctx.fillStyle = `rgba(235,240,255,${1 - (t - A.FLASH)})`; ctx.fillRect(0, 0, W, H); }
    const t1 = A.GLOW + 0.3, t2 = A.SWEEP_END;
    if (t > t1 && t < t2) {
      ctx.globalAlpha = clamp((t - t1) * 2, 0, 1) * clamp((t2 - t) * 2, 0, 1);
      drawTextS(ctx, "THE OVERGROWN RUNE STIRS...", W / 2, 20, "#c8b0ff", 1, "center", "#000");
      ctx.globalAlpha = 1;
    }
  }

  /** Presentation that follows the world each simulated frame. */
  updateWorldFx(dt: number) {
    const pl = this.pl, area = this.area;
    // camera
    const VW = this.vw, VH = this.vh;
    const tx = clamp(pl.x - VW / 2, 0, area.w * TS - VW), ty = clamp(pl.y - 12 - VH / 2, 0, area.h * TS - VH);
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 3.5);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 3.5);
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.shakeT <= 0) this.shakeMag = 0;
    this.crackFlash = Math.max(0, this.crackFlash - dt);
    // golem light
    const gl = this.glight;
    gl.x = pl.x; gl.y = pl.y - 6;
    if (Math.abs(gl.x - gl.vx) > 2 || Math.abs(gl.y - gl.vy) > 2) computeVis(gl, area);
    const base = this.screens.is("tele") ? gl.int : 1.0;
    gl.cur = base * this.look.core * (0.95 + 0.05 * Math.sin(this.t * 13) * Math.sin(this.t * 3.1)) + this.eyeBoost * 0.3;
    // NPCs: eased pose and eye, eye light through the light registry
    this.updateNpcLooks(dt);
    // light flicker
    for (const L of this.view.lights.values()) {
      const n = Math.sin(this.t * 9 + L.seed) * 0.5 + Math.sin(this.t * 23.7 + L.seed * 2) * 0.3 + Math.sin(this.t * 3.3 + L.seed) * 0.2;
      L.cur = L.int * (1 - L.flick * (0.5 + 0.5 * n));
    }
    // rune
    const r = area.ritual;
    const cl = this.view.byId("circle");
    if (r?.active) {
      this.sfx.setHum(Math.min(1, r.actT / 2));
      if (cl) {
        const target = 120;
        if (cl.rad < target) { cl.rad = Math.min(target, cl.rad + dt * 30); if (Math.abs(cl.rad - cl.vx) > 0) computeVis(cl, area); }
        cl.int = 0.6 + Math.min(1, r.actT / 3) * 0.6;
        cl.cur = cl.int * (0.85 + 0.15 * Math.sin(this.t * 3));
      }
      const c = area.ritualPos;
      if (Math.random() < dt * 30) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: c.x + p.x, y: c.y + p.y, z: 0, vz: 8 + Math.random() * 12, life: 1.5, kind: "rune", col: Math.random() < 0.6 ? "#a070ff" : "#70d0ff", emit: true, g: -2 });
      }
    } else if (cl) {
      cl.cur = cl.int * (0.8 + 0.2 * Math.sin(this.t * 1.3)) + (this.fizzT > 0 ? Math.random() * 0.6 : 0);
    }
    this.fizzT = Math.max(0, this.fizzT - dt);
    // surface rune glow: dark and dead while dormant (no baseline), driven by the cutscene, steady once restored
    const rg = this.view.byId("runeglow");
    if (rg) {
      const st = this.surfaceRuneState();
      rg.cur = rg.int * (st.glow * (0.92 + 0.08 * Math.sin(this.t * 2.3)) + st.column * 0.7);
      if (!this.runeAnim && st.t >= 1 && Math.random() < dt * 8) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: rg.x + p.x, y: rg.y + p.y, z: 0, vz: 6 + Math.random() * 10, life: 1.4, kind: "rune", col: Math.random() < 0.6 ? "#a070ff" : "#70d0ff", emit: true, g: -2 });
      }
    }
    // short-hop arrival
    if (this.arriveFade > 0) { this.arriveFade = Math.max(0, this.arriveFade - dt * 1.4); this.look.z = Math.max(0, this.look.z - dt * 24); }
    if (this.note) { this.note.t += dt; if (this.note.t > 3) this.note = null; }
    // drifting leaves on the night wind
    if (area.base.outdoor && Math.random() < dt * 1.5)
      this.spawn({ x: this.cam.x - 20 + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 30 + Math.random() * 40, vx: 8 + Math.random() * 8, vy: (Math.random() - 0.3) * 3, vz: -4 - Math.random() * 3, life: 7, kind: "mote", col: ["#7a5630", "#946a34", "#5a7a34", "#a07c40"][(Math.random() * 4) | 0], emit: false, g: 0 });
    // fireflies under the open sky
    if (area.base.outdoor && Math.random() < dt * 3 * this.zoom * this.zoom)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 6 + Math.random() * 20, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 3, life: 4, kind: "mote", col: "#d8f080", emit: true, g: 0 });
    // drips
    area.drips.forEach((d, i) => {
      this.dripT[i] -= dt;
      if (this.dripT[i] <= 0) {
        this.dripT[i] = 1.5 + Math.random() * 4;
        if (Math.abs(d.x - this.cam.x - VW / 2) < VW / 2 + 100 && Math.abs(d.y - this.cam.y - VH / 2) < VH / 2 + 90)
          this.spawn({ x: d.x, y: d.y, z: 70, vz: -20, life: 3, kind: "drip", col: "#6a8aa8", g: 140 });
      }
    });
    // torch embers
    for (const p of area.props) {
      if (!p.lit) continue;
      const fire = propDef(p.kind).fire;
      if (!fire) continue;
      if (Math.abs(p.x - this.cam.x - VW / 2) > VW / 2 + 40 || Math.abs(p.y - this.cam.y - VH / 2) > VH / 2 + 50) continue;
      if (Math.random() < dt * fire.embers)
        this.spawn({ x: p.x + (Math.random() - 0.5) * 4, y: p.y + fire.emberDy, z: 14, vx: (Math.random() - 0.5) * 6, vz: 10 + Math.random() * 10, life: 1 + Math.random(), kind: "ember", col: Math.random() < 0.5 ? "#ffb040" : "#ff6a1a", emit: true, g: -4 });
    }
    // ambient dust motes
    if (Math.random() < dt * 8 * this.zoom * this.zoom)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 4 + Math.random() * 30, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 5, kind: "mote", col: "#b8b0a0", emit: false, g: 0 });
    // moonbeam motes
    const moon = this.view.byId("moon");
    if (moon && Math.random() < dt * 5)
      this.spawn({ x: moon.x - 14 + Math.random() * 30, y: moon.y + 2, z: 10 + Math.random() * 70, vx: (Math.random() - 0.5) * 2, vz: -3 - Math.random() * 3, life: 6, kind: "mote", col: "#a8c0ff", emit: true, g: 0 });
    // item glints
    if (Math.random() < dt * 2) {
      const cands: [number, number][] = [];
      for (const it of interactables(area)) if (it.kind === "item" || it.kind === "propItem" || (it.kind === "container" && it.hasItem)) cands.push([it.x, it.y - (it.itemZ ?? 6) - 2]);
      const near = cands.filter(([x, y]) => Math.abs(x - this.cam.x - VW / 2) < VW / 2 + 10 && Math.abs(y - this.cam.y - VH / 2) < VH / 2 + 10);
      if (near.length) {
        const [x, y] = near[(Math.random() * near.length) | 0];
        this.spawn({ x: x + (Math.random() - 0.5) * 8, y: y + 2, z: 2 + Math.random() * 4, life: 0.45, kind: "glint", col: "#fff4d0", emit: true });
      }
    }
    if (this.debugMsg) { this.debugMsg.t += dt; if (this.debugMsg.t > 2) this.debugMsg = null; }
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

  // ---------------------------------------------------------------- UiHost
  say(text: string) { this.note = { text, t: 0 }; }
  /** Open an item's reading screen (pack E, UiHost.read). */
  read(id: ItemId) {
    const opens = ITEMS[id].opens;
    if (opens === "schematic") this.schemUi.open();
    else if (opens === "book") this.bookUi.open(id);
  }
  boostEye(level: number) { this.eyeBoost = level; }
  /** World presentation without simulation (overlays that keep the scene alive, e.g. dialogue). */
  animate(dt: number) { this.updateWorldFx(dt); }

  renderNote(y = H - 40) {
    if (!this.note) return;
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(3 - this.note.t, 0, 1);
    drawTextS(ctx, this.note.text, W / 2, y, "#e8d8b0", 1, "center", "#000");
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- render
  render() {
    this.ctx.clearRect(0, 0, W, H);
    this.screens.render();
  }

  private renderWorldScene() {
    this.view.flush();
    this.renderWorld();
    this.renderHud();
  }

  renderWorld() {
    const sc = this.scene.ctx, ec = this.emit.ctx, area = this.area;
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { sx = (Math.random() - 0.5) * this.shakeMag * 2; sy = (Math.random() - 0.5) * this.shakeMag * 2; }
    const camX = Math.round(this.cam.x + sx), camY = Math.round(this.cam.y + sy);
    const W = this.vw, H = this.vh; // the world layer is view-sized (zoom)
    sc.fillStyle = "#000"; sc.fillRect(0, 0, W, H);
    ec.fillStyle = "#000"; ec.fillRect(0, 0, W, H);
    this.view.prepare(camX, camY, W, H);
    this.view.idle();
    sc.drawImage(this.view.bg.c, camX, camY, W, H, 0, 0, W, H);
    const spr = (s: Sprite, x: number, y: number) => {
      const dx = Math.round(x - s.ax - camX), dy = Math.round(y - s.ay - camY);
      if (dx > W || dy > H || dx + s.w < 0 || dy + s.h < 0) return;
      sc.drawImage(s.a, dx, dy);
      ec.drawImage(s.e, dx, dy);
    };
    // ---- rune circle (floor layer)
    const r = area.ritual;
    if (r) {
      const c = area.ritualPos;
      const schemRead = hasFlag(this.world, FLAGS.knowSchematic);
      const ccx = c.x - CR - camX, ccy = c.y - CR - camY;
      if (ccx > -140 && ccx < W + 10 && ccy > -140 && ccy < H + 10) {
        sc.drawImage(this.circle.base, ccx, ccy);
        sc.drawImage(r.carved ? this.circle.gapCarved : this.circle.chalk, ccx, ccy);
        let lvl = r.active ? 0.55 + 0.35 * Math.sin(this.t * 3) + Math.min(0.3, r.actT * 0.1) : 0.16 + 0.06 * Math.sin(this.t * 1.3);
        if (this.fizzT > 0) lvl = Math.random() * 0.8;
        ec.globalAlpha = clamp(lvl, 0, 1);
        ec.drawImage(this.circle.glow, ccx, ccy);
        if (r.carved) ec.drawImage(this.circle.glowGap, ccx, ccy);
        if (!r.carved && schemRead) { ec.globalAlpha = 0.45 + 0.3 * Math.sin(this.t * 4); ec.drawImage(this.circle.ghost, ccx, ccy); }
        if (r.active) {
          ec.globalCompositeOperation = "lighter";
          ec.globalAlpha = 0.35 + 0.25 * Math.sin(this.t * 5);
          ec.drawImage(this.circle.glow, ccx, ccy);
          ec.drawImage(this.circle.glowGap, ccx, ccy);
          ec.globalCompositeOperation = "source-over";
        }
        ec.globalAlpha = 1;
      }
    }
    // ---- rune circles that are props (surface)
    for (const p of area.props) if (p.kind === "runecircle") this.drawSurfaceRune(p, camX, camY);
    // ---- sortables
    type D = { y: number; f: () => void };
    const list: D[] = [];
    const vx0 = camX - 48, vx1 = camX + W + 48, vy0 = camY - 16, vy1 = camY + H + 60;
    for (const p of area.props) {
      if (p.x < vx0 || p.x > vx1 || p.y < vy0 || p.y > vy1) continue;
      if (p.kind === "pedestal") {
        const i = Number(p.id.slice(3));
        list.push({ y: p.y, f: () => this.drawPedestal(p, i, spr, camX, camY) });
        continue;
      }
      const def = propDef(p.kind);
      const alt = def.alt === "lit" ? !!p.lit : def.alt === "taken" ? p.taken : p.open;
      const s = propSprite(p.kind, p.v, alt);
      if (!s) continue;
      list.push({
        y: def.wallMounted ? p.y - 0.5 : def.flat ? p.y - 16 : p.y,
        f: () => {
          if (def.sway && !alt) this.drawSwaying(s, p, camX, camY); else spr(s, p.x, p.y);
          if (p.lit && def.fire) this.drawFlame(p, def.fire.big, camX, camY);
          if (p.item && !p.container && !p.taken && ITEMS[p.item].showOnProp !== false) {
            const ic = itemIcon(p.item);
            const bob = isGlyph(p.item) ? Math.round(Math.sin(this.t * 2) * 0.6) : 0;
            spr(ic, p.x + (def.itemDx ?? 0), p.y - (p.itemZ ?? 8) + bob);
          }
        },
      });
    }
    for (const l of area.loose) {
      if (l.taken || l.x < vx0 || l.x > vx1 || l.y < vy0 || l.y > vy1) continue;
      list.push({ y: l.y, f: () => spr(itemIcon(l.item), l.x, l.y + 2) });
    }
    const AW = area.w;
    const tx0 = Math.max(0, Math.floor(camX / TS) - 1), tx1 = Math.min(AW - 1, Math.floor((camX + W) / TS) + 1);
    const ty0 = Math.max(0, Math.floor(camY / TS) - 1), ty1 = Math.min(area.h - 1, Math.floor((camY + H) / TS) + 3);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = area.grid[ty * AW + tx];
        const x = tx * TS + 8, y = ty * TS + 16;
        if (t === T.RUBBLE) { const s = rubbleSprite(Math.floor(hash2(tx, ty, 5) * 3), false); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.CRACKED) {
          const s = rubbleSprite(0, true);
          list.push({ y, f: () => { spr(s, x, y); if (this.crackFlash > 0) { ec.globalAlpha = this.crackFlash; ec.drawImage(s.e, Math.round(x - s.ax - camX), Math.round(y - s.ay - camY)); ec.globalAlpha = 1; } } });
        }
        else if (t === T.PILLAR) { const s = pillarSprite(area.tvar[ty * AW + tx] === 1); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.LOCKED) { const s = doorSprite(); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.BARS) { const s = barsSprite(); list.push({ y, f: () => spr(s, x, y) }); }
      }
    // NPCs (one generic path: art looked up by NpcDef id)
    for (const a of this.world.actors) {
      if (a.kind !== "npc" || a.area !== area.id || a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
      list.push({ y: a.y, f: () => this.drawNpc(a, camX, camY) });
    }
    // player
    const pl = this.pl;
    if (!this.hideGolem) list.push({ y: pl.y, f: () => this.drawPlayer(camX, camY) });
    // world particles
    for (const p of this.particles) {
      if (p.kind === "debris" || p.kind === "dust" || p.kind === "smoke" || p.kind === "splash") {
        list.push({ y: p.y, f: () => { sc.fillStyle = p.col; const s = p.size; sc.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), s, s); if (p.emit === false) { ec.fillStyle = "#000"; ec.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), s, s); } } });
      }
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    // moonbeam
    const moon = this.view.byId("moon");
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
    const active: Light[] = this.hideGolem ? [] : [this.glight];
    for (const L of this.view.lights.values()) if (L.on) active.push(L);
    this.lighting.accumulate(active, camX, camY);
    this.lighting.compose(sImg.data, eImg.data, this.outImg.data, area.base.ambient ?? [0.05, 0.045, 0.065]);
    this.wctx.putImageData(this.outImg, 0, 0);
  }

  /**
   * The surface rune: mostly eroded and overgrown while dormant, redrawn by the
   * awakening sweep, fully carved and glowing once active. Layers come cached
   * from SurfaceRuneArt (re-rasterised only while the sweep is in progress).
   */
  drawSurfaceRune(p: PropInst, camX: number, camY: number) {
    const st = this.surfaceRuneState();
    const ccx = Math.round(p.x - CR - camX), ccy = Math.round(p.y - CR - camY);
    if (ccx > -140 && ccx < this.vw + 10 && ccy > -140 && ccy < this.vh + 10) {
      const sc = this.scene.ctx, ec = this.emit.ctx;
      const L = this.runeArt.layers(st.t);
      sc.drawImage(L.scene, ccx, ccy);
      if (st.glow > 0) {
        ec.globalAlpha = clamp(st.glow, 0, 1);
        ec.drawImage(L.emit, ccx, ccy);
        if (st.glow > 1) {
          ec.globalCompositeOperation = "lighter";
          ec.globalAlpha = clamp(st.glow - 1, 0, 1);
          ec.drawImage(L.emit, ccx, ccy);
          ec.globalCompositeOperation = "source-over";
        }
        ec.globalAlpha = 1;
      }
    }
    if (st.column > 0) this.drawSummonColumn(p.x - camX, p.y - camY, st.column);
  }

  /** The summoning beam: a shimmering column of light rising from the dais (emissive only). */
  drawSummonColumn(x: number, y: number, k: number) {
    const ec = this.emit.ctx;
    x = Math.round(x); y = Math.round(y);
    const w = Math.round(3 + 7 * k);
    ec.globalCompositeOperation = "lighter";
    for (let yy = y + 4; yy > -2; yy -= 2) {
      const f = 1 - ((y - yy) / Math.max(1, y + 2)) * 0.6;
      const wob = Math.round(Math.sin(yy * 0.21 + this.t * 9) * k);
      ec.globalAlpha = clamp(k * f * 0.5, 0, 1); ec.fillStyle = "#9a70ff"; ec.fillRect(x - w + wob, yy - 2, w * 2, 2);
      ec.globalAlpha = clamp(k * f, 0, 1); ec.fillStyle = "#e8e0ff"; ec.fillRect(x - 1 + wob, yy - 2, 2 + Math.round(k * 2), 2);
    }
    ec.globalAlpha = clamp(k * 0.6, 0, 1); ec.fillStyle = "#c0a0ff"; ec.fillRect(x - 14, y - 3, 28, 8);
    ec.globalAlpha = 1;
    ec.globalCompositeOperation = "source-over";
  }

  /** Foliage in the wind: the upper part of the sprite shifts by a pixel now and then. */
  drawSwaying(s: Sprite, p: PropInst, camX: number, camY: number) {
    const dx = Math.round(p.x - s.ax - camX), dy = Math.round(p.y - s.ay - camY);
    if (dx > this.vw || dy > this.vh || dx + s.w < 0 || dy + s.h < 0) return;
    const sc = this.scene.ctx, ec = this.emit.ctx;
    const wv = Math.sin(this.t * 1.6 + p.x * 0.031 + p.y * 0.017) + 0.4 * Math.sin(this.t * 3.7 + p.x * 0.11);
    const o = Math.round(wv * 0.75);
    if (!o) { sc.drawImage(s.a, dx, dy); ec.drawImage(s.e, dx, dy); return; }
    const cut = Math.floor(s.h * 0.55);
    for (const [src, ctx] of [[s.a, sc], [s.e, ec]] as const) {
      ctx.drawImage(src, 0, 0, s.w, cut, dx + o, dy, s.w, cut);
      ctx.drawImage(src, 0, cut, s.w, s.h - cut, dx, dy + cut, s.w, s.h - cut);
    }
  }

  drawFlame(p: PropInst, big: boolean, camX: number, camY: number) {
    const ec = this.emit.ctx;
    const bx = Math.round(p.x - camX), by = Math.round(p.y - camY - 15);
    const t = this.t * 12 + p.x;
    const cols = ["#ff5a10", "#ff9a30", "#ffd060", "#fff0b0"];
    const w = big ? 8 : 3;
    for (let i = 0; i < w; i++) {
      const hgt = Math.max(1, Math.round((big ? 7 : 4) * (1 - Math.abs(i - (w - 1) / 2) / w) + Math.sin(t + i * 1.7) * 1.5 + Math.sin(t * 1.7 + i) * 0.8));
      for (let j = 0; j < hgt; j++) {
        const k = Math.min(3, Math.floor((j / hgt) * 4));
        ec.fillStyle = cols[3 - k];
        if (j === hgt - 1) ec.fillStyle = cols[0];
        ec.fillRect(bx - Math.floor(w / 2) + i, by - j + (big ? 2 : 0), 1, 1);
      }
    }
  }

  drawPedestal(p: PropInst, i: number, spr: (s: Sprite, x: number, y: number) => void, camX: number, camY: number) {
    const s = propSprite("pedestal", 0, false)!;
    spr(s, p.x, p.y);
    const area = this.area, r = area.ritual!;
    const g = r.sockets[i];
    const ec = this.emit.ctx;
    const topY = p.y - 15;
    if (g >= 0) {
      spr(itemIcon(glyphItem(g)), p.x, topY + 4);
      if (r.active) {
        const pen = new Pen(ec, true);
        glyphPattern(pen, g, Math.round(p.x - camX) - 4, Math.round(topY - camY) - 7, GLYPHS[g].color, true);
      }
      if (r.wrong[i] && this.fizzT > 0 && Math.sin(this.t * 30) > 0) {
        ec.fillStyle = "#ff2040";
        ec.globalAlpha = 0.6;
        ec.fillRect(Math.round(p.x - camX) - 6, Math.round(topY - camY) - 8, 12, 12);
        ec.globalAlpha = 1;
      }
    }
    if (hasFlag(this.world, FLAGS.knowSchematic) && g !== r.solution[i] && !r.active) {
      const pen = new Pen(ec, true);
      ec.globalAlpha = 0.35 + 0.2 * Math.sin(this.t * 3 + i);
      const bob = Math.round(Math.sin(this.t * 2 + i) * 1.5);
      glyphPattern(pen, r.solution[i], Math.round(p.x - camX) - 3, Math.round(topY - camY) - 16 + bob - (g >= 0 ? 4 : 0), GLYPHS[r.solution[i]].color, true);
      ec.globalAlpha = 1;
    }
    if (i === 0 && r.core) {
      // core floating above center
      const c = area.ritualPos;
      const bob = Math.round(Math.sin(this.t * 2) * 1.5) + (r.active ? -3 : 0);
      spr(itemIcon("core"), c.x, c.y - 4 + bob);
    }
  }

  drawPlayer(camX: number, camY: number) {
    const pl = this.pl, lk = this.look, sc = this.scene.ctx;
    // shadow
    sc.fillStyle = "rgba(0,0,0,0.45)";
    const sx = Math.round(pl.x - camX), sy = Math.round(pl.y - camY);
    const sw = Math.max(4, 8 - Math.round(lk.z / 3));
    sc.fillRect(sx - sw, sy - 1, sw * 2, 2);
    sc.fillRect(sx - sw + 2, sy - 2, sw * 2 - 4, 4);
    const a = pl.task;
    let raise = 0, reach = 0;
    if (a) {
      const k = a.t / a.dur;
      if (a.kind === "reach" || a.kind === "push" || a.kind === "dismantle") reach = Math.sin(Math.min(1, k) * Math.PI);
      if (a.kind === "smash") raise = a.t < 0.5 ? a.t / 0.5 : a.t < 0.62 ? lerp(1, -1, (a.t - 0.5) / 0.12) : lerp(-1, 0, clamp((a.t - 0.62) / 0.5, 0, 1));
      if (a.kind === "carve") reach = 0.4 + 0.6 * Math.abs(Math.sin(a.t * 14));
      if (a.kind === "attach") reach = 0.3;
      if (a.kind === "punch") { const k2 = a.t / a.dur; raise = k2 < 0.35 ? k2 / 0.35 : k2 < 0.5 ? lerp(1, -1, (k2 - 0.35) / 0.15) : lerp(-1, 0, clamp((k2 - 0.5) / 0.4, 0, 1)); }
      if (a.kind === "channel") reach = 0.2;
    }
    const pose: GolemPose = {
      facing: pl.facing, phase: pl.phase, moving: pl.moving && !a, hasArm: this.hasArm, dormant: lk.dormant,
      eye: clamp(lk.eye + this.eyeBoost, 0, 1.6), core: lk.core, raise, reach, t: this.t,
      eyeFixed: hasFlag(this.world, FLAGS.golemEye),
    };
    const ox = pl.x - camX + (a?.kind === "push" ? Math.round(Math.sin(a.t * 40)) : 0), oy = pl.y - camY - lk.z;
    drawGolem(new Pen(sc, false), ox, oy, pose);
    drawGolem(new Pen(this.emit.ctx, true), ox, oy, pose);
  }

  // ---------------------------------------------------------------- NPCs
  /** Presentation state for an NPC actor, created from its sim state (so a loaded world looks right at once). */
  npcLook(a: Actor): NpcLook {
    let L = this.npcLooks.get(a.id);
    if (!L) {
      const on = isAwake(this.world, a.id) ? 1 : 0;
      L = { awake: on, eye: on, wakeT: 99, sleepT: 99, reach: 0, flare: 0 };
      this.npcLooks.set(a.id, L);
    }
    return L;
  }

  /** Ease every NPC in view toward its sim state: wake sputter, straighten, dim and slump. Drives its eye light. */
  updateNpcLooks(dt: number) {
    const area = this.area;
    for (const a of this.world.actors) {
      if (a.kind !== "npc" || a.area !== area.id) continue;
      const def = npcDef(a.npc);
      if (!def) continue;
      const L = this.npcLook(a), on = isAwake(this.world, a.id);
      L.wakeT += dt; L.sleepT += dt;
      // awake: the eye sputters on first, then it straightens; dormant: the eye dims, then it slumps
      const target = on ? (L.wakeT > 0.6 ? 1 : 0) : (L.sleepT > 0.7 ? 0 : 1);
      L.awake += clamp(target - L.awake, -dt / 1.1, dt / 1.1);
      if (on) L.eye = L.wakeT < 0.9 ? (Math.random() < 0.45 + L.wakeT * 0.5 ? 1 : 0.12) : 1;
      else L.eye = Math.max(0, Math.min(L.eye, 1 - L.sleepT / 1.2));
      if (on && L.wakeT < 0.05) L.flare = 0.8;
      L.flare = Math.max(0, L.flare - dt * 1.5);
      L.reach = Math.max(0, L.reach - dt * 0.7);
      const el = def.eyeLight;
      if (el) {
        const lt = this.view.dynamicLight("npc:" + a.id, () => makeLight(a.x + el.dx, a.y + el.dy, el.rad, el.col, 0, 0.05, "npc:" + a.id));
        lt.int = L.eye * 0.42 + L.flare * 0.5 + (L.reach > 0.8 ? 0.25 : 0);
      }
    }
  }

  npcSparks(a: Actor, n: number) {
    for (let i = 0; i < n; i++)
      this.spawn({ x: a.x + (Math.random() - 0.5) * 16, y: a.y - 2, z: 18 + Math.random() * 14, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 10 + Math.random() * 30, life: 0.3 + Math.random() * 0.4, kind: "spark", col: Math.random() < 0.5 ? "#fff2a0" : "#7fe8ff", emit: true, g: 120 });
  }
  npcDust(a: Actor) {
    for (let i = 0; i < 12; i++)
      this.spawn({ x: a.x + (Math.random() - 0.5) * 26, y: a.y, z: 2 + Math.random() * 6, vx: (Math.random() - 0.5) * 24, vz: 6 + Math.random() * 8, life: 1, kind: "dust", col: "#8a8478", g: 14 });
  }

  /** Draw any NPC: shadow, then its NPC_ART entry (albedo + emissive passes), looked up by NpcDef id. */
  drawNpc(a: Actor, camX: number, camY: number) {
    const def = npcDef(a.npc), art = def && NPC_ART[def.art];
    if (!def || !art) return;
    const L = this.npcLook(a), sc = this.scene.ctx;
    const x = Math.round(a.x - camX), y = Math.round(a.y - camY);
    const hw = Math.round(def.box[0] / 2) + 2;
    sc.fillStyle = "rgba(0,0,0,0.45)";
    sc.fillRect(x - hw, y - 1, hw * 2, 2);
    sc.fillRect(x - hw + 3, y - 3, hw * 2 - 6, 4);
    const ease = (v: number) => v * v * (3 - 2 * v);
    const pose: NpcPose = { facing: a.facing, awake: ease(clamp(L.awake, 0, 1)), eye: L.eye + L.flare, reach: clamp(L.reach, 0, 1), t: this.t };
    art(new Pen(sc, false), x, y, pose);
    art(new Pen(this.emit.ctx, true), x, y, pose);
  }

  renderHud() {
    const ctx = this.ctx;
    // interaction marker (world space: drawn on the world layer)
    if (this.screens.is("play") && this.target) {
      const ctx = this.wctx;
      const it = this.target;
      const x = Math.round(it.x - this.cam.x), y = Math.round(it.y - this.cam.y - (it.itemZ ?? 10) - 14 + Math.sin(this.t * 4) * 1.5);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x - 3, y, 7, 1); ctx.fillRect(x - 2, y + 1, 5, 1); ctx.fillRect(x - 1, y + 2, 3, 1);
      ctx.fillStyle = "#d8cfa8";
      ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y + 1, 1, 1);
    }
    if (this.arriveFade > 0) { ctx.fillStyle = `rgba(235,240,255,${this.arriveFade})`; ctx.fillRect(0, 0, W, H); }
    if (this.screens.is("play")) this.renderNote();
    // debug message
    if (this.debugMsg) {
      ctx.globalAlpha = clamp(2 - this.debugMsg.t, 0, 1);
      drawTextS(ctx, this.debugMsg.text, W / 2, 6, "#ff9a5a", 1, "center");
      ctx.globalAlpha = 1;
    }
    // toast (the dialogue box draws it above itself)
    if (!this.screens.is("schem") && !this.screens.is("dialogue")) this.renderToast(H - 26);
  }

  renderToast(y: number) {
    const ctx = this.ctx;
    if (this.toast) {
      const t = this.toast.t;
      const a = t < 0.2 ? t / 0.2 : t > 2.5 ? 1 - (t - 2.5) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      const name = this.toast.name;
      const w = name.length * 4 + 30;
      const x = Math.round(W / 2 - w / 2);
      ctx.fillStyle = "#0c0a0e"; ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = "#3a3540"; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + 19, w, 1); ctx.fillRect(x, y, 1, 20); ctx.fillRect(x + w - 1, y, 1, 20);
      ctx.drawImage(this.toast.icon.a, x + 3, y + 2);
      drawText(ctx, name, x + 23, y + 8, "#d8d0b8");
      ctx.globalAlpha = 1;
    }
  }
}

