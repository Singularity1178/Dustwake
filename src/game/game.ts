// Host + presentation. Owns the canvas, input, screens, camera, particles,
// audio and rendering. It never mutates the World directly except through sim
// entry points; it reacts to the World's events for sound and particles.
import { TS, T } from "./content/tiles";
import { ITEMS, ITEM_NAMES, RELICS, isGlyph, glyphItem, type ItemId } from "./content/items";
import { RECIPES } from "./content/build";
import { capacity, countItem, hasItem, addItems } from "./sim/inventory";
import { dropFromSlot, orderBuild, readItem } from "./sim/commands";
import { placement, frontTile, buildAnchor, BLOCK_TEXT } from "./sim/build";
import { BUILD_REACH } from "./content/build";
import { propDef } from "./content/props";
import { GLYPHS } from "./content/glyphs";
import { FLAGS } from "./content/flags";
import { propSprite, rubbleSprite, pillarSprite, doorSprite, barsSprite, itemIcon, glyphPattern } from "./art";
import { makeCanvas, Pen, Sprite, hash2, clamp, lerp, makeSprite } from "./util";
import { drawGolem, GolemPose } from "./golem";
import { Light, makeLight, computeVis, Lighting } from "./light";
import { Sfx } from "./audio";
import { buildCircle, CircleArt, CR } from "./circle";
import { SurfaceRuneArt } from "./surfaceRune";
import { carvingVisible, clumpCleared } from "./runeReveal";
import { RUNE_NODES } from "./content/runes";
import { buildSchematic, PLAN_X, PLAN_Y, PLAN_S } from "./schematic";
import { drawText, drawTextS, textWidth } from "./font";
import { createWorld, player, currentArea, hasFlag, setFlag, getArea, type World, type SimEvent } from "./world/world";
import type { PropInst } from "./world/area";
import { stepPlayer, stepWorld, addPlayTime } from "./sim/step";
import { interactables, type Interactable } from "./sim/interact";
import { placeGlyph } from "./sim/ritual";
import { AreaView } from "./view/areaView";
import { ScreenStack, type Screen } from "./ui/screens";
import { BASE_W, BASE_H, ZOOM_STEPS, ZOOM_DEFAULT, viewSize, nextZoomStep } from "./view/zoom";
import { npcDef } from "./content/npcs";
import { NPC_ART, type NpcPose } from "./npcArt";
import { DIALOGUE, type DialoguePage, type DialogueSegment } from "./content/dialogue";
import { dialogueBeat, finishSegment, segmentPages, isAwake, npcActor } from "./sim/dialogue";
import type { Actor } from "./world/world";

/** Debug super-speed multiplier. 200% faster = base + 2x base = 3x. */
const DEBUG_SPEED_MULT = 3;

/** Base logical size. HUD and overlay screens are laid out for it (they draw on a base-size UI layer). */
export const W = BASE_W, H = BASE_H;
export { ZOOM_STEPS, ZOOM_DEFAULT, viewSize };

