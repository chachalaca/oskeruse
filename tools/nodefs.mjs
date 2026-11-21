// Minimální implementace rozhraní FileSystemDirectoryHandle nad node:fs.
// Umožňuje používat stejné úložiště (src/core/repo.js) v Node – v importním nástroji a v testech.
import fs from "node:fs/promises";
import path from "node:path";

function notFound(p) { const e = new Error(`not found: ${p}`); e.name = "NotFoundError"; return e; }

export class NodeFile {
  constructor(p) { this.kind = "file"; this.name = path.basename(p); this._p = p; }
  async getFile() {
    let st; try { st = await fs.stat(this._p); } catch (e) { throw notFound(this._p); }
    const p = this._p;
    return { name: this.name, size: st.size, lastModified: Math.floor(st.mtimeMs), text: () => fs.readFile(p, "utf8"),
      arrayBuffer: async () => { const b = await fs.readFile(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } };
  }
  async createWritable() {
    const tmp = path.join(path.dirname(this._p), `.${this.name}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
    const chunks = [];
    const p = this._p;
    return {
      async write(d) {
        if (typeof d === "string") chunks.push(Buffer.from(d));
        else if (d instanceof Blob) chunks.push(Buffer.from(await d.arrayBuffer()));
        else if (d instanceof ArrayBuffer) chunks.push(Buffer.from(d));
        else chunks.push(Buffer.from(d));
      },
      async close() { await fs.writeFile(tmp, Buffer.concat(chunks)); await fs.rename(tmp, p); },
      async abort() { try { await fs.unlink(tmp); } catch (e) {} },
    };
  }
}

export class NodeDir {
  constructor(p) { this.kind = "directory"; this.name = path.basename(p); this._p = p; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const p = path.join(this._p, name);
    try { const st = await fs.stat(p); if (!st.isDirectory()) throw notFound(p); }
    catch (e) { if (!create) throw notFound(p); await fs.mkdir(p, { recursive: true }); }
    return new NodeDir(p);
  }
  async getFileHandle(name, { create = false } = {}) {
    const p = path.join(this._p, name);
    try { await fs.stat(p); } catch (e) { if (!create) throw notFound(p); await fs.writeFile(p, ""); }
    return new NodeFile(p);
  }
  async removeEntry(name, { recursive = false } = {}) { await fs.rm(path.join(this._p, name), { recursive }); }
  async *values() {
    for (const d of await fs.readdir(this._p, { withFileTypes: true })) {
      const p = path.join(this._p, d.name);
      yield d.isDirectory() ? new NodeDir(p) : new NodeFile(p);
    }
  }
}
