// Browser persistence. The save store (world/saveStore.ts) runs over IndexedDB
// when it opens, else localStorage, else memory (a private window that blocks
// both still plays; its saves just do not outlive the tab). The legacy single
// localStorage slot is imported into the quick slot once. The old helpers stay
// for the tests and the debug hook.
import { saveToStorage as save, loadFromStorage as load } from "../world/save";
import { SaveStore, MemoryBackend, type KvBackend } from "../world/saveStore";
import type { World } from "../world/world";

export const saveToStorage = (w: World) => save(w, localStorage);
export const loadFromStorage = () => load(localStorage);

/** IndexedDB as a key-value store of strings (one object store). */
export class IdbBackend implements KvBackend {
  private constructor(private db: IDBDatabase, private name: string) {}

  static open(dbName = "dustwake", store = "saves"): Promise<IdbBackend> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store); };
      req.onsuccess = () => resolve(new IdbBackend(req.result, store));
      req.onerror = () => reject(req.error ?? new Error("IndexedDB would not open"));
      req.onblocked = () => reject(new Error("IndexedDB is blocked"));
    });
  }

  private run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.name, mode), req = op(tx.objectStore(this.name));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async get(k: string) { const v = await this.run("readonly", (s) => s.get(k)); return typeof v === "string" ? v : null; }
  async set(k: string, v: string) { await this.run("readwrite", (s) => s.put(v, k)); }
  async delete(k: string) { await this.run("readwrite", (s) => s.delete(k)); }
  async keys() { return (await this.run("readonly", (s) => s.getAllKeys())).map(String); }
}

/** localStorage as the store's backend, under its own prefix. */
export class LocalBackend implements KvBackend {
  constructor(private prefix = "dustwake.v2.") {}
  async get(k: string) { return localStorage.getItem(this.prefix + k); }
  async set(k: string, v: string) { localStorage.setItem(this.prefix + k, v); }
  async delete(k: string) { localStorage.removeItem(this.prefix + k); }
  async keys() {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(this.prefix)) out.push(k.slice(this.prefix.length)); }
    return out;
  }
}

/** The browser's save store, initialised, with the legacy slot imported. `kind` says which backend it got. */
export async function openBrowserStore(): Promise<{ store: SaveStore; kind: "IndexedDB" | "localStorage" | "memory" }> {
  let backend: KvBackend, kind: "IndexedDB" | "localStorage" | "memory" = "IndexedDB";
  try { backend = await IdbBackend.open(); }
  catch {
    try { localStorage.setItem("dustwake.probe", "1"); localStorage.removeItem("dustwake.probe"); backend = new LocalBackend(); kind = "localStorage"; }
    catch { backend = new MemoryBackend(); kind = "memory"; }
  }
  const store = new SaveStore(backend);
  await store.init();
  try { store.importLegacy(localStorage.getItem("dustwake.save")); } catch { /* no localStorage */ }
  return { store, kind };
}
