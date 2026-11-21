import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyTree, applyPatch, mergeRecords, parseCirc, parseCoords, live, serialize, parseRecord, conflictBase, validateTree } from "../src/core/model.js";
import { Repo } from "../src/core/repo.js";
import { NodeDir } from "../tools/nodefs.mjs";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "osk-"));

test("obvod kmene", () => {
  assert.deepEqual(parseCirc("170"), { stems: [170], eq: 170, approx: null });
  assert.equal(parseCirc("105+97+36").eq, 147);
  assert.equal(parseCirc("cca 200").approx, true);
  assert.equal(parseCirc(""), null);
});

test("souřadnice v různých formátech", () => {
  assert.deepEqual(parseCoords("50.5272475N, 14.0108600E"), { lat: 50.5272475, lon: 14.01086 });
  assert.deepEqual(parseCoords("50,5272475, 14,01086"), { lat: 50.5272475, lon: 14.01086 });
  assert.deepEqual(parseCoords("14.01086E, 50.5272475N"), { lat: 50.5272475, lon: 14.01086 });
  const d = parseCoords(`50°31'38.09"N 14°0'39.10"E`); assert.ok(Math.abs(d.lat - 50.527247) < 1e-5 && Math.abs(d.lon - 14.010861) < 1e-5);
  assert.deepEqual(parseCoords("https://mapy.cz/turisticka?x=14.0108600&y=50.5272475&z=17"), { lat: 50.5272475, lon: 14.01086 });
  assert.deepEqual(parseCoords("https://www.google.com/maps/search/?api=1&query=50.5272475,14.01086"), { lat: 50.5272475, lon: 14.01086 });
  assert.equal(parseCoords("nic"), null);
});

test("úprava zapisuje časy polí a historii", () => {
  const t = emptyTree("abc");
  const { rec, changed } = applyPatch(t, { name: "Ohnivka", alt: 383 }, "Eva", "2026-01-01T00:00:00Z");
  assert.deepEqual(changed, ["name", "alt"]);
  assert.equal(rec._ts.name, "2026-01-01T00:00:00Z");
  assert.equal(rec.history.length, 1);
  const r2 = applyPatch(rec, { name: "Ohnivka" }, "Eva");
  assert.equal(r2.changed.length, 0);
});

test("slučování: různá pole se spojí, stejné pole vyhraje novější", () => {
  const base = applyPatch(emptyTree("x"), { name: "A", alt: 300, measurements: [{ id: "m1", year: 2020, text: "170" }] }, "u", "2026-01-01T00:00:00Z").rec;
  const a = applyPatch(base, { alt: 310, note: "od A" }, "a", "2026-02-01T00:00:00Z").rec;
  const b = applyPatch(base, { note: "od B", height: 9, measurements: [...base.measurements, { id: "m2", year: 2026, text: "180" }] }, "b", "2026-02-02T00:00:00Z").rec;
  const m1 = mergeRecords(a, b), m2 = mergeRecords(b, a);
  assert.deepEqual(m1, { ...m2, _ts: m1._ts }); // nezávisí na pořadí
  assert.equal(m1.alt, 310); assert.equal(m1.height, 9); assert.equal(m1.note, "od B");
  assert.deepEqual(live(m1.measurements).map(m => m.id).sort(), ["m1", "m2"]);
});

test("slučování: smazaná položka se nevrátí", () => {
  const base = applyPatch(emptyTree("x"), { measurements: [{ id: "m1", text: "1" }, { id: "m2", text: "2" }] }, "u", "2026-01-01T00:00:00Z").rec;
  const a = applyPatch(base, { measurements: base.measurements.filter(m => m.id !== "m1") }, "a", "2026-02-01T00:00:00Z").rec;
  const b = applyPatch(base, { name: "jiná změna" }, "b", "2026-02-02T00:00:00Z").rec;
  assert.deepEqual(live(mergeRecords(a, b).measurements).map(m => m.id), ["m2"]);
  assert.deepEqual(live(mergeRecords(b, a).measurements).map(m => m.id), ["m2"]);
});

test("serializace je stabilní a čitelná zpět", () => {
  const t = applyPatch(emptyTree("x"), { name: "N" }, "u").rec;
  assert.deepEqual(parseRecord(serialize(t), "x"), t);
  assert.equal(conflictBase("abc.sync-conflict-20261121-101500-ABCDEFG.json"), "abc.json");
});

test("kontrola duplicitního inv. č.", () => {
  const a = { ...emptyTree("a"), name: "A", inv: "22" }, b = { ...emptyTree("b"), name: "B", inv: "22" };
  assert.ok(validateTree(a, [a, b]).some(e => e.f === "inv"));
});

