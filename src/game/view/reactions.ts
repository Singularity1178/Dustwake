// The event-reaction layer, split out of game.ts (Phase 0.6): the World's events
// drained each tick and turned into sound, particles, notes, toasts, screen shakes
// and screens. Audience rules (view/audience.ts) decide what is the player's, what
// is nearby, and what stays silent; every event also passes the notification feed
// (Game.noteEvent). Presentation only: it never changes the World except through
// the sim's own entry points.
import { ITEMS, ITEM_NAMES } from "../content/items";
import { coreCheck } from "../sim/power";
import { isStation } from "../content/crafting";
import { reactToEvents, playerThinks } from "../sim/monologue";
import { learnedText } from "../content/flags";
import { portalById } from "../sim/portals";
import { itemIcon } from "../art/items";
import { SLAM_HIT } from "../content/tasks";
import { RUNE_NODES } from "../content/runes";
import { actorById, type SimEvent } from "../world/world";
import { ZOOM_DEFAULT } from "./zoom";
import { actorDef } from "../content/actors";
import { type AnimCue } from "../workerAnim";
import { eventAudience } from "./audience";
import { npcActor } from "../sim/dialogue";
import type { Actor } from "../world/world";
import { folkLabel, sayTime } from "../sim/folk";
import { keeperLabel } from "../sim/shops";
import { type DayPhase } from "../content/daycycle";
import type { Game } from "../game";

/** How near the golem must be to read townsfolk's own talk as words (px), and how many such lines show at once besides a talk already going. */
const FOLK_EARSHOT = 170, FOLK_MAX_LINES = 3;

export class EventReactions {
  /** One chime per analyzed prop, however many plans it held. */
  lastAnalyzed = { prop: "", t: -1 };

  constructor(private g: Game) {}

  drainEvents() {
    // Monologue triggers must see events from paused-world commands (a book, the pack) before they are drained.
    reactToEvents(this.g.world);
    const evs = this.g.world.events;
    if (!evs.length) return;
    this.g.world.events = [];
    for (const e of evs) {
      this.g.noteEvent(e); // the notification feed hears everything first (ui/notify.ts)
      if (e.t === "travelled" && e.actor !== this.g.world.playerId) { this.workerTravelled(e); continue; }
      if (e.t === "portal" && actorById(this.g.world, e.actor)?.kind === "folk") continue; // townsfolk come and go quietly
      if (e.t === "portal" && e.actor !== this.g.world.playerId) { this.workerWalked(e); continue; }
      const aud = eventAudience(this.g.world, e);
      if (aud === "player") this.onEvent(e);
      else if (aud === "nearby") this.onNearby(e);
    }
  }

  /** Another actor in the player's area did something: world-space feedback only. */
  onNearby(e: SimEvent) {
    if (e.t === "step") {
      const a = actorById(this.g.world, e.actor);
      if (a) for (let i = 0; i < 2; i++)
        this.g.spawn({ x: a.x + (Math.random() - 0.5) * 8, y: a.y, z: 1, vx: (Math.random() - 0.5) * 12, vz: 6, life: 0.5, kind: "dust", col: "#8a8478", g: 20 });
    } else if (e.t === "harvestHit") {
      if (e.kind === "tree" || e.kind === "log") this.g.sfx.thud(); else this.g.sfx.clink();
      for (let i = 0; i < (e.depleted ? 14 : 6); i++)
        this.g.spawn({ x: e.x + (Math.random() - 0.5) * 10, y: e.y, z: 6 + Math.random() * 8, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 14, vz: 10 + Math.random() * 20, life: 0.8, kind: "debris", col: e.kind === "rock" ? "#6a6372" : "#6a5034", g: 120 });
    } else if (e.t === "cue") {
      // Cues are local sound/particles for the worker that made them: no screen
      // shake, fizz timer or crack flash, because those belong to the player.
      if (e.cue === "clank") this.g.sfx.clank();
      else if (e.cue === "scrape") this.g.sfx.scrape();
      else if (e.cue === "dud" || e.cue === "runeDud") this.g.sfx.fizzle();
      else if (e.cue === "scrapeDust") {
        this.g.sfx.scrape();
        for (let i = 0; i < 4; i++) this.g.spawn({ x: e.x, y: e.y, z: 2, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.8, kind: "dust", col: "#9a96a0", g: 20 });
      } else if (e.cue === "push") {
        this.g.sfx.thud();
        for (let i = 0; i < 6; i++) this.g.spawn({ x: e.x + (Math.random() - 0.5) * 16, y: e.y + 2, z: 20 + Math.random() * 10, vx: (Math.random() - 0.5) * 10, life: 1.5, kind: "debris", col: "#6a6372", g: 80 });
      }
    }
  }

