// The world renderer, split out of game.ts (Phase 0.6): the lit scene of the area the
// player is in, drawn into the host's scene and emissive buffers and composed through
// the lighting pass onto the world canvas, then the vision overlay. It reads the World
// and the host's presentation state (camera, looks, particles) and never changes the
// World. The overview renderer of Phase 2 sits beside it.
import { TS, T } from "../content/tiles";
import { ITEMS, isGlyph, glyphItem } from "../content/items";
import { runeMarks } from "../sim/gear";
import { propLook } from "../content/digging";
import { propDef } from "../content/props";
import { GLYPHS } from "../content/glyphs";
import { FLAGS } from "../content/flags";
import { propSprite } from "../art/props";
import { rubbleSprite, pillarSprite, doorSprite, barsSprite } from "../art/tiles";
import { itemIcon, glyphPattern } from "../art/items";
import { Pen, Sprite, hash2, clamp, lerp } from "../util";
import { drawGolem, GolemPose, slamPose } from "../golem";
import { Light } from "../light";
import { CR } from "../circle";
import { hasFlag } from "../world/world";
import type { PropInst } from "../world/area";
import { drawActor } from "./actors";
import { ambientAt, lampGain, sunLevel, type RGB } from "../content/daycycle";
import { worldHour, exposureOf } from "../sim/daytime";
import type { Game } from "../game";

/** An area with no `ambient` of its own: the dark of the buried halls. */
const BURIED_AMBIENT: RGB = [0.05, 0.045, 0.065];

export class WorldRenderer {
  constructor(private g: Game) {}

