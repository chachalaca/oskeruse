// Úložiště katalogu nad složkou. Pracuje s rozhraním FileSystemDirectoryHandle
// (File System Access API v Chrome/Edge); v Node a v testech se používá stejné rozhraní
// nad node:fs (tools/nodefs.mjs), pro režim jen ke čtení obal nad seznamem souborů.
//
// Načítání: soubory, jejichž čas změny a velikost se od minula nezměnily, se nečtou znovu –
// záznamy se vezmou z mezipaměti (IndexedDB). Po synchronizaci se tak čte jen pár souborů.
// Zápis: před každým uložením se soubor znovu přečte z disku a změna se aplikuje na aktuální
// verzi; konfliktní kopie od Syncthingu se slučují automaticky podle časů změn polí.

import { APP_MARKER, DIRS, SCHEMA, CONFLICT_RE, conflictBase, isTempName, parseRecord, serialize, applyPatch, mergeRecords, nowISO } from "./model.js";

const TYPES = ["tree", "orchard"];
const POOL = 24;

export class Repo {
  constructor(root, { cache = memoryCache(), readOnly = false } = {}) {
    this.root = root; this.cache = cache; this.readOnly = readOnly;
    this.records = { tree: new Map(), orchard: new Map() };
    this.files = new Map();     // "stromy/x.json" → {m, s, id, type}
    this.conflicts = [];        // [{dir, name, base}]
    this.errors = [];           // [{path, msg}]
    this.marker = null;
    this._chain = Promise.resolve();
  }

  /* ---------- složka ---------- */
  async readMarker() {
    try { this.marker = JSON.parse(await (await (await this.root.getFileHandle(APP_MARKER)).getFile()).text()); }
    catch (e) { this.marker = null; }
    return this.marker;
  }
  async isEmpty() { for await (const e of this.root.values()) if (!isTempName(e.name)) return false; return true; }
  async createCatalog(name, who) {
    const m = { app: "oskeruse", schema: SCHEMA, name: name || "Katalog oskeruší", created: nowISO(), createdBy: who || null };
    await this._write(this.root, APP_MARKER, JSON.stringify(m, null, 1) + "\n");
    for (const d of Object.values(DIRS)) await this.root.getDirectoryHandle(d, { create: true });
    this.marker = m; return m;
  }

  /* ---------- načtení / změny ---------- */
  // Prvotní načtení z mezipaměti – okamžitě, bez čtení složky.
  async loadFromCache() {
    const all = await this.cache.all();
    for (const [path, v] of all) {
      if (!v || !v.rec) continue;
      this.files.set(path, { m: v.m, s: v.s, id: v.rec.id, type: v.rec.type });
      this.records[v.rec.type]?.set(v.rec.id, v.rec);
    }
    return all.size;
  }

  // Projde složku a načte jen změněné soubory. Vrací sadu změněných a odstraněných id.
  async scan(onProgress) {
    const changed = new Set(), removed = new Set(), seen = new Set(), errors = [], conflicts = [];
    let total = 0, done = 0;
    for (const type of TYPES) {
      const dirName = DIRS[type];
      let dir; try { dir = await this.root.getDirectoryHandle(dirName); } catch (e) { continue; }
      const entries = [];
      for await (const e of dir.values()) {
        if (e.kind !== "file" || isTempName(e.name)) continue;
        if (CONFLICT_RE.test(e.name)) { conflicts.push({ type, dir: dirName, name: e.name, base: conflictBase(e.name) }); continue; }
        if (!e.name.endsWith(".json")) continue;
        entries.push(e);
      }
      total += entries.length;
      const idsInDir = new Map();
      await pool(entries, POOL, async (e) => {
        const path = `${dirName}/${e.name}`; seen.add(path);
        try {
          const f = await e.getFile();
          const prev = this.files.get(path);
          if (prev && prev.m === f.lastModified && prev.s === f.size && this.records[type].has(prev.id)) { idsInDir.set(prev.id, path); return; }
          const rec = parseRecord(await f.text(), path);
          if (rec.type !== type) throw new Error(`${path}: záznam typu ${rec.type} ve složce ${dirName}`);
          if (e.name !== rec.id + ".json") errors.push({ path, msg: `Soubor obsahuje záznam s id ${rec.id} – název souboru má být ${rec.id}.json.` });
          if (idsInDir.has(rec.id)) { errors.push({ path, msg: `Záznam ${rec.id} je zároveň v souboru ${idsInDir.get(rec.id)} – tento soubor se ignoruje.` }); return; }
          idsInDir.set(rec.id, path);
          const old = prev && this.records[type].get(prev.id);
          if (prev && prev.id !== rec.id) { this.records[type].delete(prev.id); removed.add(prev.id); }
          this.files.set(path, { m: f.lastModified, s: f.size, id: rec.id, type });
          this.records[type].set(rec.id, rec);
          this.cache.put(path, { m: f.lastModified, s: f.size, rec });
          if (!old || JSON.stringify(old) !== JSON.stringify(rec)) changed.add(rec.id);
        } catch (err) {
          errors.push({ path, msg: err.message || String(err) });
        } finally { done++; if (onProgress && done % 50 === 0) onProgress(done, total); }
      });
    }
    // soubory, které zmizely
    for (const [path, v] of [...this.files]) {
      if (seen.has(path)) continue;
      this.files.delete(path); this.cache.del(path);
      if (![...this.files.values()].some(o => o.id === v.id)) { this.records[v.type]?.delete(v.id); removed.add(v.id); }
    }
    this.errors = errors; this.conflicts = conflicts;
    if (onProgress) onProgress(total, total);
    return { changed, removed };
  }

