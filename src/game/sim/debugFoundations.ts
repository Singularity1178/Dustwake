import { RUNE_NODES, RUNE_LINKS } from "../content/runes";
import { createWorld, enterArea, getArea, makeActor, player, setFlag } from "../world/world";
import { AREAS } from "../world/areas";
import { buildFoundationArea } from "../world/foundationAreas";
import { giveItem } from "./inventory";
import { insertPowerCore } from "./power";
import { assignJob, gatherOrder } from "./jobs";

/**
 * Registers the two debug areas and their rune link (?debug and tests). The
 * storage chest, ruby and inverse recipes it used to opt into are production
 * rows now (content/build.ts, content/crafting.ts), so nothing here touches a
 * catalog. Idempotent, and performed before loading fixture saves.
 */
export function registerFoundations() {
  for (const id of ["debug_yard", "debug_workshop"] as const) {
    AREAS[id] = () => buildFoundationArea(id);
    RUNE_NODES[id] = { id, area: id, prop: `rune.${id}`, flag: `rune.${id}.active`, name: id.toUpperCase(), arrive: { dx: 0, dy: 16, facing: "down" } };
  }
  if (!RUNE_LINKS.some((l) => l.a === "debug_yard")) RUNE_LINKS.push({ a: "debug_yard", b: "debug_workshop" });
}

/** A complete gather/travel/deposit proof, without altering either real area. */
export function foundationDemo(seed = 1178) {
  registerFoundations();
  const w = createWorld(seed), pl = player(w);
  getArea(w, "debug_yard"); getArea(w, "debug_workshop");
  enterArea(w, pl, "debug_workshop", 136, 139);
  const worker = makeActor("debug.worker", "worker_golem", "debug_workshop", 120, 123);
  w.actors.push(worker);
  for (const f of ["know.build", "tutorial.done", "rune.debug_yard.active", "rune.debug_workshop.active"]) setFlag(w, f);
  giveItem(w, pl, "ruby_core"); insertPowerCore(w, pl, worker, "ruby_core");
  giveItem(w, pl, "chisel"); giveItem(w, pl, "crown"); giveItem(w, pl, "planks", 8);
  assignJob(w, worker, gatherOrder("wood", "debug_yard", { area: "debug_workshop", prop: "chest.fixture" }, 6));
  w.events = [];
  return w;
}