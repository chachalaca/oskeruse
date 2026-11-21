#!/usr/bin/env node
// Jednorázový převod původních HTML souborů do nové složky katalogu.
//
//   node tools/import-legacy.mjs --out data \
//     --catalog "~/vysadby/oskerusovy-katalog-ceske-stredohori (3).html" \
//     --orchard ~/vysadby/kostalov/oskerusovy-sad-kostalov.html \
//     --photos ~/Downloads/Fotografie-sad
//
// Id stromů jsou odvozená z obsahu (stabilní), opakovaný import do prázdné složky dá stejný výsledek.
// Fotky se převedou na WebP (zobrazovací velikost max. 1600 px a náhled 320 px) pomocí ImageMagick.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NodeDir } from "./nodefs.mjs";
import { Repo } from "../src/core/repo.js";
import { emptyTree, emptyOrchard, parseCirc, hav } from "../src/core/model.js";

const run = promisify(execFile);
const WHO = "import";
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? a.push([v.slice(2), arr[i + 1]]) : 0, a), []));
const home = p => p && p.replace(/^~(?=\/)/, os.homedir());
const OUT = home(args.out || "data"), CATALOG = home(args.catalog), ORCHARD = home(args.orchard), PHOTOS = home(args.photos);

const B32 = "abcdefghijkmnpqrstuvwxyz23456789";
const stableId = (s, n = 10) => [...crypto.createHash("sha1").update(s).digest()].slice(0, n).map(b => B32[b % 32]).join("");

