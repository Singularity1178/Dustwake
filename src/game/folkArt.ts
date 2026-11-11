// Townsfolk sprites (presentation). One painter for every generic NPC: a person's look (sim/folk.ts: FolkLook) and
// garb (content/folk.ts: Garb) give skin, hair, build and outfit; a pose (what they are doing, which way they face
// and look, the animation frame) gives the posture and what is in their hands.
//
// A person is painted into a small pixel grid first, then outlined automatically (every empty pixel next to a body
// pixel takes the outline colour, as the hand-drawn props have), then emitted as rects through Pen, albedo and
// emissive (a lantern or a lamplighter's wick glows; nothing else does). Sprites are cached by everything that
// changes a pixel, so a crowd costs one drawImage each per frame.
import { makeSprite, shade, type Sprite } from "./util";
import type { Facing } from "./golem";
import type { ChatIcon, Garb } from "./content/folk";
import { drawText, textWidth } from "./font";
import { wrapText } from "./ui/textWrap";
import type { FolkLook, FolkPose } from "./sim/folk";

const OUT = "#1a1418";
const BW = 36, BH = 50, OX = 18, OY = 45;
const SKIN: [string, string][] = [["#f2cfae", "#d8a882"], ["#e4b48e", "#c48e68"], ["#c9946a", "#a87650"], ["#a87650", "#87583a"], ["#86583c", "#664028"], ["#5e3c28", "#462a1c"]];
const HAIR = ["#2a1e1a", "#4a2e1e", "#6e4426", "#9a5a2a", "#c89a50", "#b8622a", "#8c8a88", "#dcd6cc"];
const EYE = "#241a18";
const WOOD = "#6e4a2a", WOOD_D = "#4a3018", IRON = "#9aa4ae", IRON_D = "#5c636c", STEEL = "#d4dce4";
const GLOW = { hot: "#fff0b0", mid: "#ffc060", low: "#ff8a30" };

interface Garbs { body: string; body2: string; legs: string; shoe: string; trim: string; cloak?: string; apron?: string; sleeve?: string }
/** Outfit colours by garb and the look's cloth / trim picks: muted, so a crowd reads as one town. */
function colours(garb: Garb, l: FolkLook): Garbs {
  const pick = <T,>(a: T[], i: number) => a[i % a.length];
  switch (garb) {
    case "watch": return { body: "#2f4a78", body2: "#c8a040", legs: "#3a3430", shoe: "#2a1e16", trim: "#c8a040", sleeve: "#7c838c" };
    case "labourer": return { body: pick(["#b8a888", "#a86a3a", "#7a8a5a", "#8a6a5a"], l.cloth), body2: "#6a4a2e", legs: pick(["#5a4632", "#4a4a40", "#5a5040"], l.trim), shoe: "#2e2016", trim: "#3a2a1a", apron: "#6a4a2e" };
    case "apprentice": return { body: pick(["#8a7a5a", "#6a7a8a", "#9a6a4a", "#7a6a8a"], l.cloth), body2: "#4a3a2a", legs: pick(["#4a3e32", "#3e4248"], l.trim), shoe: "#2e2016", trim: "#3a2a1a", apron: "#5a4030" };
    case "adventurer": return { body: pick(["#7a2e2e", "#2e5a4a", "#5a4a7a", "#8a6a2a"], l.cloth), body2: "#3a2a1e", legs: pick(["#4a3a2a", "#3a3a3a", "#4a4436"], l.trim), shoe: "#3a2618", trim: pick(["#c8a040", "#a8a8b0", "#a85a3a", "#6a8a9a"], l.trim), cloak: pick(["#3a2e2a", "#2a3440", "#4a3a2a", "#3a2a3a"], l.acc) };
    case "resident": return { body: pick(["#a85a5a", "#5a7aa8", "#c89a4a", "#6a9a6a"], l.cloth), body2: "#5a4030", legs: pick(["#5a4a3a", "#4a4a5a", "#5a5040"], l.trim), shoe: "#2e2016", trim: pick(["#e0d8c0", "#d8c8a0", "#c8b8a8", "#b8c8b8"], l.trim), apron: l.acc < 2 ? "#e4dcc6" : undefined };
    case "elder": return { body: pick(["#6a5a6a", "#5a5a4a", "#7a6a5a", "#4a5a6a"], l.cloth), body2: "#3a2e26", legs: "#3e362e", shoe: "#2a1e16", trim: pick(["#a89a7a", "#9a7a6a", "#8a8a9a"], l.trim) };
    case "hunter": return { body: "#6a4a2e", body2: "#4a3220", legs: pick(["#4a4030", "#3e3a2e"], l.trim), shoe: "#2e2016", trim: "#3a2a1a", cloak: pick(["#3a5a32", "#4a5a2a", "#2e4a3a", "#5a4a2a"], l.cloth) };
    case "forager": return { body: pick(["#8a7a4a", "#6a6a3a", "#7a5a4a", "#5a6a5a"], l.cloth), body2: "#4a3a26", legs: "#4a4030", shoe: "#2e2016", trim: "#d8b860" };
  }
}

