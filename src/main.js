// Oskeruše – katalog stromů a sadů. Data jsou ve složce na disku (sdílené Syncthingem),
// aplikace je čte a zapisuje přes File System Access API.
import "leaflet/dist/leaflet.css";
import "./app.css";
import { app, $, esc, derive, toast, modal } from "./ui/util.js";
import { Repo } from "./core/repo.js";
import { kv, idbCache } from "./core/idb.js";
import { dirFromFileList } from "./core/filelist-dir.js";
import { initCatalog, refreshCatalog, renderDetail, renderCurrentTab, select, fitAll } from "./ui/catalog.js";
import { initLightbox, forgetPhotoURLs } from "./ui/photos.js";
import { openTreeForm } from "./ui/edit.js";
import { initOrchards, refreshOrchardOptions } from "./ui/orchard.js";
import { initCheck, updateBadge } from "./ui/check.js";

const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
const POLL_MS = 30000;
const FS = "showDirectoryPicker" in window;

/* ======================= DATA ======================= */
function rebuild(changed, opts = {}) {
  const R = app.repo;
  const prev = app.byId; app.byId = {};
  app.trees = R.list("tree").map(rec => { const old = prev[rec.id]; const t = old && old.rec === rec ? old : derive(rec); app.byId[rec.id] = t; return t; });
  app.orchards = R.list("orchard"); app.byOrch = Object.fromEntries(app.orchards.map(o => [o.id, o]));
  refreshCatalog(); refreshOrchardOptions(); updateBadge();
  if (app.sel && !app.byId[app.sel]) select(null);
  else if (app.sel && !opts.keepDetail && (!changed || changed.has(app.sel))) { const s = $("detail").scrollTop; renderDetail(); $("detail").scrollTop = s; }
  renderCurrentTab();
}
app.hooks.dataChanged = (changed, opts) => rebuild(changed, opts);

let polling = null, scanning = false, lastScan = null;
async function rescan(reason) {
  if (!app.repo || scanning) return;
  scanning = true; setSync("busy", "kontroluji změny…");
  try {
    const { changed, removed } = await app.repo.scan();
    if (app.repo.conflicts.length && !app.readOnly) {
      const r = await app.repo.resolveConflicts();
      if (r.merged) { toast(`Sloučeno ${r.merged} konfliktních verzí ze synchronizace.`); const s2 = await app.repo.scan(); s2.changed.forEach(id => changed.add(id)); }
    }
    lastScan = new Date();
    if (changed.size || removed.size) { rebuild(new Set([...changed, ...removed])); if (reason !== "start") toast(`Načteny změny ze složky: ${changed.size + removed.size} ${changed.size + removed.size === 1 ? "záznam" : "záznamů"}.`); }
    else updateBadge();
    setSync(app.repo.errors.length ? "err" : app.readOnly ? "ro" : "", syncText());
  } catch (e) {
    console.error(e);
    setSync("err", "složku nelze přečíst");
    if (/permission|NotAllowed/i.test(e.name + e.message)) toast("Ztracen přístup ke složce katalogu – načtěte aplikaci znovu.", "err");
  } finally { scanning = false; }
}
const syncText = () => `${app.folderName}${app.readOnly ? " · jen pro čtení" : ""}${lastScan ? " · " + lastScan.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }) : ""}`;
function setSync(cls, text) { const el = $("syncSt"); el.className = "syncst " + cls; el.innerHTML = `<i></i>${esc(text)}`; el.title = "Složka katalogu: " + app.folderName + (lastScan ? `\nNaposledy zkontrolováno ${lastScan.toLocaleString("cs-CZ")}` : "") + "\nKliknutím zkontrolujete změny"; }

