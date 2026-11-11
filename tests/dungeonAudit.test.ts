// The tutorial dungeon's audit, kept: the layout checks the town gets
// (tests/support/townAudit.ts) run over the dungeon with the findings that are
// there by design named one by one, and the things the audit fixed pinned so
// they stay fixed (the throne hall's colonnade, the cracked wall as wall mass,
// the barracks' beds and footlockers, the chapel's axis, roots off the walls).
// Headless: the builder, the content tables and the recording fake canvas only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeCanvas } from "./support/fakeCanvas";
installFakeCanvas();
import { auditArea } from "./support/townAudit";
import { buildDungeon, MW } from "../src/game/map";
import { T, TS, isWallMassT, isSolidT, isOpaqueT } from "../src/game/content/tiles";
import { propSprite } from "../src/game/art/props";
import { pillarSprite } from "../src/game/art/tiles";

const d = buildDungeon();
const tile = (x: number, y: number) => d.grid[y * MW + x];
const props = (kind: string) => d.props.filter((p) => p.kind === kind);

test("the layout audit finds nothing in the dungeon but what is there by design", () => {
  const found = auditArea("dungeon");
  // boulders heaped on the collapsed SURFACE GATE's rubble, and the seam of night air buried in it
  // and under the same fall the stair's own stonework: its two newel posts and two cheek walls stand in the rubble
  // that buries the flight (floor once it is dug out), and the fall's boulders lie heaped against them
  const stonework = /stair(post|cheek)\.[we] /;
  const buried = found.filter((f) => stonework.test(f.msg) && (f.check === "in-wall" || ((f.check === "crowded" || f.check === "overlap") && f.msg.startsWith("rockpile@"))));
  assert.equal(buried.filter((f) => f.check === "in-wall").length, 4, buried.map((f) => f.msg).join("\n"));
  const gate = found.filter((f) => (f.check === "in-wall" && f.msg.startsWith("rockpile@")) || f.check === "light" || buried.includes(f));
  // the throne hall (behind the cracked wall), the treasury (behind the locked door) and two gaol cells (behind bars)
  const sealed = found.filter((f) => f.check === "sealed");
  assert.equal(sealed.length, 4, sealed.map((f) => f.msg).join("\n"));
  const rest = found.filter((f) => !gate.includes(f) && !sealed.includes(f));
  assert.deepEqual(rest.map((f) => `[${f.check}] ${f.msg}`), []);
});

test("no pillar stands on the capital of the one in front of it", () => {
  const rows = Math.ceil(pillarSprite(false).h / TS); // how many tiles tall a whole pillar is drawn
  let n = 0;
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
    if (tile(x, y) !== T.PILLAR) continue;
    n++;
    for (let k = 1; k <= rows; k++) assert.notEqual(tile(x, y + k), T.PILLAR, `pillars at ${x},${y} and ${x},${y + k} are drawn into each other`);
  }
  assert.equal(n, 16, "ten in the great hall, six in the throne hall");
});

test("the cracked wall is part of the wall it stands in until it is broken", () => {
  assert.ok(isWallMassT(T.CRACKED) && isSolidT(T.CRACKED) && isOpaqueT(T.CRACKED));
  assert.ok(!isWallMassT(T.FLOOR) && !isWallMassT(T.RUBBLE), "broken, it is floor: the wall above shows its face again");
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
    if (tile(x, y) !== T.CRACKED) continue;
    // flush with wall (or more cracked wall) above and below, open floor to either side
    for (const dy of [-1, 1]) assert.ok(tile(x, y + dy) === T.WALL || tile(x, y + dy) === T.CRACKED, `cracked wall at ${x},${y} is not built into the wall`);
    for (const dx of [-1, 1]) assert.equal(tile(x + dx, y), T.FLOOR);
  }
});

test("every footlocker stands at the foot of its bed, and all four bed variants exist", () => {
  const beds = props("bed");
  for (const f of props("footlocker")) {
    const bed = beds.filter((b) => b.x === f.x).sort((a, b) => Math.abs(a.y - f.y) - Math.abs(b.y - f.y))[0];
    assert.ok(bed, `${f.id} has no bed`);
    // bed v bit 1: the head lies to the south. A locker below its bed wants the head north, one above it the head south.
    assert.equal((bed.v & 2) === 2, f.y < bed.y, `${f.id} stands at the head of ${bed.id}`);
  }
  // all four variants exist and are one size
  for (let v = 0; v < 4; v++) { const s = propSprite("bed", v, false)!; assert.deepEqual([s.w, s.h], [16, 30]); }
});

test("the chapel keeps one axis: the banner, the altar under it, the pews facing them", () => {
  const altar = d.props.find((p) => p.id === "altar@26,48")!, banner = d.props.find((p) => p.id === "banner@23,46")!;
  assert.equal(banner.x, altar.x);
  for (const pew of props("pew")) assert.equal(pew.x, altar.x);
  assert.ok(banner.y < altar.y && props("pew").every((p) => p.y > altar.y));
});

test("roots trail across floor and rubble, never across the top of a wall", () => {
  const roots = d.decals.filter((dc) => dc.kind === "rootfall");
  assert.ok(roots.length >= 5);
  for (const r of roots) for (const [dx, dy] of [[-9, 0], [9, 0], [-9, 22], [9, 22]]) {
    const tx = Math.floor((r.x + dx) / TS), ty = Math.floor((r.y + dy) / TS);
    assert.notEqual(tile(tx, ty), T.WALL, `a root at ${(r.x / TS).toFixed(1)},${(r.y / TS).toFixed(1)} runs over the wall at ${tx},${ty}`);
  }
});