/** The pixel grid one sprite is painted into, coordinates relative to the feet (x 0 is the middle column, y -1 the ground row). */
class Grid {
  c: (string | null)[] = new Array(BW * BH).fill(null);
  g = new Uint8Array(BW * BH);
  /** 1: takes the outline (body and gear); 0: thin things (shafts, strings) stay unoutlined. */
  o = new Uint8Array(BW * BH);
  px(x: number, y: number, col: string, line = true, glow = false) {
    const X = OX + x, Y = OY + y;
    if (X < 0 || Y < 0 || X >= BW || Y >= BH) return;
    const i = Y * BW + X;
    this.c[i] = col; this.g[i] = glow ? 1 : 0; this.o[i] = line ? 1 : 0;
  }
  rect(x: number, y: number, w: number, h: number, col: string, line = true) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, col, line); }
  line(x0: number, y0: number, x1: number, y1: number, col: string, line = false, glow = false) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let k = 0; k < 64; k++) {
      this.px(x0, y0, col, line, glow);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  mirror() {
    for (let y = 0; y < BH; y++) for (let x = 0; x < OX; x++) {
      const a = y * BW + x, b = y * BW + (2 * OX - x);
      if (2 * OX - x >= BW) continue;
      [this.c[a], this.c[b]] = [this.c[b], this.c[a]]; [this.g[a], this.g[b]] = [this.g[b], this.g[a]]; [this.o[a], this.o[b]] = [this.o[b], this.o[a]];
    }
  }
  outline() {
    const add: number[] = [];
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      const i = y * BW + x;
      if (this.c[i]) continue;
      if ((x > 0 && this.o[i - 1]) || (x < BW - 1 && this.o[i + 1]) || (y > 0 && this.o[i - BW]) || (y < BH - 1 && this.o[i + BW])) add.push(i);
    }
    for (const i of add) { this.c[i] = OUT; this.g[i] = 0; }
  }
}

export interface FolkArtPose {
  facing: Facing;
  /** Where the head looks, if not where the body faces. */
  head: Facing | null;
  pose: FolkPose;
  /** Walk frame (0..3) or the motion's frame (0..1). */
  frame: number;
  carry: boolean;
  /** A lit lantern in the off hand (the watch by night). */
  lantern: boolean;
  /** The lamplighter's pole instead of the spear. */
  pole: boolean;
  blink: boolean;
}