/** Seconds a beat holds the page before its text starts typing (presentation timing only). */
const BEAT_HOLD: Record<string, number> = { wake: 1.4, pause: 1.2, repairEye: 1.6, giveCore: 0.5 };

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
  /** The open dialogue (presentation cursor only; progress lives in flags). */
  dlg: { npc: string; seg: DialogueSegment; pages: DialoguePage[]; page: number; chars: number; hold: number } | null = null;
  /** Show the zoom hint when the dialogue closes (after the eye repair). */
  zoomHint = false;
  sfx = new Sfx();
  circle: CircleArt = buildCircle();
  shaft: Sprite;

  world!: World;
  view!: AreaView;
  schemCanvas: HTMLCanvasElement | null = null;
  screens = new ScreenStack();
  /** Real (presentation) clock: animations run on it even while the world is paused. */
  t = 0;
  particles: Particle[] = [];
  invCursor = 0;
  invMode: "view" | "select" = "view";
  selSocket = -1;
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
  private S!: Record<"title" | "intro" | "play" | "tele" | "end" | "arrive" | "inv" | "schem" | "book" | "build" | "dialogue", Screen>;
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
  buildCur = { tx: 0, ty: 0 };
  buildRecipe = "torch";
  book: { id: ItemId; page: number } | null = null;

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
    const dg = getArea(world, "dungeon");
    this.schemCanvas = dg.ritual ? buildSchematic(dg.base, dg.ritual.solution) : null;
    const pl = player(world);
    this.glight = makeLight(pl.x, pl.y - 6, 108, [1, 0.78, 0.5], 0, 0.05, "golem");
    this.dripT = area.drips.map(() => Math.random() * 4);
    this.look = { eye: 0, core: 0, dormant: 1, sparkT: 1.5, sputter: 0, z: 0 };
    // Zoom is not saved: a world with a mended eye starts at the default zoomed-out view.
    this.zoomAnim = null;
    this.setZoom(hasFlag(world, FLAGS.golemEye) ? ZOOM_DEFAULT : 1);
    this.cam.x = pl.x - this.vw / 2; this.cam.y = pl.y - this.vh / 2 - 10;
    this.npcLooks.clear();
    this.dlg = null; this.zoomHint = false;
    this.invCursor = 0;
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
    k = k.toLowerCase();
    if (!this.keys.has(k)) this.pressed.add(k);
    this.keys.add(k);
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
      // Surface testing: building knowledge, basket, and a pile of materials.
      setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.golemBasket);
      addItems(w, pl, "wood", 20); addItems(w, pl, "stone", 20);
      say("DEBUG: BUILD + BASKET + MATERIALS");
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
    this.S = {
      title: scr("title", true, (dt) => {
        if (g.pressed.size) { g.sfx.init(); g.screens.set(g.S.intro); }
        if (Math.random() < 0.3) g.spawn({ x: Math.random() * W, y: H + 2, vy: -10 - Math.random() * 12, vx: (Math.random() - 0.5) * 4, life: 6, kind: "ember", col: Math.random() < 0.5 ? "#ff8a3a" : "#c84a10", emit: true });
        g.updateParticles(dt);
      }, () => g.renderTitle()),
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
      book: scr("book", false, () => g.updateBook(), () => g.renderBook()),
      build: scr("build", false, () => g.updateBuild(), () => g.renderBuild()),
      dialogue: scr("dialogue", false, (dt) => g.updateDialogue(dt), () => g.renderDialogue()),
      end: scr("end", true, (dt) => {
        const et = g.S.end.t;
        if (et > 5 && g.hit("r")) { g.reset(); g.screens.set(g.S.intro); }
        else if ((et > 5 && g.pressed.size) || et > 14) { g.particles = []; g.screens.set(g.S.arrive); }
        if (Math.random() < 0.2) g.spawn({ x: Math.random() * W, y: H * 0.4 + Math.random() * 60, vy: -3, vx: 4, life: 5, kind: "mote", col: "#ffd8a0", emit: true });
        g.updateParticles(dt);
      }, () => g.renderEnd()),
      inv: scr("inv", false, () => g.updateInv(), () => g.renderInv()),
      schem: scr("schem", false, () => {
        if (g.S.schem.t > 0.4 && g.hit("e", "escape", "enter", " ", "m", "i", "tab", "click")) {
          g.screens.popToBase();
          if (!hasFlag(g.world, FLAGS.tutorialInsight)) {
            setFlag(g.world, FLAGS.tutorialInsight);
            g.sfx.insight();
            g.eyeBoost = 1.5;
          }
        }
      }, () => g.renderSchem()),
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
  }

  /** One frame of world simulation plus its presentation. */
  private worldFrame(dt: number) {
    stepWorld(this.world, dt);
    this.drainEvents();
    this.syncView();
    if (this.view.flush()) this.glight.vx = -999;
    this.updateWorldFx(dt);
  }

  private drainEvents() {
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
        if (def.opensOnPickup) this.later(0.5, () => { if (this.screens.is("play")) def.opens === "book" ? this.openBook(id) : this.openSchem(); });
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
        this.say("YOU LEARNED " + ({ [FLAGS.knowBuild]: "THE ART OF BUILDING", [FLAGS.knowRepair]: "THE ART OF MENDING" }[e.flag] ?? e.flag));
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
        if (this.screens.is("play")) this.openDialogue(e.npc, e.script, e.segment);
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
        this.zoomHint = true;
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
    // overlays
    if (!pl.task) {
      if (this.hit("i", "tab")) { this.openInv("view"); return this.worldFrame(dt); }
      if (this.hit("m") && hasItem(pl, "schematic")) { this.openSchem(); return this.worldFrame(dt); }
      if (this.hit("b")) { this.openBuild(); return this.worldFrame(dt); }
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
    if (res.ui) this.openInv("select", res.ui.socket);
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

  // ---------------------------------------------------------------- inventory
  get cap() { return capacity(this.world, this.pl); }
  /** Pack grid layout per capacity tier: stays readable at 8, 16 and 48 slots without scrolling. */
  invLayout(cap: number) {
    const L = cap <= 8 ? { cols: 4, pitch: 30, cell: 26 } : cap <= 16 ? { cols: 4, pitch: 26, cell: 24 } : { cols: 8, pitch: 19, cell: 18 };
    const rows = Math.ceil(cap / L.cols);
    const gw = L.cols * L.pitch - (L.pitch - L.cell), gh = rows * L.pitch - (L.pitch - L.cell);
    const pw = 100 + gw + 10, ph = Math.max(132, gh + 46);
    return { ...L, rows, gw, gh, pw, ph, px: Math.floor((W - pw) / 2), py: Math.floor((H - ph) / 2) };
  }
  say(text: string) { this.note = { text, t: 0 }; }
  openInv(mode: "view" | "select", sock = -1) {
    this.screens.push(this.S.inv);
    this.invMode = mode;
    this.selSocket = sock;
    if (mode === "select") {
      const i = this.pl.inventory.findIndex((s) => s && isGlyph(s.item));
      this.invCursor = Math.max(0, i);
    }
    this.invCursor = clamp(this.invCursor, 0, this.cap - 1);
    this.sfx.tone(300, 0.08, "triangle", 0.05);
  }
  openSchem() {
    this.screens.popToBase();
    this.screens.push(this.S.schem);
    setFlag(this.world, FLAGS.knowSchematic);
    this.sfx.noise(0.4, 0.12, "bandpass", 2500, 1, 0, 800);
  }
  updateInv() {
    if (this.hit("escape", "i", "tab")) { this.screens.popToBase(); return; }
    const cap = this.cap, cols = this.invLayout(cap).cols;
    const c = clamp(this.invCursor, 0, cap - 1);
    let n = c;
    if (this.hit("arrowleft", "a")) n = (c + cap - 1) % cap;
    if (this.hit("arrowright", "d")) n = (c + 1) % cap;
    if (this.hit("arrowup", "w")) n = (c - cols + cap) % cap;
    if (this.hit("arrowdown", "s")) n = (c + cols) % cap;
    this.invCursor = n;
    if (n !== c) this.sfx.tone(500, 0.04, "square", 0.02);
    const slot = this.pl.inventory[this.invCursor];
    if (this.hit("q") && this.invMode === "view") {
      if (!slot) return;
      const r = dropFromSlot(this.world, this.pl, this.invCursor, 1);
      if (r !== "ok") this.sfx.thud();
      this.drainEvents();
      return;
    }
    if (this.hit("e", "enter", " ")) {
      if (!slot) return;
      const id = slot.item;
      if (this.invMode === "select") {
        if (isGlyph(id)) {
          this.screens.popToBase();
          placeGlyph(this.world, this.pl, this.area, this.selSocket, ITEMS[id].glyph!);
          this.drainEvents();
        } else this.sfx.thud();
      } else if (ITEMS[id].opens === "schematic") this.openSchem();
      else if (ITEMS[id].opens === "book") this.openBook(id);
      else this.sfx.tone(180, 0.1, "square", 0.04);
    }
  }

  // ---------------------------------------------------------------- books
  openBook(id: ItemId) {
    this.screens.popToBase();
    this.book = { id, page: 0 };
    this.screens.push(this.S.book);
    readItem(this.world, this.pl, id);
    this.sfx.noise(0.3, 0.1, "bandpass", 2000, 1, 0, 600);
  }
  updateBook() {
    const b = this.book, pages = b ? ITEMS[b.id].book?.pages ?? [] : [];
    if (!b || this.hit("escape", "i", "tab")) { this.screens.popToBase(); this.drainEvents(); return; }
    if (this.S.book.t < 0.3) return;
    if (this.hit("arrowleft", "a") && b.page > 0) { b.page--; this.sfx.noise(0.15, 0.06, "bandpass", 2200, 1, 0, 600); }
    if (this.hit("arrowright", "d", "e", "enter", " ")) {
      if (b.page < pages.length - 1) { b.page++; this.sfx.noise(0.15, 0.06, "bandpass", 2200, 1, 0, 600); }
      else if (this.hit("e", "enter", " ")) { this.screens.popToBase(); this.drainEvents(); }
    }
  }
  renderBook() {
    const ctx = this.ctx, b = this.book;
    if (!b) return;
    const def = ITEMS[b.id].book!;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, W, H);
    const x = 50, y = 22, w = 220, h = 136;
    ctx.fillStyle = "#2a1a0c"; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = "#d8ccb0"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#b8ac90"; ctx.fillRect(x + w / 2, y, 1, h);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = "#c8bc9e"; ctx.fillRect(x + ((hash2(i, 1, 9) * w) | 0), y + ((hash2(i, 2, 9) * h) | 0), 2, 1); }
    drawText(ctx, def.title, x + w / 2, y + 10, "#4a2a10", 1, "center");
    const lines = def.pages[b.page] ?? [];
    lines.forEach((l, i) => drawText(ctx, l, x + w / 2, y + 34 + i * 14, "#3a2a1a", 1, "center"));
    drawText(ctx, `${b.page + 1}/${def.pages.length}`, x + w / 2, y + h - 22, "#7a6a50", 1, "center");
    drawText(ctx, b.page < def.pages.length - 1 ? "E NEXT PAGE   ESC CLOSE" : "E CLOSE", x + w / 2, y + h - 12, "#7a6a50", 1, "center");
    this.renderNote();
  }

  // ---------------------------------------------------------------- building
  openBuild() {
    if (!hasFlag(this.world, FLAGS.knowBuild)) { this.say("YOU DON'T KNOW HOW TO BUILD. PERHAPS A BOOK..."); this.sfx.thud(); return; }
    this.buildCur = frontTile(this.pl);
    this.screens.push(this.S.build);
    this.sfx.tone(360, 0.08, "triangle", 0.05);
  }
  updateBuild() {
    if (this.hit("escape", "b", "i", "tab")) { this.screens.popToBase(); return; }
    const pl = this.pl, c = this.buildCur;
    const atx = Math.floor(pl.x / TS), aty = Math.floor((pl.y - 3) / TS);
    const mv = (dx: number, dy: number) => {
      c.tx = clamp(c.tx + dx, atx - BUILD_REACH, atx + BUILD_REACH); c.ty = clamp(c.ty + dy, aty - BUILD_REACH, aty + BUILD_REACH);
      this.sfx.tone(500, 0.03, "square", 0.02);
    };
    if (this.hit("arrowleft", "a")) mv(-1, 0);
    if (this.hit("arrowright", "d")) mv(1, 0);
    if (this.hit("arrowup", "w")) mv(0, -1);
    if (this.hit("arrowdown", "s")) mv(0, 1);
    if (this.hit("e", "enter", " ")) {
      if (orderBuild(this.world, pl, this.buildRecipe, c.tx, c.ty)) this.screens.popToBase();
      else this.sfx.thud();
      this.drainEvents();
    }
  }
  renderBuild() {
    const c = this.buildCur, r = RECIPES[this.buildRecipe];
    let ctx = this.wctx; // the ghost is in world space
    const ok = placement(this.world, this.pl, this.area, this.buildRecipe, c.tx, c.ty);
    const camX = Math.round(this.cam.x), camY = Math.round(this.cam.y);
    const x = c.tx * TS - camX, y = c.ty * TS - camY;
    const pulse = 0.25 + 0.12 * Math.sin(this.t * 6);
    ctx.fillStyle = ok.ok ? `rgba(90,220,120,${pulse})` : `rgba(230,70,70,${pulse})`;
    ctx.fillRect(x, y, TS, TS);
    ctx.fillStyle = ok.ok ? "#7ae08a" : "#e05a5a";
    ctx.fillRect(x, y, TS, 1); ctx.fillRect(x, y + TS - 1, TS, 1); ctx.fillRect(x, y, 1, TS); ctx.fillRect(x + TS - 1, y, 1, TS);
    const s = propSprite(r.prop, 0, true);
    if (s) { const a = buildAnchor(c.tx, c.ty); ctx.globalAlpha = 0.6; ctx.drawImage(s.a, Math.round(a.x - s.ax - camX), Math.round(a.y - s.ay - camY)); ctx.globalAlpha = 1; }
    ctx = this.ctx; // the bar is UI
    ctx.fillStyle = "rgba(8,7,10,0.85)"; ctx.fillRect(0, 0, W, 22);
    const cost = r.cost.map((k) => `${k.n} ${ITEM_NAMES[k.item]} (${countItem(this.pl, k.item)})`).join("  ");
    drawText(ctx, `BUILD ${r.name}: ${cost}`, W / 2, 3, "#e8d8b0", 1, "center");
    drawText(ctx, ok.ok ? "E PLACE   ARROWS MOVE   ESC CANCEL" : BLOCK_TEXT[ok.reason], W / 2, 12, ok.ok ? "#8a8392" : "#e08a7a", 1, "center");
    this.renderNote();
  }

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
      if (a.kind === "reach" || a.kind === "push") reach = Math.sin(Math.min(1, k) * Math.PI);
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

  // ---------------------------------------------------------------- dialogue
  // A non-opaque overlay: the world pauses beneath it (no stepWorld) while
  // presentation keeps animating. Every state change is a sim command
  // (dialogueBeat / finishSegment); this screen only holds a page cursor.
  openDialogue(npc: string, script: string, segment: string) {
    const seg = DIALOGUE[script]?.segments.find((s) => s.id === segment);
    if (!seg) return;
    this.dlg = { npc, seg, pages: [], page: 0, chars: 0, hold: 0 };
    this.screens.push(this.S.dialogue);
    this.startSegment(seg);
  }
  private startSegment(seg: DialogueSegment) {
    const d = this.dlg!;
    d.seg = seg;
    d.pages = segmentPages(this.world, this.pl, seg);
    if (!d.pages.length) { this.advanceSegment(); return; }
    this.startPage(0);
  }
  private startPage(i: number) {
    const d = this.dlg!, p = d.pages[i];
    d.page = i; d.chars = 0; d.hold = 0;
    if (p.beat) {
      dialogueBeat(this.world, this.pl, d.npc, d.seg.id, p.beat);
      this.drainEvents();
      d.hold = BEAT_HOLD[p.beat] ?? 0;
    }
  }
  private advanceSegment() {
    const d = this.dlg!;
    const next = finishSegment(this.world, this.pl, d.npc, d.seg.id);
    this.drainEvents();
    if (next && this.dlg) this.startSegment(next);
    else this.closeDialogue();
  }
  closeDialogue() {
    this.dlg = null;
    if (this.screens.is("dialogue")) this.screens.popToBase();
    if (this.zoomHint) { this.zoomHint = false; this.say("(SCROLL TO ZOOM)"); }
  }
  updateDialogue(dt: number) {
    this.updateWorldFx(dt);
    const d = this.dlg;
    if (!d) { this.screens.popToBase(); return; }
    // Esc leaves; progress is in flags, so the next talk resumes at the first unfinished segment.
    if (this.hit("escape")) { this.closeDialogue(); return; }
    if (d.hold > 0) { d.hold -= dt; return; }
    const p = d.pages[d.page];
    const total = p.lines.reduce((n, l) => n + l.length, 0);
    if (d.chars < total) {
      const before = Math.floor(d.chars);
      d.chars = Math.min(total, d.chars + dt * 42);
      const flat = p.lines.join("");
      for (let i = before; i < Math.floor(d.chars); i++) if (flat[i] !== " " && i % 2 === 0) { this.sfx.blip(); break; }
    }
    if (this.S.dialogue.t > 0.15 && this.hit("e", "enter", " ")) {
      if (d.chars < total) { d.chars = total; return; }
      if (p.then) { dialogueBeat(this.world, this.pl, d.npc, d.seg.id, p.then); this.drainEvents(); }
      if (!this.dlg) return;
      if (d.page + 1 < d.pages.length) { this.startPage(d.page + 1); this.sfx.tone(240, 0.04, "triangle", 0.02); }
      else this.advanceSegment();
    }
  }
  renderDialogue() {
    const d = this.dlg;
    if (!d) return;
    const ctx = this.ctx, p = d.pages[d.page];
    const npc = npcActor(this.world, d.npc);
    const name = p.speaker ?? npcDef(npc?.npc)?.name ?? "";
    const bx = 14, bw = W - 28, bh = 54, by = H - bh - 6;
    this.renderToast(by - 24);
    // box
    ctx.fillStyle = "#08070a"; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = "#3a3540"; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#4e4856"; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by, 1, bh);
    ctx.fillStyle = "rgba(14,12,18,0.94)"; ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
    for (const [cx, cy] of [[bx + 3, by + 3], [bx + bw - 5, by + 3], [bx + 3, by + bh - 5], [bx + bw - 5, by + bh - 5]]) { ctx.fillStyle = "#6a6372"; ctx.fillRect(cx, cy, 2, 2); }
    // speaker tag, trimmed in the guardian's rank gold
    const tw = textWidth(name) + 10;
    ctx.fillStyle = "#08070a"; ctx.fillRect(bx + 7, by - 9, tw + 2, 10);
    ctx.fillStyle = "#2a2430"; ctx.fillRect(bx + 8, by - 8, tw, 8);
    ctx.fillStyle = "#7a5a1c"; ctx.fillRect(bx + 8, by - 8, tw, 1);
    drawText(ctx, name, bx + 13, by - 6, "#e0c060");
    // typewriter text
    let left = Math.floor(d.chars);
    p.lines.forEach((line, i) => {
      const n = Math.max(0, Math.min(line.length, left));
      left -= line.length;
      if (n > 0) drawTextS(ctx, line.slice(0, n), bx + 10, by + 8 + i * 10, "#e8dcc0", 1, "left", "#000");
    });
    const total = p.lines.reduce((n, l) => n + l.length, 0);
    if (d.hold <= 0 && d.chars >= total && Math.sin(this.t * 6) > -0.3) {
      const last = d.page === d.pages.length - 1;
      drawText(ctx, last ? "E" : "E >", bx + bw - 8, by + bh - 9, "#8a8392", 1, "right");
    }
    drawText(ctx, "ESC LEAVE", bx + 10, by + bh - 9, "#4e4856");
    this.renderNote(by - 36);
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

  renderInv() {
    const ctx = this.ctx, inv = this.pl.inventory, hasArm = this.hasArm, cap = this.cap;
    const L = this.invLayout(cap), { px, py, pw, ph } = L;
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H);
    const frame = (x: number, y: number, w: number, h: number, fill: string, edge = "#3a3540", hi = "#4e4856") => {
      ctx.fillStyle = "#08070a"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = edge; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = hi; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = fill; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    };
    frame(px, py, pw, ph, "#141117");
    for (const [cx, cy] of [[px + 3, py + 3], [px + pw - 5, py + 3], [px + 3, py + ph - 5], [px + pw - 5, py + ph - 5]]) { ctx.fillStyle = "#6a6372"; ctx.fillRect(cx, cy, 2, 2); }
    // golem figure
    const fy = py + Math.floor((ph - 116) / 2);
    frame(px + 8, fy, 80, 116, "#0e0c10");
    const fig = makeCanvas(40, 40);
    const pose: GolemPose = { facing: "down", phase: 0, moving: false, hasArm, dormant: 0, eye: 1, core: 0.8 + 0.2 * Math.sin(this.t * 3), raise: 0, reach: 0, t: this.t };
    drawGolem(new Pen(fig.ctx, false), 20, 34, pose);
    ctx.drawImage(fig.c, px + 8, fy + 14, 80, 80);
    if (!hasArm && Math.sin(this.t * 4) > -0.2) {
      ctx.fillStyle = "#8a4040";
      const ax = px + 8 + (20 + 6) * 2, ay = fy + 14 + (34 - 13) * 2;
      for (let i = 0; i < 20; i += 2) { ctx.fillRect(ax + i % 8, ay, 1, 1); ctx.fillRect(ax, ay + i, 1, 1); ctx.fillRect(ax + 8, ay + i, 1, 1); ctx.fillRect(ax + (i % 8), ay + 20, 1, 1); }
    }
    if (hasFlag(this.world, FLAGS.golemBasket)) ctx.drawImage(itemIcon("basket").a, px + 66, fy + 4);
    // relics
    const rel = RELICS.filter((r) => hasItem(this.pl, r)).length;
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < rel ? "#c9a040" : "#2a2630";
      ctx.fillRect(px + 34 + i * 6, fy + 106, 4, 4);
    }
    // header
    const gx = px + 100, gy = py + 16;
    const used = inv.slice(0, cap).filter(Boolean).length;
    drawText(ctx, `PACK ${used}/${cap}`, gx, py + 6, "#8a8392");
    if (this.invMode === "select") {
      const s = propSprite("pedestal", 0, false)!;
      ctx.drawImage(s.a, px + pw - 22, py + 2);
      drawText(ctx, "?", px + pw - 24, py + 4, "#a070ff");
    }
    // grid
    for (let i = 0; i < cap; i++) {
      const cx = gx + (i % L.cols) * L.pitch, cy = gy + Math.floor(i / L.cols) * L.pitch;
      const sel = i === this.invCursor;
      frame(cx, cy, L.cell, L.cell, sel ? "#221d26" : "#100e12", sel ? (Math.sin(this.t * 6) > 0 ? "#c8b88a" : "#9a8c66") : "#2a2630", sel ? "#e8d8a8" : "#3a3540");
      const slot = inv[i];
      if (!slot) continue;
      const ic = itemIcon(slot.item);
      const dim = this.invMode === "select" && !isGlyph(slot.item);
      ctx.globalAlpha = dim ? 0.25 : 1;
      const o = Math.floor((L.cell - 16) / 2);
      ctx.drawImage(ic.a, cx + o, cy + o);
      ctx.globalAlpha = 1;
      if (slot.n > 1) { const t = String(slot.n); drawTextS(ctx, t, cx + L.cell - 1 - textWidth(t), cy + L.cell - 7, "#f0e8d0", 1, "left", "#000"); }
    }
    const slot = inv[this.invCursor];
    const ty = gy + L.gh + 6;
    if (slot) {
      drawTextS(ctx, ITEM_NAMES[slot.item] + (slot.n > 1 ? ` x${slot.n}` : ""), gx + L.gw / 2, ty, "#d8d0b8", 1, "center");
      const def = ITEMS[slot.item];
      const hint = this.invMode === "select" ? "E PLACE" : `${def.opens ? "E READ  " : ""}${def.droppable === false ? "CAN'T DROP" : "Q DROP"}`;
      drawText(ctx, hint, gx + L.gw / 2, ty + 10, "#6a6372", 1, "center");
    }
    this.renderNote();
  }

  renderSchem() {
    const ctx = this.ctx;
    if (!this.schemCanvas) return;
    const k = clamp(this.S.schem.t / 0.45, 0, 1);
    const e = 1 - (1 - k) * (1 - k);
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(0, 0, W, H);
    const w = Math.round(W * e);
    const x = Math.round((W - w) / 2);
    ctx.drawImage(this.schemCanvas, x, 0, w, H, x, 0, w, H);
    if (w < W) { ctx.fillStyle = "#d0d8e8"; ctx.fillRect(x - 3, 0, 3, H); ctx.fillRect(x + w, 0, 3, H); }
    if (k >= 1 && this.area.id === "dungeon" && Math.sin(this.t * 6) > 0) {
      const pl = this.pl;
      const mx = Math.round(PLAN_X + (pl.x / TS) * PLAN_S), my = Math.round(PLAN_Y + (pl.y / TS) * PLAN_S);
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
    const t = this.S.end.t;
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
    const pose: GolemPose = { facing: "up", phase: 0, moving: false, hasArm: this.hasArm, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: this.t };
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
      const s = Math.floor(this.world.playTime);
      const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
      const rel = RELICS.filter((r) => hasItem(this.pl, r)).length;
      drawTextS(ctx, `TIME ${mm}:${ss}`, W / 2, 44, "#d8c8b0", 1, "center", "#2a1a2a");
      drawTextS(ctx, `RELICS ${rel}/3`, W / 2, 52, "#d8c8b0", 1, "center", "#2a1a2a");
      ctx.globalAlpha = 1;
    }
    if (t > 6 && Math.sin(this.t * 3) > -0.3) drawTextS(ctx, "ANY KEY - THE SURFACE    R - WAKE AGAIN", W / 2, 168, "#c8b8a0", 1, "center", "#000");
    if (t < 1.6) { ctx.fillStyle = `rgba(235,240,255,${1 - t / 1.6})`; ctx.fillRect(0, 0, W, H); }
  }
}
