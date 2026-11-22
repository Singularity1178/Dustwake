// Save system v2 (pure, no DOM). Several slots over an async key-value backend
// (IndexedDB in the browser: view/persistence.ts; memory in tests), autosave with
// rolling backups, export / import as text (a file in the browser), checksums
// and a recovery path for damaged saves.
//
// Records are cached in memory once `init()` has read them, so reads are
// synchronous (the game's load paths stay simple); writes update the cache at
// once and reach the backend asynchronously (`flush()` awaits them).
//
// Recovery: a slot that fails its checksum, does not parse, or does not load
// falls back to its backups in order (a manual slot keeps one, `<slot>.bak`, the
// copy it overwrote; the autosave keeps BACKUPS rolling copies). What was used is
// reported, never silently hidden. The legacy single localStorage slot (v1 of
// the save system) is imported into the quick slot once.
import { serialize, deserialize, settle, SAVE_VERSION } from "./save";
import type { World } from "./world";
import { worldHour } from "../sim/daytime";

export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** An in-memory backend (tests, and the game before the browser store is open). */
export class MemoryBackend implements KvBackend {
  map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async keys() { return [...this.map.keys()]; }
}

export interface SlotMeta {
  slot: string;
  label: string;
  savedAt: number;
  version: number;
  area: string;
  day: number;
  hour: number;
  playTime: number;
  /** Bytes of save data. */
  size: number;
  checksum: string;
}

export interface SaveRecord { format: "dustwake-save"; v: 2; meta: SlotMeta; data: string }

export interface LoadResult {
  world: World;
  meta: SlotMeta;
  /** The slot the world actually came from (a backup, if the slot itself was damaged). */
  from: string;
  /** Set when a backup had to be used: what happened, for the player. */
  recovered?: string;
}

/** Manual slots, in the order menus list them. "quick" is K / L. */
export const MANUAL_SLOTS = ["quick", "slot1", "slot2", "slot3"] as const;
export const AUTO = "auto";
/** Rolling autosave copies kept besides the newest. */
export const BACKUPS = 3;
const PREFIX = "save:";

export const slotName = (slot: string): string =>
  slot === "quick" ? "Quick save" : slot.startsWith("slot") && !slot.includes(".") ? `Slot ${slot.slice(4)}`
    : slot === AUTO ? "Autosave" : slot.startsWith(`${AUTO}.`) ? `Autosave backup ${slot.slice(AUTO.length + 1)}`
      : slot.endsWith(".bak") ? `${slotName(slot.slice(0, -4))} (backup)` : slot;

/** FNV-1a over the text, as 8 hex digits: cheap, and enough to tell a damaged save from a good one. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export function makeRecord(slot: string, w: World, now: number, label?: string): SaveRecord {
  const data = JSON.stringify(serialize(w));
  const pl = w.actors.find((a) => a.id === w.playerId);
  return {
    format: "dustwake-save", v: 2,
    meta: {
      slot, label: label ?? slotName(slot), savedAt: now, version: SAVE_VERSION, area: pl?.area ?? "?",
      day: Math.floor(w.day), hour: worldHour(w), playTime: w.playTime, size: data.length, checksum: fnv1a(data),
    },
    data,
  };
}

/**
 * Read a record from text: a v2 record, or a bare save (the legacy slot, an old export). Throws with a reason when
 * it is neither, or when the checksum does not match.
 */
export function parseRecord(text: string, slot = "import"): SaveRecord {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("not valid JSON"); }
  const r = raw as Partial<SaveRecord> & { version?: number };
  if (r && r.format === "dustwake-save" && typeof r.data === "string" && r.meta) {
    if (fnv1a(r.data) !== r.meta.checksum) throw new Error("checksum mismatch (the save is damaged)");
    return r as SaveRecord;
  }
  if (r && typeof r.version === "number") {
    const data = JSON.stringify(raw);
    return {
      format: "dustwake-save", v: 2, data,
      meta: { slot, label: slotName(slot), savedAt: 0, version: r.version, area: "?", day: 0, hour: 0, playTime: 0, size: data.length, checksum: fnv1a(data) },
    };
  }
  throw new Error("not a Dustwake save");
}

/** A record's world (migrated, settled). Throws on anything that does not load. */
export function worldOf(rec: SaveRecord): World {
  return settle(deserialize(JSON.parse(rec.data)));
}

export class SaveStore {
  private cache = new Map<string, string>();
  private writes: Promise<void> = Promise.resolve();
  /** The last error a write or a load ran into (shown by the saves screen). */
  lastError: string | null = null;
  /** Called after an asynchronous write fails (the host notifies the player). */
  onError: ((msg: string) => void) | null = null;

  constructor(public backend: KvBackend, public now: () => number = () => Date.now()) {}

  /** Read every record into the cache. */
  async init(): Promise<void> {
    for (const k of await this.backend.keys()) {
      if (!k.startsWith(PREFIX)) continue;
      const v = await this.backend.get(k);
      if (v != null) this.cache.set(k.slice(PREFIX.length), v);
    }
  }

