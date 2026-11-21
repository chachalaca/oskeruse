// Malý obal nad IndexedDB: mezipaměť načtených souborů + nastavení (vč. uloženého přístupu ke složce).
const DB = "oskeruse", VER = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("files"); d.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kv = {
  get: k => tx("kv", "readonly", s => req(s.get(k))).catch(() => null),
  set: (k, v) => tx("kv", "readwrite", s => { s.put(v, k); }).catch(() => {}),
  del: k => tx("kv", "readwrite", s => { s.delete(k); }).catch(() => {}),
};

// mezipaměť souborů pro Repo – zápisy se dávkují, aby čtení 800 souborů nezdržovalo
export function idbCache(scope) {
  const pre = scope + "|";
  let pending = new Map(), timer = null;
  const flush = () => {
    timer = null; const batch = pending; pending = new Map();
    return tx("files", "readwrite", s => { for (const [k, v] of batch) v === undefined ? s.delete(pre + k) : s.put(v, pre + k); }).catch(e => console.warn("mezipaměť", e));
  };
  const later = () => { if (!timer) timer = setTimeout(flush, 400); };
  return {
    async all() {
      const m = new Map();
      try {
        await tx("files", "readonly", s => new Promise(res => {
          const r = s.openCursor(IDBKeyRange.bound(pre, pre + "￿"));
          r.onsuccess = () => { const c = r.result; if (!c) return res(); m.set(c.key.slice(pre.length), c.value); c.continue(); };
          r.onerror = () => res();
        }));
      } catch (e) {}
      return m;
    },
    put(k, v) { pending.set(k, v); later(); },
    del(k) { pending.set(k, undefined); later(); },
    async clear() { pending.clear(); await tx("files", "readwrite", s => { s.delete(IDBKeyRange.bound(pre, pre + "￿")); }).catch(() => {}); },
    flush,
  };
}
