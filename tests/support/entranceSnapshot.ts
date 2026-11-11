// Developer preview for the entrance update (run by scripts/entrancePreview.mjs, no browser): through the real
// host on the pixel canvas,
//   stairhead-stages.png  the surface's stair head at each dig stage (buried, earth, earth, stone, stone, open)
//   stair-open.png        the stair below once it is dug out, the sky coming down it
//   screen-*.png          the smelter's screen and the anvil's (its FORGE and RUNES tabs)
//   sprites.png           every sprite and icon the update added or redrew
// Nothing is asserted here; tests/entrance.test.ts and tests/smithing.test.ts hold the behaviour.
import { mkdirSync, writeFileSync } from "node:fs";
import { RCanvas, png } from "./uiSnapshot";
import { installDom } from "./daySnapshot";
import { Game } from "../../src/game/game";
import { createWorld, enterArea, getArea, player, setFlag } from "../../src/game/world/world";
import { advanceDayTo } from "../../src/game/sim/daytime";
import { openEntrance } from "../../src/game/sim/digging";
import { addItems } from "../../src/game/sim/inventory";
import { DIG_SITES, digTotal } from "../../src/game/content/digging";
import { FLAGS } from "../../src/game/content/flags";
import { GATE_PASSAGE } from "../../src/game/content/geography";
import { TS } from "../../src/game/content/tiles";
import { ITEM_IDS, ITEMS, type ItemId } from "../../src/game/content/items";
import { propSprite } from "../../src/game/art/props";
import { itemIcon } from "../../src/game/art/items";

const DT = 1 / 60, GATE = "buriedgate@48,61";

export function run(dir = ".preview/entrance"): number {
  installDom();
  mkdirSync(dir, { recursive: true });
  const mk = (w: number, h: number): RCanvas => { const c = (globalThis as any).document.createElement("canvas") as RCanvas; c.width = w; c.height = h; c.getContext(); return c; };
  const cx = (c: RCanvas) => c.getContext() as any;
  const save = (name: string, c: RCanvas, scale: number) => { writeFileSync(`${dir}/${name}.png`, png(c, scale)); console.log(`${dir}/${name}.png  ${c.width * scale}x${c.height * scale}`); };
  const view = mk(320, 180), ui = mk(320, 180);
  const g = new Game(view as unknown as HTMLCanvasElement, ui as unknown as HTMLCanvasElement), w = createWorld(7), pl = player(w);
  setFlag(w, FLAGS.golemArm); setFlag(w, FLAGS.knowBuild); setFlag(w, FLAGS.knowSmelt);
  g.resume(w);
  advanceDayTo(w, 12);
  const run = (n: number) => { for (let i = 0; i < n; i++) g.update(DT); };
  const frame = () => { view.getContext(); g.render(); return view; };
  /** The world with the UI layer over it, as the page stacks them. */
  const both = () => { const f = frame(), c = mk(320, 180); cx(c).drawImage(f, 0, 0); cx(c).drawImage(ui, 0, 0); return c; };
  run(60);

  // ---- the stair head, stage by stage (noon, the game's own light)
  const surface = getArea(w, "surface"), gate = surface.prop(GATE)!, total = digTotal(DIG_SITES.buriedgate);
  enterArea(w, pl, "surface", gate.x - 52, gate.y + 12);
  const sheet = mk(3 * 130 - 2, 2 * 100 - 2), sc = cx(sheet);
  const cell = (i: number) => { const f = frame(), cam = (g as any).cam; sc.drawImage(f, Math.round(gate.x - 64 - cam.x), Math.round(gate.y - 78 - cam.y), 128, 98, (i % 3) * 130, Math.floor(i / 3) * 100, 128, 98); };
  [0, 2, 6, 8, 13].forEach((dmg, i) => { surface.setPropState(GATE, { dmg }); run(40); cell(i); });
  surface.setPropState(GATE, { dmg: total, open: true, lit: true }); surface.touch("layout");
  openEntrance(w, pl, "surface_stair");
  pl.x = gate.x; pl.y = gate.y + 7; pl.facing = "up";
  run(40); cell(5);
  save("stairhead-stages", sheet, 3);

  // ---- the stair below, open
  enterArea(w, pl, "dungeon", (GATE_PASSAGE.x + 2) * TS, (GATE_PASSAGE.y + 3) * TS);
  pl.facing = "down";
  run(90);
  save("stair-open", both(), 4);

  // ---- the two station screens
  const give = (items: [ItemId, number][]) => { for (const [id, n] of items) addItems(w, pl, id, n); };
  enterArea(w, pl, "dungeon", 96, 621); pl.facing = "up";
  give([["iron_ore", 7], ["wood", 3]]);
  run(30);
  const cu = (g as any).craftUi;
  cu.open("smelting", "forge@5.5,37"); cu.focus = "button";
  save("screen-smelter", both(), 3);
  (g as any).screens.popToBase();
  pl.x = 104; pl.y = 667;
  give([["iron_ingot", 6], ["head_shovel_rusted", 1], ["head_pickaxe", 1], ["head_axe_fine", 1], ["rune_glow", 1]]);
  run(30);
  cu.open("smithing", "anvil@6,40"); cu.cursor = 1;
  save("screen-anvil-forge", both(), 3);
  cu.tab = 3; cu.cursor = 0;
  save("screen-anvil-runes", both(), 3);
  (g as any).screens.popToBase();

  // ---- sprites and icons
  const props: [string, number, boolean][] = [
    ["forge", 0, false], ["anvil", 0, false], ["toolboard", 0, false], ["runetable", 0, false], ["clayvat", 0, false], ["husk", 0, false],
    ["weaponrack", 0, false], ["weaponrack", 1, false], ["armorstand", 0, false], ["armorstand", 1, false], ["armorstand", 2, false], ["staffrack", 0, false],
    ["wallhooks", 0, false], ["wallhooks", 1, false], ["armorpile", 0, false], ["stairpost", 0, false], ["stairpost", 1, false], ["stairfall", 0, false],
    ["ironore", 0, false], ["ironore", 1, false], ["ironore", 2, false], ["ironore", 0, true],
  ];
  const out = mk(300, 150), oc = cx(out);
  oc.fillStyle = "#3a3640"; oc.fillRect(0, 0, 300, 150);
  let x = 4, y = 4, rowH = 0;
  for (const [kind, v, alt] of props) {
    const s = propSprite(kind, v, alt)!, sw = (s.a as unknown as RCanvas).width, sh = (s.a as unknown as RCanvas).height;
    if (x + sw > 296) { x = 4; y += rowH + 4; rowH = 0; }
    oc.drawImage(s.a, x, y);
    x += sw + 5; rowH = Math.max(rowH, sh);
  }
  x = 4; y += rowH + 6;
  for (const id of ITEM_IDS.filter((i) => ITEMS[i].tool || /^head_|^iron_|^dirt$/.test(i))) {
    if (x + 16 > 296) { x = 4; y += 18; }
    oc.fillStyle = "#1c1a20"; oc.fillRect(x, y, 16, 16);
    oc.drawImage(itemIcon(id).a, x, y);
    x += 18;
  }
  save("sprites", out, 4);
  return 0;
}
