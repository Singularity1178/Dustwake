// Host + presentation. Owns the canvas, input, screens, camera, particles,
// audio and rendering. It never mutates the World directly except through sim
// entry points; it reacts to the World's events for sound and particles.
import { TS } from "./content/tiles";
import { ITEMS, type ItemId } from "./content/items";
import { hasItem } from "./sim/inventory";
import { golemGlow } from "./sim/gear";
import { toggleGearKit, grantStoryKit, grantBuildKit, teleportTo, type DebugPlace } from "./sim/debug";
import { foundationDemo } from "./sim/debugFoundations";
import { GOLEM_LIGHT } from "./content/gear";
import { BuildUi } from "./screens/buildMenu";
import { CraftingUi } from "./screens/crafting";
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
import { renderTitle } from "./screens/cards";
import { propDef } from "./content/props";
import { VISION_CATEGORIES } from "./content/vision";
import { FLAGS } from "./content/flags";
import { makeCanvas, Sprite, hash2, clamp, lerp, makeSprite } from "./util";
import { GolemPose, type Facing } from "./golem";
import { Light, makeLight, computeVis, applyGlow, Lighting } from "./light";
import { Sfx } from "./audio";
import { buildCircle, CircleArt, CR } from "./circle";
import { SurfaceRuneArt } from "./surfaceRune";
import { carvingVisible, clumpCleared } from "./runeReveal";
import { RUNE_NODES } from "./content/runes";
import { runeState } from "./sim/runes";
import { RUNE_DUD, linkedGlow, runeDudGlow, severedGlow } from "./view/runeFx";
import { drawTextS } from "./font";
import { bindUiText, label, labelS, labelW, hints, occlude, inFrame, edge, learnNames, forgetNames, titled } from "./ui/text";
import { uiMetrics, HI_W, HI_H } from "./ui/scale";
import { createWorld, player, currentArea, hasFlag, setFlag, clearFlag, type World, type SimEvent } from "./world/world";
import type { PropInst } from "./world/area";
import { stepPlayer, stepWorld, addPlayTime } from "./sim/step";
import { interactables, type Interactable } from "./sim/interact";
import { AreaView } from "./view/areaView";
import { ScreenStack, FRAMED_SCREENS, type Screen } from "./ui/screens";
import { BASE_W, BASE_H, ZOOM_STEPS, ZOOM_DEFAULT, viewSize, nextZoomStep } from "./view/zoom";
import { npcDef } from "./content/npcs";
import { actorDef } from "./content/actors";
import { actorActive } from "./view/actors";
import { powered } from "./sim/actorStats";
import { initWorkerAnim, stepWorkerAnim, drainCues, type WorkerAnim } from "./workerAnim";
import { VisionView, type VisionCue, type VisionArt } from "./view/vision";
import type { Target } from "./content/tasks";
import { isAwake } from "./sim/dialogue";
import type { Actor } from "./world/world";
import { tendedAt } from "./world/zones";
import { archetypeOf, folkPresent } from "./sim/folk";
import { keeperPresent, shopOfArea, shopOpen } from "./sim/shops";
import { drawClosedSign } from "./keeperArt";
import { folkLantern } from "./view/actors";
import { drawChatIcon, drawSpeech } from "./folkArt";
import type { ChatIcon } from "./content/folk";
import { hash01 } from "./content/daycycle";
import { DAY_SECONDS, skyLight, litLevel, sunLevel, clockText, phaseAt, hearthSmoke } from "./content/daycycle";
import { worldHour, advanceDay, advanceDayTo } from "./sim/daytime";
import { Camera } from "./view/camera";
import { ParticleSystem, type Particle } from "./view/particles";
import { WorldRenderer } from "./view/worldRenderer";
import { EventReactions } from "./view/reactions";
import { Interpolator } from "./view/interp";
import { TimeFx } from "./view/timeFx";
import { HiHud } from "./view/hudHi";
import { downloadText, pickTextFile } from "./view/files";
import { SimClock, TICK, GAME_SPEEDS, stepSpeed, type GameSpeed } from "./core/clock";
import { enableLod } from "./sim/lod";
import type { PlayerInput, PlayerStepResult } from "./sim/step";
import { Gui, type GuiInput } from "./ui/gui";
import { KeyRepeat } from "./ui/keyRepeat";
import { NotificationFeed, noteForEvent, type Note } from "./ui/notify";
import { Settings, applyPalette, browserStorage, type Action } from "./ui/settings";
import { SaveStore, MemoryBackend, slotName, type LoadResult } from "./world/saveStore";
import { createArea } from "./world/world";
import { SystemMenu } from "./screens/system";

/** The number keys that pick a game speed, in GAME_SPEEDS order (pause, 1x, 2x, 4x, 8x). */
const SPEED_KEYS = ["1", "2", "3", "4", "5"];

/** Debug super-speed multiplier. 200% faster = base + 2x base = 3x. */
const DEBUG_SPEED_MULT = 3;

/** Base logical size. HUD and overlay screens are laid out for it (they draw on a base-size UI layer). */
export const W = BASE_W, H = BASE_H;
export { ZOOM_STEPS, ZOOM_DEFAULT, viewSize };
/** The crossing's arrival timings (content/cutscenes.ts), re-exported for the host's callers. */
export { ARRIVE };
/** Stop running ticks in a frame once the simulation has taken this long (ms): the game runs slow, never frozen. */
const SIM_BUDGET_MS = 12;
const perfNow = () => (globalThis.performance?.now?.() ?? Date.now());

/** Presentation state of one NPC (eased pose, eye, flare). Not saved: derived from flags on load. */
interface NpcLook {
  awake: number; eye: number; wakeT: number; sleepT: number; reach: number; flare: number;
  /** A worker body's animation sequencer (workerAnim.ts), the px a rune holds it off the ground, when it was last stepped, and whether it just arrived through a rune. */
  worker?: WorkerAnim; lift: number; seen: number; arrived: boolean;
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
  bubbles = new Map<string, { text?: string; icon?: ChatIcon; t: number; dur: number; /** A line of their own talk (not said to the golem). */ talk?: boolean }>();
  /** The golem's vision mode overlay (presentation of the sim's scan mode). */
  vision = new VisionView();
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
  toast: { icon: Sprite; name: string; t: number } | null = null;
  /** Debug/testing state (not saved, not part of the sim). */
  debugSpeed = false;
  /** The multiplier super speed applies while on (Ctrl+3 uses the default; the debug menu cycles it). */
  debugSpeedMult = DEBUG_SPEED_MULT;
  debugNoclip = false;
  /** Corner readout of the area, position and active debug modes. */
  debugHud = false;
  debugMsg: { text: string; t: number } | null = null;
  /** The camera and its shake (view/camera.ts). */
  cam = new Camera();
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
  uiTimers: { at: number; fn: () => void }[] = [];
  S!: Record<"title" | "intro" | "play" | "tele" | "crossing" | "inv" | "schem" | "book" | "build" | "crafting" | "storage" | "manage" | "dialogue" | "debug" | "system", Screen>;
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
  runeArtCache: SurfaceRuneArt | null = null;
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
  skyT = 3;
  /** Printable characters typed this frame (raw case) and "\b" for Backspace: text fields read these. */
  typed: string[] = [];