/** Paint one person. Exported for the preview sheet and tests. */
export function paintFolk(gd: Grid, garb: Garb, l: FolkLook, age: "young" | "adult" | "old", p: FolkArtPose) {
  const C = colours(garb, l), [skin, skinD] = SKIN[l.skin % SKIN.length], hair = HAIR[l.hair % HAIR.length], hairD = shade(hair, 0.72);
  const side = p.facing === "left" || p.facing === "right", back = p.facing === "up";
  const young = age === "young", old = age === "old";
  const hw = l.build === 2 ? 4 : 3;
  const legH = young ? 3 : 4 + (l.tall && !old ? 1 : 0);
  const torsoH = young ? 5 : 6;
  const walking = p.pose === "walk";
  const bob = walking && (p.frame === 1 || p.frame === 3) ? -1 : 0;
  const sitting = p.pose === "sit", crouching = p.pose === "crouch";
  const lower = sitting ? 3 : crouching ? 3 : 0;
  const tb = -legH - 2 + bob + lower, tt = tb - torsoH + 1; // torso bottom / top rows
  const stoop = old ? 1 : 0;
  const hb = tt - 1 + stoop, ht = hb - 5; // head rows
  const skirt = (garb === "resident" && l.fem === 1) || garb === "elder";
  const f = p.frame & 1;

  // ---- things on the back, behind the body when seen from the front
  const backItem = () => {
    if (garb === "forager") { // a wicker basket
      const x0 = side ? 1 : -4, w = side ? 5 : 9, y0 = tt - 2;
      gd.rect(x0, y0, w, 7, "#a0784a"); for (let j = 0; j < 7; j += 2) gd.rect(x0, y0 + j, w, 1, "#7a5432"); gd.rect(x0, y0, w, 1, "#c09a62");
      if (!back && !side) { gd.rect(-4, tt - 3, 2, 1, "#a0784a"); gd.rect(3, tt - 3, 2, 1, "#a0784a"); }
    }
    if (garb === "hunter") { // quiver, fletchings showing over the shoulder
      const qx = side ? 2 : 2;
      if (back || side) { gd.rect(qx, tt - 1, 2, 6, "#5a3a22"); }
      gd.px(qx, tt - 3, "#d8d0c0", false); gd.px(qx + 1, tt - 4, "#c84a3a", false); gd.px(qx + 1, tt - 2, "#d8d0c0", false);
      if (back) gd.line(-3, tt - 2, 3, tb + 1, WOOD_D); // the bow slung across
    }
    if (garb === "adventurer" && (back || side)) { // pack with a rolled blanket
      const x0 = side ? 1 : -3;
      gd.rect(x0, tt + 1, side ? 3 : 7, 4, "#6a4a2e"); gd.rect(x0, tt, side ? 3 : 7, 1, C.cloak!);
    }
  };
  const cloak = () => {
    if (!C.cloak) return;
    const len = garb === "hunter" ? torsoH : torsoH + legH - 1;
    if (back) gd.rect(-hw - 1, tt, hw * 2 + 3, len, C.cloak);
    else if (side) gd.rect(0, tt, 3, len - 1, shade(C.cloak, 0.85));
    else { gd.rect(-hw - 2, tt + 1, 1, len - 2, shade(C.cloak, 0.8)); gd.rect(hw + 2, tt + 1, 1, len - 2, shade(C.cloak, 0.8)); }
  };

  if (!back) backItem();
  cloak();

  // ---- legs and feet
  if (p.pose !== "lie") {
    if (sitting || crouching) {
      if (side) { gd.rect(-3, tb + 1, 4, 2, C.legs); gd.rect(-4, tb + 3, 2, -tb - 4 > 0 ? -tb - 4 : 1, C.legs); gd.rect(-5, -1, 3, 1, C.shoe); }
      else { gd.rect(-2, tb + 1, 2, 2, C.legs); gd.rect(1, tb + 1, 2, 2, C.legs); gd.rect(-3, -1, 3, 1, C.shoe); gd.rect(1, -1, 3, 1, C.shoe); gd.rect(-2, tb + 3, 2, Math.max(1, -tb - 4), shade(C.legs, 0.85)); gd.rect(1, tb + 3, 2, Math.max(1, -tb - 4), shade(C.legs, 0.85)); }
    } else if (side) {
      const s = walking ? (p.frame === 1 ? 2 : p.frame === 3 ? -2 : 0) : 0;
      const lx = -1 - Math.max(0, s) + Math.max(0, -s), rx = -1 + Math.max(0, s) - Math.max(0, -s);
      gd.rect(rx, -legH - 1 + bob + (s ? 0 : 0), 2, legH, shade(C.legs, 0.8)); gd.rect(rx - 1, -1, 3, 1, shade(C.shoe, 0.8));
      gd.rect(lx, -legH - 1 + bob, 2, legH, C.legs); gd.rect(lx - 1, -1, 3, 1, C.shoe);
    } else {
      const lu = walking && p.frame === 1 ? 1 : 0, ru = walking && p.frame === 3 ? 1 : 0;
      gd.rect(-2, -legH - 1 + bob, 2, legH - lu, C.legs); gd.rect(1, -legH - 1 + bob, 2, legH - ru, shade(C.legs, 0.85));
      gd.rect(-3, -1 - lu, 3, 1, C.shoe); gd.rect(1, -1 - ru, 3, 1, C.shoe);
      if (garb === "adventurer" || garb === "hunter") { gd.rect(-2, -3 - lu, 2, 2 - 0, shade(C.shoe, 1.2)); gd.rect(1, -3 - ru, 2, 2, shade(C.shoe, 1.2)); } // tall boots
    }
  }

  // ---- lying down (asleep on a bedroll, seen from above): a head on the pillow, the rest under a blanket
  if (p.pose === "lie") {
    gd.rect(-4, -15, 9, 13, shade(C.body, 0.9)); gd.rect(-4, -15, 9, 1, shade(C.body, 1.15)); gd.rect(-4, -9, 9, 1, shade(C.body, 0.75));
    gd.rect(-3, -21, 7, 6, skin); gd.rect(-3, -22, 7, 3, hair); gd.rect(3, -21, 1, 6, skinD);
    gd.px(-1, -17, skinD); gd.px(1, -17, skinD);
    if (l.beard === 1) gd.rect(-2, -16, 5, 2, hair);
    gd.outline();
    return;
  }

  // ---- torso
  const tx0 = side ? -2 : -hw, tw = side ? 5 : hw * 2 + 1;
  gd.rect(tx0, tt, tw, torsoH, C.body);
  gd.rect(tx0, tt, tw, 1, shade(C.body, 1.15)); // shoulders catch the light
  if (!side) gd.rect(hw, tt + 1, 1, torsoH - 1, shade(C.body, 0.78)); else gd.rect(2, tt + 1, 1, torsoH - 1, shade(C.body, 0.78));
  const belt = tb - 1;
  if (skirt) {
    // a dress or a long robe: the skirt widens to the ankles and hides the legs (not when sitting)
    if (!sitting && !crouching) for (let y = tb + 1, k = 0; y <= -2; y++, k++) {
      const w = side ? 5 + (k > 2 ? 1 : 0) : hw * 2 + 1 + (k > 1 ? 2 : 0), x = side ? -2 - (k > 2 ? 1 : 0) : -hw - (k > 1 ? 1 : 0);
      gd.rect(x, y, w, 1, k === -tb - 3 ? shade(C.body, 0.8) : C.body);
    }
  }
  switch (garb) {
    case "watch":
      if (!side) { gd.rect(-hw, tt + 1, 1, torsoH - 1, C.sleeve!); gd.rect(hw, tt + 1, 1, torsoH - 1, shade(C.sleeve!, 0.8)); }
      if (!back) { gd.rect(side ? -2 : -1, tt + 2, side ? 1 : 3, 2, C.body2); gd.px(side ? -2 : 0, tt + 2, "#fff0a0"); }
      gd.rect(tx0, belt, tw, 1, "#3a2616"); gd.rect(tx0 + 1, tb + 1, tw - 2, 1, C.body); // tabard hem
      break;
    case "labourer": case "apprentice":
      if (!back) gd.rect(side ? -2 : -hw + 1, tt + 2, side ? 2 : tw - 2, torsoH - 1, C.apron!);
      if (!back && garb === "apprentice") { gd.px(-1, tt + 3, "#2a2420"); gd.px(1, tt + 4, "#3a3430"); }
      if (back) gd.rect(tx0, belt, tw, 1, C.apron!);
      break;
    case "adventurer":
      gd.rect(tx0, belt, tw, 1, "#2e1e12"); if (!back) gd.px(side ? -2 : 0, belt, C.trim);
      if (!back) { const sx = side ? 1 : -hw - 1; gd.line(sx, belt, sx - (side ? 0 : 1), belt + 5, "#4a4a52", true); gd.px(sx, belt - 1, C.trim); }
      if (!back && !side) gd.line(-hw + 1, tt, hw - 1, tb - 2, shade(C.body, 0.7)); // baldric
      break;
    case "resident":
      if (C.apron && !back) gd.rect(side ? -2 : -hw + 1, tt + 3, side ? 2 : tw - 2, torsoH - 3 + (skirt && !sitting ? -tb - 2 : 0), C.apron);
      if (!skirt) gd.rect(tx0, belt, tw, 1, C.body2);
      break;
    case "elder":
      gd.rect(tx0 - (side ? 0 : 1), tt, tw + (side ? 0 : 2), 2, C.trim); // a shawl round the shoulders
      break;
    case "hunter":
      gd.rect(tx0, belt, tw, 1, "#2e1e12"); if (!back) gd.line(side ? -2 : -hw, tt, side ? 1 : hw, tb - 1, "#3a2616");
      break;
    case "forager":
      gd.rect(tx0, belt, tw, 1, C.body2);
      if (!back && !side) { gd.line(-2, tt, -2, belt - 1, "#7a5432"); gd.line(2, tt, 2, belt - 1, "#7a5432"); }
      break;
  }

  // ---- arms and what the hands hold
  const sleeve = C.sleeve ?? (garb === "labourer" ? skin : shade(C.body, 0.9));
  const shoulderY = tt + 1;
  const arm = (sx: number, dx: number, dy: number, col = sleeve, hand = skin) => {
    const hx = sx + dx, hy = shoulderY + dy;
    gd.line(sx, shoulderY, hx, hy, col, true);
    if (garb === "labourer") gd.px(sx, shoulderY, shade(C.body, 0.9));
    gd.px(hx, hy, hand);
    return { x: hx, y: hy };
  };
  const A = side ? 0 : hw + 1, dn = torsoH - 1;
  type H = { x: number; y: number };
  let main: H, off: H;
  const pose = p.pose;
  if (side) {
    // the far arm first (darker), then the body's near side over it
    const far = (dx: number, dy: number) => arm(1, dx, dy, shade(sleeve, 0.75), skinD);
    const near = (dx: number, dy: number) => arm(-1, dx, dy);
    const sw = walking ? (p.frame === 1 ? 2 : p.frame === 3 ? -2 : 0) : 0;
    switch (pose) {
      case "aim": off = far(-5, 1); main = near(2, 1); break;
      case "hammer": off = far(-3, 3); main = near(f ? -3 : -1, f ? 3 : -5); break;
      case "chop": case "dig": case "hoe": off = far(f ? -4 : -1, f ? 4 : -4); main = near(f ? -3 : 0, f ? 4 : -4); break;
      case "sweep": off = far(-2, 3); main = near(f ? -3 : -1, 4); break;
      case "hang": case "stretch": off = far(-1, -6); main = near(-2, -6); break;
      case "wave": off = far(0, dn); main = near(f ? -1 : -2, -6); break;
      case "chat": off = far(0, dn); main = near(-3, f ? -1 : 1); break;
      case "drink": off = far(0, dn); main = near(-2, f ? -2 : 2); break;
      case "feed": off = far(-1, 3); main = near(-4, f ? 0 : 2); break;
      case "draw": off = far(-3, f ? 1 : 3); main = near(-3, f ? 2 : 4); break;
      case "browse": off = far(-2, 3); main = near(-2, 3); break;
      case "warm": off = far(-4, f ? 1 : 2); main = near(-4, f ? 2 : 1); break;
      case "raise": off = far(0, dn); main = near(-1, -6); break;
      case "lean": off = far(-2, 2); main = near(-2, 3); break;
      case "crouch": off = far(-3, -shoulderY - 2); main = near(-3 - f, -shoulderY - 2 - f); break;
      default: off = far(sw, dn - (sw ? 1 : 0)); main = near(-sw, dn - (sw ? 1 : 0));
    }
  } else {
    const L_ = (dx: number, dy: number) => arm(-A, dx, dy, back ? sleeve : sleeve);
    const R_ = (dx: number, dy: number) => arm(A, dx, dy, shade(sleeve, 0.85));
    const lu = walking && p.frame === 1 ? -1 : walking && p.frame === 3 ? 1 : 0;
    switch (pose) {
      case "hammer": off = L_(1, 3); main = R_(f ? -1 : 1, f ? 3 : -5); break;
      case "chop": case "dig": case "hoe": off = L_(f ? 2 : 3, f ? 4 : -3); main = R_(f ? -1 : -2, f ? 4 : -4); break;
      case "sweep": off = L_(2, 3); main = R_(f ? 0 : -1, 4); break;
      case "hang": case "stretch": off = L_(-1, -5); main = R_(1, -5); break;
      case "wave": off = L_(0, dn); main = R_(f ? 1 : 2, -6); break;
      case "chat": off = L_(0, dn); main = R_(f ? -2 : -1, f ? 1 : 2); break;
      case "drink": off = L_(0, dn); main = R_(-2, f ? -1 : 3); break;
      case "feed": off = L_(1, 3); main = R_(f ? 3 : 2, f ? 1 : 3); break;
      case "draw": off = L_(2, f ? 1 : 3); main = R_(-2, f ? 1 : 3); break;
      case "browse": case "warm": off = L_(2, f && pose === "warm" ? 1 : 3); main = R_(-2, f && pose === "warm" ? 2 : 3); break;
      case "raise": off = L_(0, dn); main = R_(1, -6); break;
      case "lean": off = L_(0, dn); main = R_(0, 2); break;
      case "crouch": off = L_(1, -shoulderY - 2 - f); main = R_(-1, -shoulderY - 2 - (1 - f)); break;
      default: off = L_(0, dn + Math.min(0, lu)); main = R_(0, dn + Math.min(0, -lu));
    }
  }
  // the hand holds (main / off are the hands' pixels)
  const tool = (kind: string) => {
    const m = main, o = off;
    switch (kind) {
      case "spear": {
        const x = m.x + (side ? -1 : 0);
        gd.line(x, -1, x, -27 + (sitting ? 3 : 0), WOOD_D);
        gd.px(x, -28, STEEL); gd.px(x, -29, STEEL); gd.px(x - 1, -28, IRON); gd.px(x + 1, -28, IRON); gd.px(x, -30, IRON);
        break;
      }
      case "pole": {
        const top = pose === "raise" ? -37 : -28, x = m.x;
        gd.line(x, pose === "raise" ? m.y + 4 : -1, x, top + 1, WOOD);
        gd.px(x + 1, top, IRON_D, false); gd.px(x + 1, top + 1, IRON_D, false);
        gd.px(x + 1, top - 1, GLOW.hot, false, true); gd.px(x + 1, top - 2, GLOW.mid, false, true); gd.px(x + 2, top - 1, GLOW.low, false, true);
        break;
      }
      case "lantern": {
        const x = o.x, y = o.y + 1;
        gd.px(x, y, IRON_D, false); gd.rect(x - 1, y + 1, 3, 1, IRON_D); gd.rect(x - 1, y + 2, 3, 2, GLOW.mid, true); gd.px(x, y + 2, GLOW.hot);
        for (const [dx, dy] of [[-1, 2], [1, 2], [0, 2], [-1, 3], [0, 3], [1, 3]]) gd.px(x + dx, y + dy, dx === 0 && dy === 2 ? GLOW.hot : GLOW.mid, true, true);
        gd.rect(x - 1, y + 4, 3, 1, IRON_D);
        break;
      }
      case "hammer": { const dirx = side ? -1 : 1; gd.line(m.x, m.y, m.x + dirx, m.y - 3, WOOD); gd.rect(m.x + dirx - 1, m.y - 4, 3, 2, IRON_D); gd.px(m.x + dirx - 1, m.y - 4, IRON); break; }
      case "axe": { const ex = side ? m.x - 2 : m.x, ey = f ? -1 : m.y - 5; gd.line(m.x, m.y, ex, ey, WOOD); gd.rect(ex - 1, ey - (f ? 1 : 0), 3, 2, IRON); gd.px(ex - 1, ey, STEEL); break; }
      case "hoe": case "dig": {
        const ex = side ? m.x - 5 : m.x - 4, ey = f ? -1 : m.y + 1;
        gd.line(m.x + (side ? 1 : 2), m.y - 2, ex, ey, WOOD);
        if (kind === "hoe") gd.rect(ex - 1, ey, 3, 1, IRON_D); else { gd.rect(ex - 1, ey - 1, 2, 2, IRON); gd.px(ex - 1, ey, STEEL); }
        break;
      }
      case "broom": { const ex = (side ? m.x - 4 : m.x - 3) + (f ? -1 : 1); gd.line(m.x + 1, m.y - 3, ex, -2, WOOD); gd.rect(ex - 1, -2, 3, 2, "#c8a860"); gd.px(ex - 1, -1, "#a88840"); break; }
      case "mug": gd.rect(m.x - (side ? 1 : 0), m.y - 1, 2, 2, "#8a6a42"); gd.px(m.x - (side ? 1 : 0), m.y - 1, "#f0ead8"); break;
      case "cane": gd.line(m.x + (side ? -1 : 1), m.y, m.x + (side ? -2 : 1), -1, WOOD_D); gd.px(m.x + (side ? -1 : 1), m.y - 1, WOOD); break;
      case "basket": gd.rect(m.x - 1, m.y + 1, 4, 3, "#a0784a"); gd.rect(m.x - 1, m.y + 1, 4, 1, "#c09a62"); gd.px(m.x, m.y, "#7a5432"); break;
      case "bow": {
        const x = o.x - (side ? 1 : 0), y = o.y;
        gd.line(x + 1, y - 6, x, y - 3, WOOD); gd.line(x, y - 3, x, y + 3, WOOD); gd.line(x, y + 3, x + 1, y + 6, WOOD);
        gd.line(x + 1, y - 6, main.x, main.y, "#d8d0c0"); gd.line(main.x, main.y, x + 1, y + 6, "#d8d0c0");
        gd.line(main.x, main.y, x - 2, y, "#c8b898"); gd.px(x - 3, y, STEEL, false);
        break;
      }
      case "sack": { const sx = side ? 0 : main.x - 1; gd.rect(sx - 2, tt - 4, 6, 4, "#c8b88a"); gd.rect(sx - 2, tt - 4, 6, 1, "#ddd0a8"); gd.px(sx + 3, tt - 2, "#a89868"); break; }
      case "cloth": gd.rect(Math.min(m.x, o.x), Math.min(m.y, o.y) - 1, Math.abs(m.x - o.x) + 1, 3, "#e8e0d0"); break;
      case "grain": if (f) { gd.px(m.x + (side ? -2 : 2), m.y + 2, "#e0c070", false); gd.px(m.x + (side ? -3 : 3), m.y + 4, "#e0c070", false); } break;
      case "rope": gd.line(m.x, m.y, m.x + (side ? -2 : -1), m.y + 5, "#b09060"); break;
    }
  };

  // what each garb carries, by pose
  const held: string[] = [];
  if (garb === "watch") held.push(p.pole ? "pole" : "spear");
  if (p.lantern) held.push("lantern");
  if (garb === "elder" && (pose === "stand" || pose === "walk" || pose === "lean")) held.push("cane");
  if (garb === "resident" && l.acc === 0 && (pose === "walk" || pose === "browse" || pose === "stand")) held.push("basket");
  if (garb === "hunter" && pose === "aim") held.push("bow");
  if (p.carry) held.push("sack");
  switch (pose) {
    case "hammer": held.push("hammer"); break;
    case "chop": held.push("axe"); break;
    case "hoe": held.push("hoe"); break;
    case "dig": held.push("dig"); break;
    case "sweep": held.push("broom"); break;
    case "drink": held.push("mug"); break;
    case "hang": held.push("cloth"); break;
    case "feed": held.push("grain"); break;
    case "draw": held.push("rope"); break;
  }
  // the watch's spear rests in the off hand while the main hand works or waves
  if (garb === "watch" && !p.pole && pose !== "lean" && pose !== "stand" && pose !== "walk") { const t = main; main = off; off = t; }
  for (const k of held) tool(k);
  if (garb === "watch" && !p.pole && pose !== "lean" && pose !== "stand" && pose !== "walk") { const t = main; main = off; off = t; }

  // ---- the head (it may look elsewhere than the body faces)
  const hf: Facing = p.head ?? p.facing;
  const hside = hf === "left" || hf === "right", hback = hf === "up";
  // the sprite of a body facing right is painted facing left and mirrored at the end: paint the head in that space
  const mirrorF = (x: Facing): Facing => (x === "left" ? "right" : x === "right" ? "left" : x);
  const phf = p.facing === "right" ? mirrorF(hf) : hf, headFlip = hside && phf === "right";
  const hx = -3, hwid = hside ? 6 : 7;
  const HP = (x: number, y: number, c: string) => gd.px(headFlip ? -x - 1 : x, y, c);
  const HR = (x: number, y: number, w: number, h: number, c: string) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) HP(x + i, y + j, c); };
  const hy = ht + (pose === "browse" || pose === "crouch" ? 1 : 0) + (pose === "drink" && f ? -1 : 0);
  const hatCovers = hatKind(garb, l) !== "none";
  // face / skull
  HR(hx, hy, hwid, 6, skin);
  if (hside) HR(hx + hwid - 1, hy, 1, 6, skinD); else HR(hx + hwid - 1, hy + 1, 1, 5, skinD);
  HR(hx + 1, hy + 5, hwid - 2, 1, skinD);
  // hair
  const longHair = l.style === 1 || (l.fem && l.style !== 0);
  const bald = old && !l.fem && l.style === 0;
  if (hback) {
    HR(hx, hy - 1, hwid, bald ? 2 : 6, hair); HR(hx + 1, hy - 1, hwid - 2, 1, shade(hair, 1.15));
    if (bald) HR(hx + 1, hy, hwid - 2, 2, skin);
    if (longHair) HR(hx, hy + 5, hwid, 3, hairD);
    if (l.style === 2) HR(-1, hy, 3, 2, hairD);
  } else if (hside) {
    HR(hx, hy - 1, hwid, 2, hair); HR(hx + 3, hy, 3, 4, hair); HR(hx + 1, hy - 1, 3, 1, shade(hair, 1.15));
    if (bald) HR(hx, hy - 1, 4, 2, skin);
    if (longHair) HR(hx + 3, hy + 3, 3, 4, hairD);
    if (l.style === 2) HR(hx + 5, hy, 2, 2, hairD);
    // eye, nose, ear
    if (!p.blink) HP(hx + 1, hy + 3, EYE); else HP(hx + 1, hy + 3, skinD);
    HP(hx - 1, hy + 3, skin); HP(hx - 1, hy + 4, skinD);
    HP(hx + 3, hy + 3, skinD);
    if (l.beard === 1) HR(hx, hy + 4, 4, 2, hair); else if (l.beard === 2) HR(hx, hy + 4, 2, 1, hair);
    if (young) HP(hx + 2, hy + 4, "#e89a8a");
  } else {
    HR(hx, hy - 1, hwid, 2, hair); HR(hx + 1, hy - 1, hwid - 2, 1, shade(hair, 1.15));
    if (bald) { HR(hx + 1, hy - 1, hwid - 2, 2, skin); HR(hx, hy, 1, 3, hair); HR(hx + hwid - 1, hy, 1, 3, hair); }
    else {
      HR(hx, hy + 1, 1, 2, hair); HR(hx + hwid - 1, hy + 1, 1, 2, hair);
      if (l.style === 3) { HP(hx + 1, hy + 1, hair); HP(hx + 4, hy + 1, hair); } else HR(hx + 1, hy + 1, 2, 1, hair); // fringe
    }
    if (longHair) { HR(hx - 1, hy + 1, 1, 6, hairD); HR(hx + hwid, hy + 1, 1, 6, hairD); HR(hx, hy + 3, 1, 4, hair); HR(hx + hwid - 1, hy + 3, 1, 4, hair); }
    if (l.style === 2 && !hatCovers) HR(-1, hy - 2, 3, 1, hairD);
    const ey = hy + 3;
    if (!p.blink) { HP(-1 - 1, ey, EYE); HP(1, ey, EYE); HP(-2, ey - 1, shade(skin, 0.92)); } else { HP(-2, ey, skinD); HP(1, ey, skinD); }
    if (l.beard === 1) { HR(hx + 1, hy + 4, hwid - 2, 2, hair); HR(hx + 2, hy + 6, hwid - 4, 1, hairD); }
    else if (l.beard === 2) HR(-2, hy + 4, 4, 1, hair);
    if (young) { HP(-3, ey + 1, "#e89a8a"); HP(2, ey + 1, "#e89a8a"); }
  }
  // headwear
  hat(HP, HR, hatKind(garb, l), hf, hx, hy, hwid, C, l);

  // things on the back, over the body when seen from behind
  if (back) backItem();
  if (p.facing === "right") gd.mirror();
  gd.outline();
}