  /** Sound, particles and UI reactions to the player's (and world) simulation events. */
  onEvent(e: SimEvent) {
    const pl = this.g.pl;
    switch (e.t) {
      case "itemGained": {
        const n = e.n ?? 1;
        this.g.toast = { icon: itemIcon(e.item), name: ITEM_NAMES[e.item] + (n > 1 ? ` x${n}` : ""), t: 0 };
        this.g.sfx.pickup();
        if (e.stored) for (let i = 0; i < 10; i++) this.g.spawn({ x: pl.x, y: pl.y - 4, z: 14, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 20, vz: 20 + Math.random() * 20, life: 0.6, kind: "glint", col: "#fff0c0", emit: true, g: 40 });
        const def = ITEMS[e.item], id = e.item;
        if (def.opensOnPickup) this.g.later(0.5, () => { if (this.g.screens.is("play")) def.opens === "book" ? this.g.bookUi.open(id) : this.g.schemUi.open(); });
        break;
      }
      case "itemDropped":
        this.g.sfx.thud();
        for (let i = 0; i < 6; i++) this.g.spawn({ x: e.x + (Math.random() - 0.5) * 8, y: e.y, z: 2, vx: (Math.random() - 0.5) * 14, vz: 8, life: 0.6, kind: "dust", col: "#8a8478", g: 20 });
        if (e.reason !== "drop") this.g.say(e.reason === "full" ? "PACK FULL - LEFT ON THE GROUND" : "NO ROOM - DROPPED ON THE GROUND");
        break;
      case "packFull": this.g.say("YOUR PACK IS FULL"); this.g.sfx.tone(180, 0.1, "square", 0.04); break;
      case "message": this.g.say(e.text); break;
      case "folkSpoke": {
        const a = actorById(this.g.world, e.folk);
        const label = a?.person ? folkLabel(a) : a?.keeper ? keeperLabel(a) : null;
        if (a && label) { this.g.bubbles.set(a.id, { text: e.line, t: 0, dur: 2.4 + e.line.length * 0.055 }); this.g.say(label); this.g.sfx.tone(520, 0.05, "triangle", 0.03); }
        break;
      }
      case "folkSay": {
        // Their own talk (to each other, to a keeper, to themselves): the words in a bubble when it is near and the
        // street is not already full of words; otherwise the pictogram from `folkChat` stands. Never a dialogue screen.
        const a = actorById(this.g.world, e.folk);
        if (!a || a.area !== this.g.pl.area) break;
        const cur = this.g.bubbles.get(a.id);
        if (cur?.text && !cur.talk) break; // answering the golem: that line stays
        const near = Math.hypot(a.x - this.g.pl.x, a.y - this.g.pl.y) < FOLK_EARSHOT;
        const partner = e.to ? this.g.bubbles.get(e.to) : undefined;
        let others = 0;
        for (const [id, b] of this.g.bubbles) if (b.text && id !== a.id && id !== e.to && b.t < b.dur - 0.3) others++;
        if (!near || (others >= FOLK_MAX_LINES && !partner?.talk && !cur?.talk)) break;
        if (partner?.talk && e.to) this.g.bubbles.delete(e.to); // in turn: one side of a talk at a time
        this.g.bubbles.set(a.id, { text: e.line, t: 0, dur: sayTime(e.line), talk: true });
        break;
      }
      case "folkChat": {
        const a = actorById(this.g.world, e.folk);
        if (a && a.area === this.g.pl.area && !this.g.bubbles.get(a.id)?.text) this.g.bubbles.set(a.id, { icon: e.icon, t: 0, dur: 1.5 });
        break;
      }
      case "analyzed":
        // one chime per prop, however many plans it held
        if (this.lastAnalyzed.prop !== e.prop || this.g.t - this.lastAnalyzed.t > 0.2) this.g.sfx.analyzed();
        this.lastAnalyzed = { prop: e.prop, t: this.g.t };
        break;
      case "learned":
        this.g.sfx.insight(); this.g.eyeBoost = 1.5;
        this.g.say(learnedText(e.flag));
        break;
      case "thought":
        this.g.monologue.push(e.line);
        break;
      case "harvestHit": {
        const tree = e.kind === "tree" || e.kind === "log";
        if (tree) this.g.sfx.thud(); else this.g.sfx.clink();
        this.g.shake(e.depleted ? 0.35 : 0.12, e.depleted ? 2 : 1);
        if (e.depleted && !tree) this.g.sfx.smash();
        const cols = tree ? ["#5b3d24", "#7a5634", "#3e6a30", "#5a8a40"] : ["#8a8392", "#6a6372", "#4b4552"];
        for (let i = 0; i < (e.depleted ? 26 : 10); i++)
          this.g.spawn({ x: e.x + (Math.random() - 0.5) * 12, y: e.y, z: tree && i % 2 ? 20 + Math.random() * 14 : 6 + Math.random() * 6, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 10 + Math.random() * 30, life: 1 + Math.random(), kind: "debris", col: cols[(Math.random() * cols.length) | 0], g: tree && i % 2 ? 30 : 120 });
        break;
      }
      case "deconstructed":
        this.g.sfx.clink(); this.g.sfx.noise(0.2, 0.1, "bandpass", 900, 2);
        for (let i = 0; i < 12; i++) this.g.spawn({ x: e.x + (Math.random() - 0.5) * 10, y: e.y, z: e.kind === "torch" || e.kind === "banner" ? 10 : 4, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 16, vz: 10 + Math.random() * 20, life: 0.7, kind: "debris", col: Math.random() < 0.5 ? "#7a5634" : "#6a6372", g: 120 });
        break;
      case "openStation":
        // E on a station: the bench, the smelter or the anvil, each the same screen under its own name (content/crafting.ts).
        if (e.actor === this.g.world.playerId && this.g.screens.is("play") && isStation(e.station)) this.g.craftUi.open(e.station, e.prop);
        break;
      case "dug": {
        // A dig stroke: earth thuds and flies brown, stone rings and flies grey. A layer giving out, and the
        // stair coming open, are said in words (the sim only reports what happened).
        const stone = e.material === "stone";
        if (stone) this.g.sfx.clink(); else this.g.sfx.thud();
        this.g.shake(e.opened ? 0.6 : 0.12, e.opened ? 3 : 1);
        const cols = stone ? ["#8a8392", "#6a6372", "#4b4552"] : ["#4e3c2a", "#5a4630", "#3e2e20"];
        for (let i = 0; i < (e.opened ? 32 : 12); i++)
          this.g.spawn({ x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * 20, z: 2 + Math.random() * 6, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 14 + Math.random() * 30, life: 0.8 + Math.random() * 0.6, kind: "debris", col: cols[(Math.random() * cols.length) | 0], g: 120 });
        if (e.actor !== this.g.world.playerId) break;
        if (e.opened) { this.g.sfx.smash(); this.g.say("THE VAULT GIVES WAY. THE OLD STAIR IS OPEN: WALK DOWN INTO IT FROM ITS SOUTH END"); }
        else if (e.next === "stone") this.g.say("THE EARTH IS OUT. FALLEN STONE LIES UNDER IT: THAT NEEDS A PICKAXE HEAD");
        break;
      }
      case "openStorage":
        // E on a storage prop: its screen (pack beside chest). Only the player's own use, from the play screen.
        if (e.actor === this.g.world.playerId && this.g.screens.is("play")) this.g.storageUi.open(e.prop);
        break;
      case "manageActor":
        // E on a worker: its management screen (state, core, orders). The golem's thought about a body with no
        // core (content/monologue.ts) still fires from this event.
        if (e.actor === this.g.world.playerId && this.g.screens.is("play") && actorById(this.g.world, e.target)) this.g.manageUi.open(e.target);
        break;
      case "coreSlotted": {
        // The core seam's feedback (sim/power.ts), both ways. In: the latch, a hum, embers, the core flaring as it
        // boots before it settles to its faint idle glow. Out: the latch, the hum falling, a puff of dust.
        const a = actorById(this.g.world, e.target);
        if (!a) break;
        const L = this.g.npcLook(a), name = ITEM_NAMES[e.item];
        if (e.inserted) {
          this.g.sfx.coreIn(e.powered);
          if (e.powered) L.flare = 1;
          this.coreSparks(a, e.powered ? 6 : 5, e.powered); // the latch; the boot animation sparks it again as it lights
          this.g.say(e.powered ? `${name} SLOTTED - IT POWERS ON` : `${name} SLOTTED`);
        } else {
          const ran = coreCheck(a, e.item).sufficient;
          this.g.sfx.coreOut(ran);
          L.flare = 0;
          for (let i = 0; i < 6; i++) this.g.spawn({ x: a.x + (Math.random() - 0.5) * 10, y: a.y, z: 6 + Math.random() * 6, vx: (Math.random() - 0.5) * 14, vz: 4 + Math.random() * 6, life: 0.8, kind: "dust", col: "#8a8478", g: 10 });
          this.g.say(ran ? `${name} TAKEN OUT - IT POWERS DOWN` : `${name} TAKEN OUT`);
        }
        break;
      }
      case "built":
        this.g.sfx.place(); this.g.sfx.tone(520, 0.2, "triangle", 0.05);
        for (let i = 0; i < 10; i++) this.g.spawn({ x: e.x, y: e.y - 14, z: 2, vx: (Math.random() - 0.5) * 30, vz: 10 + Math.random() * 20, life: 0.6, kind: "spark", col: "#ffb040", emit: true, g: 80 });
        break;
      case "runeAwakened": case "travelled":
        this.g.tele.travelled = true;
        break;
      case "step":
        this.g.sfx.step(e.heavy);
        for (let i = 0; i < (e.heavy ? 4 : 2); i++)
          this.g.spawn({ x: pl.x + (Math.random() - 0.5) * 10, y: pl.y, z: 1, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 6, vz: 8, life: 0.6, kind: "dust", col: "#8a8478", g: 20 });
        if (!e.heavy && !this.g.hasArm) this.g.sfx.scrape();
        break;
      case "taskTick": {
        const a = e.task;
        if (a.kind === "attach") { if (Math.random() < 0.5) this.g.sparkBurst(2); }
        else if (a.kind === "slam") {
          // both arms heave up (a low grind), then swing down (a whoosh) just before the blow lands
          const k0 = (a.t - e.dt) / a.dur, k1 = a.t / a.dur, down = SLAM_HIT * 0.88;
          if (k0 <= 0.02 && k1 > 0.02) this.g.sfx.slamWindup();
          if (k0 < down && k1 >= down) this.g.sfx.slamSwing();
          if (!this.g.hasArm && k1 < SLAM_HIT && Math.random() < 0.12) this.g.sparkBurst(1);
        }
        else if (a.kind === "dismantle" && a.target) {
          if (Math.floor(a.t / 0.3) !== Math.floor((a.t - e.dt) / 0.3)) this.g.sfx.clink();
          if (Math.random() < 0.3) this.g.spawn({ x: a.target.x + (Math.random() - 0.5) * 10, y: a.target.y, z: 4 + Math.random() * 8, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.5, kind: "dust", col: "#8a8478", g: 30 });
        }
        else if (a.kind === "scan" && e.actor === pl.id) {
          // the eye reads the pattern: a rising run of data chirps up to the fire point
          const fire = a.dur * 0.85, k0 = (a.t - e.dt) / fire, k1 = a.t / fire;
          if (k0 <= 0 && k1 > 0) this.g.sfx.scanStart();
          if (k1 < 1 && Math.floor(k1 * 9) !== Math.floor(k0 * 9)) this.g.sfx.scanTick(k1);
        }
        else if (a.kind === "craft") {
          if (Math.floor(a.t / 0.25) !== Math.floor((a.t - e.dt) / 0.25)) {
            this.g.sfx.clink();
            if (a.target) for (let i = 0; i < 2; i++) this.g.spawn({ x: a.target.x + (Math.random() - 0.5) * 14, y: a.target.y - 6, z: 8, vx: (Math.random() - 0.5) * 30, vz: 12 + Math.random() * 14, life: 0.4, kind: "spark", col: "#e8d8a0", emit: true, g: 120 });
          }
        }
        else if (a.kind === "carve") {
          const c = this.g.area.ritualPos;
          const k = Math.floor(a.t / 0.22), kp = Math.floor((a.t - e.dt) / 0.22);
          if (k !== kp && a.t < a.dur - 0.3) {
            this.g.sfx.clink();
            const ang = 0.26 + Math.random() * 1.05, r = 44 + Math.random() * 13;
            for (let i = 0; i < 4; i++) this.g.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, vz: 20 + Math.random() * 20, life: 0.4, kind: "spark", col: "#d0c0ff", emit: true, g: 120 });
            this.g.spawn({ x: c.x + Math.cos(ang) * r, y: c.y + Math.sin(ang) * r, z: 1, vz: 6, life: 1, kind: "dust", col: "#8a8690", g: 4 });
          }
        }
        break;
      }
      case "cue":
        if (e.cue === "clank") { this.g.sfx.clank(); this.g.shake(0.1, 1); }
        else if (e.cue === "scrape") this.g.sfx.scrape();
        else if (e.cue === "dud") { this.g.sfx.fizzle(); this.g.fizzT = 0.5; }
        else if (e.cue === "runeDud") this.runeRefused(e.x, e.y);
        else if (e.cue === "scrapeDust") {
          this.g.sfx.scrape();
          for (let i = 0; i < 4; i++) this.g.spawn({ x: e.x, y: e.y, z: 2, vx: (Math.random() - 0.5) * 20, vz: 8, life: 0.8, kind: "dust", col: "#9a96a0", g: 20 });
        } else if (e.cue === "push") {
          this.g.sfx.thud();
          this.g.shake(0.2, 1);
          for (let i = 0; i < 6; i++) this.g.spawn({ x: e.x + (Math.random() - 0.5) * 16, y: e.y + 2, z: 20 + Math.random() * 10, vx: (Math.random() - 0.5) * 10, life: 1.5, kind: "debris", col: "#6a6372", g: 80 });
          this.g.crackFlash = 1;
        }
        break;
      case "equipped":
        this.g.sfx.clank();
        this.g.shake(0.15, 1);
        this.g.sparkBurst(14);
        break;
      case "gearOn": case "gearOff":
        // Gear is light: a soft wicker creak and a quiet line (nothing like the iron arm's clank, sparks and shake).
        if (e.actor !== this.g.world.playerId) break;
        if (ITEMS[e.item].worn) this.g.sfx.tone(e.t === "gearOn" ? 700 : 420, 0.14, "triangle", 0.05); // a rune: a soft chime
        else if (e.t === "gearOn") this.g.sfx.strap(); else this.g.sfx.unstrap();
        this.g.say(e.t === "gearOn" ? (e.slot === "back" ? `${ITEM_NAMES[e.item]} ON YOUR BACK` : `${ITEM_NAMES[e.item]} EQUIPPED`) : `${ITEM_NAMES[e.item]} TAKEN OFF`);
        break;
      case "crafted":
        if (e.actor === this.g.world.playerId) { this.g.sfx.place(); this.g.say(`MADE ${e.n} ${ITEM_NAMES[e.item]}`); }
        break;
      case "containerOpened":
        this.g.sfx.open();
        for (let i = 0; i < 8; i++) this.g.spawn({ x: e.x + (Math.random() - 0.5) * 12, y: e.y, z: 6, vx: (Math.random() - 0.5) * 20, vz: 10, life: 1, kind: "dust", col: "#7a7468", g: 10 });
        break;
      case "doorUnlocked": this.g.sfx.unlock(); break;
      case "wallBroken": {
        this.g.sfx.smash();
        this.g.shake(0.7, 3.5);
        const cx = e.x, cy = e.y;
        for (let i = 0; i < 40; i++)
          this.g.spawn({ x: cx + (Math.random() - 0.5) * 16, y: cy + (Math.random() - 0.5) * 20, z: 4 + Math.random() * 18, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 60, vz: 20 + Math.random() * 60, life: 1.6 + Math.random(), kind: "debris", col: ["#8a8392", "#6a6372", "#4b4552"][(Math.random() * 3) | 0], g: 160, size: Math.random() < 0.4 ? 2 : 1 });
        for (let i = 0; i < 40; i++)
          this.g.spawn({ x: cx + (Math.random() - 0.5) * 24, y: cy + (Math.random() - 0.5) * 24, z: Math.random() * 20, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 30, vz: Math.random() * 10, life: 2 + Math.random() * 2, kind: "smoke", col: "#7a7470", g: -2, size: 2 });
        break;
      }
      case "slam": {
        // Both fists hit the ground: a deep thud, a ring of dust where they land, a small shake.
        // Whatever was hit adds its own feedback (wallBroken / withstood).
        this.g.sfx.slam();
        this.g.shake(0.18, 1.2);
        for (let i = 0; i < 16; i++) {
          const ang = Math.random() * Math.PI * 2, v = 14 + Math.random() * 24;
          this.g.spawn({ x: e.x + Math.cos(ang) * 3, y: e.y + Math.sin(ang) * 2, z: 1, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.5, vz: 6 + Math.random() * 10, life: 0.6 + Math.random() * 0.5, kind: "dust", col: Math.random() < 0.5 ? "#8a8478" : "#a09a8c", g: 20 });
        }
        if (!this.g.hasArm) this.g.sparkBurst(5); // the broken stub struck too
        break;
      }
      case "withstood": {
        // The debris takes the blow and holds: a heavy impact, a smaller shake than a break, chips and
        // dust off its face, and the debris itself jolts and flashes. Nothing in the world changes.
        this.g.sfx.impact();
        this.g.shake(0.3, 2);
        this.g.crackFlash = 1;
        if (e.tx !== undefined && e.ty !== undefined) this.g.shudder = { tx: e.tx, ty: e.ty, t: 0.45 };
        for (let i = 0; i < 14; i++)
          this.g.spawn({ x: e.x + (Math.random() - 0.5) * 16, y: e.y + 2, z: 4 + Math.random() * 20, vx: (Math.random() - 0.5) * 60, vy: Math.random() * 24, vz: 10 + Math.random() * 30, life: 0.9 + Math.random() * 0.6, kind: "debris", col: ["#8a8392", "#6a6372", "#4b4552"][(Math.random() * 3) | 0], g: 140 });
        for (let i = 0; i < 16; i++)
          this.g.spawn({ x: e.x + (Math.random() - 0.5) * 20, y: e.y + 3, z: Math.random() * 14, vx: (Math.random() - 0.5) * 24, vy: Math.random() * 10, vz: 2 + Math.random() * 6, life: 1 + Math.random(), kind: "dust", col: "#8a8478", g: 6, size: Math.random() < 0.4 ? 2 : 1 });
        break;
      }
      case "corePlaced": this.g.sfx.place(); this.g.sfx.tone(660, 1, "sine", 0.06); break;
      case "carved": this.g.sfx.tone(392, 1.2, "sine", 0.07); break;
      case "glyphPlaced": this.g.sfx.place(); break;
      case "runeActivated": this.g.sfx.activate(); this.g.shake(1.5, 1.5); break;
      case "runeFizzled": {
        this.g.fizzT = 1.2;
        this.g.sfx.fizzle();
        this.g.shake(0.4, 2);
        const c = this.g.area.ritualPos;
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2, rr = 44 + Math.random() * 13;
          this.g.spawn({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr, z: 1, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 40, vz: 30 + Math.random() * 30, life: 0.5, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
        }
        break;
      }
      case "runeDeactivated": this.g.sfx.setHum(0); break;
      case "teleport":
        this.g.tele = { x: e.x, y: e.y, dur: pl.task?.dur ?? 4.6, first: e.first, travelled: false };
        this.g.screens.set(this.g.S.tele); this.g.sfx.teleport();
        // The first jump opens the crossing (screens/crossing.ts): bars in, and the golem's own account of it begins.
        if (e.first) { this.g.letterbox(true); this.g.monologue.pinned = true; playerThinks(this.g.world, "cross.engage"); }
        break;
      case "areaEntered": break;
      case "dayPhase": this.onDayPhase(e.phase); break;
      case "portal": {
        // Walked through a doorway or out along a road (sim/portals.ts): a latch or a footfall, a short fade up from
        // dark, and the name of the place arrived in. The old area's particles stay behind.
        const dest = this.g.world.areas.get(e.toArea), out = dest && portalById(dest, e.to);
        this.g.doorFade = 1; this.g.particles = [];
        if (out?.door) this.g.sfx.open(); else this.g.sfx.step(true);
        if (out?.label) this.g.say(out.label);
        break;
      }
      case "dialogue":
        if (this.g.screens.is("play")) this.g.dialogueUi.open(e.npc, e.script, e.segment);
        break;
      case "npcState": {
        const a = npcActor(this.g.world, e.npc);
        if (!a) break;
        const L = this.g.npcLook(a);
        if (e.awake) {
          L.wakeT = 0;
          this.g.sfx.wakeSputter();
          this.npcSparks(a, 10);
          this.g.later(0.5, () => this.npcSparks(a, 6));
        } else {
          L.sleepT = 0;
          this.g.sfx.powerDown();
          this.g.later(1.1, () => { this.g.shake(0.2, 1); this.npcDust(a); });
        }
        break;
      }
      case "eyeRepaired": {
        const lk = this.g.look;
        lk.sputter = 0; lk.eye = 1;
        this.g.eyeBoost = 2.2;
        this.g.sfx.eyeRepair();
        this.g.shake(0.25, 1);
        this.g.sparkBurst(10);
        for (let i = 0; i < 24; i++)
          this.g.spawn({ x: pl.x + (Math.random() - 0.5) * 4, y: pl.y, z: 18, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 24, vz: 10 + Math.random() * 40, life: 0.4 + Math.random() * 0.5, kind: "spark", col: Math.random() < 0.5 ? "#bff4ff" : "#7fe8ff", emit: true, g: 110 });
        const by = e.by ? npcActor(this.g.world, e.by) : undefined;
        if (by) this.g.npcLook(by).reach = 1.8; // the guardian's hand holds still, then lowers
        // the camera pulls out as the eye clears; the wheel takes over from here
        this.g.later(0.5, () => this.g.zoomTo(ZOOM_DEFAULT, 1.1));
        this.g.dialogueUi.zoomHint = true;
        break;
      }
    }
  }

  /** The day turned (sim/daytime.ts). Under the open sky it is said; where people live, the town answers it. */
  onDayPhase(phase: DayPhase) {
    const a = this.g.area;
    if (!a.base.outdoor || !this.g.screens.is("play")) return;
    const town = !!a.base.tended;
    if (phase === "dawn") { this.g.say(town ? "DAWN. THE TOWN PUTS OUT ITS LAMPS." : "DAWN BREAKS."); if (town) this.g.sfx.bell(); }
    else if (phase === "dusk") { this.g.say(town ? "DUSK. THE TOWN LIGHTS ITS LAMPS." : "DUSK. THE LIGHT IS GOING."); if (town) this.g.sfx.bell(); }
    else if (phase === "night") this.g.say("NIGHT FALLS.");
  }

  /** The sounds and dust of a worker's animation cues (workerAnim.ts), quiet when it is far off. */
  workerCue(a: Actor, cue: AnimCue) {
    const near = this.g.volAt(a.x, a.y) > 0.15;
    const dust = (n: number) => { for (let i = 0; i < n; i++) this.g.spawn({ x: a.x + (Math.random() - 0.5) * 12, y: a.y + 1, z: 1, vx: (Math.random() - 0.5) * 22, vy: (Math.random() - 0.5) * 8, vz: 6 + Math.random() * 6, life: 0.6, kind: "dust", col: "#8a7a68", g: 20 }); };
    switch (cue) {
      case "spark": this.coreSparks(a, 9, true); if (near) this.g.sfx.spark(); break;
      case "creak": if (near) this.g.sfx.scrape(); break;
      case "lamp": this.coreSparks(a, 3, true); if (near) this.g.sfx.wakeSputter(); break;
      case "plant": dust(7); if (near) this.g.sfx.thud(); break;
      case "jolt": this.coreSparks(a, 8, false); dust(3); if (near) this.g.sfx.clank(); break;
      case "lampOut": if (near) this.g.sfx.tone(420, 0.25, "sine", 0.03, 110); break;
      case "settle": if (near) this.g.sfx.tone(190, 0.7, "sine", 0.035, 70); break;
    }
  }

  /** A soft rune chime and a burst of motes at (x, y): a worker leaving or arriving through a rune. */
  runeBlip(x: number, y: number, k = 1) {
    const v = this.g.volAt(x, y) * k;
    if (v > 0.05) { this.g.sfx.tone(520, 0.35, "sine", 0.06 * v, 1040); this.g.sfx.tone(780, 0.5, "triangle", 0.04 * v, undefined, 0.07); }
  }

  runeBurst(x: number, y: number) {
    this.runeBlip(x, y);
    for (let i = 0; i < 26; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 14 + Math.random() * 30;
      this.g.spawn({ x, y, z: 2 + Math.random() * 10, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.5, vz: 10 + Math.random() * 30, life: 0.7, kind: "rune", col: Math.random() < 0.4 ? "#ffffff" : Math.random() < 0.5 ? "#c0a0ff" : "#80e0ff", emit: true, g: 10 });
    }
  }

  /**
   * E on a rune that will not carry (dark, or lit with nothing answering it): the fizzle, a jolt, sparks thrown off
   * its ring, and the rune's own sputter (view/runeFx.ts), which updateWorldFx runs. The halls' circle flickers on
   * `fizzT`, as it always did for a dud; a rune that is a prop (the surface's) reads `runeDud` in surfaceRuneState.
   */
  runeRefused(x: number, y: number) {
    this.g.sfx.fizzle();
    this.g.fizzT = 0.5;
    this.g.runeDud = { x, y, t: 0 };
    this.g.shake(0.25, 1.2);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, rr = 44 + Math.random() * 13;
      this.g.spawn({ x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, z: 1, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 40, vz: 30 + Math.random() * 30, life: 0.5, kind: "spark", col: Math.random() < 0.5 ? "#ff6a8a" : "#a070ff", emit: true, g: 120 });
    }
  }

  /**
   * Another body walked through a door or off along a road (a worker under orders: sim/jobs.ts). It is only heard:
   * the latch or a footfall where it left, if that was here, else where it came out, if that is here. The view, the
   * fade and the place's name are the player's own (onEvent, "portal").
   */
  workerWalked(e: Extract<SimEvent, { t: "portal" }>) {
    const here = this.g.pl.area, a = actorById(this.g.world, e.actor);
    const from = e.fromArea === here ? portalById(this.g.area, e.from) : undefined;
    const out = !from && a && e.toArea === here ? portalById(this.g.area, e.to) : undefined;
    const at = from ? { x: from.x + from.w / 2, y: from.y + from.h / 2, door: !!from.door } : out && a ? { x: a.x, y: a.y, door: !!out.door } : null;
    if (!at || this.g.volAt(at.x, at.y) < 0.15) return;
    if (at.door) this.g.sfx.open(); else this.g.sfx.step(true);
  }

  /** Another body went through a rune: a flash where it left (if that was in the player's area) and where it landed. */
  workerTravelled(e: Extract<SimEvent, { t: "travelled" }>) {
    const a = actorById(this.g.world, e.actor), pa = this.g.pl.area;
    const from = RUNE_NODES[e.from], p = from && from.area === pa ? this.g.area.prop(from.prop) : null;
    if (p) this.runeBurst(p.x, p.y);
    if (a && a.area === pa) { const L = this.g.npcLook(a); L.lift = 13; L.arrived = true; this.runeBurst(a.x, a.y); }
  }

  /** Embers from a golem's core hatch as a core seats: bright when it powers the body, a few dull ones when too weak. */
  coreSparks(a: Actor, n: number, bright: boolean) {
    const z = actorDef(a).body.height * 0.55;
    for (let i = 0; i < n; i++)
      this.g.spawn({ x: a.x + (Math.random() - 0.5) * 4, y: a.y + 1, z: z + Math.random() * 3, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.2) * 16, vz: 8 + Math.random() * 24, life: 0.3 + Math.random() * 0.4, kind: "spark", col: bright ? (Math.random() < 0.5 ? "#ff5a70" : "#ffc0c8") : "#8a3040", emit: true, g: 110 });
  }

  npcSparks(a: Actor, n: number) {
    for (let i = 0; i < n; i++)
      this.g.spawn({ x: a.x + (Math.random() - 0.5) * 16, y: a.y - 2, z: 18 + Math.random() * 14, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 20, vz: 10 + Math.random() * 30, life: 0.3 + Math.random() * 0.4, kind: "spark", col: Math.random() < 0.5 ? "#fff2a0" : "#7fe8ff", emit: true, g: 120 });
  }

  npcDust(a: Actor) {
    for (let i = 0; i < 12; i++)
      this.g.spawn({ x: a.x + (Math.random() - 0.5) * 26, y: a.y, z: 2 + Math.random() * 6, vx: (Math.random() - 0.5) * 24, vz: 6 + Math.random() * 8, life: 1, kind: "dust", col: "#8a8478", g: 14 });
  }
}