  // ---------------------------------------------------------------- Phase 0: engine and UI shell
  /** The particle system (view/particles.ts); `particles` reads and replaces its list. */
  fx = new ParticleSystem();
  get particles(): Particle[] { return this.fx.list; }
  set particles(v: Particle[]) { this.fx.list = v; }
  get shakeT() { return this.cam.shakeT; }
  set shakeT(v: number) { this.cam.shakeT = v; }
  get shakeMag() { return this.cam.shakeMag; }
  set shakeMag(v: number) { this.cam.shakeMag = v; }
  /** The world renderer (view/worldRenderer.ts) and the event-reaction layer (view/reactions.ts). */
  renderer = new WorldRenderer(this);
  reactions = new EventReactions(this);
  /** The fixed-timestep clock (core/clock.ts), the play screen's game speed, and render interpolation (view/interp.ts). */
  clock = new SimClock(TICK);
  speed: GameSpeed = 1;
  lastSpeed: GameSpeed = 1;
  interp = new Interpolator();
  /** The look of the game speed (view/timeFx.ts: a hush when paused, warm streaks and a vignette as time speeds up). Presentation only. */
  timeFx = new TimeFx();
  /** Edge actions waiting for the next tick: a press on a frame that runs no tick is not lost. */
  latch = { use: false, attack: false, core: false, toggleScan: false };
  /** A click on what E would use (view/hudHi.ts) uses it on the next tick. */
  mouseUse = false;
  /** Settings (ui/settings.ts), the notification feed (ui/notify.ts) and the save slots (world/saveStore.ts). */
  settings = new Settings(browserStorage());
  notes = new NotificationFeed();
  store = new SaveStore(new MemoryBackend());
  autosave = { t: 0, soon: -1 };
  /** The high-resolution UI layer (2x the base), its context, and the widget kit that draws on it. */
  hiCanvas!: HTMLCanvasElement;
  /** The fixed 320x180 layer: what is not interface and never scales (cutscene cards, the dialogue box, the letterbox, the title). */
  fixedCanvas!: HTMLCanvasElement;
  fctx!: CanvasRenderingContext2D;
  hctx!: CanvasRenderingContext2D;
  gui = new Gui();
  hud!: HiHud;
  systemMenu!: SystemMenu;
  /** The mouse (App.tsx): base-layer px (NaN off the canvas), buttons held, and this frame's edges. */
  mouse = { x: NaN, y: NaN, down: false, rdown: false, pressed: false, released: false, rpressed: false, wheel: 0 };
  /** Keys pressed this frame, kept for the UI layer (it reads them while drawing, after update has cleared `pressed`). */
  uiPressed = new Set<string>();
  /** Menu key auto-repeat (ui/keyRepeat.ts): the held key that repeats, and the key that repeated this frame (the UI layer keeps its copy, as with `uiPressed`). */
  readonly repeat = new KeyRepeat();
  uiRepeat: string | null = null;
  private repeatScreen: Screen | undefined;
  /** Frame and simulation timing (the performance readout and graphs). */
  perf = { fps: 60, ticks: 0, simMs: 0, history: [] as number[], tickHistory: [] as number[], dropped: 0 };

  constructor(public canvas: HTMLCanvasElement, public uiCanvas: HTMLCanvasElement, hiCanvas?: HTMLCanvasElement, fixedCanvas?: HTMLCanvasElement) {
    this.wctx = canvas.getContext("2d")!;
    this.wctx.imageSmoothingEnabled = false;
    this.ctx = uiCanvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.fixedCanvas = fixedCanvas ?? makeCanvas(W, H).c;
    this.fctx = this.fixedCanvas.getContext("2d")!;
    this.fctx.imageSmoothingEnabled = false;
    this.outImg = this.wctx.createImageData(W, H);
    this.shaft = this.buildShaft(["#1c2638", "#121a28", "#26324a"]);
    this.sunShaft = this.buildShaft(["#4a3a1c", "#33280f", "#5e4a22"]);
    this.hiCanvas = hiCanvas ?? makeCanvas(HI_W, HI_H).c;
    this.hctx = this.hiCanvas.getContext("2d")!;
    this.fx.onDrip = (p) => this.sfx.drip(this.volAt(p.x, p.y));
    this.notes.onAlert = (n) => this.onAlert(n);
    this.store.onError = (m) => this.notes.push(m, "warn", "store");
    this.settings.onChange(() => this.applySettings());
    this.makeScreens();
    this.reset();
    this.applySettings();
    this.screens.set(this.S.title);
  }