type HatKind = "helm" | "hood" | "cap" | "straw" | "kerchief" | "band" | "shawl" | "flatcap" | "none";
function hatKind(garb: Garb, l: FolkLook): HatKind {
  switch (garb) {
    case "watch": return "helm";
    case "hunter": return "hood";
    case "forager": return "straw";
    case "labourer": return l.hat === 2 ? "none" : "cap";
    case "apprentice": return l.hat === 0 ? "cap" : "none";
    case "adventurer": return l.hat === 0 ? "hood" : l.hat === 1 ? "band" : "none";
    case "resident": return l.fem ? (l.hat === 0 ? "kerchief" : "none") : (l.hat === 0 ? "flatcap" : "none");
    case "elder": return l.fem ? (l.hat < 2 ? "shawl" : "none") : (l.hat === 0 ? "flatcap" : "none");
  }
}

function hat(HP: (x: number, y: number, c: string) => void, HR: (x: number, y: number, w: number, h: number, c: string) => void, k: HatKind, hf: Facing, hx: number, hy: number, w: number, C: Garbs, l: FolkLook) {
  const side = hf === "left" || hf === "right", back = hf === "up";
  switch (k) {
    case "helm": {
      HR(hx, hy - 2, w, 3, IRON); HR(hx + 1, hy - 2, w - 2, 1, STEEL); HR(hx + w - 2, hy - 1, 2, 2, IRON_D);
      HR(hx - 1, hy + 1, w + 2, 1, IRON_D); // the kettle brim
      if (!side && !back) HR(hx, hy + 2, w, 1, "rgba(0,0,0,0)"); // nothing: the brim shades the brow in the outline
      break;
    }
    case "hood": {
      const c = C.cloak ?? "#3a5a32", cd = shade(c, 0.78);
      HR(hx - 1, hy - 1, w + 2, 2, c); HR(hx - 1, hy + 1, 1, 6, cd); HR(hx + w, hy + 1, 1, 5, cd);
      if (back) { HR(hx, hy - 1, w, 7, c); HP(hx + 3, hy + 6, cd); }
      else if (side) { HR(hx + 3, hy, 4, 6, c); HP(hx + 6, hy + 6, cd); HR(hx - 1, hy, 1, 2, c); }
      else { HR(hx, hy, 1, 3, c); HR(hx + w - 1, hy, 1, 3, c); HP(hx + 3, hy - 2, c); }
      break;
    }
    case "cap": { const c = l.hat === 0 ? "#6a4a2e" : "#8a7a5a"; HR(hx, hy - 2, w, 2, c); HR(hx + 1, hy - 2, w - 2, 1, shade(c, 1.2)); if (side) HR(hx - 2, hy - 1, 3, 1, shade(c, 0.8)); else if (!back) HR(hx + 1, hy, w - 2, 1, shade(c, 0.8)); break; }
    case "straw": {
      const s = "#d8b860", sd = "#a88838";
      HR(hx + 1, hy - 3, w - 2, 3, s); HR(hx + 1, hy - 1, w - 2, 1, "#8a4a2a"); HR(hx - 2, hy, w + 4, 1, s); HR(hx - 2, hy, 1, 1, sd); HR(hx + w + 1, hy, 1, 1, sd);
      if (!back && !side) HR(hx, hy + 1, w, 1, "rgba(0,0,0,0.25)");
      break;
    }
    case "kerchief": { const c = C.trim; HR(hx, hy - 2, w, 3, c); HR(hx + 1, hy - 2, w - 2, 1, shade(c, 1.1)); if (back) HP(hx + 3, hy + 1, shade(c, 0.8)); else if (side) HR(hx + 5, hy + 1, 2, 2, shade(c, 0.8)); break; }
    case "band": HR(hx, hy, w, 1, C.trim); break;
    case "shawl": { const c = C.trim, cd = shade(c, 0.8); HR(hx - 1, hy - 2, w + 2, 2, c); HR(hx - 1, hy, 1, 6, cd); HR(hx + w, hy, 1, 6, cd); if (back) HR(hx, hy, w, 6, c); else if (side) HR(hx + 3, hy, 4, 6, c); break; }
    case "flatcap": { const c = "#5a5048"; HR(hx, hy - 2, w, 2, c); HR(hx, hy - 2, w, 1, shade(c, 1.2)); if (side) HR(hx - 1, hy - 1, 2, 1, c); break; }
    case "none": break;
  }
}