  /** Every stored slot, newest first, with whether it reads cleanly. */
  list(): (SlotMeta & { ok: boolean; reason?: string })[] {
    const out: (SlotMeta & { ok: boolean; reason?: string })[] = [];
    for (const [slot, text] of this.cache) {
      try { const r = parseRecord(text, slot); out.push({ ...r.meta, slot, ok: true }); }
      catch (e) { out.push({ slot, label: slotName(slot), savedAt: 0, version: 0, area: "?", day: 0, hour: 0, playTime: 0, size: text.length, checksum: "", ok: false, reason: (e as Error).message }); }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  }

  has(slot: string) { return this.cache.has(slot); }
  meta(slot: string): SlotMeta | null {
    const t = this.cache.get(slot);
    if (!t) return null;
    try { return parseRecord(t, slot).meta; } catch { return null; }
  }
  /** Raw stored text (tests, and the export of a slot as it is). */
  raw(slot: string) { return this.cache.get(slot) ?? null; }

  /** Save `w` into a manual slot. The copy it replaces is kept as `<slot>.bak`. Throws if the world will not serialize. */
  save(slot: string, w: World, label?: string): SlotMeta {
    const rec = makeRecord(slot, w, this.now(), label);
    const prev = this.cache.get(slot);
    if (prev) this.put(`${slot}.bak`, prev);
    this.put(slot, JSON.stringify(rec));
    return rec.meta;
  }

  /** The autosave: the newest copy in `auto`, the older ones rolled down auto.1 .. auto.BACKUPS. */
  autosave(w: World): SlotMeta {
    const rec = makeRecord(AUTO, w, this.now());
    for (let i = BACKUPS; i >= 1; i--) {
      const from = i === 1 ? AUTO : `${AUTO}.${i - 1}`, t = this.cache.get(from);
      if (t) this.put(`${AUTO}.${i}`, t);
    }
    this.put(AUTO, JSON.stringify(rec));
    return rec.meta;
  }

  /** The slots tried, in order, when loading `slot`. */
  chain(slot: string): string[] {
    if (slot === AUTO) return [AUTO, ...Array.from({ length: BACKUPS }, (_, i) => `${AUTO}.${i + 1}`)];
    return [slot, `${slot}.bak`];
  }

  /** Load a slot, falling back along its chain. Null if nothing in it loads (lastError says why). */
  load(slot: string): LoadResult | null {
    const errors: string[] = [];
    for (const s of this.chain(slot)) {
      const text = this.cache.get(s);
      if (!text) continue;
      try {
        const rec = parseRecord(text, s);
        const world = worldOf(rec);
        const res: LoadResult = { world, meta: rec.meta, from: s };
        if (s !== slot) res.recovered = `${slotName(slot)} could not be read (${errors[0] ?? "missing"}); loaded ${slotName(s)} instead.`;
        this.lastError = null;
        return res;
      } catch (e) { errors.push((e as Error).message); }
    }
    this.lastError = errors.length ? `${slotName(slot)}: ${errors.join("; ")}` : `${slotName(slot)} is empty`;
    return null;
  }

  /** The newest save of any slot that loads (Continue). */
  loadLatest(): LoadResult | null {
    const primary = this.list().filter((m) => !m.slot.endsWith(".bak") && !/^auto\.\d+$/.test(m.slot));
    for (const m of primary) { const r = this.load(m.slot); if (r) return r; }
    for (const m of this.list()) { const r = this.load(m.slot); if (r) return r; }
    return null;
  }

  delete(slot: string) {
    this.cache.delete(slot);
    this.queue(() => this.backend.delete(PREFIX + slot));
  }

  /** The text of a slot for a file (the v2 record: meta, checksum and data). */
  exportText(slot: string): string | null { return this.cache.get(slot) ?? null; }

  /** Store text from a file in `slot`, after checking that it loads. Throws with the reason if it does not. */
  importText(text: string, slot: string): SlotMeta {
    const rec = parseRecord(text, slot);
    worldOf(rec);
    const meta = { ...rec.meta, slot, label: rec.meta.label || slotName(slot) };
    const prev = this.cache.get(slot);
    if (prev) this.put(`${slot}.bak`, prev);
    this.put(slot, JSON.stringify({ ...rec, meta }));
    return meta;
  }

  /** The legacy single slot (localStorage "dustwake.save"): copied into the quick slot once, if that is empty. */
  importLegacy(raw: string | null): boolean {
    if (!raw || this.cache.has("quick")) return false;
    try { this.importText(raw, "quick"); return true; } catch (e) { this.lastError = `old save: ${(e as Error).message}`; return false; }
  }

  /** Wait for every write so far to reach the backend. */
  flush(): Promise<void> { return this.writes; }

  private put(slot: string, text: string) {
    this.cache.set(slot, text);
    this.queue(() => this.backend.set(PREFIX + slot, text));
  }
  private queue(op: () => Promise<void>) {
    this.writes = this.writes.then(op).catch((e) => {
      this.lastError = `write failed: ${(e as Error)?.message ?? e}`;
      this.onError?.(this.lastError);
    });
  }
}
