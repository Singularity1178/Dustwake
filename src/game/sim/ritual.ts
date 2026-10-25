// Translocation-circle puzzle rules (tutorial).
import { ITEMS, glyphItem, type ItemId } from "../content/items";
import { socketPositions } from "../content/ritual";
import { emit, type Actor, type World } from "../world/world";
import type { Area } from "../world/area";
import { beginTask, faceTo, removeItem } from "./tasks";

export function checkRune(w: World, area: Area) {
  const r = area.ritual;
  if (!r) return;
  if (r.sockets.some((s) => s < 0) || !r.core || !r.carved) return;
  const ok = r.sockets.every((s, i) => s === r.solution[i]);
  if (ok) {
    r.active = true; r.actT = 0;
    r.wrong = r.wrong.map(() => false);
    emit(w, { t: "runeActivated" });
  } else {
    r.wrong = r.sockets.map((s, i) => s !== r.solution[i]);
    emit(w, { t: "runeFizzled" });
  }
  area.touch();
}

export function deactivate(w: World, area: Area) {
  const r = area.ritual;
  if (!r) return;
  r.active = false;
  r.actT = 0;
  area.touch();
  emit(w, { t: "runeDeactivated" });
}

/** Command from the glyph picker: seat a glyph immediately, then a short reach checks the circle. */
export function placeGlyph(w: World, actor: Actor, area: Area, socket: number, glyph: number) {
  const r = area.ritual;
  if (!r) return;
  const id: ItemId = glyphItem(glyph);
  if (ITEMS[id].glyph === undefined) return;
  removeItem(actor, id);
  r.sockets[socket] = glyph;
  r.wrong[socket] = false;
  area.touch();
  emit(w, { t: "glyphPlaced", socket });
  const s = socketPositions(area.ritualPos)[socket];
  faceTo(actor, s.x, s.y);
  beginTask(actor, { kind: "reach", dur: 0.45, effect: { op: "checkRune" } });
}