/* ======================= SLOŽKA ======================= */
async function openFolder(handle, { readOnly = false } = {}) {
  app.readOnly = readOnly; document.body.classList.toggle("readonly", readOnly);
  app.folderName = handle.name;
  const repo = new Repo(handle, { cache: idbCache((readOnly ? "ro:" : "") + handle.name), readOnly });
  const marker = await repo.readMarker();
  if (!marker) {
    if (readOnly) return welcome({ msg: "Vybraná složka neobsahuje katalog (chybí soubor oskeruse.json)." });
    const empty = await repo.isEmpty();
    return welcome({ create: handle, msg: empty ? "Složka je prázdná. Založit v ní nový katalog?" : "Ve složce není katalog (chybí soubor oskeruse.json) a obsahuje jiné soubory. Vyberte správnou složku – nebo v ní přesto založte nový katalog." });
  }
  forgetPhotoURLs();
  app.repo = repo;
  if (!readOnly) await kv.set("folder", handle);
  const T0 = performance.now(), perf = (m) => console.info(`[čas] ${m}: ${Math.round(performance.now() - T0)} ms`);
  const cached = await repo.loadFromCache(); perf(`mezipaměť (${cached} záznamů)`);
  if (cached) { rebuild(); hideWelcome(); startView(); perf("zobrazeno z mezipaměti"); }
  else welcome({ loading: true });
  setSync("busy", "načítám…");
  scanning = true; let res;
  try {
    res = await repo.scan((d, n) => { const p = $("wProg"); if (p) p.style.width = (n ? d / n * 100 : 100) + "%"; const tx = $("wProgTx"); if (tx) tx.textContent = `${d} / ${n}`; });
  } finally { scanning = false; }
  perf("kontrola složky");
  let merged = 0;
  if (repo.conflicts.length && !readOnly) { const r = await repo.resolveConflicts(); merged = r.merged; if (r.merged) { toast(`Sloučeno ${r.merged} konfliktních verzí ze synchronizace.`); await repo.scan(); } }
  lastScan = new Date();
  // po zobrazení z mezipaměti se překresluje jen tehdy, když se ve složce něco změnilo
  if (!cached || merged || res.changed.size || res.removed.size) rebuild(cached ? new Set([...res.changed, ...res.removed]) : null); else updateBadge();
  hideWelcome(); if (!cached) startView(); perf("hotovo");
  setSync(repo.errors.length ? "err" : readOnly ? "ro" : "", syncText());
  if (repo.errors.length) toast(`${repo.errors.length} souborů nejde načíst – viz Kontrola dat.`, "err");
  clearInterval(polling);
  if (!readOnly) polling = setInterval(() => document.visibilityState === "visible" && rescan(), POLL_MS);
}
let viewStarted = false;
function startView() {
  if (viewStarted) return; viewStarted = true;
  fitAll();
  const h = decodeURIComponent((location.hash.match(/strom=([^&]+)/) || [])[1] || "");
  if (h && app.byId[h]) setTimeout(() => select(h, { fly: true }), 300);
}
async function pickFolder() {
  try {
    const h = await window.showDirectoryPicker({ id: "oskeruse", mode: "readwrite" });
    await openFolder(h);
  } catch (e) { if (e.name !== "AbortError") { console.error(e); toast("Složku se nepodařilo otevřít: " + esc(e.message), "err"); } }
}

/* ======================= ÚVODNÍ OBRAZOVKA ======================= */
function hideWelcome() { $("welcome").hidden = true; }
async function welcome(opt = {}) {
  const w = $("welcome"); w.hidden = false;
  const name = app.user;
  let body = "";
  if (opt.loading) body = `<p>Načítám katalog ze složky <b>${esc(app.folderName)}</b>… Poprvé to může trvat několik sekund, příště se otevře hned.</p><div class="prog"><i id="wProg"></i></div><p class="muted" id="wProgTx" style="font-size:12px"></p>`;
  else if (opt.create) body = `<p class="warn">${esc(opt.msg)}</p><div class="acts"><button class="btn primary" id="wCreate">Založit nový katalog ve složce „${esc(opt.create.name)}“</button><button class="btn" id="wPick">Vybrat jinou složku</button></div>`;
  else {
    const saved = FS ? await kv.get("folder") : null;
    body = `<p>Katalog oskeruší a sadů. Data jsou ve složce na vašem počítači, kterou s ostatními sdílí <b>Syncthing</b> – změny se k ostatním dostanou samy.</p>
      ${opt.msg ? `<p class="warn">${esc(opt.msg)}</p>` : ""}
      <label style="font-size:13px;color:var(--muted)">Vaše jméno (zapisuje se ke změnám)<input id="wName" value="${esc(name)}" placeholder="např. Jana Nováková"></label>
      <div class="acts">
        ${FS ? (saved ? `<button class="btn primary" id="wResume">Pokračovat – složka „${esc(saved.name)}“</button><button class="btn" id="wPick">Vybrat jinou složku katalogu…</button>` : `<button class="btn primary" id="wPick">Vybrat složku katalogu…</button>`)
          : `<p class="warn">Tento prohlížeč neumí zapisovat do složek na disku. Pro úpravy katalogu použijte <b>Google Chrome</b> nebo <b>Microsoft Edge</b>. Tady můžete katalog jen prohlížet.</p>`}
        <label class="btn" style="cursor:pointer">Otevřít jen pro čtení…<input type="file" id="wRO" webkitdirectory multiple hidden></label>
      </div>
      <p class="muted" style="font-size:12px;margin-top:14px">Verze ${esc(VERSION)}</p>`;
  }
  w.innerHTML = `<div class="card"><h2>Oskeruše</h2>${body}</div>`;
  const saveName = async () => { const n = $("wName"); if (n) { app.user = n.value.trim(); await kv.set("user", app.user); } };
  const needName = () => { if (!$("wName") || $("wName").value.trim()) return false; $("wName").focus(); toast("Vyplňte prosím své jméno – zapisuje se ke změnám v katalogu.", "err"); return true; };
  $("wPick")?.addEventListener("click", async () => { if (needName()) return; await saveName(); pickFolder(); });
  $("wResume")?.addEventListener("click", async () => {
    if (needName()) return; await saveName();
    const h = await kv.get("folder");
    try { if (await h.requestPermission({ mode: "readwrite" }) === "granted") await openFolder(h); else toast("Bez povolení přístupu ke složce nelze katalog otevřít.", "err"); }
    catch (e) { toast("Složku se nepodařilo otevřít (byla přesunuta?). Vyberte ji znovu.", "err"); }
  });
  $("wCreate")?.addEventListener("click", async () => {
    const r = new Repo(opt.create); await r.createCatalog("Katalog oskeruší", app.user); await openFolder(opt.create);
  });
  $("wRO")?.addEventListener("change", async e => {
    await saveName();
    const files = [...e.target.files]; if (!files.length) return;
    await openFolder(dirFromFileList(files), { readOnly: true });
  });
}

