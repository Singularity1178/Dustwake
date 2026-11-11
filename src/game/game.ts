// Host + presentation. Owns the canvas, input, screens, camera, particles,
// audio and rendering. It never mutates the World directly except through sim
// entry points; it reacts to the World's events for sound and particles.
import { TS, T } from "./content/tiles";
import { ITEMS, ITEM_NAMES, isGlyph, glyphItem, type ItemId } from "./content/items";
import { hasItem } from "./sim/inventory";
import { golemGlow, runeMarks } from "./sim/gear";
import { toggleGearKit, grantStoryKit, grantBuildKit, teleportTo, type DebugPlace } from "./sim/debug";
import { foundationDemo } from "./sim/debugFoundations";
import { coreCheck } from "./sim/power";
import { GOLEM_LIGHT } from "./content/gear";
import { BuildUi } from "./screens/buildMenu";
import { CraftingUi } from "./screens/crafting";
import { isStation } from "./content/crafting";
import { propLook } from "./content/digging";
import { PackUi } from "./screens/pack";
import { StorageUi } from "./screens/storage";
import { DebugUi } from "./screens/debug";
import { ManageUi } from "./screens/manage";
import { TransferUi } from "./screens/transfer";
import { BookUi } from "./screens/book";
import { SchematicUi } from "./screens/schematic";
import { DialogueUi } from "./screens/dialogue";
import { IntroCutscene } from "./screens/intro";
import { CrossingCutscene } from "./screens/crossing";
import { ARRIVE } from "./content/cutscenes";
import { MonologueLog, drawMonologue } from "./ui/monologue";
import { reactToEvents, playerThinks } from "./sim/monologue";
import { renderTitle } from "./screens/cards";
import { propDef } from "./content/props";
import { VISION_CATEGORIES } from "./content/vision";
import { GLYPHS } from "./content/glyphs";
import { FLAGS, learnedText } from "./content/flags";
import { propSprite } from "./art/props";
import { portalById } from "./sim/portals";
import { rubbleSprite, pillarSprite, doorSprite, barsSprite } from "./art/tiles";
import { itemIcon, glyphPattern } from "./art/items";
import { makeCanvas, Pen, Sprite, hash2, clamp, lerp, makeSprite } from "./util";
import { drawGolem, GolemPose, slamPose, type Facing } from "./golem";
import { SLAM_HIT } from "./content/tasks";
import { Light, makeLight, computeVis, applyGlow, Lighting } from "./light";
import { Sfx } from "./audio";
import { buildCircle, CircleArt, CR } from "./circle";
import { SurfaceRuneArt } from "./surfaceRune";
import { carvingVisible, clumpCleared } from "./runeReveal";
import { RUNE_NODES } from "./content/runes";
import { runeState } from "./sim/runes";
import { RUNE_DUD, linkedGlow, runeDudGlow, severedGlow } from "./view/runeFx";
import { drawText, drawTextS } from "./font";
import { createWorld, player, currentArea, actorById, hasFlag, setFlag, clearFlag, type World, type SimEvent } from "./world/world";
import type { PropInst } from "./world/area";
import { stepPlayer, stepWorld, addPlayTime } from "./sim/step";
import { interactables, type Interactable } from "./sim/interact";
import { AreaView } from "./view/areaView";
import { ScreenStack, type Screen } from "./ui/screens";
import { BASE_W, BASE_H, ZOOM_STEPS, ZOOM_DEFAULT, viewSize, nextZoomStep } from "./view/zoom";
import { npcDef } from "./content/npcs";
import { actorDef } from "./content/actors";
import { drawActor, actorActive } from "./view/actors";
import { powered } from "./sim/actorStats";
import { initWorkerAnim, stepWorkerAnim, drainCues, type WorkerAnim, type AnimCue } from "./workerAnim";
import { eventAudience } from "./view/audience";
import { VisionView, type VisionCue, type VisionArt } from "./view/vision";
import type { Target } from "./content/tasks";
import { isAwake, npcActor } from "./sim/dialogue";
import { saveToStorage, loadFromStorage } from "./view/persistence";
import type { Actor } from "./world/world";
import { archetypeOf, folkLabel, folkPresent } from "./sim/folk";
import { folkLantern } from "./view/actors";
import { drawChatIcon, drawSpeech } from "./folkArt";
import type { ChatIcon } from "./content/folk";
import { hash01 } from "./content/daycycle";
import { DAY_SECONDS, ambientAt, lampGain, skyLight, litLevel, sunLevel, clockText, phaseAt, hearthSmoke, type DayPhase, type RGB } from "./content/daycycle";
import { worldHour, exposureOf, advanceDay, advanceDayTo } from "./sim/daytime";

/** Debug super-speed multiplier. 200% faster = base + 2x base = 3x. */
const DEBUG_SPEED_MULT = 3;

/** Base logical size. HUD and overlay screens are laid out for it (they draw on a base-size UI layer). */
export const W = BASE_W, H = BASE_H;
export { ZOOM_STEPS, ZOOM_DEFAULT, viewSize };
/** The crossing's arrival timings (content/cutscenes.ts), re-exported for the host's callers. */
export { ARRIVE };
/** An area with no `ambient` of its own: the dark of the buried halls. */
const BURIED_AMBIENT: RGB = [0.05, 0.045, 0.065];

/** Presentation state of one NPC (eased pose, eye, flare). Not saved: derived from flags on load. */
interface NpcLook {
  awake: number; eye: number; wakeT: number; sleepT: number; reach: number; flare: number;
  /** A worker body's animation sequencer (workerAnim.ts), the px a rune holds it off the ground, when it was last stepped, and whether it just arrived through a rune. */
  worker?: WorkerAnim; lift: number; seen: number; arrived: boolean;
}

interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; max: number; kind: "spark" | "ember" | "dust" | "debris" | "drip" | "splash" | "rune" | "mote" | "glint" | "smoke";
  col: string; emit: boolean; g: number; size: number;
}

/** Presentation-only state of the golem's body: boot-up, flicker, hover. */
interface GolemLook { eye: number; core: number; dormant: number; sparkT: number; sputter: number; z: number }

const newSeed = () => (Math.random() * 4294967296) >>> 0;

export class Game {
  /** Base-size (W x H) UI layer: HUD, overlays, title and chapter cards. */
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
  /** Speech bubbles over townsfolk (presentation only): a line said to the golem, or a pictogram in their own talk. */
  bubbles = new Map<string, { text?: string; icon?: ChatIcon; t: number; dur: number }>();
  /** The golem's vision mode overlay (presentation of the sim's scan mode). */
  vision = new VisionView();
  private lastAnalyzed = { prop: "", t: -1 };
  sfx = new Sfx();
  circle: CircleArt = buildCircle();
  /** The sky through the throne room's broken roof: a shaft of moonlight, and the same shaft as a sunbeam. */
  shaft: Sprite;
  sunShaft: Sprite;

  world!: World;
  view!: AreaView;
  screens = new ScreenStack();
  /** Real (presentation) clock: animations run on it even while the world is paused. */
  t = 0;
  particles: Particle[] = [];
  toast: { icon: Sprite; name: string; t: number } | null = null;
  /** Debug/testing state (not saved, not part of the sim). */
  debugSpeed = false;
  /** The multiplier super speed applies while on (Ctrl+3 uses the default; the debug menu cycles it). */
  debugSpeedMult = DEBUG_SPEED_MULT;
  debugNoclip = false;
  /** Corner readout of the area, position and active debug modes. */
  debugHud = false;
  debugMsg: { text: string; t: number } | null = null;
  cam = { x: 0, y: 0 };
  shakeT = 0; shakeMag = 0;
  rumbleT = 50;
  eyeBoost = 0;
  crackFlash = 0;
  /** Cracked debris that took a slam and held shudders for a moment (presentation only). */
  shudder: { tx: number; ty: number; t: number } | null = null;
  fizzT = 0;
  look: GolemLook = { eye: 0, core: 0, dormant: 1, sparkT: 2, sputter: 0, z: 0 };
  glight!: Light;
  keys = new Set<string>();
  pressed = new Set<string>();
  dripT: number[] = [];
  target: Interactable | null = null;
  outImg: ImageData;
  private uiTimers: { at: number; fn: () => void }[] = [];
  private S!: Record<"title" | "intro" | "play" | "tele" | "crossing" | "inv" | "schem" | "book" | "build" | "crafting" | "storage" | "manage" | "dialogue" | "debug", Screen>;
  /** Feedback line (blocked actions, pack full, rune dark...). */
  note: { text: string; t: number } | null = null;
  /** Current rune jump: where the effect plays, how long, and whether it's the first (cinematic) one. */
  tele = { x: 0, y: 0, dur: 4.6, first: true, travelled: false };
  /** White fade after a short rune hop (1 -> 0). */
  arriveFade = 0;
  /** Stepping through a doorway or along a road into the next area: a short fade up from dark. */
  doorFade = 0;
  hideGolem = false;
  /**
   * Surface rune override during the arrival cutscene (null: follow its flag).
   * t: redraw progress 0..1, glow: emissive level (>1 = overdriven pulse), column: summon beam 0..1.
   */
  runeAnim: { t: number; glow: number; column: number } | null = null;
  /** A rune that refused to carry (E on one that is dark or severed): where it is, and how long its sputter has run (view/runeFx.ts). */
  runeDud: { x: number; y: number; t: number } | null = null;
  private runeArtCache: SurfaceRuneArt | null = null;
  /** The surface rune's layered art (dormant / awakening / restored), built on first use. */
  get runeArt() { return (this.runeArtCache ??= new SurfaceRuneArt(this.circle.pixels)); }
  /** Build menu, placement and deconstruct tools (screens/buildMenu.ts). */
  buildUi!: BuildUi;
  /** Crafting bench screen (screens/crafting.ts). */
  craftUi!: CraftingUi;
  /** Pack / inventory overlay (screens/pack.ts). */
  packUi!: PackUi;
  storageUi!: StorageUi;
  manageUi!: ManageUi;
  transferUi!: TransferUi;
  /** The Ctrl+0 debug menu (screens/debug.ts). */
  debugUi!: DebugUi;
  /** Book reading screen (screens/book.ts). */
  bookUi!: BookUi;
  /** Schematic overlay (screens/schematic.ts). */
  schemUi!: SchematicUi;
  /** Dialogue box overlay (screens/dialogue.ts). */
  dialogueUi!: DialogueUi;
  /** The opening cutscene (screens/intro.ts, script in content/cutscenes.ts). */
  introUi!: IntroCutscene;
  /** The golem's inner monologue as shown (ui/monologue.ts); the sim emits `thought` events into it. */
  monologue = new MonologueLog();
  /** Cutscene letterbox: current amount 0..1 and where it is easing to. */
  bars = { v: 0, to: 0 };
  /** The first crossing to the surface (screens/crossing.ts, script in content/cutscenes.ts). */
  crossingUi!: CrossingCutscene;
  /** Which way a cutscene has the golem drawn facing (null: as the sim says). Presentation only. */
  gaze: Facing | null = null;
  /** Debug: the calendar clock runs this many times faster (1: normal). Not saved. */
  debugClock = 1;
  /** Under the open sky: seconds until the next bird or cricket. */
  private skyT = 3;
  /** Printable characters typed this frame (raw case) and "\b" for Backspace: text fields read these. */
  typed: string[] = [];

