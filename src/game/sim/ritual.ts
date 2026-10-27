// Translocation-circle puzzle rules (tutorial).
import { ITEMS, glyphItem, type ItemId } from "../content/items";
import { socketPositions } from "../content/ritual";
import { RUNE_NODES } from "../content/runes";
import { clearFlag, emit, setFlag, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { beginTask, faceTo } from "./tasks";
import { removeItems } from "./inventory";

export function checkRune(w: World, area: Area) {
  const r = area.ritual;
  if (!r) return;
  if (r.sockets.some((s) => s < 0) || !r.core || !r.carved) return;
  const ok = r.sockets.every((s, i) => s === r.solution[i]);
  if (ok) {
    area.updateRitual({ active: true, actT: 0, wrong: r.wrong.map(() => false) });
    // The circle is this area's node in the rune network: lighting it activates the node.
    setFlag(w, RUNE_NODES.dungeon.flag);
    emit(w, { t: "runeActivated" });
  } else {
    area.updateRitual({ wrong: r.sockets.map((s, i) => s !== r.solution[i]) });
    emit(w, { t: "runeFizzled" });
  }
}

export function deactivate(w: World, area: Area) {
  const r = area.ritual;
  if (!r) return;
  area.updateRitual({ active: false, actT: 0 });
  clearFlag(w, RUNE_NODES.dungeon.flag);
  emit(w, { t: "runeDeactivated" });
}

/** Command from the glyph picker: seat a glyph immediately, then a short reach checks the circle. */
export function placeGlyph(w: World, actor: Actor, area: Area, socket: number, glyph: number) {
  const r = area.ritual;
  if (!r) return;
  const id: ItemId = glyphItem(glyph);
  if (ITEMS[id].glyph === undefined) return;
  if (!removeItems(actor, id, 1)) return;
  const sockets = [...r.sockets], wrong = [...r.wrong];
  sockets[socket] = glyph; wrong[socket] = false;
  area.updateRitual({ sockets, wrong });
  emit(w, { t: "glyphPlaced", socket });
  const s = socketPositions(area.ritualPos)[socket];
  faceTo(actor, s.x, s.y);
  beginTask(actor, { kind: "reach", dur: 0.45, effect: { op: "checkRune" } });
}