/* ======================= NASTAVENÍ ======================= */
function openSettings() {
  const m = modal(`<div class="mhead"><h3>Nastavení</h3><button class="btn icon" data-close>✕</button></div>
    <div class="mbody"><form class="form" id="sf">
      <label class="full">Vaše jméno<input name="user" value="${esc(app.user)}"></label>
      <div class="full" style="font-size:13px">Složka katalogu: <b>${esc(app.folderName)}</b>${app.readOnly ? " (jen pro čtení)" : ""}<br>
        <span class="muted">${app.trees.length} stromů, ${app.orchards.length} sadů${lastScan ? ` · zkontrolováno ${lastScan.toLocaleTimeString("cs-CZ")}` : ""}</span></div>
      <div class="full" style="display:flex;gap:8px;flex-wrap:wrap">${FS ? `<button type="button" class="btn" id="sPick">Otevřít jinou složku…</button>` : ""}<button type="button" class="btn" id="sRescan">Zkontrolovat změny</button><button type="button" class="btn" id="sCache">Načíst vše znovu</button></div>
      <p class="full muted" style="font-size:12px;margin:0">Aplikaci lze nainstalovat (v Chrome/Edge ikona v adresním řádku nebo menu → Nainstalovat). Pak běží ve vlastním okně a funguje i bez internetu – kromě mapových podkladů a stanovištních údajů. Verze ${esc(VERSION)}.</p>
    </form></div><div class="mfoot"><button class="btn" data-close>Zavřít</button><button class="btn primary" id="sSave">Uložit</button></div>`);
  m.el.querySelector("#sSave").onclick = async () => { app.user = m.el.querySelector("[name=user]").value.trim(); await kv.set("user", app.user); toast("Uloženo."); m.close(); };
  m.el.querySelector("#sPick")?.addEventListener("click", () => { m.close(); pickFolder(); });
  m.el.querySelector("#sRescan").onclick = () => { m.close(); rescan(); };
  m.el.querySelector("#sCache").onclick = async () => { await app.repo.cache.clear(); app.repo.files.clear(); app.repo.records.tree.clear(); app.repo.records.orchard.clear(); m.close(); await rescan(); rebuild(); toast("Katalog načten znovu ze složky."); };
}

/* ======================= SERVICE WORKER ======================= */
function registerSW() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").then(reg => {
    const ask = w => { $("upd").hidden = false; $("updBtn").onclick = () => w.postMessage("skipWaiting"); };
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener("updatefound", () => { const w = reg.installing; w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) ask(w); }); });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(e => console.warn("SW", e));
  // znovu načíst jen při aktualizaci (ne při prvním nainstalování service workeru)
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
}

/* ======================= START ======================= */
window.oskeruse = app; // pro ladění z konzole
async function main() {
  initCatalog(); initLightbox(); initOrchards(); initCheck();
  app.hooks.editTree = t => openTreeForm(t);
  $("newTree").addEventListener("click", () => openTreeForm(null));
  $("settingsBtn").addEventListener("click", openSettings);
  $("syncSt").addEventListener("click", () => rescan());
  window.addEventListener("focus", () => app.repo && !app.readOnly && rescan());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && app.repo && !app.readOnly && rescan());
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerSW();
  app.user = (await kv.get("user")) || "";
  // test / automatizace: složka předaná oknem (např. OPFS v end-to-end testu)
  if (window.__oskeruseFolder) return openFolder(await window.__oskeruseFolder);
  const h = FS ? await kv.get("folder") : null;
  if (h && app.user) {
    try { if (await h.queryPermission({ mode: "readwrite" }) === "granted") return await openFolder(h); } catch (e) {}
  }
  welcome();
}
main();