// ---------------------------------------------------------------- the cache and the draw call
const cache = new Map<string, Sprite>();
const lookKey = (l: FolkLook) => `${l.skin}${l.hair}${l.style}${l.beard}${l.build}${l.tall}${l.cloth}${l.trim}${l.hat}${l.acc}${l.fem}`;

export function folkSprite(garb: Garb, age: "young" | "adult" | "old", l: FolkLook, p: FolkArtPose): Sprite {
  const key = `${garb}|${age}|${lookKey(l)}|${p.facing}|${p.head ?? "-"}|${p.pose}|${p.frame}|${+p.carry}${+p.lantern}${+p.pole}${+p.blink}`;
  let s = cache.get(key);
  if (s) return s;
  if (cache.size > 6000) cache.clear();
  const gd = new Grid();
  paintFolk(gd, garb, l, age, p);
  s = makeSprite(BW, BH, OX, OY, 0, (pen) => {
    for (let y = 0; y < BH; y++) {
      let x = 0;
      while (x < BW) {
        const i = y * BW + x, c = gd.c[i];
        if (!c) { x++; continue; }
        let n = 1;
        while (x + n < BW && gd.c[i + n] === c && gd.g[i + n] === gd.g[i]) n++;
        if (gd.g[i]) pen.g(x, y, n, 1, c); else pen.r(x, y, n, 1, c);
        x += n;
      }
    }
  });
  cache.set(key, s);
  return s;
}

