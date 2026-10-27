// Art added with crafted materials, runes and the gear slots. Own file: node
// --test runs each file in a fresh process, so the sprite cache starts empty
// and the traces don't depend on other tests. The goldens for what existed
// before (tests/artRegistry.test.ts, tests/golemArt.test.ts) are untouched;
// these pin the new icons, slot silhouettes and rune-bearing poses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas, resetTrace, traceHash } from "./support/fakeCanvas";
installFakeCanvas();
import { itemIcon, ITEM_ART } from "../src/game/art/items";
import { slotIcon, SLOT_ART } from "../src/game/art/slots";
import { drawGolem, type Facing, type GolemPose } from "../src/game/golem";
import { GEAR_SLOT_DEFS } from "../src/game/content/gear";
import { ITEM_IDS, ITEMS, type ItemId } from "../src/game/content/items";
import { Pen, makeCanvas } from "../src/game/util";

const GOLDEN = { items: "650359c4", slots: "fef1ce6e", runes: "fea2d425" };
const NEW_ITEMS: ItemId[] = ["planks", "cut_stone", "rune_swift", "rune_glow"];

test("every item has an icon and a description", () => {
  for (const id of ITEM_IDS) { assert.ok(ITEM_ART[id], id); assert.ok(ITEMS[id].desc && ITEMS[id].desc!.length <= 3 && ITEMS[id].desc!.every((l) => l.length <= 34), id); }
});

test("new item icons are pixel-stable", () => {
  resetTrace();
  for (const id of NEW_ITEMS) itemIcon(id);
  assert.equal(traceHash(), GOLDEN.items);
});

test("slot silhouettes: one per slot kind, pixel-stable", () => {
  for (const d of GEAR_SLOT_DEFS) assert.ok(SLOT_ART[d.kind], d.id);
  resetTrace();
  for (const k of Object.keys(SLOT_ART) as (keyof typeof SLOT_ART)[]) slotIcon(k);
  assert.equal(traceHash(), GOLDEN.slots);
});

test("runes show on the golem in every facing; no runes draws nothing extra", () => {
  const swift = { col: "#5cf0c8", pat: ["#..", ".#.", "#.."] }, glow = { col: "#ffffff", pat: [".#.", "###", ".#."] };
  const trace = (list: GolemPose[]) => {
    resetTrace();
    const c = makeCanvas(48, 48);
    for (const p of list) { drawGolem(new Pen(c.ctx, false), 24, 40, p); drawGolem(new Pen(c.ctx, true), 24, 40, p); }
    return traceHash();
  };
  const list: GolemPose[] = [];
  for (const facing of ["down", "up", "left", "right"] as Facing[]) for (const hasArm of [false, true]) for (const back of [undefined, "basket"])
    list.push({ facing, phase: 0, moving: false, hasArm, dormant: 0, eye: 1, core: 1, raise: 0, reach: 0, t: 0.3, back, runes: [swift, glow, swift, glow] });
  assert.equal(trace(list), GOLDEN.runes);
  for (const p of list.slice(0, 8)) {
    assert.notEqual(trace([p]), trace([{ ...p, runes: undefined }]), `${p.facing}: visible`);
    assert.equal(trace([{ ...p, runes: [null, null, null, null] }]), trace([{ ...p, runes: undefined }]), "empty slots draw nothing");
    assert.notEqual(trace([{ ...p, runes: [swift, null, null, null] }]), trace([{ ...p, runes: [null, swift, null, null] }]), "each slot has its own place");
  }
});