test("úložiště: založení, zápis, mezipaměť, změna zvenku, konflikt", async () => {
  const dir = await tmp();
  const cache = new Map();
  const c = { async all() { return cache; }, put(k, v) { cache.set(k, v); }, del(k) { cache.delete(k); } };
  const repo = new Repo(new NodeDir(dir), { cache: c });
  assert.equal(await repo.readMarker(), null);
  await repo.createCatalog("Test", "Eva");
  const t = await repo.create("tree", { ...emptyTree("t1"), name: "Ohnivka", inv: "22" }, "Eva");
  assert.equal(t.createdBy, "Eva");
  await repo.update("tree", "t1", r => ({ alt: 383 }), "Eva");

  // nová instance: vše z mezipaměti, žádný soubor se nečte znovu
  const repo2 = new Repo(new NodeDir(dir), { cache: c });
  await repo2.loadFromCache();
  assert.equal(repo2.get("tree", "t1").alt, 383);
  const r = await repo2.scan();
  assert.equal(r.changed.size, 0);

  // změna souboru zvenku (jako po synchronizaci)
  const p = path.join(dir, "stromy", "t1.json");
  const ext = applyPatch(JSON.parse(await fs.readFile(p, "utf8")), { height: 12 }, "Jan", "2099-01-01T00:00:00Z").rec;
  await fs.writeFile(p, serialize(ext)); await fs.utimes(p, new Date(), new Date(Date.now() + 5000));
  const r2 = await repo2.scan();
  assert.ok(r2.changed.has("t1")); assert.equal(repo2.get("tree", "t1").height, 12);

  // zápis vždy vychází z aktuálního stavu na disku
  const ext2 = applyPatch(ext, { note: "zvenku" }, "Jan", "2099-01-02T00:00:00Z").rec;
  await fs.writeFile(p, serialize(ext2));
  await repo2.update("tree", "t1", () => ({ crown: 3 }), "Eva");
  const disk = JSON.parse(await fs.readFile(p, "utf8"));
  assert.equal(disk.note, "zvenku"); assert.equal(disk.crown, 3);

  // konfliktní kopie od Syncthingu
  const conf = applyPatch(ext2, { ripening: "IX." }, "Petr", "2099-01-03T00:00:00Z").rec;
  await fs.writeFile(path.join(dir, "stromy", "t1.sync-conflict-20261121-101500-ABCDEFG.json"), serialize(conf));
  await repo2.scan();
  assert.equal(repo2.conflicts.length, 1);
  const res = await repo2.resolveConflicts();
  assert.equal(res.merged, 1);
  const fin = JSON.parse(await fs.readFile(p, "utf8"));
  assert.equal(fin.ripening, "IX."); assert.equal(fin.crown, 3); assert.equal(fin.note, "zvenku");
  assert.deepEqual((await fs.readdir(path.join(dir, "stromy"))), ["t1.json"]);

  // smazaný soubor zmizí z katalogu
  await fs.unlink(p);
  const r3 = await repo2.scan();
  assert.ok(r3.removed.has("t1")); assert.equal(repo2.get("tree", "t1"), null);
});

test("úložiště: chybný soubor se nahlásí, ostatní se načtou", async () => {
  const dir = await tmp();
  const repo = new Repo(new NodeDir(dir));
  await repo.createCatalog("T");
  await repo.create("tree", { ...emptyTree("ok"), name: "ok" });
  await fs.writeFile(path.join(dir, "stromy", "bad.json"), "{ nejde");
  await fs.writeFile(path.join(dir, "stromy", ".syncthing.x.json.tmp"), "x");
  const r = new Repo(new NodeDir(dir)); await r.scan();
  assert.equal(r.list("tree").length, 1);
  assert.equal(r.errors.length, 1); assert.match(r.errors[0].path, /bad\.json/);
});

test("režim jen pro čtení: složka ze seznamu souborů (webkitdirectory)", async () => {
  const { dirFromFileList } = await import("../src/core/filelist-dir.js");
  const dir = await tmp();
  const w = new Repo(new NodeDir(dir)); await w.createCatalog("T");
  await w.create("tree", { ...emptyTree("a1"), name: "A" }); await w.create("tree", { ...emptyTree("b2"), name: "B" });
  await fs.mkdir(path.join(dir, "foto", "a1"), { recursive: true }); await fs.writeFile(path.join(dir, "foto", "a1", "p.webp"), "x");
  const files = [];
  const walk = async (d, rel) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name), r = rel + "/" + e.name;
    if (e.isDirectory()) await walk(p, r); else { const f = new File([await fs.readFile(p)], e.name, { lastModified: 1 }); Object.defineProperty(f, "webkitRelativePath", { value: r }); files.push(f); } } };
  await walk(dir, "katalog");
  const ro = new Repo(dirFromFileList(files), { readOnly: true });
  assert.equal((await ro.readMarker()).name, "T");
  await ro.scan();
  assert.deepEqual(ro.list("tree").map(t => t.name).sort(), ["A", "B"]);
  assert.equal(await (await ro.photoFile("foto/a1/p.webp")).text(), "x");
  await assert.rejects(ro.update("tree", "a1", () => ({ name: "X" })), /jen pro čtení/);
});
