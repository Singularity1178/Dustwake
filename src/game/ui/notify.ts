// The notification feed (pure model; drawn by view/hudHi.ts). Sim events that a
// manager needs to hear about become notes: info (the day turning, an order
// done), warn (a full pack, a worker out of power), alert (a worker blocked). A
// repeat of the same note within a few seconds is counted, not stacked. With
// "pause on alert" on (settings), an alert pauses the game (Game.onAlert).
import { actorById, type Actor, type SimEvent, type World } from "../world/world";
import { actorDef } from "../content/actors";
import { learnedText } from "../content/flags";

export type NoteLevel = "info" | "warn" | "alert";

export interface Note {
  id: number;
  text: string;
  level: NoteLevel;
  /** Seconds shown so far, and how long it stays. */
  age: number;
  ttl: number;
  /** How many times it came in while shown. */
  count: number;
  /** Notes with the same key merge. */
  key: string;
}

export const NOTE_TTL: Record<NoteLevel, number> = { info: 6, warn: 10, alert: 16 };

export class NotificationFeed {
  items: Note[] = [];
  /** Everything said this session, newest first (the system menu's log). */
  history: Note[] = [];
  /** Shown at once. */
  max = 6;
  onAlert: ((n: Note) => void) | null = null;
  private seq = 0;

  push(text: string, level: NoteLevel = "info", key = text): Note {
    const same = this.items.find((n) => n.key === key && n.age < 4);
    if (same) { same.count++; same.age = 0; same.text = text; return same; }
    const n: Note = { id: ++this.seq, text, level, age: 0, ttl: NOTE_TTL[level], count: 1, key };
    this.items.unshift(n);
    if (this.items.length > this.max) this.items.length = this.max;
    this.history.unshift(n);
    if (this.history.length > 80) this.history.length = 80;
    if (level === "alert") this.onAlert?.(n);
    return n;
  }

  update(dt: number) {
    for (const n of this.items) n.age += dt;
    this.items = this.items.filter((n) => n.age < n.ttl);
  }

  dismiss(id: number) { this.items = this.items.filter((n) => n.id !== id); }
  clear() { this.items = []; }
}

/** "BOB - WORKER GOLEM" style names, in sentence case for the v2 font. */
export function actorName(a: Actor): string {
  const kind = sentence(actorDef(a).name);
  return a.name ? `${sentence(a.name)} (${kind})` : kind;
}

/** "THE OLD STAIR" -> "The old stair". Mixed-case text is left alone. */
export function sentence(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const t = s.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "noRoute" -> "no route". */
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** What a sim event says in the feed, if anything. Pure: the tests read it straight. */
export function noteForEvent(w: World, e: SimEvent): { text: string; level: NoteLevel; key: string } | null {
  switch (e.t) {
    case "jobChanged": {
      const a = actorById(w, e.actor);
      if (!a || a.id === w.playerId) return null;
      const who = actorName(a);
      if (e.status === "blocked") return { text: `${who} is blocked${e.reason ? `: ${words(e.reason)}` : ""}`, level: "alert", key: `job:${a.id}:blocked` };
      if (e.status === "done") return { text: `${who} finished its order`, level: "info", key: `job:${a.id}:done` };
      if (e.status === "paused" && e.reason === "power") return { text: `${who} has no power`, level: "warn", key: `job:${a.id}:power` };
      return null;
    }
    case "packFull": return e.actor === w.playerId ? { text: "Your pack is full", level: "warn", key: "packFull" } : null;
    case "dayPhase": return { text: `${sentence(e.phase.toUpperCase())}, day ${e.day + 1}`, level: "info", key: `phase:${e.day}:${e.phase}` };
    case "learned": return { text: sentence(learnedText(e.flag)), level: "info", key: `learned:${e.flag}` };
    case "entranceOpened": return { text: "A way in has been opened", level: "info", key: `entrance:${e.entrance}` };
    case "powerChanged": {
      const a = actorById(w, e.actor);
      if (!a || a.id === w.playerId) return null;
      return { text: `${actorName(a)} ${e.powered ? "powered on" : "powered down"}`, level: e.powered ? "info" : "warn", key: `power:${a.id}` };
    }
    default: return null;
  }
}
