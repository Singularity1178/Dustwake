// Developer tool (not a test; run by scripts/artDiff.mjs): what did an art change move? The golden hashes in
// tests/art.test.ts and tests/artRegistry.test.ts say only that something did. This renders every prop sprite
// (the surface's and the halls', four variants, both states), the tile sprites and both background bakes on the
// pixel canvas and hashes them one by one: per sprite, and per baked tile. `save` writes that to a file; `diff`
// compares the tree as it is now against such a file and names every sprite and every tile that differs.
//
//   node scripts/artDiff.mjs save .preview/art-before.json     (on the tree as it was)
//   node scripts/artDiff.mjs diff .preview/art-before.json     (after the change)
import { readFileSync, writeFileSync } from "node:fs";
import { RCanvas } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { PROP_ART, propSprite } from "../../src/game/art/props";
import { TOWN_PROP_ART } from "../../src/game/art/propsTown";
import { rubbleSprite, pillarSprite, doorSprite, barsSprite, bakeRegion } from "../../src/game/art/tiles";
import { buildDungeon } from "../../src/game/map";
import { buildSurface } from "../../src/game/surface";
import { TS } from "../../src/game/content/tiles";
import type { Sprite } from "../../src/game/util";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Dump = { sprites: Record<string, string>; bakes: Record<string, { w: number; h: number; tiles: string[] }> };

function fnv(d: Uint8ClampedArray, from = 0, to = d.length, h = 0x811c9dc5): number {
  for (let i = from; i < to; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
const spriteHash = (s: Sprite) => {
  const a = s.a as unknown as RCanvas, e = s.e as unknown as RCanvas;
  return `${s.w}x${s.h}@${s.ax},${s.ay}:${fnv(e.data, 0, e.data.length, fnv(a.data)).toString(16)}`;
};

function collect(): Dump {
  installDom();
  const sprites: Record<string, string> = {};
  for (const k of Object.keys(PROP_ART)) {
    if (k in TOWN_PROP_ART) continue;
    for (let v = 0; v < 4; v++) for (const alt of [false, true]) sprites[`${k}|${v}|${alt ? "alt" : "-"}`] = spriteHash(propSprite(k, v, alt)!);
  }
  for (let v = 0; v < 3; v++) for (const cracked of [false, true]) sprites[`tile:rubble|${v}|${cracked ? "cracked" : "-"}`] = spriteHash(rubbleSprite(v, cracked));
  sprites["tile:pillar"] = spriteHash(pillarSprite(false)); sprites["tile:pillar|broken"] = spriteHash(pillarSprite(true));
  sprites["tile:door"] = spriteHash(doorSprite()); sprites["tile:bars"] = spriteHash(barsSprite());

  const bakes: Dump["bakes"] = {};
  for (const [name, m] of [["dungeon", buildDungeon()], ["surface", buildSurface()]] as const) {
    const c = (globalThis as any).document.createElement("canvas") as RCanvas;
    c.width = m.w * TS; c.height = m.h * TS;
    bakeRegion(c.getContext() as any, m, 0, 0, m.w - 1, m.h - 1);
    const tiles: string[] = [];
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      let h = 0x811c9dc5;
      for (let y = 0; y < TS; y++) { const i = ((ty * TS + y) * c.width + tx * TS) * 4; h = fnv(c.data, i, i + TS * 4, h); }
      tiles.push(h.toString(16));
    }
    bakes[name] = { w: m.w, h: m.h, tiles };
  }
  return { sprites, bakes };
}

export function main(argv: string[]): number {
  const [cmd, file] = argv;
  if ((cmd !== "save" && cmd !== "diff") || !file) { console.log("usage: artDiff.mjs save|diff <file.json>"); return 2; }
  const now = collect();
  if (cmd === "save") { writeFileSync(file, JSON.stringify(now)); console.log(`${file}: ${Object.keys(now.sprites).length} sprites, ${Object.keys(now.bakes).join(" + ")} bakes`); return 0; }
  const was: Dump = JSON.parse(readFileSync(file, "utf8"));
  const keys = [...new Set([...Object.keys(was.sprites), ...Object.keys(now.sprites)])];
  const moved = keys.filter((k) => was.sprites[k] !== now.sprites[k]);
  const kinds = [...new Set(moved.map((k) => k.split("|")[0]))];
  console.log(`sprites: ${moved.length} of ${keys.length} differ, ${keys.length - moved.length} identical`);
  for (const kind of kinds) console.log(`  ${kind}: ${moved.filter((k) => k.split("|")[0] === kind).map((k) => k.split("|").slice(1).join("|") + (k in was.sprites ? (k in now.sprites ? "" : " (gone)") : " (new)")).join("  ")}`);
  for (const name of Object.keys(now.bakes)) {
    const a = was.bakes[name], b = now.bakes[name];
    if (!a || a.w !== b.w || a.h !== b.h) { console.log(`${name} bake: size changed`); continue; }
    const diff: [number, number][] = [];
    b.tiles.forEach((h, i) => { if (h !== a.tiles[i]) diff.push([i % b.w, Math.floor(i / b.w)]); });
    if (!diff.length) { console.log(`${name} bake: identical (${b.tiles.length} tiles)`); continue; }
    const xs = diff.map((d) => d[0]), ys = diff.map((d) => d[1]);
    console.log(`${name} bake: ${diff.length} of ${b.tiles.length} tiles differ, all inside x ${Math.min(...xs)}-${Math.max(...xs)}, y ${Math.min(...ys)}-${Math.max(...ys)}`);
    console.log(`  ${diff.map((d) => d.join(",")).join(" ")}`);
  }
  return 0;
}