  list(type) { return [...this.records[type].values()]; }
  get(type, id) { return this.records[type].get(id) || null; }

  /* ---------- zápis ---------- */
  // Zápisy jdou postupně za sebou (žádné souběžné zápisy do jednoho souboru).
  _serial(fn) { const p = this._chain.then(fn, fn); this._chain = p.catch(() => {}); return p; }

  // patchFn(aktuální záznam) → objekt se změněnými poli
  update(type, id, patchFn, who) {
    return this._serial(async () => {
      this._assertWritable();
      const dirName = DIRS[type], name = id + ".json", path = `${dirName}/${name}`;
      const dir = await this.root.getDirectoryHandle(dirName, { create: true });
      let base = null;
      try { base = parseRecord(await (await (await dir.getFileHandle(name)).getFile()).text(), path); }
      catch (e) { if (e.name !== "NotFoundError" && !/not ?found|ENOENT/i.test(e.message)) throw e; }
      base = base || this.records[type].get(id);
      if (!base) throw new Error(`Záznam ${id} neexistuje.`);
      const { rec, changed } = applyPatch(base, patchFn(structuredClone(base)), who);
      if (changed.length || !this.files.has(path)) await this._saveRec(dir, path, rec);
      return rec;
    });
  }
  create(type, rec, who) {
    return this._serial(async () => {
      this._assertWritable();
      const dirName = DIRS[type], path = `${dirName}/${rec.id}.json`;
      const dir = await this.root.getDirectoryHandle(dirName, { create: true });
      const { _ts, history, ...fields } = rec;
      const { rec: out } = applyPatch({ schema: rec.schema, type: rec.type, id: rec.id, _ts: {}, history: [] }, fields, who);
      await this._saveRec(dir, path, out);
      return out;
    });
  }
  async _saveRec(dir, path, rec) {
    const name = path.split("/").pop();
    await this._write(dir, name, serialize(rec));
    const f = await (await dir.getFileHandle(name)).getFile();
    this.files.set(path, { m: f.lastModified, s: f.size, id: rec.id, type: rec.type });
    this.records[rec.type].set(rec.id, rec);
    this.cache.put(path, { m: f.lastModified, s: f.size, rec });
  }
  async _write(dir, name, data) {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();   // zapisuje do dočasného souboru, při close() se atomicky nahradí
    try { await w.write(data); await w.close(); }
    catch (e) { try { await w.abort?.(); } catch (_) {} throw e; }
  }
  _assertWritable() { if (this.readOnly) throw new Error("Katalog je otevřen jen pro čtení."); }

  /* ---------- konflikty od Syncthingu ---------- */
  async resolveConflicts() {
    const res = { merged: 0, failed: [] };
    if (this.readOnly) return res;
    for (const c of this.conflicts) {
      await this._serial(async () => {
        const dir = await this.root.getDirectoryHandle(c.dir);
        const cpath = `${c.dir}/${c.name}`;
        try {
          const other = parseRecord(await (await (await dir.getFileHandle(c.name)).getFile()).text(), cpath);
          let main = null;
          try { main = parseRecord(await (await (await dir.getFileHandle(c.base)).getFile()).text(), `${c.dir}/${c.base}`); } catch (e) {}
          const merged = mergeRecords(main, other);
          await this._saveRec(dir, `${c.dir}/${merged.id}.json`, merged);
          await dir.removeEntry(c.name);
          res.merged++;
        } catch (e) { res.failed.push({ path: cpath, msg: e.message || String(e) }); }
      });
    }
    this.conflicts = this.conflicts.filter(c => res.failed.some(f => f.path === `${c.dir}/${c.name}`));
    return res;
  }

  /* ---------- fotky ---------- */
  async _photoDir(treeId, create) {
    const p = await this.root.getDirectoryHandle(DIRS.photo, { create });
    return p.getDirectoryHandle(treeId, { create });
  }
  writePhoto(treeId, fileName, blob) {
    return this._serial(async () => { this._assertWritable(); await this._write(await this._photoDir(treeId, true), fileName, blob); });
  }
  async photoFile(relPath) { // "foto/<strom>/<soubor>"
    const [, treeId, name] = relPath.split("/");
    return (await (await this._photoDir(treeId, false)).getFileHandle(name)).getFile();
  }
  removePhotoFile(relPath) {
    return this._serial(async () => {
      this._assertWritable();
      const [, treeId, name] = relPath.split("/");
      try { await (await this._photoDir(treeId, false)).removeEntry(name); } catch (e) {}
    });
  }
  // všechny soubory ve složce foto/ (pro kontrolu dat)
  async listPhotoFiles() {
    const out = [];
    let p; try { p = await this.root.getDirectoryHandle(DIRS.photo); } catch (e) { return out; }
    for await (const d of p.values()) {
      if (d.kind !== "directory") continue;
      for await (const f of d.values()) if (f.kind === "file" && !isTempName(f.name)) out.push(`${DIRS.photo}/${d.name}/${f.name}`);
    }
    return out;
  }
}

/* ---------- pomocné ---------- */
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
export function memoryCache() {
  const m = new Map();
  return { async all() { return m; }, put(k, v) { m.set(k, v); }, del(k) { m.delete(k); }, async clear() { m.clear(); } };
}