  // ---------------------------------------------------------------- session
  /** Start presenting a world (a fresh session by default, or a loaded one). */
  reset(world: World = createWorld(newSeed())) {
    this.world = world;
    this.applyLod();
    this.clock.reset(); this.interp.clear(); this.mouseUse = false;
    this.latch = { use: false, attack: false, core: false, toggleScan: false };
    this.hud?.reset();
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

  /** Save the world into a slot of the save store (K: the quick slot). True if it was written. */
  saveGame(slot = "quick"): boolean {
    try {
      const m = this.store.save(slot, this.world);
      this.say("GAME SAVED"); this.sfx.tone(520, 0.1, "triangle", 0.05);
      this.notes.push(`Saved to ${m.label}`, "info", "saved");
      return true;
    } catch { this.say("COULD NOT SAVE"); this.sfx.tone(180, 0.1, "square", 0.04); return false; }
  }
  /** Load a slot (falling back to its backups), or the newest save of all (L: Continue). False if nothing loads. */
  loadGame(slot?: string): boolean {
    let r: LoadResult | null = null;
    try { r = slot ? this.store.load(slot) : this.store.loadLatest(); } catch { r = null; }
    if (!r) { this.say("NO SAVED GAME"); this.sfx.tone(180, 0.1, "square", 0.04); return false; }
    this.resume(r.world);
    this.say("GAME LOADED");
    this.notes.push(`Loaded ${slotName(r.from)}`, "info", "loaded");
    if (r.recovered) this.notes.push(r.recovered, "warn", "recovered");
    return true;
  }

  /** Rebuild the area view when the player has travelled to another area. */
  syncView() {
    const area = currentArea(this.world);
    if (this.view.area === area) return;
    this.view.dispose();
    this.view = new AreaView(area);
    this.dripT = area.drips.map(() => Math.random() * 4);
    this.glight.vx = -999;
    // new area: snap the camera instead of panning across the map
    const pl = this.pl;
    this.cam.x = clamp(pl.x - this.vw / 2, 0, area.w * TS - this.vw); this.cam.y = clamp(pl.y - 12 - this.vh / 2, 0, area.h * TS - this.vh);
    this.onAreaChanged();
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
  stepZoom(dt: number) {
    const a = this.zoomAnim;
    if (!a) return;
    a.t += dt;
    const k = clamp(a.t / a.dur, 0, 1), e = k * k * (3 - 2 * k);
    this.setZoom(lerp(a.from, a.to, e));
    if (k >= 1) this.zoomAnim = null;
  }
  /** Mouse wheel (App.tsx): discrete zoom steps, on the play screen only, once the eye is mended. */
  wheel(deltaY: number) {
    this.mouse.wheel += deltaY;
    if (this.gui.wantsWheel || this.gui.modal) return; // a list or slider under the pointer takes the wheel
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
    if (!this.keys.has(k)) {
      this.pressed.add(k);
      this.repeat.press(k);
      if (this.repeat.key === k) this.repeatScreen = this.screens.top; // it repeats on the screen it was pressed on
    }
    this.keys.add(k);
    if (raw.length === 1) this.typed.push(raw);
    else if (k === "backspace") this.typed.push("\b");
  }
  keyUp(k: string) { k = k.toLowerCase(); this.keys.delete(k); this.repeat.release(k); }
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
  /**
   * Pressed this frame, or a held key repeating (ui/keyRepeat.ts): for moving a cursor through a menu. Actions keep
   * `hit`, so holding a key never uses, crafts or travels twice.
   */
  navHit(...k: string[]) { return this.hit(...k) || (this.repeat.fired !== null && k.includes(this.repeat.fired)); }
  /** Nothing repeats until the next key press (the key was spent on something else, as a remap). */
  stopRepeat() { this.repeat.stop(); this.uiRepeat = null; }

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
  spawn(p: Partial<Particle> & { x: number; y: number }) { this.fx.spawn(p); }
  shake(t: number, m: number) { this.cam.shake(t, m); }
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
  makeScreens() {
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
    this.systemMenu = new SystemMenu(this);
    this.hud = new HiHud(this);
    // the overlay screens are laid out as a 320x180 box: centred on the scaled UI canvas (the build tool places itself)
    this.screens.drawWith = (sc, draw) => (FRAMED_SCREENS.has(sc.id) ? inFrame(this.ctx, draw) : draw());
    this.S = {
      title: scr("title", true, (dt) => {
        if (g.hit("l") && g.loadGame()) { g.sfx.init(); return; }
        if (g.pressed.size) { g.sfx.init(); g.introUi.start(); }
        if (Math.random() < 0.3) g.spawn({ x: Math.random() * W, y: H + 2, vy: -10 - Math.random() * 12, vx: (Math.random() - 0.5) * 4, life: 6, kind: "ember", col: Math.random() < 0.5 ? "#ff8a3a" : "#c84a10", emit: true });
        g.updateParticles(dt);
      }, () => renderTitle(g.fctx, g.t, g.particles)),
      intro: this.introUi.screen,
      play: scr("play", true, (dt) => g.updatePlay(dt), () => g.renderWorldScene()),
      tele: scr("tele", true, (dt) => {
        // the first jump is a cutscene (it runs on into the crossing): Esc skips the whole of it
        if (g.tele.first && g.S.tele.t > 0.2 && g.hit("escape")) { g.skipCrossing(); return; }
        if (g.updateTele(dt)) return;
        g.simulate(dt, 1, () => ({ ix: 0, iy: 0, use: false }));
        g.presentFrame(dt);
      }, () => {
        g.renderWorldScene();
        const t = g.S.tele.t, w0 = g.tele.dur - 1.6;
        if (t > w0) { g.fctx.fillStyle = `rgba(235,240,255,${clamp((t - w0) / 1.4, 0, 1) * g.flashK})`; g.fctx.fillRect(0, 0, W, H); }
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
      system: this.systemMenu.screen,
    };
  }

  // ---------------------------------------------------------------- update
  /** The last update's dt (the folk bubbles age on it while drawing). */
  frameDt = 0;
  /**
   * The environment's clock (presentation only). The world around the golem (drifting motes and leaves, embers, smoke,
   * drips, lamp flicker, foliage sway, rune pulses, worker animation) runs on this, not on the real clock, so it keeps
   * step with the game speed: frozen while paused, twice as fast at 2x, eight times at 8x. `envScale` eases toward the
   * speed in force so a change of speed reads as a change of pace rather than a jump.
   */
  envScale = 1;
  /** Environment seconds this frame (real dt x envScale) and the running total (the env's `t`). */
  envDt = 0;
  envT = 0;
  private stepEnv(dt: number) {
    // Only the play screen has a game speed; under a menu, cutscene or title the scenery keeps its usual 1x.
    const play = this.screens.is("play");
    const target = play ? this.speed * (this.debugSpeed ? this.debugSpeedMult : 1) : 1;
    const d = target - this.envScale;
    if (Math.abs(d) < 0.01) this.envScale = target;
    else this.envScale += d * (1 - Math.exp(-dt * 12));
    this.envDt = dt * this.envScale;
    this.envT += this.envDt;
  }
  /** How many things a Poisson process of `perSecond` x env time spawns this frame (at 8x that can be more than one a frame). */
  private rolls(perSecond: number): number {
    const x = perSecond * this.envDt, n = Math.floor(x);
    return n + (Math.random() < x - n ? 1 : 0);
  }
  update(dt: number) {
    this.frameDt = dt;
    this.t += dt;
    this.stepEnv(dt);
    if (this.uiTimers.length) {
      const due = this.uiTimers.filter((u) => u.at <= this.t);
      this.uiTimers = this.uiTimers.filter((u) => u.at > this.t);
      for (const u of due) u.fn();
    }
    this.stepZoom(dt);
    // The speed's look shows over the play screen only (a menu or cutscene over the world puts it away), and only if the setting is on.
    this.timeFx.update(dt, this.speed, this.screens.is("play") && this.settings.bool("timeFx"));
    this.notes.update(dt);
    if (dt > 0) this.perf.fps += (1 / dt - this.perf.fps) * 0.1;
    // A key held across a change of screen does not carry on repeating into the new one.
    if (this.screens.top !== this.repeatScreen) this.repeat.stop();
    this.repeat.tick(dt, this.keys);
    this.uiPressed = new Set(this.pressed);
    this.uiRepeat = this.repeat.fired;
    this.screens.update(dt);
    this.pressed.clear();
    this.typed.length = 0;
  }

  /** One frame of world simulation (whole fixed ticks: at 1x unless told, so cutscenes keep their timing) plus its presentation. */
  worldFrame(dt: number, speed = 1) {
    this.simulate(dt, speed);
    this.presentFrame(dt);
  }

  /** Presentation that follows the world once a frame, however many ticks ran (none, at a high refresh rate or paused). */
  presentFrame(dt: number) {
    this.syncView();
    if (this.view.flush()) this.glight.vx = -999;
    this.updateWorldFx(dt);
  }

  /**
   * Run the whole fixed ticks (core/clock.ts) owed for `dt` real seconds at `speed`. Each tick: the player's input (if
   * `input` is given: the play screen and the rune jump), the world, then its events. Stops early when another screen
   * comes up over the one simulating, or when the frame's simulation budget is spent (the game runs slow, never frozen).
   */
  simulate(dt: number, speed: number, input: (() => PlayerInput) | null = null, play = false): PlayerStepResult | null {
    const base = this.screens.top, w = this.world, n = this.clock.advance(dt, speed), t0 = perfNow();
    let res: PlayerStepResult | null = null, ran = 0;
    for (let i = 0; i < n; i++) {
      this.interp.capture(w, this.pl.area);
      if (input) { res = stepPlayer(w, TICK, input()); if (play) addPlayTime(w, TICK); }
      stepWorld(w, TICK);
      if (this.debugClock > 1) advanceDay(w, ((this.debugClock - 1) * TICK * 24) / DAY_SECONDS);
      this.drainEvents();
      ran++;
      if (this.screens.top !== base || res?.ui) { this.clock.reset(); break; }
      if (i < n - 1 && perfNow() - t0 > SIM_BUDGET_MS) { this.perf.dropped += n - 1 - i; this.clock.reset(); break; }
    }
    const p = this.perf;
    p.ticks = ran; p.simMs = perfNow() - t0;
    p.history.push(p.simMs); p.tickHistory.push(ran);
    if (p.history.length > 120) p.history.shift();
    if (p.tickHistory.length > 120) p.tickHistory.shift();
    this.interp.alpha = this.clock.alpha;
    return res;
  }

  updatePlay(dt: number) {
    const w = this.world, pl = this.pl, lk = this.look;
    // save / load: the quick slot, and Continue (the newest save: world/saveStore.ts)
    if (this.act("save")) this.saveGame();
    if (this.act("load") && this.loadGame()) return;
    // Esc: the HUD's context menu, inspector or selection closes first; else the system menu (screens/system.ts)
    if (this.hit("escape") && !this.hud.dismiss()) { this.systemMenu.open(); return this.presentFrame(dt); }
    this.speedKeys();
    this.stepAutosave(dt);
    // overlays
    if (!pl.task) {
      if (this.act("pack")) { this.packUi.open("view"); return this.worldFrame(dt, this.speed); }
      if (this.act("schematic") && hasItem(pl, "schematic")) { this.schemUi.open(); return this.worldFrame(dt, this.speed); }
      if (this.act("build")) { this.buildUi.open(); return this.worldFrame(dt, this.speed); }
      if (this.act("quickPlace")) { this.buildUi.quickPlace(); return this.worldFrame(dt, this.speed); }
      // Repeat placement / deconstruction: reopen the tool once the ordered work is done.
      if (this.buildUi.pending) { this.buildUi.resumeAfterWork(); if (!this.screens.is("play")) return this.worldFrame(dt, this.speed); }
      // After crafting at a bench, the bench's plans come back once the work is done.
      if (this.craftUi.pending) { this.craftUi.resume(); if (!this.screens.is("play")) return this.worldFrame(dt, this.speed); }
      // After slotting a core in or out from the management screen, the worker's screen comes back once the reach is done.
      if (this.manageUi.pending) { this.manageUi.resume(); if (!this.screens.is("play")) return this.worldFrame(dt, this.speed); }
    }
    let ix = 0, iy = 0;
    if (this.held("left")) ix -= 1;
    if (this.held("right")) ix += 1;
    if (this.held("up")) iy -= 1;
    if (this.held("down")) iy += 1;
    // E / Enter interact, Space attacks (the two-arm slam): separate actions, both usable next to anything.
    // Edge actions wait in the latch for the next tick (core/clock.ts), so a press on a frame that runs no tick still
    // lands; while paused they are dropped. The keys are the player's own (settings: Controls).
    const L = this.latch;
    L.use ||= this.act("interact") || this.mouseUse; L.attack ||= this.act("attack"); L.core ||= this.act("core"); L.toggleScan ||= this.act("scan");
    this.mouseUse = false;
    if (this.speed === 0) this.latch = { use: false, attack: false, core: false, toggleScan: false };
    const res = this.simulate(dt, this.speed, () => {
      const l = this.latch;
      this.latch = { use: false, attack: false, core: false, toggleScan: false };
      return { ix, iy, use: l.use, attack: l.attack, core: l.core, toggleScan: l.toggleScan, speed: this.debugSpeed ? this.debugSpeedMult : 1, noclip: this.debugNoclip };
    }, true);
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
    if (res) { this.target = res.target; if (res.ui) this.packUi.open("select", res.ui.socket); }
    // rumble events
    // the buried halls groan; a lived-in room under a sound roof does not
    if (!this.area.base.outdoor && !this.area.base.interior) this.rumbleT -= dt;
    if (this.rumbleT <= 0) {
      this.rumbleT = 50 + Math.random() * 50;
      this.sfx.rumble();
      this.shake(2.2, 1.5);
      for (let i = 0; i < 30 * this.zoom * this.zoom; i++) this.spawn({ x: this.cam.x + Math.random() * this.vw, y: this.cam.y + Math.random() * this.vh, z: 60 + Math.random() * 40, vz: -10, life: 4, kind: "debris", col: Math.random() < 0.5 ? "#6a6372" : "#4b4552", g: 60 });
    }
    this.presentFrame(dt);
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
    if (p.dyn || !tendedAt(this.area, p.x, p.y)) return 1;
    const habit = propDef(p.kind).habit;
    return habit ? litLevel(habit, p.id, hour) : 1;
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
    const rest = state === "linked" ? linkedGlow(this.envT) : state === "severed" ? severedGlow(this.envT) : 0;
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
    const A = ARRIVE, ctx = this.fctx;
    if (t < A.FADE) { ctx.fillStyle = `rgba(0,0,0,${1 - t / A.FADE})`; ctx.fillRect(0, 0, W, H); }
    if (t > A.FLASH && t < A.FLASH + 1) { ctx.fillStyle = `rgba(235,240,255,${1 - (t - A.FLASH)})`; ctx.fillRect(0, 0, W, H); }
  }

  /** The cinema dressing alone (letterbox, the golem's thoughts), over a picture a cutscene drew itself. */
  renderCinema() {
    this.renderBars();
    const bar = this.bars.v * this.bars.v * (3 - 2 * this.bars.v);
    drawMonologue(this.fctx, this.monologue, this.t, 7 + Math.round(12 * bar));
  }

  /** "ESC - SKIP", small in the lower bar of a cutscene that can be skipped (`t`: seconds it has run). */
  renderSkipHint(t: number) {
    const ctx = this.fctx;
    ctx.globalAlpha = clamp((t - 0.6) * 1.5, 0, 1) * 0.85;
    hints(ctx, [["Esc", "Skip"]], W - 5, H - 9, "#8a8392", "right");
    ctx.globalAlpha = 1;
  }

  /** Presentation that follows the world each simulated frame. */
  updateWorldFx(dt: number) {
    const pl = this.pl, area = this.area, edt = this.envDt, et = this.envT;
    // camera
    const VW = this.vw, VH = this.vh;
    const tx = clamp(pl.x - VW / 2, 0, area.w * TS - VW), ty = clamp(pl.y - 12 - VH / 2, 0, area.h * TS - VH);
    this.cam.follow(tx, ty, dt);
    this.cam.decay(dt);
    this.crackFlash = Math.max(0, this.crackFlash - dt);
    if (this.shudder && (this.shudder.t -= dt) <= 0) this.shudder = null;
    // golem light
    const gl = this.glight;
    gl.x = pl.x; gl.y = pl.y - 6;
    // The glow is the sim's (sim/gear.ts: golemGlow: the standard glow, or what a worn rune of glow makes of it); the light system applies it.
    applyGlow(gl, golemGlow(this.world, pl));
    if (Math.abs(gl.x - gl.vx) > 2 || Math.abs(gl.y - gl.vy) > 2) computeVis(gl, area);
    const base = this.screens.is("tele") ? gl.int : 1.0;
    gl.cur = base * this.look.core * (0.95 + 0.05 * Math.sin(et * 13) * Math.sin(et * 3.1)) + this.eyeBoost * 0.3;
    // NPCs: eased pose and eye, eye light through the light registry
    this.updateNpcLooks(dt);
    // light flicker, and the hour: tended lamps are lit and put out with the day, sky light takes the sky's colour
    const hour = worldHour(this.world), sun = sunLevel(hour);
    for (const L of this.view.lights.values()) {
      const n = Math.sin(et * 9 + L.seed) * 0.5 + Math.sin(et * 23.7 + L.seed * 2) * 0.3 + Math.sin(et * 3.3 + L.seed) * 0.2;
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
        if (cl.rad < target) { cl.rad = Math.min(target, cl.rad + edt * 30); if (Math.abs(cl.rad - cl.vx) > 0) computeVis(cl, area); }
        cl.int = 0.6 + Math.min(1, r.actT / 3) * 0.6;
        cl.cur = cl.int * (0.85 + 0.15 * Math.sin(et * 3));
      }
      const c = area.ritualPos;
      for (let n = this.rolls(30); n > 0; n--) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: c.x + p.x, y: c.y + p.y, z: 0, vz: 8 + Math.random() * 12, life: 1.5, kind: "rune", col: Math.random() < 0.6 ? "#a070ff" : "#70d0ff", emit: true, g: -2 });
      }
    } else if (cl) {
      cl.cur = cl.int * (0.8 + 0.2 * Math.sin(et * 1.3)) + (this.fizzT > 0 ? Math.random() * 0.6 : 0);
    }
    this.fizzT = Math.max(0, this.fizzT - edt);
    // a rune that refused: its sputter runs its course, spitting sparks off the carvings while it gutters
    if (this.runeDud) {
      const d = this.runeDud;
      if (d.t < RUNE_DUD.gutter) for (let n = this.rolls(40); n > 0; n--) {
        const p = this.circle.pixels[(Math.random() * this.circle.pixels.length) | 0];
        this.spawn({ x: d.x + p.x, y: d.y + p.y, z: 1, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 30, vz: 20 + Math.random() * 30, life: 0.45, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
      }
      if ((d.t += edt) >= RUNE_DUD.dur) this.runeDud = null;
    }
    // surface rune glow: dark and dead while dormant (no baseline), driven by the cutscene, steady once restored
    const rg = this.view.byId("runeglow");
    if (rg) {
      const st = this.surfaceRuneState();
      rg.cur = rg.int * (st.glow * (0.92 + 0.08 * Math.sin(et * 2.3)) + st.column * 0.7);
      // motes rise from the carvings only while the rune has somewhere to carry them
      if (!this.runeAnim && runeState(this.world, RUNE_NODES.surface) === "linked") for (let n = this.rolls(8); n > 0; n--) {
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
    if (area.base.outdoor) for (let n = this.rolls(1.5); n > 0; n--)
      this.spawn({ x: this.cam.x - 20 + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 30 + Math.random() * 40, vx: 8 + Math.random() * 8, vy: (Math.random() - 0.3) * 3, vz: -4 - Math.random() * 3, life: 7, kind: "mote", col: ["#7a5630", "#946a34", "#5a7a34", "#a07c40"][(Math.random() * 4) | 0], emit: false, g: 0 });
    // fireflies under the open sky: the night's, thinning out as the sun comes up
    if (area.base.outdoor) for (let n = this.rolls(3 * this.zoom * this.zoom * (1 - sun)); n > 0; n--)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 6 + Math.random() * 20, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 3, life: 4, kind: "mote", col: "#d8f080", emit: true, g: 0 });
    // by day: pollen on the air and the odd butterfly instead
    if (area.base.outdoor) for (let n = this.rolls(1.2 * this.zoom * this.zoom * sun); n > 0; n--)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 8 + Math.random() * 18, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 6, life: 5, kind: "mote", col: ["#f0e8c0", "#e8c860", "#d8d0e8", "#e89a5a"][(Math.random() * 4) | 0], emit: false, g: 0 });
    // and the open air sounds its hour: birds by day, crickets by night, a hush while one hands over to the other
    if (area.base.outdoor && (this.skyT -= edt) <= 0) {
      this.skyT = 2.5 + Math.random() * 6;
      if (sun > 0.6) this.sfx.bird(); else if (sun < 0.25) this.sfx.cricket();
    }
    // drips
    area.drips.forEach((d, i) => {
      this.dripT[i] -= edt;
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
      for (let n = this.rolls(fire.embers); n > 0; n--)
        this.spawn({ x: p.x + (Math.random() - 0.5) * 4, y: p.y + fire.emberDy, z: 14, vx: (Math.random() - 0.5) * 6, vz: 10 + Math.random() * 10, life: 1 + Math.random(), kind: "ember", col: Math.random() < 0.5 ? "#ffb040" : "#ff6a1a", emit: true, g: -4 });
    }
    // chimney smoke over the town's roofs (props with a `smoke` row), leaning on the same night wind as the leaves
    for (const p of area.props) {
      const sm = propDef(p.kind).smoke;
      if (!sm || Math.abs(p.x - this.cam.x - VW / 2) > VW / 2 + 40 || Math.abs(p.y - this.cam.y - VH / 2) > VH / 2 + 70) continue;
      for (let n = this.rolls(sm.rate * (tendedAt(area, p.x, p.y) ? hearthSmoke(hour) : 1)); n > 0; n--) // thick at breakfast and supper
        this.spawn({ x: p.x + sm.dx + (Math.random() - 0.5) * 3, y: p.y, z: sm.z, vx: 3 + Math.random() * 4, vy: (Math.random() - 0.5) * 1.5, vz: 7 + Math.random() * 5, life: 2.2 + Math.random() * 1.8, kind: "smoke", col: Math.random() < 0.5 ? "#6e6a70" : "#585460", g: -1, size: 2, emit: false });
    }
    // ambient dust motes
    for (let n = this.rolls(8 * this.zoom * this.zoom); n > 0; n--)
      this.spawn({ x: this.cam.x + Math.random() * VW, y: this.cam.y + Math.random() * VH, z: 4 + Math.random() * 30, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 5, kind: "mote", col: "#b8b0a0", emit: false, g: 0 });
    // moonbeam motes
    const moon = this.view.byId("moon");
    if (moon) for (let n = this.rolls(5); n > 0; n--)
      this.spawn({ x: moon.x - 14 + Math.random() * 30, y: moon.y + 2, z: 10 + Math.random() * 70, vx: (Math.random() - 0.5) * 2, vz: -3 - Math.random() * 3, life: 6, kind: "mote", col: sun > 0.5 ? "#ffe8b0" : "#a8c0ff", emit: true, g: 0 });
    // item glints
    if (this.rolls(2) > 0) {
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
    this.updateParticles(edt);
  }

  visionArtCache: VisionArt | null = null;
  visionArt(): VisionArt {
    const a = (this.visionArtCache ??= { t: 0, npcLook: (x) => this.npcLook(x), circle: { lines: [this.circle.glow, this.circle.glowGap], r: CR }, self: () => (this.hideGolem ? null : this.selfPose) });
    a.t = this.envT;
    return a;
  }

  /** Where the golem's eye is (world px), for the scanner's glint and the data stream home. */
  eyeSpot(): { x: number; y: number; w: number; show: boolean } | null {
    if (this.hideGolem) return null;
    const pl = this.pl, lk = this.look, f = pl.facing;
    const y = Math.round(pl.y - lk.z) - 18 + Math.round(lk.dormant * 4) + Math.round(lk.dormant * 3);
    const x = Math.round(pl.x) + (f === "right" ? 2 : f === "left" ? -4 : -2);
    return { x, y, w: f === "down" ? 4 : 2, show: f !== "up" };
  }

  /** Sound and particles for the vision overlay's moments. */
  onVisionCue(c: VisionCue) {
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

  updateParticles(dt: number) { this.fx.update(dt); }

  // ---------------------------------------------------------------- UiHost
  say(text: string) { this.note = { text, t: 0 }; }

  // ---------------------------------------------------------------- CutsceneHost (screens/intro.ts)
  letterbox(on: boolean) { this.bars.to = on ? 1 : 0; if (on) this.bars.v = 1; }
  startPlay() { this.screens.set(this.S.play); }
  renderScene() { this.renderWorldScene(); }

  /** Type the monologue and ease the letterbox (presentation clock, scenes and animating overlays). */
  stepMonologue(dt: number) {
    const s = this.monologue.update(dt);
    if (s.started) this.sfx.thoughtStart();
    for (let i = 0; i < s.typed; i++) this.sfx.thoughtTick(s.tone === "void");
    const b = this.bars;
    if (b.v !== b.to) b.v = b.to > b.v ? Math.min(b.to, b.v + dt * 4) : Math.max(b.to, b.v - dt * 2.2);
  }

  /** Cutscene letterbox bars (they slide away when the player gets control). */
  renderBars() {
    const b = this.bars.v;
    if (b <= 0) return;
    const e = b * b * (3 - 2 * b), h = Math.round(14 * e);
    this.fctx.fillStyle = "#000";
    this.fctx.fillRect(0, 0, W, h); this.fctx.fillRect(0, H - h, W, h);
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

  /** A height on the fixed 320x180 layer, as a height on the scaled UI canvas (a notice shown above the dialogue box). */
  fromFixedY(y: number) { return (y * uiMetrics(this.settings.str("uiScale")).uh) / H; }

  /** The notice (`say`): centred at the screen's foot by default; the overlay screens place it under their panel. */
  renderNote(y = edge().b - 40) {
    if (!this.note) return;
    const ctx = this.ctx;
    ctx.globalAlpha = clamp(3 - this.note.t, 0, 1);
    labelS(ctx, this.note.text, edge().cx, y, "#f0e2bc", "center", "#000");
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- render
  render() {
    // drawn between the last two ticks (view/interp.ts); the sim's own positions are put back afterwards
    const restore = this.interp.apply(this.world, this.pl.area);
    try {
      const L = this.hiLayout(), hx = this.hctx;
      this.fctx.clearRect(0, 0, W, H);
      this.fctx.imageSmoothingEnabled = false;
      this.ctx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
      this.ctx.imageSmoothingEnabled = false;
      hx.setTransform?.(1, 0, 0, 1, 0, 0);
      hx.clearRect(0, 0, this.hiCanvas.width, this.hiCanvas.height);
      hx.setTransform?.(L.k, 0, 0, L.k, 0, 0);
      hx.imageSmoothingEnabled = false;
      // interface text asked for on the base grid (ui/text.ts) is drawn on this layer, in the v2 face
      bindUiText({ base: this.ctx, fixed: this.fctx, hi: hx, s: L.s, k: L.k, uw: L.uw, uh: L.uh });
      this.learnNames();
      // the game speed's look: a grade on the world canvas and an overlay on the fixed layer, under the interface
      this.timeFx.applyFilter(this.canvas);
      this.timeFx.render(this.fctx);
      this.renderPauseLabel();
      this.gui.begin(hx, L.lw, L.lh, this.guiInput(L.lw, L.lh));
      this.screens.render();
      this.hud.render();
      this.gui.end();
    } finally { restore(); }
    const m = this.mouse;
    m.pressed = false; m.released = false; m.rpressed = false; m.wheel = 0;
  }

  /** "PAUSED" in the middle of the screen while the pause look is showing (it fades in and out with the look). */
  private renderPauseLabel() {
    const a = this.timeFx.cur.pauseA;
    if (a < 0.02) return;
    const f = this.fctx, was = f.globalAlpha;
    f.globalAlpha = Math.min(1, a);
    labelS(f, "Paused", W / 2, H / 2 - 34, "#ffffff", "center", "#000", { case: "raw", bold: true });
    f.globalAlpha = Math.min(1, a) * 0.8;
    labelS(f, "Press P to resume", W / 2, H / 2 - 22, "#d8d8d8", "center", "#000", { case: "raw" });
    f.globalAlpha = was;
  }

  renderWorldScene() {
    this.view.flush();
    this.renderWorld();
    this.renderHud();
  }

  /** The pose the golem was last drawn in (world px): vision mode outlines it so it never gets lost under highlights. */
  selfPose: { pose: GolemPose; x: number; y: number } | null = null;

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
      if (a.kind === "keeper") continue; // a keeper's look is all in keeperArt.ts
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
  updateWorkerLook(a: Actor, dt: number) {
    const L = this.npcLook(a);
    const inp = { powered: powered(a), active: actorActive(a), moving: a.moving, hasCore: !!a.powerCore };
    if (!L.worker || this.t - L.seen > 0.5) { L.worker = initWorkerAnim(inp); if (!L.arrived) L.lift = 0; }
    L.seen = this.t; L.arrived = false;
    stepWorkerAnim(L.worker, dt * this.envScale, inp);
    for (const cue of drainCues(L.worker)) this.reactions.workerCue(a, cue);
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
      if (task.t - dt <= 0) this.reactions.runeBlip(c.x, c.y, 0.7);
    } else L.lift = Math.max(0, L.lift - dt * 26);
    // its core and lamp light the floor round it
    const lt = this.view.dynamicLight("npc:" + a.id, () => makeLight(a.x, a.y - 9, 38, [1, 0.38, 0.34], 0, 0.07, "npc:" + a.id));
    lt.x = a.x; lt.y = a.y - 9 - L.lift;
    if (Math.abs(lt.x - lt.vx) > 2 || Math.abs(lt.y - lt.vy) > 2) computeVis(lt, this.area);
    lt.int = L.worker.out.core * 0.2 + L.worker.out.eye * 0.1 + (task?.kind === "channel" ? 0.3 : 0);
  }

  /** A townsperson, one frame: the watch's lantern lights the street round them after dark. */
  updateFolkLook(a: Actor) {
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
  renderFolkBubbles(dt: number) {
    const ctx = this.wctx, area = this.area, camX = this.cam.x, camY = this.cam.y;
    for (const [id, b] of this.bubbles) { b.t += dt; if (b.t > b.dur) this.bubbles.delete(id); }
    // a shop out of hours: a card on the counter where the keeper would stand
    const shop = shopOfArea(area.id), counter = shop && !shopOpen(this.world, shop.id) ? area.base.spots?.find((s) => s.id === "keeper") : undefined;
    if (counter) drawClosedSign(ctx, Math.round(counter.x - camX), Math.round(counter.y - camY) + 12);
    for (const a of this.world.actors) {
      if (a.area !== area.id || !(a.kind === "folk" ? folkPresent(a) && !!a.life : a.kind === "keeper" && keeperPresent(a))) continue;
      const x = Math.round(a.x - camX), y = Math.round(a.y - camY);
      if (x < -60 || y < -60 || x > this.vw + 60 || y > this.vh + 60) continue;
      if (a.life?.pose === "lie") {
        const k = (this.envT * 0.5 + hash01(a.id, 4)) % 1;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        drawTextS(ctx, k < 0.5 ? "z" : "Z", x + 4 + k * 6, y - 26 - k * 10, "#d8e0f0", 1, "left", "#1a1418");
        ctx.globalAlpha = 1;
      }
      const b = this.bubbles.get(a.id);
      if (!b) continue;
      const fade = clamp(Math.min(b.t / 0.12, (b.dur - b.t) / 0.25), 0, 1), top = y - (a.life?.pose === "sit" ? 27 : a.kind === "keeper" ? 26 : 30);
      ctx.globalAlpha = fade;
      if (b.text) drawSpeech(ctx, b.text, x, top, this.vw);
      else if (b.icon) drawChatIcon(ctx, b.icon, x + 3, top - Math.round((1 - fade) * 3));
      ctx.globalAlpha = 1;
    }
  }

  renderHud() {
    // Cinema and screen-wide fades are drawn on the fixed layer; the readouts on the scaled UI canvas (ctx), anchored to its edges.
    const ctx = this.fctx, ui = this.ctx, e = edge();
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
    if (this.arriveFade > 0) { ctx.fillStyle = `rgba(235,240,255,${this.arriveFade * this.flashK})`; ctx.fillRect(0, 0, W, H); }
    if (this.doorFade > 0) { ctx.fillStyle = `rgba(6,5,9,${this.doorFade})`; ctx.fillRect(0, 0, W, H); }
    this.renderBars();
    // below the letterbox while it is up; it rises with the bars as control is handed over
    const bar = this.bars.v * this.bars.v * (3 - 2 * this.bars.v);
    drawMonologue(ctx, this.monologue, this.t, 7 + Math.round(12 * bar));
    if (this.screens.is("play")) { this.renderNote(); this.vision.drawHud(ui, e.r); this.renderClock(); }
    // debug message
    if (this.debugMsg) {
      ui.globalAlpha = clamp(2 - this.debugMsg.t, 0, 1);
      labelS(ui, this.debugMsg.text, e.cx, e.t + 6, "#ff9a5a", "center");
      ui.globalAlpha = 1;
    }
    // debug readout: active modes, and (menu option) where the golem is
    if (this.debugHud || this.debugNoclip || this.debugSpeed) {
      const pl = this.pl, modes = [this.debugNoclip ? "NOCLIP" : "", this.debugSpeed ? `SPEED X${this.debugSpeedMult}` : ""].filter(Boolean).join("  ");
      const lines = [
        ...(this.debugHud ? [`${pl.area.toUpperCase()}  X ${Math.round(pl.x)}  Y ${Math.round(pl.y)}  TILE ${Math.floor(pl.x / TS)},${Math.floor((pl.y - 3) / TS)}`] : []),
        ...(modes ? [`DEBUG: ${modes}`] : []),
      ];
      // above the speed bar, which has the corner
      lines.forEach((l, i) => labelS(ui, l, e.l + 4, e.b - 20 - (lines.length - 1 - i) * 7, "#ff9a5a", "left", "#000"));
    }
    // toast (the dialogue box draws it above itself)
    if (!this.screens.is("schem") && !this.screens.is("dialogue")) this.renderToast(e.b - 26);
  }

  /**
   * The hour, bottom right: the sun, the moon, or the sun on the horizon, and the clock. Shown under the open sky, and
   * anywhere once the golem has been up to see it (it keeps count from then on; before that it has no way to know).
   */
  renderClock() {
    if (!this.area.base.outdoor && !hasFlag(this.world, FLAGS.tutorialDone)) return;
    const ctx = this.ctx, hour = worldHour(this.world), ph = phaseAt(hour), e = edge(), x = e.r - 35, y = e.b - 11;
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
    label(ctx, clockText(hour), x + 10, y + 1, ph === "night" ? "#a8b4d8" : ph === "day" ? "#e8d8a0" : "#f0b078");
  }

  renderToast(y: number) {
    const ctx = this.ctx;
    if (this.toast) {
      const t = this.toast.t;
      const a = t < 0.2 ? t / 0.2 : t > 2.5 ? 1 - (t - 2.5) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      const name = titled(this.toast.name);
      const w = Math.ceil(labelW(name)) + 31;
      const x = Math.round(edge().cx - w / 2);
      occlude(ctx, x, y, w, 20);
      ctx.fillStyle = "#0c0a0e"; ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = "#3a3540"; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + 19, w, 1); ctx.fillRect(x, y, 1, 20); ctx.fillRect(x + w - 1, y, 1, 20);
      ctx.drawImage(this.toast.icon.a, x + 3, y + 2);
      label(ctx, name, x + 23, y + 8, "#d8d0b8");
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- Phase 0: delegates to the split-out layers
  drainEvents() { this.reactions.drainEvents(); }
  renderWorld() { this.renderer.renderWorld(); }
  coreSparks(a: Actor, n: number, bright: boolean) { this.reactions.coreSparks(a, n, bright); }
  npcSparks(a: Actor, n: number) { this.reactions.npcSparks(a, n); }
  npcDust(a: Actor) { this.reactions.npcDust(a); }

  // ---------------------------------------------------------------- Phase 0: settings, keys and game speed
  /**
   * The UI layers' geometry by the UI scale setting (ui/scale.ts). The hi-res layer is always HI_W x HI_H; `k` canvas
   * px make one logical px (one font px): Large 4, Normal 3, Compact 2. The scaled UI canvas (`ctx`: the HUD and the
   * overlay screens) is uw x uh UI px, 1:1: 320x180 at Large, which is the interface as designed, and larger canvases
   * at the smaller scales, so everything drawn on it (frames, sprites and text alike) shrinks together.
   */
  hiLayout(): { cw: number; ch: number; lw: number; lh: number; k: number; s: number; uw: number; uh: number } {
    const m = uiMetrics(this.settings.str("uiScale"));
    return { cw: HI_W, ch: HI_H, lw: HI_W / m.k, lh: HI_H / m.k, k: m.k, s: m.s, uw: m.uw, uh: m.uh };
  }
  /** Names in play (workers the keeper named, townsfolk, shopkeepers), for the interface's casing: "Bob", not "bob". */
  private namesAt = -1;
  private namesOf: World | null = null;
  learnNames() {
    if (!this.world) return;
    if (this.namesOf !== this.world) { forgetNames(); this.namesOf = this.world; this.namesAt = -1; }
    if (this.t - this.namesAt < 1 && this.namesAt >= 0) return;
    this.namesAt = this.t;
    const out: string[] = [];
    for (const a of this.world.actors) { if (a.name) out.push(a.name); if (a.person?.name) out.push(a.person.name); if (a.keeper?.name) out.push(a.keeper.name); }
    learnNames(out);
  }
  /** Apply every setting (ui/settings.ts) to the systems that read it. */
  applySettings() {
    const s = this.settings;
    this.sfx.setVolumes({ master: s.num("volMaster") / 100, sfx: s.num("volSfx") / 100, ambient: s.num("volAmbient") / 100 });
    this.cam.shakeOn = s.bool("shake"); this.cam.shakeScale = s.num("shakeAmt") / 100;
    if (!this.cam.shakeOn) { this.cam.shakeT = 0; this.cam.shakeMag = 0; }
    this.interp.enabled = s.bool("interp");
    const p = applyPalette(s.str("palette"));
    this.gui.palette = { alert: p.alert, warn: p.warn, info: p.info, select: p.select };
    const L = this.hiLayout();
    let resized = false;
    if (this.hiCanvas && (this.hiCanvas.width !== L.cw || this.hiCanvas.height !== L.ch)) { this.hiCanvas.width = L.cw; this.hiCanvas.height = L.ch; resized = true; }
    if (this.uiCanvas.width !== L.uw || this.uiCanvas.height !== L.uh) { this.uiCanvas.width = L.uw; this.uiCanvas.height = L.uh; this.ctx.imageSmoothingEnabled = false; resized = true; }
    if (resized) this.onView?.(this.vw, this.vh);
    if (this.world) this.applyLod();
  }
  /** Simulation LOD (sim/lod.ts) on the presented world, by the setting. */
  applyLod() {
    if (this.settings.bool("lod")) { if (!this.world.lod) enableLod(this.world); }
    else this.world.lod = null;
  }
  /** How much of a white flash to show (accessibility: bright flashes off dims them to a soft fade). */
  get flashK() { return this.settings.bool("flashes") ? 1 : 0.25; }

  keysFor(a: Action) { return this.settings.keys(a); }
  /** A play-screen action pressed this frame (its remappable keys). */
  act(a: Action) { return this.hit(...this.keysFor(a)); }
  /** A play-screen action held. */
  held(a: Action) { return this.has(...this.keysFor(a)); }

  setSpeed(s: number) {
    const next = ((GAME_SPEEDS as readonly number[]).includes(s) ? s : 1) as GameSpeed;
    if (next === this.speed) return;
    if (next > 0) this.lastSpeed = next;
    this.speed = next;
    this.sfx.tone(next === 0 ? 300 : 380 + next * 30, 0.06, "triangle", 0.03);
  }
  togglePause() { this.setSpeed(this.speed === 0 ? this.lastSpeed || 1 : 0); }
  speedKeys() {
    if (this.act("pause")) this.togglePause();
    // Gamepad LT / RT step the ladder one rung (the keyboard has no step keys).
    if (this.hit("padfaster")) this.setSpeed(stepSpeed(this.speed, 1));
    if (this.hit("padslower")) this.setSpeed(stepSpeed(this.speed, -1));
    // 1..5 pick the speed straight: 1 pause, 2 1x, 3 2x, 4 4x, 5 8x (GAME_SPEEDS in order). Fixed keys, not remappable.
    SPEED_KEYS.forEach((k, i) => { if (this.hit(k)) this.setSpeed(GAME_SPEEDS[i]); });
  }
  /** An alert came into the feed: pause, if the player asked for that (settings: Pause on alert). */
  onAlert(n: Note) {
    if (!this.settings.bool("pauseOnAlert") || this.speed === 0 || !this.screens.is("play")) return;
    this.setSpeed(0);
    this.notes.push(`Paused: ${n.text}`, "info", "pausedAlert");
  }
  /** Every sim event passes here first: the ones a manager should hear about become notes (ui/notify.ts). */
  noteEvent(e: SimEvent) {
    const n = noteForEvent(this.world, e);
    if (n) this.notes.push(n.text, n.level, n.key);
  }

  // ---------------------------------------------------------------- Phase 0: mouse (App.tsx), base-layer px
  pointerMove(x: number, y: number) { this.mouse.x = x; this.mouse.y = y; }
  pointerLeave() { this.mouse.x = NaN; this.mouse.y = NaN; this.mouse.down = false; }
  pointerDown(button: number, x: number, y: number) {
    this.pointerMove(x, y);
    if (button === 2) { this.mouse.rdown = true; this.mouse.rpressed = true; return; }
    this.mouse.down = true; this.mouse.pressed = true;
    if (!this.gui.pointerOver) this.pressed.add("click");
  }
  pointerUp(button: number, x: number, y: number) {
    this.pointerMove(x, y);
    if (button === 2) { this.mouse.rdown = false; return; }
    this.mouse.down = false; this.mouse.released = true;
  }
  /** The widget kit's input this frame, in the hi-res layer's logical px. */
  guiInput(lw: number, lh: number): GuiInput {
    const k = this.uiPressed, has = (...ks: string[]) => ks.some((x) => k.has(x));
    // Held keys repeat for the widgets' cursor moves (up / down / left / right / tabs), never for activate or back, and
    // not on the play screen, where W A S D walk and the HUD's few widgets must not take the focus along.
    const rk = this.screens.is("play") ? null : this.uiRepeat, step = (...ks: string[]) => has(...ks) || (rk !== null && ks.includes(rk));
    const fresh = { up: has("arrowup", "w"), down: has("arrowdown", "s"), left: has("arrowleft", "a"), right: has("arrowright", "d"), activate: has("enter", "e", " "), back: has("escape"), prevTab: has("q"), nextTab: has("r") };
    return {
      mx: (this.mouse.x * lw) / W, my: (this.mouse.y * lh) / H, down: this.mouse.down, pressed: this.mouse.pressed, released: this.mouse.released, rpressed: this.mouse.rpressed, wheel: this.mouse.wheel,
      keys: { ...fresh, up: step("arrowup", "w"), down: step("arrowdown", "s"), left: step("arrowleft", "a"), right: step("arrowright", "d"), prevTab: step("q"), nextTab: step("r") },
      fresh,
      t: this.t, dt: this.frameDt,
    };
  }

  // ---------------------------------------------------------------- Phase 0: saves (world/saveStore.ts)
  /** Use another save store (App.tsx opens IndexedDB and hands it over); slots saved before then come along. */
  useStore(s: SaveStore) {
    const old = this.store;
    for (const m of old.list()) { const t = old.raw(m.slot); if (t && !s.has(m.slot)) { try { s.importText(t, m.slot); } catch { /* it never loaded */ } } }
    s.onError = (msg) => this.notes.push(msg, "warn", "store");
    this.store = s;
  }
  /** The autosave, with its rolling backups. Only from the play screen, never mid-cutscene. */
  autosaveNow(why: "timer" | "area") {
    this.autosave.t = 0;
    if (!this.screens.is("play")) return;
    try { this.store.autosave(this.world); this.notes.push(why === "area" ? "Autosaved (new area)" : "Autosaved", "info", "autosave"); }
    catch (e) { this.notes.push(`Autosave failed: ${(e as Error).message}`, "warn", "autosave"); }
  }
  stepAutosave(dt: number) {
    const mins = this.settings.num("autosave");
    if (this.bars.v > 0 || this.monologue.pinned) return;
    if (mins > 0 && (this.autosave.t += dt) >= mins * 60) this.autosaveNow("timer");
    if (this.autosave.soon > 0 && (this.autosave.soon -= dt) <= 0) { this.autosave.soon = -1; if (mins > 0) this.autosaveNow("area"); }
  }
  /** The player came into another area: autosave shortly (once the fade is over); the HUD's picks were of the old one. */
  onAreaChanged() { this.autosave.soon = 2; this.hud?.reset(); }
  /** Download a slot as a file. */
  exportSlot(slot: string): boolean {
    const text = this.store.exportText(slot);
    if (!text) return false;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return downloadText(`dustwake-${slot}-${stamp}.json`, text);
  }
  /** Ask for a save file and store it in a slot (checked first: a file that does not load is refused, with the reason). */
  importToSlot(slot: string) {
    pickTextFile().then((text) => {
      try { const m = this.store.importText(text, slot); this.notes.push(`Imported into ${m.label}`, "info", "import"); }
      catch (e) { this.notes.push(`Import failed: ${(e as Error).message}`, "warn", "import"); }
    }, () => { /* cancelled */ });
  }

  // ---------------------------------------------------------------- Phase 0: generated areas (world/areaSpec.ts)
  /** Dev: make a generated area under where the golem stands, linked there, and go down into it. */
  devCreateFloor(kind: "floor" | "cave" = "floor") {
    const w = this.world, pl = this.pl, parent = this.area, n = w.specs.size + 1;
    const depth = (w.specs.get(parent.id)?.depth ?? 0) + 1;
    const area = createArea(w, {
      kind, seed: (w.seed ^ Math.imul(n, 0x9e3779b1)) >>> 0, w: 56, h: 36, parent: parent.id, depth,
      link: { area: parent.id, x: Math.round(pl.x), y: Math.round(pl.y) }, label: `${kind === "cave" ? "Cave" : "Test floor"} ${n} (depth ${depth})`,
    });
    this.debugTeleport({ label: area.id, group: "generated", area: area.id, x: area.base.start.x, y: area.base.start.y });
    this.notes.push(`Went down into ${w.specs.get(area.id)?.label ?? area.id}`, "info", "floor");
    return area;
  }
  /** Dev: back up to the spot a generated area hangs off. */
  devLeaveFloor(): boolean {
    const spec = this.world.specs.get(this.area.id);
    if (!spec?.link) return false;
    return this.debugTeleport({ label: spec.link.area, group: "generated", area: spec.link.area, x: spec.link.x, y: spec.link.y - 20 });
  }

}


/** The vision target id of an interaction target (sim/analysis.ts: visionTargets ids). */
function visionId(t: Target): string | null {
  return t.propId ?? t.looseId ?? t.actorId ?? (t.tx !== undefined && t.ty !== undefined ? `tile:${t.tx},${t.ty}` : null);
}