  renderWorld() {
    const sc = this.g.scene.ctx, ec = this.g.emit.ctx, area = this.g.area;
    const { x: camX, y: camY } = this.g.cam.view();
    const W = this.g.vw, H = this.g.vh; // the world layer is view-sized (zoom)
    const hour = worldHour(this.g.world);
    sc.fillStyle = "#000"; sc.fillRect(0, 0, W, H);
    ec.fillStyle = "#000"; ec.fillRect(0, 0, W, H);
    // the ground: the chunks under the camera (baked by now), then one more of the margin around it (view/areaView.ts)
    this.g.view.prepare(camX, camY, W, H);
    this.g.view.draw(sc, camX, camY, W, H);
    this.g.view.idle();
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
      const schemRead = hasFlag(this.g.world, FLAGS.knowSchematic);
      const ccx = c.x - CR - camX, ccy = c.y - CR - camY;
      if (ccx > -140 && ccx < W + 10 && ccy > -140 && ccy < H + 10) {
        sc.drawImage(this.g.circle.base, ccx, ccy);
        sc.drawImage(r.carved ? this.g.circle.gapCarved : this.g.circle.chalk, ccx, ccy);
        let lvl = r.active ? 0.55 + 0.35 * Math.sin(this.g.envT * 3) + Math.min(0.3, r.actT * 0.1) : 0.16 + 0.06 * Math.sin(this.g.envT * 1.3);
        if (this.g.fizzT > 0) lvl = Math.random() * 0.8;
        ec.globalAlpha = clamp(lvl, 0, 1);
        ec.drawImage(this.g.circle.glow, ccx, ccy);
        if (r.carved) ec.drawImage(this.g.circle.glowGap, ccx, ccy);
        if (!r.carved && schemRead) { ec.globalAlpha = 0.45 + 0.3 * Math.sin(this.g.envT * 4); ec.drawImage(this.g.circle.ghost, ccx, ccy); }
        if (r.active) {
          ec.globalCompositeOperation = "lighter";
          ec.globalAlpha = 0.35 + 0.25 * Math.sin(this.g.envT * 5);
          ec.drawImage(this.g.circle.glow, ccx, ccy);
          ec.drawImage(this.g.circle.glowGap, ccx, ccy);
          ec.globalCompositeOperation = "source-over";
        }
        ec.globalAlpha = 1;
      }
    }
    // ---- rune circles that are props (surface)
    for (const p of area.propsOfKind("runecircle")) this.drawSurfaceRune(p, camX, camY);
    // ---- sortables
    type D = { y: number; f: () => void };
    const list: D[] = [];
    const vx0 = camX - 48, vx1 = camX + W + 48, vy0 = camY - 16, vy1 = camY + H + 60;
    // (the props standing in the box, in the area's own order: world/area.ts keeps them by place, so a frame costs
    // what is near the camera, not every prop of the land)
    for (const p of area.propsIn(vx0, vy0, vx1, vy1)) {
      if (p.kind === "pedestal") {
        const i = Number(p.id.slice(3));
        list.push({ y: p.y, f: () => this.drawPedestal(p, i, spr, camX, camY) });
        continue;
      }
      const def = propDef(p.kind);
      // Where people keep the lights, a lamp is as lit as the hour says (content/daycycle.ts): a doused torch shows
      // its unlit art, a rune or a lantern stops glowing, and a dark window is just the painted window under it.
      const lvl = def.habit ? this.g.tendedLevel(p, hour) : 1;
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
            const bob = isGlyph(p.item) ? Math.round(Math.sin(this.g.envT * 2) * 0.6) : 0;
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
          const sh = this.g.shudder, jx = sh && sh.tx === tx && ty >= sh.ty && ty <= sh.ty + 2 ? Math.round(Math.sin(this.g.t * 80) * 2 * Math.min(1, sh.t / 0.3)) : 0;
          list.push({ y, f: () => { spr(s, x + jx, y); if (this.g.crackFlash > 0) { ec.globalAlpha = this.g.crackFlash; ec.drawImage(s.e, Math.round(x + jx - s.ax - camX), Math.round(y - s.ay - camY)); ec.globalAlpha = 1; } } });
        }
        else if (t === T.PILLAR) { const s = pillarSprite(area.tvar[ty * AW + tx] === 1); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.LOCKED) { const s = doorSprite(); list.push({ y, f: () => spr(s, x, y) }); }
        else if (t === T.BARS) { const s = barsSprite(); list.push({ y, f: () => spr(s, x, y) }); }
      }
    // NPCs (one generic path: art looked up by NpcDef id)
    for (const a of this.g.world.actors) {
      if (a.id === this.g.world.playerId || a.area !== area.id || a.x < vx0 || a.x > vx1 || a.y < vy0 || a.y > vy1) continue;
      list.push({ y: a.y, f: () => drawActor(sc, ec, this.g.world, a, camX, camY, this.g.envT, this.g.npcLook(a)) });
    }
    // player
    const pl = this.g.pl;
    if (!this.g.hideGolem) list.push({ y: pl.y, f: () => this.drawPlayer(camX, camY) });
    // world particles
    for (const p of this.g.particles) {
      if (p.kind === "debris" || p.kind === "dust" || p.kind === "smoke" || p.kind === "splash") {
        list.push({ y: p.y, f: () => { sc.fillStyle = p.col; const s = p.size; sc.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), s, s); if (p.emit === false) { ec.fillStyle = "#000"; ec.fillRect(Math.round(p.x - camX), Math.round(p.y - p.z - camY), s, s); } } });
      }
    }
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.f();
    // moonbeam
    const moon = this.g.view.byId("moon");
    if (moon) {
      // moonlight through the broken roof by night, the same shaft as a sunbeam by day
      const sun = daylight, mx = Math.round(moon.x - this.g.shaft.ax - camX), my = Math.round(moon.y + 2 - this.g.shaft.ay - camY);
      ec.globalCompositeOperation = "lighter";
      if (sun < 1) { ec.globalAlpha = 1 - sun; ec.drawImage(this.g.shaft.e, mx, my); }
      if (sun > 0) { ec.globalAlpha = sun; ec.drawImage(this.g.sunShaft.e, mx, my); }
      ec.globalAlpha = 1; ec.globalCompositeOperation = "source-over";
    }
    // floating particles
    for (const p of this.g.particles) {
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
    const active: Light[] = this.g.hideGolem ? [] : [this.g.glight];
    // the lights that can reach the view, in the registry's order (the rest would add nothing to the sum)
    for (const L of this.g.view.lightsNear(camX, camY, camX + W, camY + H)) if (L.on) active.push(L);
    this.g.lighting.accumulate(active, camX, camY);
    // the hour: the sky's share of the ambient by how much of it this area sees, and lamps counting for less in daylight
    const exposure = exposureOf(area);
    this.g.lighting.compose(sImg.data, eImg.data, this.g.outImg.data, ambientAt(area.base.ambient ?? BURIED_AMBIENT, hour, exposure), 6, lampGain(hour, exposure));
    this.g.wctx.putImageData(this.g.outImg, 0, 0);
    const eye = this.g.eyeSpot();
    this.g.vision.draw(this.g.wctx, this.g.pl, camX, camY, W, H, this.g.t, eye && { x: eye.x + eye.w / 2 - 1, y: eye.y, w: eye.w, show: eye.show });
  }

  /**
   * The surface rune: mostly eroded and overgrown while dormant, redrawn by the
   * awakening sweep, fully carved and glowing once active. Layers come cached
   * from SurfaceRuneArt (re-rasterised only while the sweep is in progress).
   */
  drawSurfaceRune(p: PropInst, camX: number, camY: number) {
    const st = this.g.surfaceRuneState();
    const ccx = Math.round(p.x - CR - camX), ccy = Math.round(p.y - CR - camY);
    if (ccx > -140 && ccx < this.g.vw + 10 && ccy > -140 && ccy < this.g.vh + 10) {
      const sc = this.g.scene.ctx, ec = this.g.emit.ctx;
      const L = this.g.runeArt.layers(st.t);
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
    const ec = this.g.emit.ctx;
    x = Math.round(x); y = Math.round(y);
    const w = Math.round(3 + 7 * k);
    ec.globalCompositeOperation = "lighter";
    for (let yy = y + 4; yy > -2; yy -= 2) {
      const f = 1 - ((y - yy) / Math.max(1, y + 2)) * 0.6;
      const wob = Math.round(Math.sin(yy * 0.21 + this.g.envT * 9) * k);
      ec.globalAlpha = clamp(k * f * 0.5, 0, 1); ec.fillStyle = "#9a70ff"; ec.fillRect(x - w + wob, yy - 2, w * 2, 2);
      ec.globalAlpha = clamp(k * f, 0, 1); ec.fillStyle = "#e8e0ff"; ec.fillRect(x - 1 + wob, yy - 2, 2 + Math.round(k * 2), 2);
    }
    ec.globalAlpha = clamp(k * 0.6, 0, 1); ec.fillStyle = "#c0a0ff"; ec.fillRect(x - 14, y - 3, 28, 8);
    ec.globalAlpha = 1;
    ec.globalCompositeOperation = "source-over";
  }

  /** A tended lamp part-lit or out: its glow at `lvl`. A lit window (`whole`) is nothing but its glow, so all of it fades. */
  drawDimmed(s: Sprite, p: PropInst, lvl: number, whole: boolean, camX: number, camY: number) {
    const dx = Math.round(p.x - s.ax - camX), dy = Math.round(p.y - s.ay - camY);
    if (dx > this.g.vw || dy > this.g.vh || dx + s.w < 0 || dy + s.h < 0) return;
    const sc = this.g.scene.ctx, ec = this.g.emit.ctx;
    if (whole) sc.globalAlpha = lvl;
    sc.drawImage(s.a, dx, dy);
    sc.globalAlpha = 1;
    if (lvl > 0.01) { ec.globalAlpha = lvl; ec.drawImage(s.e, dx, dy); ec.globalAlpha = 1; }
  }

  /** Foliage in the wind: the upper part of the sprite shifts by a pixel now and then. */
  drawSwaying(s: Sprite, p: PropInst, camX: number, camY: number) {
    const dx = Math.round(p.x - s.ax - camX), dy = Math.round(p.y - s.ay - camY);
    if (dx > this.g.vw || dy > this.g.vh || dx + s.w < 0 || dy + s.h < 0) return;
    const sc = this.g.scene.ctx, ec = this.g.emit.ctx;
    const wv = Math.sin(this.g.envT * 1.6 + p.x * 0.031 + p.y * 0.017) + 0.4 * Math.sin(this.g.envT * 3.7 + p.x * 0.11);
    const o = Math.round(wv * 0.75);
    if (!o) { sc.drawImage(s.a, dx, dy); ec.drawImage(s.e, dx, dy); return; }
    const cut = Math.floor(s.h * 0.55);
    for (const [src, ctx] of [[s.a, sc], [s.e, ec]] as const) {
      ctx.drawImage(src, 0, 0, s.w, cut, dx + o, dy, s.w, cut);
      ctx.drawImage(src, 0, cut, s.w, s.h - cut, dx, dy + cut, s.w, s.h - cut);
    }
  }

  drawFlame(p: PropInst, big: boolean, camX: number, camY: number) {
    const ec = this.g.emit.ctx;
    const bx = Math.round(p.x - camX), by = Math.round(p.y - camY - 15 + (propDef(p.kind).fire?.dy ?? 0));
    const t = this.g.envT * 12 + p.x;
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
    const area = this.g.area, r = area.ritual!;
    const g = r.sockets[i];
    const ec = this.g.emit.ctx;
    const topY = p.y - 15;
    if (g >= 0) {
      spr(itemIcon(glyphItem(g)), p.x, topY + 4);
      if (r.active) {
        const pen = new Pen(ec, true);
        glyphPattern(pen, g, Math.round(p.x - camX) - 4, Math.round(topY - camY) - 7, GLYPHS[g].color, true);
      }
      if (r.wrong[i] && this.g.fizzT > 0 && Math.sin(this.g.envT * 30) > 0) {
        ec.fillStyle = "#ff2040";
        ec.globalAlpha = 0.6;
        ec.fillRect(Math.round(p.x - camX) - 6, Math.round(topY - camY) - 8, 12, 12);
        ec.globalAlpha = 1;
      }
    }
    if (hasFlag(this.g.world, FLAGS.knowSchematic) && g !== r.solution[i] && !r.active) {
      const pen = new Pen(ec, true);
      ec.globalAlpha = 0.35 + 0.2 * Math.sin(this.g.envT * 3 + i);
      const bob = Math.round(Math.sin(this.g.envT * 2 + i) * 1.5);
      glyphPattern(pen, r.solution[i], Math.round(p.x - camX) - 3, Math.round(topY - camY) - 16 + bob - (g >= 0 ? 4 : 0), GLYPHS[r.solution[i]].color, true);
      ec.globalAlpha = 1;
    }
    if (i === 0 && r.core) {
      // core floating above center
      const c = area.ritualPos;
      const bob = Math.round(Math.sin(this.g.envT * 2) * 1.5) + (r.active ? -3 : 0);
      spr(itemIcon("core"), c.x, c.y - 4 + bob);
    }
  }

  drawPlayer(camX: number, camY: number) {
    const pl = this.g.pl, lk = this.g.look, sc = this.g.scene.ctx;
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
      facing: this.g.gaze ?? pl.facing, phase: pl.phase, moving: pl.moving && !a, hasArm: this.g.hasArm, dormant: lk.dormant,
      eye: clamp(lk.eye + this.g.eyeBoost + this.g.vision.k * 0.35, 0, 1.6), core: lk.core, raise, reach, t: this.g.envT,
      eyeFixed: hasFlag(this.g.world, FLAGS.golemEye), back: pl.gear.back, runes: runeMarks(this.g.world, pl), slam, dip,
    };
    const ox = pl.x - camX + (a?.kind === "push" ? Math.round(Math.sin(a.t * 40)) : 0), oy = pl.y - camY - lk.z;
    drawGolem(new Pen(sc, false), ox, oy, pose);
    drawGolem(new Pen(this.g.emit.ctx, true), ox, oy, pose);
    this.g.selfPose = { pose, x: ox + camX, y: oy + camY };
  }
}
