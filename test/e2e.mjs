// End-to-end test ve skutečném Chrome (headless): data katalogu se zkopírují do OPFS
// (stejné rozhraní FileSystemDirectoryHandle jako u složky vybrané uživatelem) a aplikace nad nimi běží.
//   node test/e2e.mjs [složka s daty] [složka pro snímky]
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const DATA = path.resolve(process.argv[2] || "data"), SHOTS = path.resolve(process.argv[3] || "test/shots"), DIST = path.resolve("dist");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
await fs.mkdir(SHOTS, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".webmanifest": "application/manifest+json" };
async function walk(d, pre = "") { const o = []; for (const e of await fs.readdir(d, { withFileTypes: true })) { if (e.name.startsWith(".")) continue; e.isDirectory() ? o.push(...await walk(path.join(d, e.name), pre + e.name + "/")) : o.push(pre + e.name); } return o; }
const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/__seed") { res.writeHead(200, { "content-type": "text/html" }); res.end("<!doctype html><title>seed</title>"); return; }
  if (p === "/__list") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(await walk(DATA))); return; }
  const f = p.startsWith("/__data/") ? path.join(DATA, p.slice(8)) : path.join(DIST, p === "/" ? "index.html" : p);
  try { const b = await fs.readFile(f); res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); res.end(b); } catch { res.writeHead(404).end(); }
}).listen(+(process.env.PORT || 0));
const BASE = `http://localhost:${srv.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: process.env.CHROME_PROFILE || undefined, args: ["--window-size=1440,960", "--no-first-run", "--no-default-browser-check"], defaultViewport: { width: 1440, height: 960 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.text().startsWith("[sw]")) console.log("    " + m.text()); if (m.text().startsWith("[čas]")) console.log("    " + m.text()); if (m.type() === "error" && !/Failed to load resource|ERR_|net::|CORS|status of 4|status of 5/.test(m.text())) errors.push("console: " + m.text()); });
let ok = 0, fail = 0;
const check = (name, cond, info = "") => { if (cond) { ok++; console.log("  ✓", name, info); } else { fail++; console.log("  ✗", name, info); } };
const shot = n => page.screenshot({ path: path.join(SHOTS, n + ".png") });

// 1) data do OPFS
await page.goto(BASE + "/__seed");
const seedMs = await page.evaluate(async () => {
  const t0 = performance.now();
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry("katalog", { recursive: true }); } catch (e) {}
  const kat = await root.getDirectoryHandle("katalog", { create: true });
  const files = await (await fetch("/__list")).json();
  let i = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (i < files.length) {
      const f = files[i++]; const parts = f.split("/"); let d = kat;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await w.write(await (await fetch("/__data/" + f)).blob()); await w.close();
    }
  }));
  return Math.round(performance.now() - t0);
});
console.log(`data zkopírována do OPFS za ${seedMs} ms`);
await page.evaluateOnNewDocument(() => {
  window.__oskeruseFolder = navigator.storage.getDirectory().then(r => r.getDirectoryHandle("katalog"));
});
// jméno uživatele do IndexedDB
await page.goto(BASE + "/__seed");
await page.evaluate(() => new Promise(r => { const q = indexedDB.open("oskeruse", 1); q.onupgradeneeded = () => { q.result.createObjectStore("files"); q.result.createObjectStore("kv"); }; q.onsuccess = () => { const t = q.result.transaction("kv", "readwrite"); t.objectStore("kv").put("Testér", "user"); t.oncomplete = () => { q.result.close(); r(); }; }; }));

// 2) první načtení (bez mezipaměti)
let t0 = Date.now();
await page.goto(BASE + "/index.html");
await page.waitForFunction(() => document.querySelectorAll("#list li[data-id]").length > 100 && document.getElementById("welcome").hidden, { timeout: 60000 });
const cold = Date.now() - t0;
const nTrees = await page.$eval("#sAll", e => +e.textContent);
check("první načtení katalogu", nTrees === 744, `${nTrees} stromů za ${cold} ms`);
await new Promise(r => setTimeout(r, 1500)); await shot("01-mapa");

// 3) opětovné načtení z mezipaměti
t0 = Date.now();
await page.reload();
await page.waitForFunction(() => document.querySelectorAll("#list li[data-id]").length > 100 && document.getElementById("welcome").hidden, { timeout: 30000 });
const warm = Date.now() - t0;
await page.waitForFunction(() => /\d\d:\d\d/.test(document.getElementById("syncSt").textContent), { timeout: 30000 });
const warmFull = Date.now() - t0;
check("bez falešné nabídky aktualizace", await page.$eval("#upd", e => getComputedStyle(e).display === "none"));
check("načtení z mezipaměti", warm < cold || warm < 1500, `zobrazeno za ${warm} ms, kontrola složky hotova za ${warmFull} ms`);

// 4) detail stromu s fotkami
await page.type("#q", "ohnivka"); await new Promise(r => setTimeout(r, 300));
await page.click("#list li[data-id]"); await page.waitForSelector("#detail .gal img[src^='blob:']", { timeout: 10000 });
const nImgs = await page.$$eval("#detail .gal img", a => a.length);
check("fotky v detailu", nImgs === 5, `${nImgs} náhledů`);
await new Promise(r => setTimeout(r, 1200)); await shot("02-detail");
await page.evaluate(() => document.querySelector("#detail .gal button").click()); await page.waitForSelector("#lb.on #lbImg[src^='blob:']");
await new Promise(r => setTimeout(r, 300)); await shot("03-lightbox");
await page.keyboard.press("Escape");

// 5) přidání měření → zápis do souboru
const selId = await page.evaluate(() => location.hash.split("=")[1]);
await page.$eval("#measForm [name=text]", e => e.value = "119");
await page.click("#measForm button");
await page.waitForFunction(() => [...document.querySelectorAll("#detail .meas td.num")].some(td => td.textContent.includes("119")), { timeout: 10000 });
const disk = await page.evaluate(async id => JSON.parse(await (await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("katalog")).getDirectoryHandle("stromy")).getFileHandle(id + ".json")).getFile()).text()), selId);
check("měření uloženo do souboru", disk.measurements.some(m => m.text === "119" && m.author === "Testér") && disk.updatedBy === "Testér");

// 6) změna zvenku (jako ze Syncthingu) → aplikace ji načte
await page.evaluate(async id => {
  const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("katalog")).getDirectoryHandle("stromy");
  const f = await d.getFileHandle(id + ".json"); const r = JSON.parse(await (await f.getFile()).text());
  r.note = "ZMĚNA ZVENKU"; r._ts.note = "2099-01-01T00:00:00.000Z";
  const w = await f.createWritable(); await w.write(JSON.stringify(r)); await w.close();
}, selId);
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
await page.waitForFunction(() => document.querySelector("#detail .note")?.textContent.includes("ZMĚNA ZVENKU"), { timeout: 10000 }).catch(() => {});
check("změna souboru zvenku se projeví", await page.evaluate(() => !!document.querySelector("#detail .note")?.textContent.includes("ZMĚNA ZVENKU")));

// 7) konfliktní kopie od Syncthingu → sloučení
await page.evaluate(async id => {
  const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("katalog")).getDirectoryHandle("stromy");
  const r = JSON.parse(await (await (await d.getFileHandle(id + ".json")).getFile()).text());
  r.ripening = "KONFLIKT IX."; r._ts.ripening = "2099-02-01T00:00:00.000Z"; r.note = "starší poznámka"; r._ts.note = "2000-01-01T00:00:00.000Z";
  const w = await (await d.getFileHandle(id + ".sync-conflict-20261121-101500-ABCDEFG.json", { create: true })).createWritable(); await w.write(JSON.stringify(r)); await w.close();
}, selId);
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
await page.waitForFunction(() => document.querySelector("#detail")?.textContent.includes("KONFLIKT IX."), { timeout: 10000 }).catch(() => {});
const after = await page.evaluate(async id => {
  const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("katalog")).getDirectoryHandle("stromy");
  const names = []; for await (const e of d.values()) if (e.name.startsWith(id)) names.push(e.name);
  const r = JSON.parse(await (await (await d.getFileHandle(id + ".json")).getFile()).text());
  return { names, ripening: r.ripening, note: r.note };
}, selId);
check("konflikt sloučen", after.names.length === 1 && after.ripening === "KONFLIKT IX." && after.note === "ZMĚNA ZVENKU", JSON.stringify(after));

// 8) sady
await page.click('.tab[data-v="vOrch"]'); await page.waitForSelector("#plan .pos");
const nPos = await page.$$eval("#plan .pos", a => a.length);
check("plán sadu", nPos === 39, `${nPos} pozic`);
await new Promise(r => setTimeout(r, 500)); await shot("04-sad");
await page.click("#oEditPlan"); await page.waitForSelector("#plan .addpos");
await page.$$eval("#plan .addpos", a => a[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
await page.waitForFunction(() => document.querySelectorAll("#plan .pos").length === 40, { timeout: 5000 }).catch(() => {});
check("přidání pozice v plánu", await page.$$eval("#plan .pos", a => a.length) === 40);
await page.$$eval("#plan .pos.empty", a => a[0].dispatchEvent(new MouseEvent("click", { bubbles: true })));
await page.waitForSelector("#pf");
await page.type("#pf [name=tree]", "22 · Bílinka VII - \"Ohnivka\"");
await page.select("#pf [name=supplier]", "Z");
await page.click("#pfSave");
await page.waitForFunction(() => !document.querySelector("#pf"), { timeout: 5000 });
const posOk = await page.evaluate(() => [...document.querySelectorAll("#plan .pos title")].some(t => t.textContent.startsWith("A13 ·") && t.textContent.includes("inv. č. 22")));
check("přiřazení genotypu k pozici", posOk);
await shot("05-sad-uprava");
await page.click("#oEditPlan");

// 9) mapa se sadem
await page.click("#oMap"); await new Promise(r => setTimeout(r, 1500)); await shot("06-mapa-sad");

// 10) nový strom
await page.click("#newTree"); await page.waitForSelector("#tf");
await page.type("#tf [name=short]", "Testovací strom");
await page.type("#tf [name=area]", "Testov");
await page.type("#tf [name=gps]", "50.5272,14.0109");
await new Promise(r => setTimeout(r, 200));
const dupWarn = await page.$eval("#tfMsgs", e => e.textContent);
check("upozornění na blízký strom", dupWarn.includes("Do 30 m"), dupWarn.slice(0, 80));
await shot("07-novy-strom");
await page.click("#tfSave");
await page.waitForFunction(() => document.querySelector("#detail h2")?.textContent === "Testovací strom", { timeout: 10000 }).catch(() => {});
check("nový strom založen", await page.$eval("#sAll", e => +e.textContent) === 745);

// 11) tabulka, přehled, kontrola dat
await page.click('.tab[data-v="vTbl"]'); await new Promise(r => setTimeout(r, 400)); await shot("08-tabulka");
check("tabulka (jen viditelné řádky)", (await page.$$eval("#tbl tbody tr[data-id]", a => a.length)) < 200);
await page.click('.tab[data-v="vOver"]'); await new Promise(r => setTimeout(r, 400)); await shot("09-prehled");
await page.click('.tab[data-v="vCheck"]'); await new Promise(r => setTimeout(r, 400)); await shot("10-kontrola");

check("nabídka aktualizace skrytá i na konci", await page.$eval("#upd", e => getComputedStyle(e).display === "none"));
console.log(errors.length ? "Chyby v konzoli:\n  " + errors.join("\n  ") : "Žádné chyby v konzoli.");
check("bez chyb JavaScriptu", errors.length === 0);
console.log(`\n${ok} v pořádku, ${fail} selhalo`);
await browser.close(); srv.close();
process.exit(fail ? 1 : 0);
