import { emit, type Actor, type World } from "../world/world";

/** Keep legacy player messages unchanged, but never present off-screen work as
 * a player notification. The host filters actor-scoped events in one place. */
export function actorMessage(w: World, a: Actor, text: string) {
  emit(w, { t: "message", text, ...(a.id === w.playerId ? {} : { actor: a.id }) });
}