// Who a sim event concerns, for presentation. Many actors work at once
// (workers in other areas, an NPC beside the player), but host reactions such
// as notes, toasts, screen changes and shakes belong to the player. Nearby
// actors get world-space feedback only. Pure (no DOM), so tests can check it.
import { actorById, player, type SimEvent, type World } from "../world/world";

export type Audience = "player" | "nearby" | "elsewhere";

/** The actor an event is attributed to (message and cue events carry one). */
export function eventActor(e: SimEvent): string | undefined {
  return "actor" in e && typeof e.actor === "string" ? e.actor : undefined;
}

/** "player": the player's own (or world) event; "nearby": another actor in the player's area; "elsewhere": skip it. */
export function eventAudience(w: World, e: SimEvent): Audience {
  const id = eventActor(e);
  if (!id || id === w.playerId) return "player";
  const a = actorById(w, id);
  return a && a.area === player(w).area ? "nearby" : "elsewhere";
}
