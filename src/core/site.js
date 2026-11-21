// Stanovištní údaje stromu z veřejných služeb (převzato z původního katalogu).
// Výsledek se ukládá do souboru stromu (pole "site"), takže se pro každý strom zjišťuje jen jednou
// a pak je k dispozici všem přes Syncthing i bez internetu.
export const SITE_PARTS = ["terr", "hor", "geo", "soil", "bpej", "clim", "kat"];
export const CLIM_Y = [2011, 2025];
export const HOR_AZ = [0, 45, 90, 135, 180, 225, 270, 315];
const HOR_D = [100, 250, 500, 1000, 2000];
const STEP = 15, RING = 150;
const DMR_EP = ["https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer", "https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g_wm/ImageServer"];
const RUIAN = "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer";
const SVC = {
  geo: "https://mapy.geology.cz/arcgis/rest/services/Geologie/geologicka_mapa50/MapServer",
  soil: "https://mapy.geology.cz/arcgis/rest/services/Pudy/pudni_typy50/MapServer",
  lpis: "https://mze.gov.cz/public/app/wms/plpis_wfs.fcgi",
  meteo: "https://archive-api.open-meteo.com/v1/archive",
};
export const siteKey = t => `${t.lat},${t.lon}`;

function offs(lat, lon, dn, de) { return [lon + de / (111320 * Math.cos(lat * Math.PI / 180)), lat + dn / 111320]; }
function fetchJSON(url) { const c = new AbortController(); const tm = setTimeout(() => c.abort(), 15000); return fetch(url, { signal: c.signal }).then(r => { clearTimeout(tm); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
function fetchText(url) { const c = new AbortController(); const tm = setTimeout(() => c.abort(), 20000); return fetch(url, { signal: c.signal }).then(r => { clearTimeout(tm); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); }); }
let jpN = 0;
function jsonp(url) {
  return new Promise((res, rej) => {
    const cb = "__jp" + (jpN++), sc = document.createElement("script"); const tm = setTimeout(() => { clean(); rej(new Error("timeout")); }, 15000);
    function clean() { clearTimeout(tm); delete window[cb]; sc.remove(); }
    window[cb] = d => { clean(); res(d); }; sc.onerror = () => { clean(); rej(new Error("JSONP")); }; sc.src = url + "&callback=" + cb; document.head.appendChild(sc);
  });
}
const hostMode = {};
async function getJSON(url) {
  const host = new URL(url).host, modes = hostMode[host] ? [hostMode[host]] : ["fetch", "jsonp"]; let err;
  for (const m of modes) { try { const j = m === "fetch" ? await fetchJSON(url) : await jsonp(url); hostMode[host] = m; return j; } catch (e) { err = e; } }
  throw err;
}
async function retry(fn, n = 2) { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } throw e; }
async function runPool(tasks, n) { let i = 0; async function w() { while (i < tasks.length) { const t = tasks[i++]; try { await t(); } catch (e) {} } } await Promise.all(Array.from({ length: n }, w)); }
let dmrEp = null;
async function elev(lon, lat) {
  const g = JSON.stringify({ x: +lon.toFixed(7), y: +lat.toFixed(7), spatialReference: { wkid: 4326 } }), q = `/identify?geometry=${encodeURIComponent(g)}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;
  if (!dmrEp) { let last; for (const ep of DMR_EP) { try { const j = await getJSON(ep + q); if (!isNaN(parseFloat(j.value))) { dmrEp = ep; return parseFloat(j.value); } } catch (e) { last = e; } } throw last || new Error("DMR 5G nedostupný"); }
  const j = await retry(() => getJSON(dmrEp + q)); if (j.error) throw new Error(j.error.message); return parseFloat(j.value);
}
function computeTerrain(z, lat) {
  if (z.slice(0, 9).some(v => isNaN(v))) return null;
  const [a, b, c, d, e, f, g, h, i] = z;
  const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * STEP), dzdy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * STEP);
  const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI, aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
  const ring = z.slice(9).filter(v => !isNaN(v)), tpi = ring.length ? e - ring.reduce((s, v) => s + v, 0) / ring.length : null;
  const hs = (90 - lat) * Math.PI / 180, sr = slope * Math.PI / 180, ar = aspect * Math.PI / 180;
  const sun = Math.max(0, Math.cos(sr) * Math.sin(hs) + Math.sin(sr) * Math.cos(hs) * Math.cos(ar - Math.PI)) / Math.sin(hs) * 100;
  return { elev: e, slope, aspect, tpi, sun, pos: reliefPos(tpi, slope) };
}
function reliefPos(tpi, slope) { if (tpi == null) return "—"; if (tpi > 8) return "hřbet / vrchol"; if (tpi > 3) return "horní část svahu"; if (tpi < -8) return "údolí / úpatí"; if (tpi < -3) return "dolní část svahu"; return slope < 3 ? "rovina / plošina" : "střední část svahu"; }
const DRUH = { 2: "orná půda", 3: "chmelnice", 4: "vinice", 5: "zahrada", 6: "ovocný sad", 7: "trvalý travní porost", 10: "lesní pozemek", 11: "vodní plocha", 13: "zastavěná plocha a nádvoří", 14: "ostatní plocha" };
const nz = v => (v == null || v === "Null" || v === "" || v === " ") ? null : String(v).trim();
function agsIdentifyURL(svc, layers, lon, lat) { const d = .002; return `${svc}/identify?geometry=${lon.toFixed(7)},${lat.toFixed(7)}&geometryType=esriGeometryPoint&sr=4326&layers=${layers}&tolerance=0&mapExtent=${(lon - d).toFixed(6)},${(lat - d).toFixed(6)},${(lon + d).toFixed(6)},${(lat + d).toFixed(6)}&imageDisplay=400,400,96&returnGeometry=false&f=json`; }
const KR = { 0: "velmi teplý, suchý", 1: "teplý, suchý", 2: "teplý, mírně suchý", 3: "teplý, mírně vlhký", 4: "mírně teplý, suchý", 5: "mírně teplý, mírně vlhký", 6: "mírně teplý, vlhký", 7: "mírně chladný, vlhký", 8: "chladný, vlhký", 9: "velmi chladný, vlhký" };
const SE = { 0: "rovina 0–1°, všesměrná", 1: "mírný sklon 1–3°, všesměrná", 2: "mírný svah 3–7°, všesměrná", 3: "střední svah 7–12°, jižní", 4: "střední svah 7–12°, severní", 5: "výrazný svah 12–17°, jižní", 6: "výrazný svah 12–17°, severní", 7: "příkrý svah 17–25°, jižní", 8: "příkrý svah 17–25°, severní", 9: "sráz nad 25°, všesměrná" };
function decodeBPEJ(c) { const d = c.replace(/\D/g, ""); if (d.length !== 5) return null; return { kod: `${d[0]}.${d.slice(1, 3)}.${d.slice(3, 5)}`, kr: +d[0], krTxt: KR[+d[0]], hpj: d.slice(1, 3), se: +d[3], seTxt: SE[+d[3]], sh: +d[4] }; }
function doy(dstr) { const d = new Date(dstr + "T12:00:00Z"); return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1; }

async function siteTerrain(t) {
  const pts = []; for (const dn of [STEP, 0, -STEP]) for (const de of [-STEP, 0, STEP]) pts.push(offs(t.lat, t.lon, dn, de));
  [[RING, 0], [0, RING], [-RING, 0], [0, -RING]].forEach(([dn, de]) => pts.push(offs(t.lat, t.lon, dn, de)));
  const z = new Array(pts.length).fill(NaN);
  await runPool(pts.map((p, k) => async () => { z[k] = await elev(p[0], p[1]); }), 6);
  const r = computeTerrain(z, t.lat); if (!r) throw new Error(dmrEp ? "bez dat" : "služba DMR 5G neodpovídá"); return r;
}
async function siteHorizon(t, terrP) {
  const r = await terrP; const z0 = r.elev, hz = {};
  const tasks = []; HOR_AZ.forEach(az => HOR_D.forEach(d => { const a = az * Math.PI / 180, p = offs(t.lat, t.lon, d * Math.cos(a), d * Math.sin(a)); tasks.push(async () => { (hz[az] = hz[az] || {})[d] = await elev(p[0], p[1]); }); }));
  await runPool(tasks, 8);
  const ang = {}; HOR_AZ.forEach(az => { let m = -90; HOR_D.forEach(d => { const z = hz[az] && hz[az][d]; if (z != null && !isNaN(z)) m = Math.max(m, Math.atan((z - z0) / d) * 180 / Math.PI); }); ang[az] = m === -90 ? null : m; });
  const vals = HOR_AZ.map(a => ang[a]).filter(v => v != null); if (!vals.length) throw new Error("bez dat");
  const svf = vals.reduce((s, h) => s + Math.cos(Math.max(0, h) * Math.PI / 180) ** 2, 0) / vals.length;
  const south = Math.max(...[135, 180, 225].map(a => ang[a] ?? -90));
  return { ang, svf, south };
}
async function siteGeo(t) {
  const j = await retry(() => getJSON(agsIdentifyURL(SVC.geo, "all:2", t.lon, t.lat)));
  const r = (j.results || []).find(x => x.attributes && x.attributes["Hornina"]); if (!r) throw new Error("bez záznamu");
  const a = r.attributes; return { hornina: nz(a["Hornina"]), typ: nz(a["Horninový typ"]), geneze: nz(a["Geneze"]), utvar: nz(a["Útvar"]), oddeleni: nz(a["Oddělení"]), oblast: nz(a["Oblast"]), region: nz(a["Region"]) };
}
async function siteSoil(t) {
  const j = await retry(() => getJSON(agsIdentifyURL(SVC.soil, "all:1", t.lon, t.lat)));
  const r = (j.results || []).find(x => x.attributes && (x.attributes["dominantní jednotka"] || x.attributes["WRB22 dominant soil name"])); if (!r) throw new Error("bez záznamu");
  const a = r.attributes; return { typ: nz(a["dominantní jednotka"]), dopr: nz(a["doprovodná jednotka"]), substrat: nz(a["půdní substrát"]) || nz(a["půdní substrát TKSP"]), wrb: nz(a["WRB22 dominant soil name"]) };
}
async function siteBPEJ(t) {
  const d = .00002, url = `${SVC.lpis}?service=WFS&version=1.1.0&request=GetFeature&typename=BPEJ_WFS&propertyname=kodBPEJ,VERZE_PLATNOST_DO&bbox=${(t.lat - d).toFixed(6)},${(t.lon - d).toFixed(6)},${(t.lat + d).toFixed(6)},${(t.lon + d).toFixed(6)},EPSG:4326`;
  let txt; try { txt = await retry(() => fetchText(url), 2); } catch (e) { throw new Error("služba LPIS (MZe) nepovoluje přímý dotaz z prohlížeče"); }
  const doc = new DOMParser().parseFromString(txt, "text/xml");
  const feats = [...doc.getElementsByTagNameNS("*", "BPEJ_WFS")].map(f => ({ kod: (f.getElementsByTagNameNS("*", "kodBPEJ")[0] || {}).textContent || "", to: ((f.getElementsByTagNameNS("*", "VERZE_PLATNOST_DO")[0] || {}).textContent || "").trim() })).filter(f => f.kod);
  if (!feats.length) return { none: true };
  const cur = feats.filter(f => !f.to), pool = cur.length ? cur : feats, cnt = {}; pool.forEach(f => cnt[f.kod] = (cnt[f.kod] || 0) + 1);
  const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0], b = decodeBPEJ(best); if (!b) return { none: true };
  if (Object.keys(cnt).length > 1) b.alt = Object.keys(cnt).filter(k => k !== best).map(k => (decodeBPEJ(k) || { kod: k }).kod);
  return b;
}
async function siteClimate(t, terrP) {
  let el = t.alt ?? 300; try { const r = await terrP; el = Math.round(r.elev); } catch (e) {}
  const url = `${SVC.meteo}?latitude=${t.lat.toFixed(4)}&longitude=${t.lon.toFixed(4)}&elevation=${el}&start_date=${CLIM_Y[0]}-01-01&end_date=${CLIM_Y[1]}-12-31&daily=temperature_2m_min,precipitation_sum&timezone=Europe%2FPrague`;
  let j; try { j = await retry(() => fetchJSON(url), 2); } catch (e) { throw new Error("Open-Meteo neodpovídá (" + e.message + ")"); }
  if (!j || !j.daily) throw new Error("žádná data");
  const T = j.daily.time, tmin = j.daily.temperature_2m_min, pr = j.daily.precipitation_sum, years = {};
  T.forEach((d, k) => {
    const y = +d.slice(0, 4); const Y = years[y] = years[y] || { p: 0, pn: 0, tn: 0, late: false, lateN: 0, last: null };
    if (pr && pr[k] != null) { Y.p += pr[k]; Y.pn++; }
    const tm = tmin ? tmin[k] : null; if (tm == null) return; Y.tn++;
    const n = doy(d); if (n < 182 && tm <= 0) Y.last = n;
    if (n >= 110 && n <= 151 && tm <= -1) { Y.late = true; Y.lateN++; }
  });
  const yp = Object.values(years).filter(y => y.pn >= 330), yt = Object.values(years).filter(y => y.tn >= 330);
  if (!yp.length && !yt.length) throw new Error("neúplná data");
  const n = Math.max(1, yt.length), lasts = yt.map(y => y.last).filter(v => v != null);
  return { precip: yp.length ? yp.reduce((s, y) => s + y.p, 0) / yp.length : null, prob: yt.length ? yt.filter(y => y.late).length / n : null, lateN: yt.length ? yt.reduce((s, y) => s + y.lateN, 0) / n : null,
    last: lasts.length ? lasts.reduce((a, b) => a + b, 0) / lasts.length : null, years: yt.length, elev: el };
}
export function computeRisk(c, r) {
  if (!c || c.prob == null) return null;
  let sc = c.prob; const why = [`mráz po 20. 4. v ${Math.round(c.prob * 100)} % let`];
  if (r && !r.err) {
    if (/údolí|dolní/.test(r.pos)) { sc += .15; why.push("poloha v údolí / na úpatí – hromadění studeného vzduchu"); }
    else if (/hřbet|horní/.test(r.pos)) { sc -= .1; why.push("vyvýšená poloha – studený vzduch odtéká"); }
    else if (r.pos.startsWith("rovina") && r.tpi < 0) { sc += .05; why.push("plošina v mírné sníženině"); }
    if (r.slope >= 5 && r.slope < 25 && r.tpi >= -3) sc -= .03;
  }
  const k = sc < .2 ? "n" : sc < .45 ? "s" : "v"; return { k, label: { n: "nízké", s: "střední", v: "vysoké" }[k], score: sc, why };
}
async function siteKatastr(t) {
  const j = await retry(() => getJSON(`${RUIAN}/5/query?geometry=${t.lon.toFixed(7)},${t.lat.toFixed(7)}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=id,cisloparcely,druhcislovanikod,druhpozemkukod,vymeraparcely,katastralniuzemi&returnGeometry=false&f=json`));
  if (j.error) throw new Error(j.error.message);
  const a = j.features && j.features[0] && j.features[0].attributes; if (!a) throw new Error("parcela nenalezena");
  let ku = null; try { const k = await getJSON(`${RUIAN}/7/query?where=kod%3D${a.katastralniuzemi}&outFields=nazev&returnGeometry=false&f=json`); ku = k.features && k.features[0] ? k.features[0].attributes.nazev : null; } catch (e) {}
  return { id: a.id, cislo: (a.druhcislovanikod === 1 ? "st. " : "") + a.cisloparcely, druh: DRUH[a.druhpozemkukod] || ("kód " + a.druhpozemkukod), vymera: a.vymeraparcely, ku, kuKod: a.katastralniuzemi };
}

// Zjistí chybějící části. existing = dosavadní data (jen pokud sedí poloha). onPart(part, value) se volá průběžně.
export async function fetchSite(t, existing, onPart) {
  const S = { ...(existing || {}) };
  const run = (p, fn) => S[p] && !S[p].err ? Promise.resolve(S[p]) : fn().then(v => { S[p] = v; onPart && onPart(p, v, S); return v; }, e => { S[p] = { err: e.message || String(e) }; onPart && onPart(p, S[p], S); throw e; });
  const terrP = run("terr", () => siteTerrain(t)); terrP.catch(() => {});
  await Promise.allSettled([terrP, run("hor", () => siteHorizon(t, terrP)), run("geo", () => siteGeo(t)), run("soil", () => siteSoil(t)), run("bpej", () => siteBPEJ(t)), run("clim", () => siteClimate(t, terrP)), run("kat", () => siteKatastr(t))]);
  S.risk = computeRisk(S.clim && !S.clim.err ? S.clim : null, S.terr && !S.terr.err ? S.terr : null);
  return S;
}