async function main() {
  if (!CATALOG) throw new Error("Chybí --catalog");
  await fs.mkdir(OUT, { recursive: true });
  const repo = new Repo(new NodeDir(OUT));
  if (await repo.readMarker()) throw new Error(`Ve složce ${OUT} už katalog je – import se dělá jen do prázdné složky.`);
  if (!(await repo.isEmpty())) throw new Error(`Složka ${OUT} není prázdná.`);
  await repo.createCatalog("Katalog oskeruší Českého středohoří", WHO);

  /* ---------- katalog stromů ---------- */
  const html = await fs.readFile(CATALOG, "utf8");
  const m = html.match(/^const RAW = (\[.*\]);\s*$/m);
  if (!m) throw new Error("V katalogu nebyla nalezena data (const RAW = [...])");
  const RAW = JSON.parse(m[1]);
  const byInv = new Map();
  const used = new Set();
  for (const [i, r] of RAW.entries()) {
    let id = stableId(`tree|${r.inv ?? ""}|${r.name}|${i}`);
    while (used.has(id)) id = stableId(id + "x");
    used.add(id);
    const t = {
      ...emptyTree(id),
      inv: r.inv ?? null, name: r.name, short: r.short, area: r.area, place: r.loc || null,
      cultivars: (r.cv || []).map(s => s.trim()).filter(Boolean),
      lat: r.g ? r.g[0] : null, lon: r.g ? r.g[1] : null, acc: r.acc ? +r.acc : null,
      alt: r.alt ?? null, altText: r.altTxt ?? null, height: r.h ?? null, crown: r.kor ?? null, habitat: r.typ ?? null,
      ripening: r.zr ?? null, status: [...(r.st || [])], note: r.note ?? null,
      measurements: r.meas.map((x, k) => ({ id: stableId(`${id}|m|${k}`, 8), year: x.y ?? null, text: x.txt, stems: x.stems, eq: x.eq ?? parseCirc(x.txt)?.eq ?? null,
        approx: x.approx ?? null, author: x.a ?? null, source: x.src ?? null })),
      legacy: r.G ? { G: true } : null,
    };
    await repo.create("tree", t, WHO);
    if (r.inv) { const k = String(r.inv).trim(); (byInv.get(k) || byInv.set(k, []).get(k)).push(t); }
  }
  console.log(`Stromy: ${RAW.length}`);
  const findTree = (inv, near) => {
    const c = byInv.get(String(inv)) || [];
    if (c.length <= 1 || !near) return c[0] || null;
    return c.filter(t => t.lat != null).sort((a, b) => hav(a, near) - hav(b, near))[0] || c[0];
  };

  /* ---------- sad Košťálov ---------- */
  if (ORCHARD) {
    const oh = await fs.readFile(ORCHARD, "utf8");
    const a = oh.indexOf("const TREES"), b = oh.indexOf("/* ======================= DERIVED");
    const ctx = {}; vm.createContext(ctx);
    const D = vm.runInContext(oh.slice(a, b) + ";({TREES,COLORS,PLAN,ORCH_ALT,SUP_COL,SUP_NAME})", ctx);
    const om = oh.match(/const orchard=\{lat:([\d.]+), lon:([\d.]+)\}/);
    const o = { ...emptyOrchard(stableId("orchard|kostalov")) };
    o.name = "Oskerušový sad Košťálov"; o.place = "Košťálov";
    o.note = "Genofondový sad – rozmístění genotypů a jejich matečné stromy (České středohoří).";
    if (om) { o.lat = +om[1]; o.lon = +om[2]; }
    o.altRange = D.ORCH_ALT;
    o.suppliers = Object.fromEntries(Object.entries(D.SUP_NAME).filter(([k]) => k.length === 1).map(([k, n]) => [k, { name: n, color: D.SUP_COL[k] }]));
    const map = new Map();
    for (const g of D.TREES) {
      const t = findTree(g.inv, g);
      if (!t) { console.warn(`  ! genotyp ${g.inv} ${g.short} nenalezen v katalogu`); continue; }
      if (t.lat != null && hav(t, g) > 0.05) console.warn(`  ! genotyp ${g.inv}: poloha v katalogu se liší o ${Math.round(hav(t, g) * 1000)} m`);
      map.set(g.inv, t.id);
      o.genotypes.push({ tree: t.id, label: g.short, color: D.COLORS[g.inv], supply: { Z: g.Z, B: g.B } });
    }
    const rowLabel = { A: "řada A (Z)", C: "řada C (V)" };
    o.rows = Object.entries(D.PLAN).map(([row, arr]) => ({ id: row, label: rowLabel[row] || `řada ${row}`,
      positions: arr.map(([inv, sup]) => ({ tree: map.get(inv) || null, supplier: sup })) }));
    o.layout = { gaps: [{ after: 0, label: "vynechaný pás" }], top: "↑ sever · průjezd od souseda", bottom: "↘ nájezd" };
    await repo.create("orchard", o, WHO);
    console.log(`Sad: ${o.name}, ${o.genotypes.length} genotypů, ${o.rows.reduce((s, r) => s + r.positions.length, 0)} pozic`);
  }

  /* ---------- fotky ---------- */
  if (PHOTOS) {
    const jobs = [];
    for (const [sub, kind] of [["Stromy", "tree"], ["Plody", "fruit"]]) {
      let files = []; try { files = await fs.readdir(path.join(PHOTOS, sub)); } catch (e) { continue; }
      for (const f of files.sort()) {
        if (!/\.(jpe?g|png|heic|webp)$/i.test(f)) continue;
        const name = f.normalize("NFC").replace(/\.[^.]+$/, "");
        const mm = name.match(/^\s*(\d+)\s*(.*)$/); if (!mm) { console.warn(`  ! ${sub}/${f}: chybí inv. č. na začátku názvu`); continue; }
        const t = findTree(mm[1]); if (!t) { console.warn(`  ! ${sub}/${f}: strom ${mm[1]} není v katalogu`); continue; }
        const caption = mm[2].replace(/\s*\(\d+\)/g, "").replace(/\s*\.\.\s*/g, " ").replace(/\s+/g, " ").trim().replace(/^[-–\s]+|[-–\s]+$/g, "");
        jobs.push({ src: path.join(PHOTOS, sub, f), t, kind, caption, key: `${sub}/${f}` });
      }
    }
    const photosByTree = new Map();
    let i = 0;
    await Promise.all(Array.from({ length: Math.max(1, os.cpus().length - 1) }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        const pid = stableId(`photo|${j.key}`, 8);
        const dir = path.join(OUT, "foto", j.t.id); await fs.mkdir(dir, { recursive: true });
        const file = `foto/${j.t.id}/${pid}.webp`, thumb = `foto/${j.t.id}/${pid}.t.webp`;
        await run("magick", [j.src, "-auto-orient", "-strip", "-resize", "1600x1600>", "-quality", "72", "-define", "webp:method=6", path.join(OUT, file)]);
        await run("magick", [j.src, "-auto-orient", "-strip", "-thumbnail", "320x320>", "-quality", "65", path.join(OUT, thumb)]);
        const { stdout } = await run("magick", ["identify", "-format", "%w %h|%[EXIF:DateTimeOriginal]", j.src + "[0]"]).catch(() => ({ stdout: "" }));
        const [wh, dt] = stdout.split("|"); const [w, h] = (wh || "").split(" ").map(Number);
        const date = dt && /^\d{4}:\d\d:\d\d/.test(dt) ? dt.slice(0, 10).replace(/:/g, "-") : null;
        const { stdout: d2 } = await run("magick", ["identify", "-format", "%w %h", path.join(OUT, file)]);
        const [dw, dh] = d2.split(" ").map(Number);
        (photosByTree.get(j.t.id) || photosByTree.set(j.t.id, []).get(j.t.id)).push({ id: pid, kind: j.kind, file, thumb, caption: j.caption || null, date, w: dw, h: dh, author: null, key: j.key });
      }
    }));
    for (const [tid, ps] of photosByTree) {
      ps.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "tree" ? -1 : 1) || a.key.localeCompare(b.key, "cs"));
      await repo.update("tree", tid, r => ({ photos: [...r.photos, ...ps.map(({ key, ...p }) => p)] }), WHO);
    }
    console.log(`Fotky: ${jobs.length} u ${photosByTree.size} stromů`);
  }
  console.log(`Hotovo → ${path.resolve(OUT)}`);
}
main().catch(e => { console.error("Chyba:", e.message); process.exit(1); });
