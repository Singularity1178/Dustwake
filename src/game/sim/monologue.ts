// Inner monologue (sim). Decides *when* the player golem thinks a line; the
// host only shows the `thought` events this emits. Deterministic, no DOM.
//
// Three ways in (content/monologue.ts describes the rows):
//   think(w, a, id)        a script or cutscene fires a line by id
//   {op: "think", line}    an Effect (interaction rules, schedule, dialogue beats)
//   reactToEvents(w)       event triggers (`on`): run at the end of stepPlayer /
//                          stepWorld and by the host just before it drains
//                          events, so events emitted by paused-world commands
//                          (reading a book, the pack) are seen too.
import { THOUGHTS, thoughtTriggers, type ThoughtLine } from "../content/monologue";
import type { Target } from "../content/tasks";
import { actorDef } from "../content/actors";
import { actorById, emit, player, type Actor, type SimEvent, type World } from "../world/world";
import { meets } from "./requirements";
import { coreCheck } from "./power";

/** What a condition can look at: the thinker, and the event or effect target that prompted the thought (if any). */
export interface ThoughtContext { w: World; a: Actor; event?: SimEvent; target?: Target }
export type ThoughtCondition = (c: ThoughtContext) => boolean;

/**
 * The other actor a thought is about: the event's target/NPC, or the effect's
 * target actor (`coreSlotted` names the body as its `target`, `talkedTo` as
 * its `npc`). `powerChanged` is about the actor whose power changed.
 */
export function thoughtSubject(c: ThoughtContext): Actor | undefined {
  const e = c.event as Record<string, unknown> | undefined;
  const id = (e && (typeof e.target === "string" ? e.target : typeof e.npc === "string" ? e.npc : e.t === "powerChanged" ? e.actor : undefined))
    ?? c.target?.actorId;
  return typeof id === "string" ? actorById(c.w, id) : undefined;
}

/**
 * Named conditions for `ThoughtLine.if`. Adding one is a row here. The two
 * power rows drive the dormant-golem line (E on a worker with no core) and the
 * weak-core line (the guardian given the ruby core).
 */
export const THOUGHT_CONDITIONS: Record<string, ThoughtCondition> = {
  /** The subject has a body that needs power and no core in it. */
  subjectNoPower: (c) => { const s = thoughtSubject(c); return !!s && !!actorDef(s).power && !s.powerCore; },
  /** The subject holds a core of its family that is too weak for its body. */
  subjectWeakPower: (c) => {
    const s = thoughtSubject(c);
    if (!s?.powerCore) return false;
    const chk = coreCheck(s, s.powerCore);
    return chk.accepts && !chk.sufficient;
  },
};

/** Why a line can't be thought right now (undefined: it can). Exported for tests and debugging. */
export function thoughtBlocked(w: World, a: Actor, id: string, ctx: Omit<ThoughtContext, "w" | "a"> = {}): string | undefined {
  const line: ThoughtLine | undefined = THOUGHTS[id];
  if (!line) return "unknown";
  if (a.id !== w.playerId) return "notThinker";
  if (line.once !== false && w.monologue.said.includes(id)) return "said";
  if ((w.monologue.ready[id] ?? -Infinity) > w.time) return "cooldown";
  if (!meets(w, a, line.when)) return "when";
  for (const name of line.if ?? []) {
    const cond = THOUGHT_CONDITIONS[name];
    if (!cond) return `unknownCondition:${name}`;
    if (!cond({ w, a, ...ctx })) return `if:${name}`;
  }
  return undefined;
}

/**
 * The golem thinks line `id`, if it may: records it (one-shot lines, cooldowns)
 * and emits `thought`. Returns whether it fired. Only the player thinks.
 */
export function think(w: World, a: Actor, id: string, ctx: Omit<ThoughtContext, "w" | "a"> = {}): boolean {
  if (thoughtBlocked(w, a, id, ctx)) return false;
  const line = THOUGHTS[id];
  if (line.once !== false) w.monologue.said.push(id);
  if (line.cooldown) w.monologue.ready[id] = w.time + line.cooldown;
  emit(w, { t: "thought", actor: a.id, line: id });
  return true;
}

/** Fire a line from a script without holding an actor reference (cutscenes). */
export const playerThinks = (w: World, id: string) => think(w, player(w), id);

/** Has the golem already thought this one-shot line? */
export const hasThought = (w: World, id: string) => w.monologue.said.includes(id);

// Events already offered to the triggers. Transient (events are never saved) and
// keyed by object identity, so it needs no World field and works across worlds.
const seen = new WeakSet<object>();

/** Does the event belong to the player (its own, or a world event with no actor)? */
const playersEvent = (w: World, e: SimEvent) => !("actor" in e) || typeof e.actor !== "string" || e.actor === w.playerId;

function matches(e: SimEvent, trigger: { event: string; match?: Record<string, unknown> }) {
  if (e.t !== trigger.event) return false;
  const rec = e as Record<string, unknown>;
  for (const [k, v] of Object.entries(trigger.match ?? {})) if (rec[k] !== v) return false;
  return true;
}

/**
 * Offer every not-yet-seen pending event to the event triggers, in emission
 * order and then in THOUGHTS row order. Thoughts never trigger thoughts.
 */
export function reactToEvents(w: World) {
  if (!w.events.length) return;
  const pl = player(w);
  if (!pl) return;
  for (let i = 0; i < w.events.length; i++) {
    const e = w.events[i];
    if (seen.has(e)) continue;
    seen.add(e);
    if (e.t === "thought" || !playersEvent(w, e)) continue;
    for (const [id, line] of Object.entries(THOUGHTS)) {
      if (thoughtTriggers(line).some((tr) => matches(e, tr))) think(w, pl, id, { event: e });
    }
  }
}