/** Animation rate (frames per second) of each motion; 0: a still pose. */
export const POSE_RATE: Partial<Record<FolkPose, number>> = {
  hammer: 2.4, chop: 1.6, hoe: 1.3, dig: 1.4, sweep: 2.6, hang: 0.9, feed: 1.6, draw: 1.1, chat: 2.6, wave: 4, crouch: 0.8, warm: 0.6, browse: 0.4,
};

// ---------------------------------------------------------------- speech bubbles (drawn by the host on the world layer)
const PAPER = "#f2ead6", INK = "#2a2024";
/** A line said to the golem, in a bubble over the speaker's head (`x`: their middle, `y`: the bubble's foot). */
export function drawSpeech(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, viewW: number) {
  const lines = wrapText(text, 22).slice(0, 4);
  const w = Math.max(...lines.map((l) => textWidth(l))) + 8, h = lines.length * 7 + 5;
  const bx = Math.round(Math.min(Math.max(x - w / 2, 2), viewW - w - 2)), by = Math.round(y - h - 3);
  ctx.fillStyle = OUT; ctx.fillRect(bx + 1, by, w - 2, h); ctx.fillRect(bx, by + 1, w, h - 2);
  ctx.fillStyle = PAPER; ctx.fillRect(bx + 1, by + 1, w - 2, h - 2);
  ctx.fillStyle = "#d8ccb0"; ctx.fillRect(bx + 1, by + h - 2, w - 2, 1);
  // the tail, pointing at the speaker
  const tx = Math.min(Math.max(x, bx + 4), bx + w - 5);
  ctx.fillStyle = OUT; ctx.fillRect(tx - 2, by + h - 1, 5, 1); ctx.fillRect(tx - 1, by + h, 3, 1); ctx.fillRect(tx, by + h + 1, 1, 2);
  ctx.fillStyle = PAPER; ctx.fillRect(tx - 1, by + h - 1, 3, 1); ctx.fillRect(tx, by + h, 1, 1);
  lines.forEach((l, i) => drawText(ctx, l, bx + 4, by + 3 + i * 7, INK));
}