  constructor(public canvas: HTMLCanvasElement, public uiCanvas: HTMLCanvasElement) {
    this.wctx = canvas.getContext("2d")!;
    this.wctx.imageSmoothingEnabled = false;
    this.ctx = uiCanvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.outImg = this.wctx.createImageData(W, H);
    this.shaft = this.buildShaft(["#1c2638", "#121a28", "#26324a"]);
    this.sunShaft = this.buildShaft(["#4a3a1c", "#33280f", "#5e4a22"]);
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
    this.glight = makeLight(pl.x, pl.y - 6, GOLEM_LIGHT.rad, GOLEM_LIGHT.col, 0, 0.05, "golem");
    this.dripT = area.drips.map(() => Math.random() * 4);
    this.look = { eye: 0, core: 0, dormant: 1, sparkT: 1.5, sputter: 0, z: 0 };
    // Zoom is not saved: a world with a mended eye starts at the default zoomed-out view.
    this.zoomAnim = null;
    this.setZoom(hasFlag(world, FLAGS.golemEye) ? ZOOM_DEFAULT : 1);
    this.cam.x = pl.x - this.vw / 2; this.cam.y = pl.y - this.vh / 2 - 10;
    this.npcLooks.clear(); this.bubbles.clear();
    this.vision.reset(pl.mode === "scan");
    this.dialogueUi.reset();
    this.packUi.reset();
    this.storageUi.reset();
    this.manageUi.reset();
    this.transferUi.reset();
    this.particles = [];
    this.toast = null;
    this.fizzT = 0;
    this.shudder = null;
    this.uiTimers = [];
    this.rumbleT = 45 + Math.random() * 30;
    this.note = null; this.arriveFade = 0; this.doorFade = 0; this.hideGolem = false; this.runeAnim = null; this.runeDud = null; this.gaze = null; this.skyT = 3;
    this.monologue.reset();
    this.bars = { v: 0, to: 0 };
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

  buildShaft(cols: [string, string, string]): Sprite {
    // The shaft has no top. The roof it falls through is out of sight above the view, so the beam must never
    // end on an edge: it keeps the same lean and taper as it climbs, and over its upper half it thins out
    // pixel by pixel until nothing is left of it (FOOT is where it meets the floor: the pool lies below that).
    const FOOT = 150, FADE = 0.55;
    return makeSprite(80, FOOT + 10, 40, FOOT, 1, (p) => {
      for (let y = 0; y < FOOT + 10; y++) {
        const t = y / FOOT;
        const cx = lerp(22, 40, t), hw = lerp(7, 24, t);
        // how much of the beam is there at this height: none at the top, all of it below the fade
        const k = clamp(t / FADE, 0, 1), dens = k * k * (3 - 2 * k);
        for (let x = 0; x < 80; x++) {
          const d = Math.abs(x - cx) / hw;
          if (y > FOOT) {
            const e = ((x - 40) / 26) ** 2 + ((y - FOOT - 2) / 7) ** 2;
            if (e < 1 && (x + y) % 2 === 0) p.g(x, y, 1, 1, cols[2]);
            continue;
          }
          if (d < 1 && (x + y) % 2 === 0 && hash2(x, y, 2) > d * 0.8 && hash2(x, y, 5) < dens) p.g(x, y, 1, 1, d < 0.5 ? cols[0] : cols[1]);
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

  /** Debug keybinds (Ctrl+0..6), wired up in App.tsx. Ctrl+0 opens (or closes) the debug menu. */
  debugKey(n: number) {
    const w = this.world, pl = this.pl;
    const say = (text: string) => { this.debugMsg = { text, t: 0 }; };
    if (n === 0) {
      this.debugUi.toggle();
    } else if (n === 1) {
      // Toggle the iron arm.
      if (this.hasArm) { clearFlag(w, FLAGS.golemArm); say("DEBUG: IRON ARM OFF"); }
      else { setFlag(w, FLAGS.golemArm); say("DEBUG: IRON ARM ON"); }
    } else if (n === 2) {
      // Give every rune glyph, the aether core, the rune chisel and the schematic
      // (skipping any already held or already placed).
      const given = grantStoryKit(w, pl);
      this.sfx.tone(520, 0.1, "triangle", 0.05);
      say(given ? "DEBUG: RUNES + CORE + TOOLS GRANTED" : "DEBUG: ALREADY HAVE ALL RUNES + CORE + TOOLS");
    } else if (n === 3) {
      this.debugSpeed = !this.debugSpeed;
      say(this.debugSpeed ? "DEBUG: SUPER SPEED ON" : "DEBUG: SUPER SPEED OFF");
    } else if (n === 4) {
      // Building tests: every build knowledge flag (incl. masonry for the brazier),
      // the basket worn on the back (the one in the pack if there is one, else a
      // new one), and enough materials to build one of everything several times.
      grantBuildKit(w, pl);
      say("DEBUG: BUILD + MASONRY + PLANS + BASKET + MATERIALS");
    } else if (n === 6) {
      // Gear and crafting tests (sim/debug.ts): ON grants the crafted and raw materials, the chisel and both runes,
      // wears the basket and unlocks every locked gear slot; OFF locks them again (what they hold returns to the pack).
      const on = toggleGearKit(w, pl);
      this.sfx.tone(on ? 560 : 380, 0.1, "triangle", 0.05);
      say(on ? "DEBUG: GEAR KIT ON - ALL SLOTS UNLOCKED" : "DEBUG: GEAR KIT OFF - SLOTS LOCKED AGAIN");
    } else if (n === 5) {
      // Toggle the mended eye (golem.eye) and the zoom it unlocks.
      if (hasFlag(w, FLAGS.golemEye)) { w.flags.delete(FLAGS.golemEye); this.zoomTo(1, 0.4); say("DEBUG: EYE REPAIR OFF"); }
      else { setFlag(w, FLAGS.golemEye); this.zoomTo(ZOOM_DEFAULT, 1); this.eyeBoost = 1.5; say("DEBUG: EYE REPAIR ON (SCROLL TO ZOOM)"); }
    }
  }
  has(...k: string[]) { return k.some((x) => this.keys.has(x)); }
  hit(...k: string[]) { return k.some((x) => this.pressed.has(x)); }

  // ---------------------------------------------------------------- debug menu host (screens/debug.ts)
  /** Set or clear a flag from the debug menu. The mended eye also moves the zoom, as Ctrl+5 does. */
  debugSetFlag(flag: string, on: boolean) {
    const w = this.world;
    if (on) setFlag(w, flag); else clearFlag(w, flag);
    if (flag === FLAGS.golemEye) {
      if (on) { this.zoomTo(ZOOM_DEFAULT, 0.6); this.eyeBoost = 1.5; } else this.zoomTo(1, 0.4);
    }
  }
  /** Put the player at a debug place (any area): the view and camera follow at once. False if no free spot is near. */
  debugTeleport(p: DebugPlace): boolean {
    const pl = this.pl;
    if (!teleportTo(this.world, pl, p.area, p.x, p.y)) return false;
    this.syncView();
    const a = this.area;
    this.cam.x = clamp(pl.x - this.vw / 2, 0, Math.max(0, a.w * TS - this.vw));
    this.cam.y = clamp(pl.y - 12 - this.vh / 2, 0, Math.max(0, a.h * TS - this.vh));
    this.glight.vx = -999;
    this.particles = [];
    this.drainEvents();
    return true;
  }
  /** A fresh world straight in the dungeon, no intro. */
  debugNewGame() { this.resume(createWorld(newSeed())); this.say("NEW GAME (DEBUG)"); }
  /** The two-area worker fixture (what window.dustwake.foundations() does). */
  debugFoundations() { this.resume(foundationDemo()); this.say("FOUNDATION FIXTURE: A WORKER GATHERS THROUGH THE RUNES."); }
  /** Step the view zoom through ZOOM_STEPS (ascending order, wrapping). */
  debugZoom() {
    const cur = this.zoomAnim?.to ?? this.zoom;
    const steps = [...ZOOM_STEPS].sort((x, y) => x - y);
    const next = steps.find((z) => z > cur + 1e-6) ?? steps[0];
    this.zoomTo(next, 0.3);
  }

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
    this.storageUi = new StorageUi(this);
    this.manageUi = new ManageUi(this);
    this.transferUi = new TransferUi(this, (id) => this.manageUi.open(id));
    this.manageUi.openTransfer = (id) => this.transferUi.open(id);
    this.debugUi = new DebugUi(this);
    this.bookUi = new BookUi(this);
    this.schemUi = new SchematicUi(this);
    this.dialogueUi = new DialogueUi(this);
    this.introUi = new IntroCutscene(this);
    this.crossingUi = new CrossingCutscene(this);
    this.S = {
      title: scr("title", true, (dt) => {
        if (g.hit("l") && g.loadGame()) { g.sfx.init(); return; }
        if (g.pressed.size) { g.sfx.init(); g.introUi.start(); }
        if (Math.random() < 0.3) g.spawn({ x: Math.random() * W, y: H + 2, vy: -10 - Math.random() * 12, vx: (Math.random() - 0.5) * 4, life: 6, kind: "ember", col: Math.random() < 0.5 ? "#ff8a3a" : "#c84a10", emit: true });
        g.updateParticles(dt);
      }, () => renderTitle(g.ctx, g.t, g.particles)),
      intro: this.introUi.screen,
      play: scr("play", true, (dt) => g.updatePlay(dt), () => g.renderWorldScene()),
      tele: scr("tele", true, (dt) => {
        // the first jump is a cutscene (it runs on into the crossing): Esc skips the whole of it
        if (g.tele.first && g.S.tele.t > 0.2 && g.hit("escape")) { g.skipCrossing(); return; }
        if (g.updateTele(dt)) return;
        stepPlayer(g.world, dt, { ix: 0, iy: 0, use: false });
        g.drainEvents();
        g.worldFrame(dt);
      }, () => {
        g.renderWorldScene();
        const t = g.S.tele.t, w0 = g.tele.dur - 1.6;
        if (t > w0) { g.ctx.fillStyle = `rgba(235,240,255,${clamp((t - w0) / 1.4, 0, 1)})`; g.ctx.fillRect(0, 0, W, H); }
        if (g.tele.first) g.renderSkipHint(t);
      }),
      crossing: this.crossingUi.screen,
      book: this.bookUi.screen,
      build: this.buildUi.screen,
      crafting: this.craftUi.screen,
      storage: this.storageUi.screen,
      manage: this.manageUi.screen,
      debug: this.debugUi.screen,
      dialogue: this.dialogueUi.screen,
      inv: this.packUi.screen,
      schem: this.schemUi.screen,
    };
  }

  // ---------------------------------------------------------------- update
  /** The last update's dt (the folk bubbles age on it while drawing). */
  frameDt = 0;
  update(dt: number) {
    this.frameDt = dt;
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
  worldFrame(dt: number) {
    stepWorld(this.world, dt);
    if (this.debugClock > 1) advanceDay(this.world, ((this.debugClock - 1) * dt * 24) / DAY_SECONDS);
    this.drainEvents();
    this.syncView();
    if (this.view.flush()) this.glight.vx = -999;
    this.updateWorldFx(dt);
  }

  drainEvents() {
    // Monologue triggers must see events from paused-world commands (a book, the pack) before they are drained.
    reactToEvents(this.world);
    const evs = this.world.events;
    if (!evs.length) return;
    this.world.events = [];
    for (const e of evs) {
      if (e.t === "travelled" && e.actor !== this.world.playerId) { this.workerTravelled(e); continue; }
      if (e.t === "portal" && actorById(this.world, e.actor)?.kind === "folk") continue; // townsfolk come and go quietly
      if (e.t === "portal" && e.actor !== this.world.playerId) { this.workerWalked(e); continue; }
      const aud = eventAudience(this.world, e);
      if (aud === "player") this.onEvent(e);
      else if (aud === "nearby") this.onNearby(e);
    }
  }

  /** Another actor in the player's area did something: world-space feedback only. */
  private onNearby(e: SimEvent) {
    if (e.t === "step") {
      const a = actorById(this.world, e.actor);
      if (a) for (let i = 0; i < 2; i++)
        this.spawn({ x: a.x + (Math.random() - 0.5) * 8, y: a.y, z: 1, vx: (Math.random() - 0.5) * 12, vz: 6, life: 0.5, kind: "dust", col: "#8a8478", g: 20 });
    } else if (e.t === "harvestHit") {
      if (e.kind === "tree" || e.kind === "log") this.sfx.thud(); else this.sfx.clink();
      for (let i = 0; i < (e.depleted ? 14 : 6); i++)
        this.spawn({ x: e.x + (Math.random() - 0.5) * 10, y: e.y, z: 6 + Math.random() * 8, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 14, vz: 10 + Math.random() * 20, life: 0.8, kind: "debris", col: e.kind === "rock" ? "#6a6372" : "#6a5034", g: 120 });
    } else if (e.t === "cue") {
      // Cues are local sound/particles for the worker that made them: no screen
      // shake, fizz timer or crack flash, because those belong to the player.
      if (e.cue === "clank") this.sfx.clank();
      else if (e.cue === "scrape") this.sfx.scrape();
      else if (e.cue === "dud" || e.cue === "runeDud") this.sfx.fizzle();
      else if (e.cue === "scrapeDust") {
        this.sfx.scrape();
        for (let i = 0; i < 4; i++) this.spawn({ x: e.x, y: e.y, z: 2, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.8, kind: "dust", col: "#9a96a0", g: 20 });
      } else if (e.cue === "push") {
        this.sfx.thud();
        for (let i = 0; i < 6; i++) this.spawn({ x: e.x + (Math.random() - 0.5) * 16, y: e.y + 2, z: 20 + Math.random() * 10, vx: (Math.random() - 0.5) * 10, life: 1.5, kind: "debris", col: "#6a6372", g: 80 });
      }
    }
  }

  /** Sound, particles and UI reactions to the player's (and world) simulation events. */
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
      case "folkSpoke": {
        const a = actorById(this.world, e.folk);
        if (a?.person) { this.bubbles.set(a.id, { text: e.line, t: 0, dur: 2.4 + e.line.length * 0.055 }); this.say(folkLabel(a)); this.sfx.tone(520, 0.05, "triangle", 0.03); }
        break;
      }
      case "folkChat": {
        const a = actorById(this.world, e.folk);
        if (a && a.area === this.pl.area && !this.bubbles.get(a.id)?.text) this.bubbles.set(a.id, { icon: e.icon, t: 0, dur: 1.5 });
        break;
      }
      case "analyzed":
        // one chime per prop, however many plans it held
        if (this.lastAnalyzed.prop !== e.prop || this.t - this.lastAnalyzed.t > 0.2) this.sfx.analyzed();
        this.lastAnalyzed = { prop: e.prop, t: this.t };
        break;
      case "learned":
        this.sfx.insight(); this.eyeBoost = 1.5;
        this.say(learnedText(e.flag));
        break;
      case "thought":
        this.monologue.push(e.line);
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
        // E on a station: the bench, the smelter or the anvil, each the same screen under its own name (content/crafting.ts).
        if (e.actor === this.world.playerId && this.screens.is("play") && isStation(e.station)) this.craftUi.open(e.station, e.prop);
        break;
      case "dug": {
        // A dig stroke: earth thuds and flies brown, stone rings and flies grey. A layer giving out, and the
        // stair coming open, are said in words (the sim only reports what happened).
        const stone = e.material === "stone";
        if (stone) this.sfx.clink(); else this.sfx.thud();
        this.shake(e.opened ? 0.6 : 0.12, e.opened ? 3 : 1);
        const cols = stone ? ["#8a8392", "#6a6372", "#4b4552"] : ["#4e3c2a", "#5a4630", "#3e2e20"];
        for (let i = 0; i < (e.opened ? 32 : 12); i++)
          this.spawn({ x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * 20, z: 2 + Math.random() * 6, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 14 + Math.random() * 30, life: 0.8 + Math.random() * 0.6, kind: "debris", col: cols[(Math.random() * cols.length) | 0], g: 120 });
        if (e.actor !== this.world.playerId) break;
        if (e.opened) { this.sfx.smash(); this.say("THE VAULT GIVES WAY. THE OLD STAIR IS OPEN: WALK DOWN INTO IT FROM ITS SOUTH END"); }
        else if (e.next === "stone") this.say("THE EARTH IS OUT. FALLEN STONE LIES UNDER IT: THAT NEEDS A PICKAXE HEAD");
        break;
      }
      case "openStorage":
        // E on a storage prop: its screen (pack beside chest). Only the player's own use, from the play screen.
        if (e.actor === this.world.playerId && this.screens.is("play")) this.storageUi.open(e.prop);
        break;
      case "manageActor":
        // E on a worker: its management screen (state, core, orders). The golem's thought about a body with no
        // core (content/monologue.ts) still fires from this event.
        if (e.actor === this.world.playerId && this.screens.is("play") && actorById(this.world, e.target)) this.manageUi.open(e.target);
        break;
      case "coreSlotted": {
        // The core seam's feedback (sim/power.ts), both ways. In: the latch, a hum, embers, the core flaring as it
        // boots before it settles to its faint idle glow. Out: the latch, the hum falling, a puff of dust.
        const a = actorById(this.world, e.target);
        if (!a) break;
        const L = this.npcLook(a), name = ITEM_NAMES[e.item];
        if (e.inserted) {
          this.sfx.coreIn(e.powered);
          if (e.powered) L.flare = 1;
          this.coreSparks(a, e.powered ? 6 : 5, e.powered); // the latch; the boot animation sparks it again as it lights
          this.say(e.powered ? `${name} SLOTTED - IT POWERS ON` : `${name} SLOTTED`);
        } else {
          const ran = coreCheck(a, e.item).sufficient;
          this.sfx.coreOut(ran);
          L.flare = 0;
          for (let i = 0; i < 6; i++) this.spawn({ x: a.x + (Math.random() - 0.5) * 10, y: a.y, z: 6 + Math.random() * 6, vx: (Math.random() - 0.5) * 14, vz: 4 + Math.random() * 6, life: 0.8, kind: "dust", col: "#8a8478", g: 10 });
          this.say(ran ? `${name} TAKEN OUT - IT POWERS DOWN` : `${name} TAKEN OUT`);
        }
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
        else if (a.kind === "slam") {
          // both arms heave up (a low grind), then swing down (a whoosh) just before the blow lands
          const k0 = (a.t - e.dt) / a.dur, k1 = a.t / a.dur, down = SLAM_HIT * 0.88;
          if (k0 <= 0.02 && k1 > 0.02) this.sfx.slamWindup();
          if (k0 < down && k1 >= down) this.sfx.slamSwing();
          if (!this.hasArm && k1 < SLAM_HIT && Math.random() < 0.12) this.sparkBurst(1);
        }
        else if (a.kind === "dismantle" && a.target) {
          if (Math.floor(a.t / 0.3) !== Math.floor((a.t - e.dt) / 0.3)) this.sfx.clink();
          if (Math.random() < 0.3) this.spawn({ x: a.target.x + (Math.random() - 0.5) * 10, y: a.target.y, z: 4 + Math.random() * 8, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.5, kind: "dust", col: "#8a8478", g: 30 });
        }
        else if (a.kind === "scan" && e.actor === pl.id) {
          // the eye reads the pattern: a rising run of data chirps up to the fire point
          const fire = a.dur * 0.85, k0 = (a.t - e.dt) / fire, k1 = a.t / fire;
          if (k0 <= 0 && k1 > 0) this.sfx.scanStart();
          if (k1 < 1 && Math.floor(k1 * 9) !== Math.floor(k0 * 9)) this.sfx.scanTick(k1);
        }
        else if (a.kind === "craft") {
          if (Math.floor(a.t / 0.25) !== Math.floor((a.t - e.dt) / 0.25)) {
            this.sfx.clink();
            if (a.target) for (let i = 0; i < 2; i++) this.spawn({ x: a.target.x + (Math.random() - 0.5) * 14, y: a.target.y - 6, z: 8, vx: (Math.random() - 0.5) * 30, vz: 12 + Math.random() * 14, life: 0.4, kind: "spark", col: "#e8d8a0", emit: true, g: 120 });
          }
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
        else if (e.cue === "runeDud") this.runeRefused(e.x, e.y);
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
      case "gearOn": case "gearOff":
        // Gear is light: a soft wicker creak and a quiet line (nothing like the iron arm's clank, sparks and shake).
        if (e.actor !== this.world.playerId) break;
        if (ITEMS[e.item].worn) this.sfx.tone(e.t === "gearOn" ? 700 : 420, 0.14, "triangle", 0.05); // a rune: a soft chime
        else if (e.t === "gearOn") this.sfx.strap(); else this.sfx.unstrap();
        this.say(e.t === "gearOn" ? (e.slot === "back" ? `${ITEM_NAMES[e.item]} ON YOUR BACK` : `${ITEM_NAMES[e.item]} EQUIPPED`) : `${ITEM_NAMES[e.item]} TAKEN OFF`);
        break;
      case "crafted":
        if (e.actor === this.world.playerId) { this.sfx.place(); this.say(`MADE ${e.n} ${ITEM_NAMES[e.item]}`); }
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
      case "slam": {
        // Both fists hit the ground: a deep thud, a ring of dust where they land, a small shake.
        // Whatever was hit adds its own feedback (wallBroken / withstood).
        this.sfx.slam();
        this.shake(0.18, 1.2);
        for (let i = 0; i < 16; i++) {
          const ang = Math.random() * Math.PI * 2, v = 14 + Math.random() * 24;
          this.spawn({ x: e.x + Math.cos(ang) * 3, y: e.y + Math.sin(ang) * 2, z: 1, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.5, vz: 6 + Math.random() * 10, life: 0.6 + Math.random() * 0.5, kind: "dust", col: Math.random() < 0.5 ? "#8a8478" : "#a09a8c", g: 20 });
        }
        if (!this.hasArm) this.sparkBurst(5); // the broken stub struck too
        break;
      }
      case "withstood": {
        // The debris takes the blow and holds: a heavy impact, a smaller shake than a break, chips and
        // dust off its face, and the debris itself jolts and flashes. Nothing in the world changes.
        this.sfx.impact();
        this.shake(0.3, 2);
        this.crackFlash = 1;
        if (e.tx !== undefined && e.ty !== undefined) this.shudder = { tx: e.tx, ty: e.ty, t: 0.45 };
        for (let i = 0; i < 14; i++)
          this.spawn({ x: e.x + (Math.random() - 0.5) * 16, y: e.y + 2, z: 4 + Math.random() * 20, vx: (Math.random() - 0.5) * 60, vy: Math.random() * 24, vz: 10 + Math.random() * 30, life: 0.9 + Math.random() * 0.6, kind: "debris", col: ["#8a8392", "#6a6372", "#4b4552"][(Math.random() * 3) | 0], g: 140 });
        for (let i = 0; i < 16; i++)
          this.spawn({ x: e.x + (Math.random() - 0.5) * 20, y: e.y + 3, z: Math.random() * 14, vx: (Math.random() - 0.5) * 24, vy: Math.random() * 10, vz: 2 + Math.random() * 6, life: 1 + Math.random(), kind: "dust", col: "#8a8478", g: 6, size: Math.random() < 0.4 ? 2 : 1 });
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
        // The first jump opens the crossing (screens/crossing.ts): bars in, and the golem's own account of it begins.
        if (e.first) { this.letterbox(true); this.monologue.pinned = true; playerThinks(this.world, "cross.engage"); }
        break;
      case "areaEntered": break;
      case "dayPhase": this.onDayPhase(e.phase); break;
      case "portal": {
        // Walked through a doorway or out along a road (sim/portals.ts): a latch or a footfall, a short fade up from
        // dark, and the name of the place arrived in. The old area's particles stay behind.
        const dest = this.world.areas.get(e.toArea), out = dest && portalById(dest, e.to);
        this.doorFade = 1; this.particles = [];
        if (out?.door) this.sfx.open(); else this.sfx.step(true);
        if (out?.label) this.say(out.label);
        break;
      }
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
      // After crafting at a bench, the bench's plans come back once the work is done.
      if (this.craftUi.pending) { this.craftUi.resume(); if (!this.screens.is("play")) return this.worldFrame(dt); }
      // After slotting a core in or out from the management screen, the worker's screen comes back once the reach is done.
      if (this.manageUi.pending) { this.manageUi.resume(); if (!this.screens.is("play")) return this.worldFrame(dt); }
    }
    let ix = 0, iy = 0;
    if (this.has("arrowleft", "a")) ix -= 1;
    if (this.has("arrowright", "d")) ix += 1;
    if (this.has("arrowup", "w")) iy -= 1;
    if (this.has("arrowdown", "s")) iy += 1;
    // E / Enter interact, Space attacks (the two-arm slam): separate actions, both usable next to anything.
    const res = stepPlayer(w, dt, { ix, iy, use: this.hit("e", "enter"), attack: this.hit(" "), core: this.hit("c"), toggleScan: this.hit("z"), speed: this.debugSpeed ? this.debugSpeedMult : 1, noclip: this.debugNoclip });
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
    // the buried halls groan; a lived-in room under a sound roof does not
    if (!this.area.base.outdoor && !this.area.base.interior) this.rumbleT -= dt;
    if (this.rumbleT <= 0) {
      this.rumbleT = 50 + Math.random() * 50;
      this.sfx.rumble();
      this.shake(2.2, 1.5);
      for (let i = 0; i < 30 * this.zoom * this.zoom; i++) this.spawn({ x: this.cam.x + Math.random() * this.vw, y: this.cam.y + Math.random() * this.vh, z: 60 + Math.random() * 40, vz: -10, life: 4, kind: "debris", col: Math.random() < 0.5 ? "#6a6372" : "#4b4552", g: 60 });
    }
    this.worldFrame(dt);
  }

  /** The rune-jump effect (first jump: long, and it runs on into the crossing cutscene; later hops: short). Returns true if it ended. */
  updateTele(_dt: number): boolean {
    const t = this.S.tele.t, lk = this.look, tl = this.tele, pl = this.pl;
    if (!pl.task && t > 0.2) {
      this.sfx.setHum(0);
      if (tl.first && tl.travelled) { this.particles = []; this.crossingUi.start(); }
      else {
        if (tl.first) { this.letterbox(false); this.monologue.release(); } // the jump failed: there is no crossing to run on into
        this.screens.set(this.S.play); this.arriveFade = tl.travelled ? 1 : 0; lk.z = tl.travelled ? 16 : 0;
      }
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

  /**
   * Esc during the first jump's lift-off: let the sim finish the channel at once (it travels), then end the
   * crossing as if it had played (screens/crossing.ts: the same hour, the same lines thought).
   */
  skipCrossing() {
    const pl = this.pl;
    for (let i = 0; i < 200 && pl.task; i++) stepPlayer(this.world, 0.1, { ix: 0, iy: 0, use: false });
    this.drainEvents();
    this.sfx.setHum(0);
    this.look.z = 0;
    if (!this.tele.travelled) { this.letterbox(false); this.monologue.release(); this.screens.set(this.S.play); return; }
    this.syncView();
    this.particles = [];
    this.crossingUi.start();
    this.crossingUi.skip();
  }

  // ---------------------------------------------------------------- the hour (content/daycycle.ts)
  /**
   * How lit (0..1) a prop is at this hour. Where people keep the lights (`tended` areas) a lamp follows its kind's
   * habit; anywhere else, and anything the golem built itself, simply stays as it is.
   */
  tendedLevel(p: PropInst, hour = worldHour(this.world)): number {
    if (!this.area.base.tended || p.dyn) return 1;
    const habit = propDef(p.kind).habit;
    return habit ? litLevel(habit, p.id, hour) : 1;
  }

  /** The day turned (sim/daytime.ts). Under the open sky it is said; where people live, the town answers it. */
  private onDayPhase(phase: DayPhase) {
    const a = this.area;
    if (!a.base.outdoor || !this.screens.is("play")) return;
    const town = !!a.base.tended;
    if (phase === "dawn") { this.say(town ? "DAWN. THE TOWN PUTS OUT ITS LAMPS." : "DAWN BREAKS."); if (town) this.sfx.bell(); }
    else if (phase === "dusk") { this.say(town ? "DUSK. THE TOWN LIGHTS ITS LAMPS." : "DUSK. THE LIGHT IS GOING."); if (town) this.sfx.bell(); }
    else if (phase === "night") this.say("NIGHT FALLS.");
  }

  /** Debug menu: move the clock on to the next mark of the day. Returns what it now reads. */
  debugAdvanceTime(): string {
    const marks = [0, 5, 6, 7, 12, 19, 20, 21], h = worldHour(this.world);
    advanceDayTo(this.world, marks.find((m) => m > h + 0.01) ?? marks[0]);
    this.drainEvents();
    const now = worldHour(this.world);
    return `${clockText(now)} ${phaseAt(now).toUpperCase()}`;
  }

  /**
   * The surface rune's presentation state: the arrival cutscene's, else what the sim says of it (sim/runes.ts:
   * runeState). Dormant: eroded and dark. Restored and linked: carved, its steady pulse. Restored but severed (the
   * circle below is broken, so nothing answers): carved, burning low as embers. While it is refusing someone
   * (`runeDud`), its sputter rides over whichever of those it rests at (view/runeFx.ts).
   */
  surfaceRuneState(): { t: number; glow: number; column: number } {
    if (this.runeAnim) return this.runeAnim;
    const state = runeState(this.world, RUNE_NODES.surface);
    const rest = state === "linked" ? linkedGlow(this.t) : state === "severed" ? severedGlow(this.t) : 0;
    const d = this.runeDud, p = d ? this.area.prop(RUNE_NODES.surface.prop) : undefined;
    const glow = d && p && Math.hypot(p.x - d.x, p.y - d.y) < 4 ? runeDudGlow(d.t, rest, state === "dormant" ? 0.5 : 1) : rest;
    return { t: state === "dormant" ? 0 : 1, glow, column: 0 };
  }

  /** The crossing's arrival act (screens/crossing.ts), `t` seconds in: the overgrown rune wakes and redraws itself, then summons the golem. */
  arriveStep(t: number, dt: number) {
    const A = ARRIVE, t0 = t - dt, lk = this.look;
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
    const fall = clamp((t - A.FLASH) / A.FALL, 0, 1);
    lk.z = 30 * (1 - fall) ** 2;
    lk.eye = 1; lk.core = 1; lk.dormant = 0;
    this.cam.x = clamp(c.x - this.vw / 2, 0, this.area.w * TS - this.vw); this.cam.y = clamp(c.y - 12 - this.vh / 2, 0, this.area.h * TS - this.vh);
  }

  /** The arrival is over (played out or skipped): the rune follows its flag again and the golem stands on it, lit. */
  arriveEnd() {
    this.runeAnim = null; this.hideGolem = false;
    this.look.z = 0; this.look.eye = 1; this.look.core = 1; this.look.dormant = 0;
    this.sfx.setHum(0);
  }

  /** The golem comes down on the dais: the blow, a ring of dust, the ground answering. */
  landFx() {
    const pl = this.pl;
    this.sfx.slam(); this.shake(0.35, 2.2);
    for (let i = 0; i < 22; i++) {
      const ang = Math.random() * Math.PI * 2, v = 16 + Math.random() * 30;
      this.spawn({ x: pl.x + Math.cos(ang) * 4, y: pl.y + Math.sin(ang) * 2, z: 1, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.5, vz: 6 + Math.random() * 12, life: 0.7 + Math.random() * 0.6, kind: "dust", col: Math.random() < 0.5 ? "#8a8478" : "#a09a8c", g: 20 });
    }
    if (!this.hasArm) this.sparkBurst(6);
  }

  /** First light from the east during the crossing's dawn: a low gold light across the clearing (0 puts it out). */
  sunrise(level: number) {
    if (level <= 0 && !this.view.lights.has("sunrise")) return;
    const pl = this.pl;
    const lt = this.view.dynamicLight("sunrise", () => makeLight(pl.x + 190, pl.y - 30, 330, [1, 0.7, 0.4], 0, 0, "sunrise"));
    lt.int = 0.75 * clamp(level, 0, 1);
  }

  clearParticles() { this.particles = []; }
  anyKey() { return this.pressed.size > 0; }
  /** Wake again: a fresh world and the whole opening (R at the crossing's chapter card). */
  wakeAgain() { this.reset(); this.introUi.start(); }

  /** A clump of plants on the rune withers and blows off as the glow reaches it. */
  witherClump(x: number, y: number, size: number) {
    const cols = ["#3e5e2a", "#527636", "#6e8e34", "#7a6a3a", "#5a4630"];
    for (let i = 0; i < 1 + Math.min(4, size / 6); i++)
      this.spawn({ x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 4, z: 1, vx: 10 + Math.random() * 22, vy: (Math.random() - 0.5) * 10, vz: 12 + Math.random() * 18, life: 0.7 + Math.random() * 0.7, kind: "debris", col: cols[(Math.random() * cols.length) | 0], g: 26 });
    if (Math.random() < 0.6) this.spawn({ x, y, z: 1, vz: 10 + Math.random() * 8, life: 0.8, kind: "rune", col: "#c0a0ff", emit: true, g: -3 });
  }

  /** Over the arrival's world scene: the cut in from black, and the white of the summoning flash. */
  arriveOverlay(t: number) {
    const A = ARRIVE, ctx = this.ctx;
    if (t < A.FADE) { ctx.fillStyle = `rgba(0,0,0,${1 - t / A.FADE})`; ctx.fillRect(0, 0, W, H); }
    if (t > A.FLASH && t < A.FLASH + 1) { ctx.fillStyle = `rgba(235,240,255,${1 - (t - A.FLASH)})`; ctx.fillRect(0, 0, W, H); }
  }

  /** The cinema dressing alone (letterbox, the golem's thoughts), over a picture a cutscene drew itself. */
  renderCinema() {
    this.renderBars();
    const bar = this.bars.v * this.bars.v * (3 - 2 * this.bars.v);
    drawMonologue(this.ctx, this.monologue, this.t, 7 + Math.round(12 * bar));
  }

  /** "ESC - SKIP", small in the lower bar of a cutscene that can be skipped (`t`: seconds it has run). */
  renderSkipHint(t: number) {
    const ctx = this.ctx;
    ctx.globalAlpha = clamp((t - 0.6) * 1.5, 0, 1) * 0.85;
    drawText(ctx, "ESC - SKIP", W - 5, H - 9, "#8a8392", 1, "right");
    ctx.globalAlpha = 1;
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
    if (this.shudder && (this.shudder.t -= dt) <= 0) this.shudder = null;
    // golem light
    const gl = this.glight;
    gl.x = pl.x; gl.y = pl.y - 6;
    // The glow is the sim's (sim/gear.ts: golemGlow: the standard glow, or what a worn rune of glow makes of it); the light system applies it.
    applyGlow(gl, golemGlow(this.world, pl));
    if (Math.abs(gl.x - gl.vx) > 2 || Math.abs(gl.y - gl.vy) > 2) computeVis(gl, area);
    const base = this.screens.is("tele") ? gl.int : 1.0;
    gl.cur = base * this.look.core * (0.95 + 0.05 * Math.sin(this.t * 13) * Math.sin(this.t * 3.1)) + this.eyeBoost * 0.3;
    // NPCs: eased pose and eye, eye light through the light registry
    this.updateNpcLooks(dt);
    // light flicker, and the hour: tended lamps are lit and put out with the day, sky light takes the sky's colour
    const hour = worldHour(this.world), sun = sunLevel(hour);
    for (const L of this.view.lights.values()) {
      const n = Math.sin(this.t * 9 + L.seed) * 0.5 + Math.sin(this.t * 23.7 + L.seed * 2) * 0.3 + Math.sin(this.t * 3.3 + L.seed) * 0.2;
      L.cur = L.int * (1 - L.flick * (0.5 + 0.5 * n));
      if (L.habit) L.day = litLevel(L.habit, L.owner!, hour);
      else if (L.sky) { const s = skyLight(L.sky, hour); L.r = s.col[0]; L.g = s.col[1]; L.b = s.col[2]; L.day = s.gain; }
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
    // a rune that refused: its sputter runs its course, spitting sparks off the carvings while it gutters
    if (this.runeDud) {
      const d = this.runeDud;
      if (d.t < RUNE_DUD.gutter && Math.random() < dt * 40) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: d.x + p.x, y: d.y + p.y, z: 1, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 30, vz: 20 + Math.random() * 30, life: 0.45, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
      }
      if ((d.t += dt) >= RUNE_DUD.dur) this.runeDud = null;
    }
    // surface rune glow: dark and dead while dormant (no baseline), driven by the cutscene, steady once restored
    const rg = this.view.byId("runeglow");
    if (rg) {
      const st = this.surfaceRuneState();
      rg.cur = rg.int * (st.glow * (0.92 + 0.08 * Math.sin(this.t * 2.3)) + st.column * 0.7);
      // motes rise from the carvings only while the rune has somewhere to carry them
      if (!this.runeAnim && runeState(this.world, RUNE_NODES.surface) === "linked" && Math.random() < dt * 8) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: rg.x + p.x, y: rg.y + p.y, z: 0, vz: 6 + Math.random() * 10, life: 1.4, kind: "rune", col: Math.random() < 0.6 ? "#a070ff" : "#70d0ff", emit: true, g: -2 });
      }
    }
    // short-hop arrival
    if (this.arriveFade > 0) { this.arriveFade = Math.max(0, this.arriveFade - dt * 1.4); this.look.z = Math.max(0, this.look.z - dt * 24); }
    if (this.doorFade > 0) this.doorFade = Math.max(0, this.doorFade - dt * 2.8);
    if (this.note) { this.note.t += dt; if (this.note.t > 3) this.note = null; }
    this.stepMonologue(dt);
    // drifting leaves on the wind
    if (area.base.outdoor && Math.random() < dt * 1.5)
      this.spawn({ x: this.cam.x - 20 + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 30 + Math.random() * 40, vx: 8 + Math.random() * 8, vy: (Math.random() - 0.3) * 3, vz: -4 - Math.random() * 3, life: 7, kind: "mote", col: ["#7a5630", "#946a34", "#5a7a34", "#a07c40"][(Math.random() * 4) | 0], emit: false, g: 0 });
    // fireflies under the open sky: the night's, thinning out as the sun comes up
    if (area.base.outdoor && Math.random() < dt * 3 * this.zoom * this.zoom * (1 - sun))
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 6 + Math.random() * 20, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 3, life: 4, kind: "mote", col: "#d8f080", emit: true, g: 0 });
    // by day: pollen on the air and the odd butterfly instead
    if (area.base.outdoor && Math.random() < dt * 1.2 * this.zoom * this.zoom * sun)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 8 + Math.random() * 18, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 6, life: 5, kind: "mote", col: ["#f0e8c0", "#e8c860", "#d8d0e8", "#e89a5a"][(Math.random() * 4) | 0], emit: false, g: 0 });
    // and the open air sounds its hour: birds by day, crickets by night, a hush while one hands over to the other
    if (area.base.outdoor && (this.skyT -= dt) <= 0) {
      this.skyT = 2.5 + Math.random() * 6;
      if (sun > 0.6) this.sfx.bird(); else if (sun < 0.25) this.sfx.cricket();
    }
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
      if (!fire || this.tendedLevel(p, hour) <= 0.05) continue;
      if (Math.abs(p.x - this.cam.x - VW / 2) > VW / 2 + 40 || Math.abs(p.y - this.cam.y - VH / 2) > VH / 2 + 50) continue;
      if (Math.random() < dt * fire.embers)
        this.spawn({ x: p.x + (Math.random() - 0.5) * 4, y: p.y + fire.emberDy, z: 14, vx: (Math.random() - 0.5) * 6, vz: 10 + Math.random() * 10, life: 1 + Math.random(), kind: "ember", col: Math.random() < 0.5 ? "#ffb040" : "#ff6a1a", emit: true, g: -4 });
    }
    // chimney smoke over the town's roofs (props with a `smoke` row), leaning on the same night wind as the leaves
    for (const p of area.props) {
      const sm = propDef(p.kind).smoke;
      if (!sm || Math.abs(p.x - this.cam.x - VW / 2) > VW / 2 + 40 || Math.abs(p.y - this.cam.y - VH / 2) > VH / 2 + 70) continue;
      if (Math.random() < dt * sm.rate * (area.base.tended ? hearthSmoke(hour) : 1)) // thick at breakfast and supper
        this.spawn({ x: p.x + sm.dx + (Math.random() - 0.5) * 3, y: p.y, z: sm.z, vx: 3 + Math.random() * 4, vy: (Math.random() - 0.5) * 1.5, vz: 7 + Math.random() * 5, life: 2.2 + Math.random() * 1.8, kind: "smoke", col: Math.random() < 0.5 ? "#6e6a70" : "#585460", g: -1, size: 2, emit: false });
    }
    // ambient dust motes
    if (Math.random() < dt * 8 * this.zoom * this.zoom)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 4 + Math.random() * 30, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 5, kind: "mote", col: "#b8b0a0", emit: false, g: 0 });
    // moonbeam motes
    const moon = this.view.byId("moon");
    if (moon && Math.random() < dt * 5)
      this.spawn({ x: moon.x - 14 + Math.random() * 30, y: moon.y + 2, z: 10 + Math.random() * 70, vx: (Math.random() - 0.5) * 2, vz: -3 - Math.random() * 3, life: 6, kind: "mote", col: sun > 0.5 ? "#ffe8b0" : "#a8c0ff", emit: true, g: 0 });
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
    // vision mode: follows the sim's mode; the lock-on reticle sits on whatever E would act on
    const focus = this.screens.is("play") && this.target ? visionId(this.target) : null;
    for (const c of this.vision.update(dt, this.world, pl, gl, focus, this.visionArt())) this.onVisionCue(c);
    this.updateParticles(dt);
  }

  private visionArtCache: VisionArt | null = null;
  private visionArt(): VisionArt {
    const a = (this.visionArtCache ??= { t: 0, npcLook: (x) => this.npcLook(x), circle: { lines: [this.circle.glow, this.circle.glowGap], r: CR }, self: () => (this.hideGolem ? null : this.selfPose) });
    a.t = this.t;
    return a;
  }

  /** Where the golem's eye is (world px), for the scanner's glint and the data stream home. */
  private eyeSpot(): { x: number; y: number; w: number; show: boolean } | null {
    if (this.hideGolem) return null;
    const pl = this.pl, lk = this.look, f = pl.facing;
    const y = Math.round(pl.y - lk.z) - 18 + Math.round(lk.dormant * 4) + Math.round(lk.dormant * 3);
    const x = Math.round(pl.x) + (f === "right" ? 2 : f === "left" ? -4 : -2);
    return { x, y, w: f === "down" ? 4 : 2, show: f !== "up" };
  }

  /** Sound and particles for the vision overlay's moments. */
  private onVisionCue(c: VisionCue) {
    switch (c.t) {
      case "on": this.sfx.visionOn(); break;
      case "off": this.sfx.visionOff(); break;
      case "ping": if (c.n < 10) this.sfx.visionPing(c.category, c.pending, c.n); break;
      case "lock": {
        // the reading locks in: motes of the category's colour burst off the silhouette and drift up
        const col = VISION_CATEGORIES[c.target.category].color;
        for (let i = 0; i < 18; i++) {
          const edge = Math.random() < 0.5, px = c.x + (edge ? (Math.random() < 0.5 ? 0 : c.w) : Math.random() * c.w), py = c.y + (edge ? Math.random() * c.h : (Math.random() < 0.5 ? 0 : c.h));
          const zx = c.target.y - py;
          this.spawn({ x: px, y: c.target.y, z: zx, vx: (px - (c.x + c.w / 2)) * (1.5 + Math.random() * 2), vz: 6 + Math.random() * 16, life: 0.5 + Math.random() * 0.5, kind: "rune", col: Math.random() < 0.35 ? "#ffffff" : col, emit: true, g: -6 });
        }
        this.eyeBoost = Math.max(this.eyeBoost, 0.6);
        break;
      }
    }
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

  // ---------------------------------------------------------------- CutsceneHost (screens/intro.ts)
  letterbox(on: boolean) { this.bars.to = on ? 1 : 0; if (on) this.bars.v = 1; }
  startPlay() { this.screens.set(this.S.play); }
  renderScene() { this.renderWorldScene(); }

  /** Type the monologue and ease the letterbox (presentation clock, scenes and animating overlays). */
  private stepMonologue(dt: number) {
    const s = this.monologue.update(dt);
    if (s.started) this.sfx.thoughtStart();
    for (let i = 0; i < s.typed; i++) this.sfx.thoughtTick(s.tone === "void");
    const b = this.bars;
    if (b.v !== b.to) b.v = b.to > b.v ? Math.min(b.to, b.v + dt * 4) : Math.max(b.to, b.v - dt * 2.2);
  }

  /** Cutscene letterbox bars (they slide away when the player gets control). */
  private renderBars() {
    const b = this.bars.v;
    if (b <= 0) return;
    const e = b * b * (3 - 2 * b), h = Math.round(14 * e);
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, W, h); this.ctx.fillRect(0, H - h, W, h);
  }
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
    const hour = worldHour(this.world);
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
    // ---- a room's doorway: the threshold is painted with the night beyond it; by day the daylight stands there instead
    const daylight = sunLevel(hour);
    if (area.base.interior && daylight > 0) for (const pt of area.base.portals ?? []) {
      if (!pt.door || pt.dir !== "down") continue;
      const x = pt.x - 1 - camX, y = pt.y + 4 - camY, ww = pt.w + 2;
      sc.globalAlpha = daylight; sc.fillStyle = "#cfc49c"; sc.fillRect(x, y, ww, 6); sc.fillStyle = "#f0e8c8"; sc.fillRect(x + 1, y + 2, ww - 2, 3); sc.globalAlpha = 1;
      ec.globalAlpha = daylight * 0.45; ec.fillStyle = "#a89868"; ec.fillRect(x, y, ww, 6); ec.globalAlpha = 1;
    }
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
      // Where people keep the lights, a lamp is as lit as the hour says (content/daycycle.ts): a doused torch shows
      // its unlit art, a rune or a lantern stops glowing, and a dark window is just the painted window under it.
      const lvl = def.habit ? this.tendedLevel(p, hour) : 1;
      const alt = def.alt === "lit" ? !!p.lit && lvl > 0.05 : def.alt === "taken" ? p.taken : p.open;
      const s = propSprite(p.kind, propLook(p), alt);
      if (!s) continue;
      if (lvl <= 0.01 && def.habit === "window") continue;
      list.push({
        y: def.wallMounted ? p.y - 0.5 : def.flat ? p.y - 16 : p.y,
        f: () => {
          if (lvl < 1 && def.alt !== "lit") this.drawDimmed(s, p, lvl, def.habit === "window", camX, camY);
          else if (def.sway && !alt) this.drawSwaying(s, p, camX, camY); else spr(s, p.x, p.y);
          if (p.lit && def.fire && lvl > 0.05) this.drawFlame(p, def.fire.big, camX, camY);
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
          // a slam that didn't break it: the debris jolts side to side as the shudder dies away
          const sh = this.shudder, jx = sh && sh.tx === tx && ty >= sh.ty && ty <= sh.ty + 2 ? Math.round(Math.sin(this.t * 80) * 2 * Math.min(1, sh.t / 0.3)) : 0;
          list.push({ y, f: () => { spr(s, x + jx, y); if (this.crackFlash > 0) { ec.globalAlpha = this.crackFlash; ec.drawImage(s.e, Math.round(x + jx - s.ax - camX), Math.round(y - s.ay - camY)); ec.globalAlpha = 1; } } });
        }
        else if (t === T.PILLAR) { const s = pillarSprite(area.tvar[ty * AW + tx] === 1); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.LOCKED) { const s = doorSprite(); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.BARS) { const s = barsSprite(); list.push({ y, f: () => spr(s, x, y) }); }
      }
    // NPCs (one generic path: art looked up by NpcDef id)
    for (const a of this.world.actors) {
      if (a.id === this.world.playerId || a.area !== area.id || a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
      list.push({ y: a.y, f: () => drawActor(sc, ec, this.world, a, camX, camY, this.t, this.npcLook(a)) });
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
    if (moon) {
      // moonlight through the broken roof by night, the same shaft as a sunbeam by day
      const sun = daylight, mx = Math.round(moon.x - this.shaft.ax - camX), my = Math.round(moon.y + 2 - this.shaft.ay - camY);
      ec.globalCompositeOperation = "lighter";
      if (sun < 1) { ec.globalAlpha = 1 - sun; ec.drawImage(this.shaft.e, mx, my); }
      if (sun > 0) { ec.globalAlpha = sun; ec.drawImage(this.sunShaft.e, mx, my); }
      ec.globalAlpha = 1; ec.globalCompositeOperation = "source-over";
    }
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
    // the hour: the sky's share of the ambient by how much of it this area sees, and lamps counting for less in daylight
    const exposure = exposureOf(area);
    this.lighting.compose(sImg.data, eImg.data, this.outImg.data, ambientAt(area.base.ambient ?? BURIED_AMBIENT, hour, exposure), 6, lampGain(hour, exposure));
    this.wctx.putImageData(this.outImg, 0, 0);
    const eye = this.eyeSpot();
    this.vision.draw(this.wctx, this.pl, camX, camY, W, H, this.t, eye && { x: eye.x + eye.w / 2 - 1, y: eye.y, w: eye.w, show: eye.show });
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

  /** A tended lamp part-lit or out: its glow at `lvl`. A lit window (`whole`) is nothing but its glow, so all of it fades. */
  private drawDimmed(s: Sprite, p: PropInst, lvl: number, whole: boolean, camX: number, camY: number) {
    const dx = Math.round(p.x - s.ax - camX), dy = Math.round(p.y - s.ay - camY);
    if (dx > this.vw || dy > this.vh || dx + s.w < 0 || dy + s.h < 0) return;
    const sc = this.scene.ctx, ec = this.emit.ctx;
    if (whole) sc.globalAlpha = lvl;
    sc.drawImage(s.a, dx, dy);
    sc.globalAlpha = 1;
    if (lvl > 0.01) { ec.globalAlpha = lvl; ec.drawImage(s.e, dx, dy); ec.globalAlpha = 1; }
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
    const bx = Math.round(p.x - camX), by = Math.round(p.y - camY - 15 + (propDef(p.kind).fire?.dy ?? 0));
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
    let raise = 0, reach = 0, slam: number | undefined, dip: number | undefined;
    if (a) {
      const k = a.t / a.dur;
      if (a.kind === "reach" || a.kind === "push" || a.kind === "dismantle") reach = Math.sin(Math.min(1, k) * Math.PI);
      if (a.kind === "smash") raise = a.t < 0.5 ? a.t / 0.5 : a.t < 0.62 ? lerp(1, -1, (a.t - 0.5) / 0.12) : lerp(-1, 0, clamp((a.t - 0.62) / 0.5, 0, 1));
      if (a.kind === "carve") reach = 0.4 + 0.6 * Math.abs(Math.sin(a.t * 14));
      if (a.kind === "craft") reach = 0.3 + 0.7 * Math.abs(Math.sin(a.t * 9));
      if (a.kind === "attach") reach = 0.3;
      if (a.kind === "punch") { const k2 = a.t / a.dur; raise = k2 < 0.35 ? k2 / 0.35 : k2 < 0.5 ? lerp(1, -1, (k2 - 0.35) / 0.15) : lerp(-1, 0, clamp((k2 - 0.5) / 0.4, 0, 1)); }
      if (a.kind === "channel") reach = 0.2;
      if (a.kind === "slam") ({ lift: slam, dip } = slamPose(k));
    }
    const pose: GolemPose = {
      facing: this.gaze ?? pl.facing, phase: pl.phase, moving: pl.moving && !a, hasArm: this.hasArm, dormant: lk.dormant,
      eye: clamp(lk.eye + this.eyeBoost + this.vision.k * 0.35, 0, 1.6), core: lk.core, raise, reach, t: this.t,
      eyeFixed: hasFlag(this.world, FLAGS.golemEye), back: pl.gear.back, runes: runeMarks(this.world, pl), slam, dip,
    };
    const ox = pl.x - camX + (a?.kind === "push" ? Math.round(Math.sin(a.t * 40)) : 0), oy = pl.y - camY - lk.z;
    drawGolem(new Pen(sc, false), ox, oy, pose);
    drawGolem(new Pen(this.emit.ctx, true), ox, oy, pose);
    this.selfPose = { pose, x: ox + camX, y: oy + camY };
  }
  /** The pose the golem was last drawn in (world px): vision mode outlines it so it never gets lost under highlights. */
  private selfPose: { pose: GolemPose; x: number; y: number } | null = null;

  // ---------------------------------------------------------------- NPCs
  /** Presentation state for an NPC actor, created from its sim state (so a loaded world looks right at once). */
  npcLook(a: Actor): NpcLook {
    let L = this.npcLooks.get(a.id);
    if (!L) {
      const on = isAwake(this.world, a.id) ? 1 : 0;
      L = { awake: on, eye: on, wakeT: 99, sleepT: 99, reach: 0, flare: 0, lift: 0, seen: -99, arrived: false };
      this.npcLooks.set(a.id, L);
    }
    return L;
  }

  /** Ease every NPC in view toward its sim state: wake sputter, straighten, dim and slump. Drives its eye light. */
  updateNpcLooks(dt: number) {
    const area = this.area;
    for (const a of this.world.actors) {
      if (a.area !== area.id || a.id === this.world.playerId) continue;
      if (a.kind === "folk") { this.updateFolkLook(a); continue; }
      // Bodies without a dialogue identity (workers): the sequencer decides how they stand, sit and shut down.
      if (!npcDef(a.npc)) { this.updateWorkerLook(a, dt); continue; }
      if (a.kind !== "npc") continue;
      const def = actorDef(a);
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

  /**
   * A worker body, one frame: step its animation sequencer from what the sim says (powered, working, moving, has a core),
   * play the sounds and dust the sequence asks for, and, while it channels a rune, hold it up in the rune's own effect.
   * A worker that was out of the player's area (or the screen) starts at rest in whatever the sim says it is.
   */
  private updateWorkerLook(a: Actor, dt: number) {
    const L = this.npcLook(a);
    const inp = { powered: powered(a), active: actorActive(a), moving: a.moving, hasCore: !!a.powerCore };
    if (!L.worker || this.t - L.seen > 0.5) { L.worker = initWorkerAnim(inp); if (!L.arrived) L.lift = 0; }
    L.seen = this.t; L.arrived = false;
    stepWorkerAnim(L.worker, dt, inp);
    for (const cue of drainCues(L.worker)) this.workerCue(a, cue);
    L.flare = Math.max(0, L.flare - dt * 0.8);
    const task = a.task;
    if (task?.kind === "channel" && task.target) {
      // Rune travel. The body does nothing of its own (it just stands at the rune); the rune does the effect:
      // the worker is lifted, motes spiral into the rune and a column of light builds, as the maintainer's jump does.
      const c = task.target, lift = task.dur - 1.0;
      L.lift = Math.min(task.t, lift) * 5.5 + Math.sin(task.t * 3);
      const n = Math.floor(dt * 150 + Math.random());
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2, r = 12 + Math.random() * 26;
        this.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vx: -Math.cos(ang) * r * 0.8, vy: -Math.sin(ang) * r * 0.8, vz: 8 + Math.random() * 16, life: 1.0, kind: "rune", col: Math.random() < 0.5 ? "#c0a0ff" : "#80e0ff", emit: true, g: -5 });
      }
      if (task.t - dt <= 0) this.runeBlip(c.x, c.y, 0.7);
    } else L.lift = Math.max(0, L.lift - dt * 26);
    // its core and lamp light the floor round it
    const lt = this.view.dynamicLight("npc:" + a.id, () => makeLight(a.x, a.y - 9, 38, [1, 0.38, 0.34], 0, 0.07, "npc:" + a.id));
    lt.x = a.x; lt.y = a.y - 9 - L.lift;
    if (Math.abs(lt.x - lt.vx) > 2 || Math.abs(lt.y - lt.vy) > 2) computeVis(lt, this.area);
    lt.int = L.worker.out.core * 0.2 + L.worker.out.eye * 0.1 + (task?.kind === "channel" ? 0.3 : 0);
  }

  /** A townsperson, one frame: the watch's lantern lights the street round them after dark. */
  private updateFolkLook(a: Actor) {
    if (archetypeOf(a).garb !== "watch") return;
    const on = folkPresent(a) && folkLantern(this.world, a);
    const side = a.facing === "left" ? -1 : a.facing === "right" ? 1 : -4 / 3;
    const lx = a.x + side * 4, ly = a.y - 6;
    const lt = this.view.dynamicLight("folk:" + a.id, () => makeLight(lx, ly, 70, [1, 0.7, 0.38], 0, 0.14, "folk:" + a.id));
    lt.x = lx; lt.y = ly;
    if (on && (Math.abs(lt.x - lt.vx) > 2 || Math.abs(lt.y - lt.vy) > 2)) computeVis(lt, this.area);
    lt.int = on ? 0.62 : 0;
  }

  /** Speech bubbles and sleepers' Zs over townsfolk, on the world layer (they scale with the zoom like the marker). */
  private renderFolkBubbles(dt: number) {
    const ctx = this.wctx, area = this.area, camX = this.cam.x, camY = this.cam.y;
    for (const [id, b] of this.bubbles) { b.t += dt; if (b.t > b.dur) this.bubbles.delete(id); }
    for (const a of this.world.actors) {
      if (a.kind !== "folk" || a.area !== area.id || !folkPresent(a) || !a.life) continue;
      const x = Math.round(a.x - camX), y = Math.round(a.y - camY);
      if (x < -60 || y < -60 || x > this.vw + 60 || y > this.vh + 60) continue;
      if (a.life.pose === "lie") {
        const k = (this.t * 0.5 + hash01(a.id, 4)) % 1;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        drawTextS(ctx, k < 0.5 ? "z" : "Z", x + 4 + k * 6, y - 26 - k * 10, "#d8e0f0", 1, "left", "#1a1418");
        ctx.globalAlpha = 1;
      }
      const b = this.bubbles.get(a.id);
      if (!b) continue;
      const fade = clamp(Math.min(b.t / 0.12, (b.dur - b.t) / 0.25), 0, 1), top = y - (a.life.pose === "sit" ? 27 : 30);
      ctx.globalAlpha = fade;
      if (b.text) drawSpeech(ctx, b.text, x, top, this.vw);
      else if (b.icon) drawChatIcon(ctx, b.icon, x + 3, top - Math.round((1 - fade) * 3));
      ctx.globalAlpha = 1;
    }
  }

  /** The sounds and dust of a worker's animation cues (workerAnim.ts), quiet when it is far off. */
  private workerCue(a: Actor, cue: AnimCue) {
    const near = this.volAt(a.x, a.y) > 0.15;
    const dust = (n: number) => { for (let i = 0; i < n; i++) this.spawn({ x: a.x + (Math.random() - 0.5) * 12, y: a.y + 1, z: 1, vx: (Math.random() - 0.5) * 22, vy: (Math.random() - 0.5) * 8, vz: 6 + Math.random() * 6, life: 0.6, kind: "dust", col: "#8a7a68", g: 20 }); };
    switch (cue) {
      case "spark": this.coreSparks(a, 9, true); if (near) this.sfx.spark(); break;
      case "creak": if (near) this.sfx.scrape(); break;
      case "lamp": this.coreSparks(a, 3, true); if (near) this.sfx.wakeSputter(); break;
      case "plant": dust(7); if (near) this.sfx.thud(); break;
      case "jolt": this.coreSparks(a, 8, false); dust(3); if (near) this.sfx.clank(); break;
      case "lampOut": if (near) this.sfx.tone(420, 0.25, "sine", 0.03, 110); break;
      case "settle": if (near) this.sfx.tone(190, 0.7, "sine", 0.035, 70); break;
    }
  }

  /** A soft rune chime and a burst of motes at (x, y): a worker leaving or arriving through a rune. */
  private runeBlip(x: number, y: number, k = 1) {
    const v = this.volAt(x, y) * k;
    if (v > 0.05) { this.sfx.tone(520, 0.35, "sine", 0.06 * v, 1040); this.sfx.tone(780, 0.5, "triangle", 0.04 * v, undefined, 0.07); }
  }
  private runeBurst(x: number, y: number) {
    this.runeBlip(x, y);
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 14 + Math.random() * 30;
      this.spawn({ x, y, z: 2 + Math.random() * 10, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.5, vz: 10 + Math.random() * 30, life: 0.7, kind: "rune", col: Math.random() < 0.4 ? "#ffffff" : Math.random() < 0.5 ? "#c0a0ff" : "#80e0ff", emit: true, g: 10 });
    }
  }
  /**
   * E on a rune that will not carry (dark, or lit with nothing answering it): the fizzle, a jolt, sparks thrown off
   * its ring, and the rune's own sputter (view/runeFx.ts), which updateWorldFx runs. The halls' circle flickers on
   * `fizzT`, as it always did for a dud; a rune that is a prop (the surface's) reads `runeDud` in surfaceRuneState.
   */
  private runeRefused(x: number, y: number) {
    this.sfx.fizzle();
    this.fizzT = 0.5;
    this.runeDud = { x, y, t: 0 };
    this.shake(0.25, 1.2);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, rr = 44 + Math.random() * 13;
      this.spawn({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, z: 1, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 40, vz: 30 + Math.random() * 30, life: 0.5, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
    }
  }

  /**
   * Another body walked through a door or off along a road (a worker under orders: sim/jobs.ts). It is only heard:
   * the latch or a footfall where it left, if that was here, else where it came out, if that is here. The view, the
   * fade and the place's name are the player's own (onEvent, "portal").
   */
  private workerWalked(e: Extract<SimEvent, { t: "portal" }>) {
    const here = this.pl.area, a = actorById(this.world, e.actor);
    const from = e.fromArea === here ? portalById(this.area, e.from) : undefined;
    const out = !from && a && e.toArea === here ? portalById(this.area, e.to) : undefined;
    const at = from ? { x: from.x + from.w / 2, y: from.y + from.h / 2, door: !!from.door } : out && a ? { x: a.x, y: a.y, door: !!out.door } : null;
    if (!at || this.volAt(at.x, at.y) < 0.15) return;
    if (at.door) this.sfx.open(); else this.sfx.step(true);
  }

  /** Another body went through a rune: a flash where it left (if that was in the player's area) and where it landed. */
  private workerTravelled(e: Extract<SimEvent, { t: "travelled" }>) {
    const a = actorById(this.world, e.actor), pa = this.pl.area;
    const from = RUNE_NODES[e.from], p = from && from.area === pa ? this.area.prop(from.prop) : null;
    if (p) this.runeBurst(p.x, p.y);
    if (a && a.area === pa) { const L = this.npcLook(a); L.lift = 13; L.arrived = true; this.runeBurst(a.x, a.y); }
  }

  /** Embers from a golem's core hatch as a core seats: bright when it powers the body, a few dull ones when too weak. */
  coreSparks(a: Actor, n: number, bright: boolean) {
    const z = actorDef(a).body.height * 0.55;
    for (let i = 0; i < n; i++)
      this.spawn({ x: a.x + (Math.random() - 0.5) * 4, y: a.y + 1, z: z + Math.random() * 3, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.2) * 16, vz: 8 + Math.random() * 24, life: 0.3 + Math.random() * 0.4, kind: "spark", col: bright ? (Math.random() < 0.5 ? "#ff5a70" : "#ffc0c8") : "#8a3040", emit: true, g: 110 });
  }

  npcSparks(a: Actor, n: number) {
    for (let i = 0; i < n; i++)
      this.spawn({ x: a.x + (Math.random() - 0.5) * 16, y: a.y - 2, z: 18 + Math.random() * 14, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 10 + Math.random() * 30, life: 0.3 + Math.random() * 0.4, kind: "spark", col: Math.random() < 0.5 ? "#fff2a0" : "#7fe8ff", emit: true, g: 120 });
  }
  npcDust(a: Actor) {
    for (let i = 0; i < 12; i++)
      this.spawn({ x: a.x + (Math.random() - 0.5) * 26, y: a.y, z: 2 + Math.random() * 6, vx: (Math.random() - 0.5) * 24, vz: 6 + Math.random() * 8, life: 1, kind: "dust", col: "#8a8478", g: 14 });
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
    if (this.screens.is("play") || this.screens.is("dialogue")) this.renderFolkBubbles(this.frameDt);
    if (this.arriveFade > 0) { ctx.fillStyle = `rgba(235,240,255,${this.arriveFade})`; ctx.fillRect(0, 0, W, H); }
    if (this.doorFade > 0) { ctx.fillStyle = `rgba(6,5,9,${this.doorFade})`; ctx.fillRect(0, 0, W, H); }
    this.renderBars();
    // below the letterbox while it is up; it rises with the bars as control is handed over
    const bar = this.bars.v * this.bars.v * (3 - 2 * this.bars.v);
    drawMonologue(ctx, this.monologue, this.t, 7 + Math.round(12 * bar));
    if (this.screens.is("play")) { this.renderNote(); this.vision.drawHud(ctx, W); this.renderClock(); }
    // debug message
    if (this.debugMsg) {
      ctx.globalAlpha = clamp(2 - this.debugMsg.t, 0, 1);
      drawTextS(ctx, this.debugMsg.text, W / 2, 6, "#ff9a5a", 1, "center");
      ctx.globalAlpha = 1;
    }
    // debug readout: active modes, and (menu option) where the golem is
    if (this.debugHud || this.debugNoclip || this.debugSpeed) {
      const pl = this.pl, modes = [this.debugNoclip ? "NOCLIP" : "", this.debugSpeed ? `SPEED X${this.debugSpeedMult}` : ""].filter(Boolean).join("  ");
      const lines = [
        ...(this.debugHud ? [`${pl.area.toUpperCase()}  X ${Math.round(pl.x)}  Y ${Math.round(pl.y)}  TILE ${Math.floor(pl.x / TS)},${Math.floor((pl.y - 3) / TS)}`] : []),
        ...(modes ? [`DEBUG: ${modes}`] : []),
      ];
      lines.forEach((l, i) => drawTextS(ctx, l, 4, H - 8 - (lines.length - 1 - i) * 8, "#ff9a5a", 1, "left", "#000"));
    }
    // toast (the dialogue box draws it above itself)
    if (!this.screens.is("schem") && !this.screens.is("dialogue")) this.renderToast(H - 26);
  }

  /**
   * The hour, bottom right: the sun, the moon, or the sun on the horizon, and the clock. Shown under the open sky, and
   * anywhere once the golem has been up to see it (it keeps count from then on; before that it has no way to know).
   */
  renderClock() {
    if (!this.area.base.outdoor && !hasFlag(this.world, FLAGS.tutorialDone)) return;
    const ctx = this.ctx, hour = worldHour(this.world), ph = phaseAt(hour), x = W - 35, y = H - 11;
    ctx.fillStyle = "rgba(6,5,9,0.6)"; ctx.fillRect(x - 3, y - 2, 36, 11);
    const px = (c: string, cells: number[][]) => { ctx.fillStyle = c; for (const [cx, cy, w = 1, h = 1] of cells) ctx.fillRect(x + cx, y + cy, w, h); };
    if (ph === "day") {
      px("#ffb030", [[3, 0], [3, 6], [0, 3], [6, 3], [1, 1], [5, 1], [1, 5], [5, 5]]);
      px("#ffd860", [[2, 2, 3, 3]]);
    } else if (ph === "night") {
      px("#c8d4f0", [[2, 1, 3, 1], [1, 2, 2, 1], [1, 3, 2, 1], [1, 4, 3, 1], [2, 5, 3, 1]]);
      px("#7a88b0", [[5, 2], [6, 0]]);
    } else {
      px("#ff9a40", [[2, 3, 3, 2], [1, 4, 5, 1], [3, 1], [1, 2], [5, 2]]);
      px("#8a5a3a", [[0, 5, 7, 1]]);
    }
    drawText(ctx, clockText(hour), x + 10, y + 1, ph === "night" ? "#a8b4d8" : ph === "day" ? "#e8d8a0" : "#f0b078");
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


/** The vision target id of an interaction target (sim/analysis.ts: visionTargets ids). */
function visionId(t: Target): string | null {
  return t.propId ?? t.looseId ?? t.actorId ?? (t.tx !== undefined && t.ty !== undefined ? `tile:${t.tx},${t.ty}` : null);
}
