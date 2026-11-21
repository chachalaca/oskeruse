// Obal seznamu souborů z <input type="file" webkitdirectory> do rozhraní složky.
// Pro prohlížeče bez File System Access API (Safari, Firefox): katalog jde jen prohlížet.
export function dirFromFileList(files) {
  const root = mk(""), first = files[0] && files[0].webkitRelativePath.split("/")[0];
  for (const f of files) {
    const parts = f.webkitRelativePath.split("/"); if (parts[0] === first) parts.shift();
    let d = root;
    for (const p of parts.slice(0, -1)) d = d.dirs.get(p) || (d.dirs.set(p, mk(p)), d.dirs.get(p));
    d.files.set(parts[parts.length - 1], f);
  }
  root.name = first || "katalog";
  return wrap(root);
}
function mk(name) { return { name, dirs: new Map(), files: new Map() }; }
function nf(n) { const e = new Error(`not found: ${n}`); e.name = "NotFoundError"; return e; }
function wrap(d) {
  return {
    kind: "directory", name: d.name,
    async getDirectoryHandle(n) { const x = d.dirs.get(n); if (!x) throw nf(n); return wrap(x); },
    async getFileHandle(n) { const f = d.files.get(n); if (!f) throw nf(n); return fileH(n, f); },
    async *values() { for (const x of d.dirs.values()) yield wrap(x); for (const [n, f] of d.files) yield fileH(n, f); },
    async removeEntry() { throw new Error("jen pro čtení"); },
  };
}
function fileH(name, f) {
  return { kind: "file", name, async getFile() { return f; }, async createWritable() { throw new Error("jen pro čtení"); } };
}