/** Pictograms for townsfolk's own talk (7 x 6, `a` / `b` the icon's two colours). */
const ICONS: Record<ChatIcon, { px: string[]; a: string; b: string }> = {
  heart: { px: [".aa.aa.", "aabaaaa", "aaaaaaa", ".aaaaa.", "..aaa..", "...a..."], a: "#d84a5a", b: "#ffb0b8" },
  note: { px: ["...aaa.", "...a.a.", "...a.a.", ".aaa.a.", "aaaa.a.", ".aa.aa."], a: "#3a3060", b: "#3a3060" },
  mug: { px: ["bbbbb..", "aaaaaa.", "aaaaa.a", "aaaaa.a", "aaaaaa.", "aaaaa.."], a: "#a87a42", b: "#ffffff" },
  coin: { px: [".aaaaa.", "aabbbaa", "aabaaaa", "aabaaaa", "aabbbaa", ".aaaaa."], a: "#d8a830", b: "#fff0a0" },
  sword: { px: ["......a", ".....a.", "b...a..", ".b.a...", "..b....", ".b.b..."], a: "#a8b4c0", b: "#6a4a2a" },
  bang: { px: ["...a...", "...a...", "...a...", "...a...", ".......", "...a..."], a: "#c83a2a", b: "#c83a2a" },
  ask: { px: ["..aaa..", ".a...a.", "....a..", "...a...", ".......", "...a..."], a: "#3a5a9a", b: "#3a5a9a" },
  sun: { px: ["a..a..a", ".abbba.", "abbbbba", ".abbba.", "a..a..a", "......."], a: "#e0a020", b: "#ffd860" },
  moon: { px: ["..aaa..", ".aa....", "aa.....", "aa.....", ".aa....", "..aaa.."], a: "#7a86c8", b: "#7a86c8" },
  bread: { px: [".......", ".aaaaa.", "abababa", "aaaaaaa", ".aaaaa.", "......."], a: "#c88a3a", b: "#f0c878" },
  deer: { px: ["a.a.a.a", ".aa.aa.", "..aaa..", "..bbb..", "..bbb..", "...b..."], a: "#7a5434", b: "#9a6a44" },
  leaf: { px: ["....aa.", "..aaaa.", ".aabaa.", ".abaa..", "ba.....", "b......"], a: "#4a9a3a", b: "#6a4a2a" },
  stone: { px: [".......", "..aaa..", ".abbaa.", "aabaaaa", "aaaaaaa", "......."], a: "#7a7a80", b: "#a8a8b0" },
  laugh: { px: ["a..a..a", ".......", "aaaaaaa", "abbbbba", ".abbba.", "..aaa.."], a: "#3a2a20", b: "#e85a5a" },
  skull: { px: [".aaaaa.", "aaaaaaa", "ab.a.ba", "aaaaaaa", ".aa.aa.", ".a.a.a."], a: "#e8e0d0", b: "#e8e0d0" },
  hammer: { px: ["aaaa...", "aaaab..", ".....b.", "......b", ".......", "......."], a: "#7c838c", b: "#8a5a32" },
};
/** A small bubble with a pictogram (`x`, `y`: where its tail points). */
export function drawChatIcon(ctx: CanvasRenderingContext2D, icon: ChatIcon, x: number, y: number) {
  const I = ICONS[icon], bx = x - 2, by = y - 12;
  ctx.fillStyle = OUT; ctx.fillRect(bx + 1, by, 9, 10); ctx.fillRect(bx, by + 1, 11, 8); ctx.fillRect(bx + 1, by + 10, 2, 1); ctx.fillRect(bx, by + 11, 1, 1);
  ctx.fillStyle = PAPER; ctx.fillRect(bx + 1, by + 1, 9, 8); ctx.fillRect(bx + 1, by + 9, 1, 1);
  I.px.forEach((row, j) => { for (let i = 0; i < 7; i++) { const c = row[i]; if (c === ".") continue; ctx.fillStyle = c === "a" ? I.a : I.b; ctx.fillRect(bx + 2 + i, by + 2 + j, 1, 1); } });
}
