// Phase 0.4: save system v2 (slots, autosave backups, recovery, export / import, the legacy slot, budgets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, player, getArea, enterArea } from "../src/game/world/world";
import { serialize, deserialize } from "../src/game/world/save";
import { SaveStore, MemoryBackend, BACKUPS, parseRecord, fnv1a } from "../src/game/world/saveStore";
import { populateResidents } from "../src/game/sim/soak";
import { simTick } from "../src/game/sim/replay";

let clock = 1000;
const store = (b = new MemoryBackend()) => new SaveStore(b, () => (clock += 1000));

test("slots: save, list, load; a manual slot keeps the copy it replaced as a backup", async () => {
  const st = store(), w = createWorld(31);
  st.save("slot1", w);
  for (let i = 0; i < 60; i++) simTick(w);
  st.save("slot1", w);
  assert.ok(st.has("slot1") && st.has("slot1.bak"));
  const r = st.load("slot1")!;
  assert.equal(r.from, "slot1");
  assert.ok(Math.abs(r.world.time - w.time) < 1e-9);
  assert.ok(st.load("slot1.bak")!.world.time < w.time);
  assert.equal(st.list()[0].slot, "slot1", "newest first");
  await st.flush();
  assert.ok((await st.backend.keys()).includes("save:slot1"), "written through to the backend");
});

test("autosave keeps BACKUPS rolling copies, newest in auto", () => {
  const st = store(), w = createWorld(32), times: number[] = [];
  for (let k = 0; k < BACKUPS + 2; k++) { simTick(w); times.push(w.time); st.autosave(w); }
  assert.ok(Math.abs(st.load("auto")!.world.time - times[times.length - 1]) < 1e-9);
  for (let i = 1; i <= BACKUPS; i++) assert.ok(Math.abs(st.load(`auto.${i}`)!.world.time - times[times.length - 1 - i]) < 1e-9);
  assert.ok(!st.has(`auto.${BACKUPS + 1}`));
});

test("recovery: a damaged slot falls back to its backup and says so; when nothing loads, the reason is kept", async () => {
  const backend = new MemoryBackend(), a = store(backend), w = createWorld(33);
  a.save("slot2", w);
  simTick(w);
  a.save("slot2", w);
  a.autosave(w); simTick(w); a.autosave(w);
  await a.flush();
  // bit rot in the newest copies
  for (const k of ["save:slot2", "save:auto"]) {
    const rec = JSON.parse(backend.map.get(k)!);
    rec.data = rec.data.replace(/"time":[0-9.e-]+/, '"time":12345');
    backend.map.set(k, JSON.stringify(rec));
  }
  const b = store(backend);
  await b.init();
  const r = b.load("slot2")!;
  assert.equal(r.from, "slot2.bak");
  assert.match(r.recovered!, /could not be read.*checksum/);
  assert.equal(b.load("auto")!.from, "auto.1");
  assert.ok(b.list().some((m) => m.slot === "slot2" && !m.ok));
  backend.map.set("save:slot3", "{not json");
  const c = store(backend);
  await c.init();
  assert.equal(c.load("slot3"), null);
  assert.match(c.lastError!, /not valid JSON/);
});

test("export and import round-trip a slot; a file that does not load is refused with the reason; a bare save imports too", () => {
  const st = store(), w = createWorld(34);
  st.save("quick", w);
  const text = st.exportText("quick")!;
  const st2 = store();
  const m = st2.importText(text, "slot3");
  assert.equal(m.slot, "slot3");
  assert.equal(JSON.stringify(serialize(st2.load("slot3")!.world)), JSON.stringify(serialize(st.load("quick")!.world)));
  assert.throws(() => st2.importText("hello", "slot1"), /not valid JSON/);
  assert.throws(() => st2.importText(JSON.stringify({ format: "dustwake-save", v: 2, meta: { checksum: "0" }, data: "{}" }), "slot1"), /checksum/);
  assert.throws(() => st2.importText("{\"a\":1}", "slot1"), /not a Dustwake save/);
  const bare = JSON.stringify(serialize(w));
  assert.equal(parseRecord(bare).meta.checksum, fnv1a(bare));
  st2.importText(bare, "slot1");
  assert.ok(st2.load("slot1"));
});

test("the legacy single localStorage slot is imported into the quick slot once (a v19 save migrates on the way)", () => {
  const st = store(), w = createWorld(35);
  const old: any = serialize(w);
  old.version = 19; delete old.specs;
  assert.ok(st.importLegacy(JSON.stringify(old)));
  assert.ok(st.load("quick"));
  assert.equal(st.importLegacy(JSON.stringify(old)), false, "never over a quick save that exists");
  assert.equal(st.importLegacy(null), false);
});

test("budgets (0.4): saves stay small and load fast, up to a 300-resident town", () => {
  const now = () => globalThis.performance.now();
  const fresh = createWorld(36);
  const freshText = JSON.stringify(serialize(fresh));
  assert.ok(freshText.length < 24 * 1024, `fresh save ${freshText.length} B`);
  const w = createWorld(37), pl = player(w), town = getArea(w, "town");
  enterArea(w, pl, "town", town.start.x, town.start.y);
  for (let i = 0; i < 120; i++) simTick(w);
  const townText = JSON.stringify(serialize(w));
  assert.ok(townText.length < 160 * 1024, `town save ${townText.length} B`);
  populateResidents(w, 300, "town");
  for (let i = 0; i < 60; i++) simTick(w);
  const t0 = now(), bigText = JSON.stringify(serialize(w)), t1 = now();
  const back = deserialize(JSON.parse(bigText)), t2 = now();
  assert.ok(bigText.length < 1536 * 1024, `300-resident save ${bigText.length} B`);
  assert.ok(t1 - t0 < 1500, `saved in ${(t1 - t0).toFixed(0)} ms`);
  assert.ok(t2 - t1 < 2000, `loaded in ${(t2 - t1).toFixed(0)} ms`);
  assert.equal(back.actors.length, w.actors.length);
});
