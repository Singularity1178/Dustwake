// Dialogue engine (sim side, no DOM). Scripts are data (content/dialogue.ts),
// keyed by the script id an NpcDef names. Nothing here knows any particular
// NPC: which segment plays is "the first segment whose requirement is met and
// whose completion flag is unset", so progress is derived from flags and a
// later chapter is a new data row.
//
// The presentation layer (the dialogue screen) only displays pages and calls
// the commands below at the right moments; every state change goes through
// Effects applied here, so tests drive whole encounters headlessly.
import { DIALOGUE, BEATS, type DialoguePage, type DialogueScript, type DialogueSegment } from "../content/dialogue";
import { npcDef } from "../content/npcs";
import { FLAGS, NPC_AWAKE, npcFlag } from "../content/flags";
import type { Effect, Target } from "../content/tasks";
import { emit, hasFlag, setFlag, clearFlag, actorById, type Actor, type World } from "../world/world";
import { meets } from "./requirements";
import { giveItem } from "./inventory";
import { applyEffect } from "./tasks";

/** An NPC's reversible awake state (flag npc.<id>.awake; absent = dormant). */
export const isAwake = (w: World, npcActorId: string) => hasFlag(w, npcFlag(npcActorId, NPC_AWAKE));

/** The NPC actor with this id, if it is one. */
export function npcActor(w: World, npcActorId: string): Actor | undefined {
  const a = actorById(w, npcActorId);
  return a && a.kind === "npc" && npcDef(a.npc) ? a : undefined;
}

/** Script id of an NPC actor (from its NpcDef). */
export function scriptIdOf(w: World, npcActorId: string): string | undefined {
  const a = npcActor(w, npcActorId);
  return a ? npcDef(a.npc)!.dialogue : undefined;
}

export function scriptOf(w: World, npcActorId: string): DialogueScript | undefined {
  const id = scriptIdOf(w, npcActorId);
  return id ? DIALOGUE[id] : undefined;
}

/** The segment talking would play now: the first available, uncompleted one. */
export function currentSegment(w: World, listener: Actor, script: DialogueScript): DialogueSegment | null {
  return script.segments.find((s) => !hasFlag(w, s.done) && meets(w, listener, s.when)) ?? null;
}

/** A segment's pages as they would be shown now (optional pages filtered by their requirement). */
export function segmentPages(w: World, listener: Actor, seg: DialogueSegment): DialoguePage[] {
  return seg.pages.filter((p) => meets(w, listener, p.when));
}

const npcTarget = (a: Actor): Target => ({ kind: "npc", x: a.x, y: a.y, actorId: a.id, npc: a.npc });

/** Apply a dialogue/NPC effect (called from applyEffect). All of these are idempotent. */
export function applyDialogueEffect(w: World, a: Actor, e: Effect, target?: Target) {
  switch (e.op) {
    case "talk": {
      const npc = target?.actorId ? npcActor(w, target.actorId) : undefined;
      if (!npc || npc.area !== a.area) break;
      const scriptId = npcDef(npc.npc)!.dialogue;
      const script = DIALOGUE[scriptId];
      if (!script) break;
      const seg = currentSegment(w, a, script);
      // Every talk, whatever it shows: a segment's `dialogue` follows, or the idle line once the story is done.
      emit(w, { t: "talkedTo", actor: a.id, npc: npc.id });
      if (seg) emit(w, { t: "dialogue", actor: a.id, npc: npc.id, script: scriptId, segment: seg.id });
      else emit(w, { t: "message", text: script.idle });
      break;
    }
    case "npcAwake": {
      const f = npcFlag(e.npc, NPC_AWAKE);
      if (hasFlag(w, f) === e.awake) break;
      if (e.awake) setFlag(w, f); else clearFlag(w, f);
      emit(w, { t: "npcState", npc: e.npc, awake: e.awake });
      break;
    }
    case "repairEye":
      if (hasFlag(w, FLAGS.golemEye)) break;
      setFlag(w, FLAGS.golemEye);
      emit(w, { t: "eyeRepaired", actor: a.id, by: target?.actorId });
      break;
    case "npcGive":
      if (hasFlag(w, e.once)) break;
      setFlag(w, e.once);
      giveItem(w, a, e.item, 1);
      break;
    case "segmentDone":
      setFlag(w, e.flag);
      break;
  }
}

/** The segment `segId` of an NPC's script, if `listener` may play it now (NPC present, requirement met). */
function playable(w: World, listener: Actor, npcActorId: string, segId: string) {
  const npc = npcActor(w, npcActorId);
  if (!npc || npc.area !== listener.area) return null;
  const script = DIALOGUE[npcDef(npc.npc)!.dialogue];
  const seg = script?.segments.find((s) => s.id === segId);
  if (!script || !seg || !meets(w, listener, seg.when)) return null;
  return { npc, script, seg };
}

// ------------------------------------------------------------------ commands
// Issued by the dialogue screen (world paused, like the pack's drop command)
// and by tests. Each validates and then applies plain Effects.

/** Talk to an NPC right now (the interaction path does the same via a `talk` task). Returns the segment that opens, if any. */
export function talkTo(w: World, a: Actor, npcActorId: string): DialogueSegment | null {
  const npc = npcActor(w, npcActorId);
  if (!npc) return null;
  applyEffect(w, a, { op: "talk" }, npcTarget(npc));
  const script = scriptOf(w, npcActorId)!;
  return currentSegment(w, a, script);
}

/** Fire a beat that belongs to segment `segId` of the NPC's script. Returns false if not allowed. */
export function dialogueBeat(w: World, a: Actor, npcActorId: string, segId: string, beat: string): boolean {
  const c = playable(w, a, npcActorId, segId);
  if (!c || !c.seg.pages.some((p) => p.beat === beat || p.then === beat)) return false;
  const h = BEATS[beat];
  if (!h) return false;
  const e = h({ npc: npcActorId });
  if (e) applyEffect(w, a, e, npcTarget(c.npc));
  return true;
}

/** A segment was played through: set its completion flag. Returns the segment that follows now, if any. */
export function finishSegment(w: World, a: Actor, npcActorId: string, segId: string): DialogueSegment | null {
  const c = playable(w, a, npcActorId, segId);
  if (!c) return null;
  applyEffect(w, a, { op: "segmentDone", npc: npcActorId, segment: segId, flag: c.seg.done }, npcTarget(c.npc));
  return currentSegment(w, a, c.script);
}

/**
 * Play a whole segment headlessly in screen order: show-beats, then dismiss
 * (then-beats), then finish. `upto` stops before dismissing that page index
 * (an interrupted dialogue). Used by tests and handy for debugging.
 */
export function playSegment(w: World, a: Actor, npcActorId: string, seg: DialogueSegment, upto = Infinity): DialogueSegment | null {
  const pages = segmentPages(w, a, seg);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.beat) dialogueBeat(w, a, npcActorId, seg.id, p.beat);
    if (i >= upto) return null;
    if (p.then) dialogueBeat(w, a, npcActorId, seg.id, p.then);
  }
  return finishSegment(w, a, npcActorId, seg.id);
}
