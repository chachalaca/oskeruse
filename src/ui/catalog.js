import L from "leaflet";
import { app, $, esc, fmt1, fmtN, plural, txtOn, ramp, R_OBV, R_ALT, R_YEAR, OBV_MAX, NODATA, TYP_GROUPS, TYP_COL, CATS, fmtGPS, obvStr, svgEl, toast, confirmBox } from "./util.js";
import { hav, live, newId, parseCirc, STATUS } from "../core/model.js";
import { SITE_PARTS, CLIM_Y, HOR_AZ, siteKey, fetchSite } from "../core/site.js";
import { photoSection, bindPhotoSection } from "./photos.js";

let ALT_MIN = 150, ALT_MAX = 500, Y_MIN = 2000, Y_MAX = 2026, AREAS = {};
let FILT = [];
const F = { q: "", area: "", typ: "", flags: new Set(), obvMin: null, obvMax: null, altMin: null, altMax: null };
const FLAGS = [["pojmenovaná", "pojmenované"], ["památná", "památné"], ["mladá", "mladé"], ["poškozená", "poškozené"], ["zaniklá", "zaniklé"], ["nogps", "bez GPS"], ["remeas", "opakovaně měřené"], ["photos", "s fotkou"], ["fruit", "s fotkou plodů"], ["archived", "vyřazené"]];

/* ======================= DATA → POHLED ======================= */
export function refreshCatalog() {
  const T = app.trees.filter(t => !t.archived);
  AREAS = {}; T.forEach(t => (AREAS[t.area] = AREAS[t.area] || []).push(t));
  const ALTS = T.map(t => t.alt).filter(v => v != null); ALT_MIN = ALTS.length ? Math.min(...ALTS) : 150; ALT_MAX = ALTS.length ? Math.max(...ALTS) : 500;
  if (ALT_MAX === ALT_MIN) ALT_MAX = ALT_MIN + 1;
  const YEARS = T.map(t => t.lastYear).filter(Boolean); Y_MIN = YEARS.length ? Math.min(...YEARS) : 2000; Y_MAX = YEARS.length ? Math.max(...YEARS) : 2026;
  if (Y_MAX === Y_MIN) Y_MAX = Y_MIN + 1;
  $("sAll").textContent = T.length; $("sLoc").textContent = Object.keys(AREAS).length; $("sOrch").textContent = app.orchards.filter(o => !o.archived).length;
  // volby filtrů (zachová vybranou hodnotu)
  const fa = $("fArea"), cur = fa.value;
  fa.innerHTML = `<option value="">všechny lokality</option>` + Object.keys(AREAS).sort((a, b) => a.localeCompare(b, "cs")).map(a => `<option value="${esc(a)}">${esc(a)} (${AREAS[a].length})</option>`).join("");
  fa.value = AREAS[cur] ? cur : "";
  const typCount = {}; T.forEach(t => typCount[t.typ || ""] = (typCount[t.typ || ""] || 0) + 1);
  const ft = $("fTyp"), ct = ft.value;
  ft.innerHTML = `<option value="">všechny</option>` + Object.entries(typCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<option value="${esc(k || "-")}">${esc(k || "neuvedeno")} (${n})</option>`).join("");
  ft.value = [...ft.options].some(o => o.value === ct) ? ct : "";
  applyFilters(false);
}

export function colorOf(t, mode) {
  mode = mode || $("colorBy").value;
  if (mode === "obv") return t.obv ? ramp(R_OBV, t.obv / OBV_MAX) : NODATA;
  if (mode === "alt") return t.alt != null ? ramp(R_ALT, (t.alt - ALT_MIN) / (ALT_MAX - ALT_MIN)) : NODATA;
  if (mode === "year") return t.lastYear ? ramp(R_YEAR, (t.lastYear - Y_MIN) / (Y_MAX - Y_MIN)) : NODATA;
  if (mode === "typ") return TYP_COL[t.tg];
  if (mode === "cat") return CATS.find(c => c[0] === t.cat)[2];
  if (mode === "orch") { const o = app.byOrch[$("mapOrch").value]; const g = o && o.genotypes.find(g => g.tree === t.id); return g ? g.color : "#e8e3d8"; }
  return "#888";
}

/* ======================= FILTRY ======================= */
function passes(t) {
  if (t.archived && !F.flags.has("archived")) return false;
  if (F.q && !F.q.split(/\s+/).every(w => t.search.includes(w))) return false;
  if (F.area && t.area !== F.area) return false;
  if (F.typ && (F.typ === "-" ? t.typ : t.typ !== F.typ)) return false;
  for (const f of F.flags) {
    if (f === "archived") { if (!t.archived) return false; continue; }
    if (f === "nogps") { if (t.has) return false; continue; }
    if (f === "remeas") { if (t.growth == null) return false; continue; }
    if (f === "photos") { if (!t.photos.length) return false; continue; }
    if (f === "fruit") { if (!t.photos.some(p => p.kind === "fruit")) return false; continue; }
    if (f === "zaniklá") { if (!t.st.includes("zaniklá") && !t.st.includes("nenalezena")) return false; continue; }
    if (!t.st.includes(f)) return false;
  }
  if (F.obvMin != null && !(t.obv >= F.obvMin)) return false;
  if (F.obvMax != null && !(t.obv <= F.obvMax)) return false;
  if (F.altMin != null && !(t.alt >= F.altMin)) return false;
  if (F.altMax != null && !(t.alt <= F.altMax)) return false;
  return true;
}
const numOrNull = v => v === "" ? null : +v;
function resetFilters() {
  ["q", "fObvMin", "fObvMax", "fAltMin", "fAltMax"].forEach(id => $(id).value = ""); $("fArea").value = ""; $("fTyp").value = ""; F.flags.clear();
  document.querySelectorAll(".fchip").forEach(b => b.classList.remove("on"));
  Object.assign(F, { q: "", area: "", typ: "", obvMin: null, obvMax: null, altMin: null, altMax: null }); applyFilters(true);
}
export function setArea(a) { $("fArea").value = a; F.area = a; applyFilters(true); }
export function applyFilters(fit) {
  FILT = app.trees.filter(passes);
  const total = app.trees.filter(t => !t.archived).length;
  const active = F.q || F.area || F.typ || F.flags.size || F.obvMin != null || F.obvMax != null || F.altMin != null || F.altMax != null;
  $("fCount").textContent = active ? `vybráno ${FILT.length} z ${total}` : `${total} stromů`;
  document.querySelectorAll("[data-reset]").forEach(b => { b.disabled = !active; b.title = active ? "Zrušit všechny filtry" : "Žádný filtr není aktivní"; });
  renderList(); drawMarkers(); renderCurrentTab();
  if (fit) fitFiltered();
}

/* ======================= SEZNAM ======================= */
const SORTS = {
  inv: (a, b) => (a.invNum ?? 1e9) - (b.invNum ?? 1e9) || a.invLbl.localeCompare(b.invLbl) || a.short.localeCompare(b.short, "cs"),
  name: (a, b) => a.short.localeCompare(b.short, "cs"),
  obv: (a, b) => (b.obv || -1) - (a.obv || -1),
  alt: (a, b) => (b.alt ?? -1) - (a.alt ?? -1),
  h: (a, b) => (b.h ?? -1) - (a.h ?? -1),
  lon: (a, b) => (a.lon ?? 99) - (b.lon ?? 99),
  upd: (a, b) => (b.rec.updated || "").localeCompare(a.rec.updated || ""),
};
let listLimit = 250;
export function renderList() {
  const arr = [...FILT].sort(SORTS[$("sort").value]);
  const mode = $("colorBy").value;
  $("list").innerHTML = arr.slice(0, listLimit).map(t => {
    const c = colorOf(t, mode);
    return `<li data-id="${t.id}" class="${app.sel === t.id ? "active" : ""}${t.archived ? " arch" : ""}">
    <span class="dot" style="background:${c};color:${txtOn(c)}">${esc(t.invLbl.length > 4 ? t.invLbl.replace(/\s/g, "") : t.invLbl)}</span>
    <span style="min-width:0"><div class="nm">${esc(t.short)}</div><div class="meta">${t.alt != null ? t.alt + " m n. m." : "výška ?"} · ${obvStr(t)}${t.has ? "" : " · bez GPS"}</div></span>${t.photos.length ? `<span class="cam" title="Počet fotografií">📷 ${t.photos.length}</span>` : ""}</li>`;
  }).join("") +
    (arr.length > listLimit ? `<li class="more" data-more="1">… a dalších ${arr.length - listLimit} – zobrazit vše</li>` : "") + (arr.length ? "" : `<li class="more">Filtru neodpovídá žádný strom.</li>`);
}

/* ======================= ZÁLOŽKY ======================= */
export function showTab(id) {
  app.tab = id;
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.v === id));
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("on", x.id === id));
  if (id === "vMap") setTimeout(() => map.invalidateSize(), 50);
  renderCurrentTab();
}
export function renderCurrentTab() {
  if (app.tab === "vLoc") renderLoc(); if (app.tab === "vOver") renderOver(); if (app.tab === "vTbl") renderTable();
  if (app.tab === "vOrch") app.hooks.renderOrchards?.(); if (app.tab === "vCheck") app.hooks.renderCheck?.();
}

/* ======================= MAPA ======================= */
export let map;
let baseLayer = null, miniMap = null, miniBase = null, reliefLayer = null, markerLayer, selLayer, orchLayer;
export function tileLayerFor(ms) {
  const esri = s => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution: "Tiles &copy; Esri" });
  return esri(ms === "aerial" ? "World_Imagery" : "World_Topo_Map");
}
function setBase() {
  const ms = $("mapset").value; if (baseLayer) map.removeLayer(baseLayer); baseLayer = tileLayerFor(ms).addTo(map);
  if (miniMap) { if (miniBase) miniMap.removeLayer(miniBase); miniBase = tileLayerFor(ms).addTo(miniMap); }
}
function radiusOf(t) { if (!$("sizeObv").checked) return 6; if (!t.obv) return 3.5; return 3 + Math.sqrt(t.obv) * 0.55; }
export function drawMarkers() {
  if (!map) return;
  markerLayer.clearLayers(); selLayer.clearLayers(); orchLayer.clearLayers();
  const mode = $("colorBy").value, lbl = $("showLbl").checked && map.getZoom() >= 13.5;
  const o = app.byOrch[$("mapOrch").value];
  const inOrch = o ? new Set(o.genotypes.map(g => g.tree)) : null;
  const arr = FILT.filter(t => t.has).sort((a, b) => (inOrch && mode === "orch" ? (inOrch.has(a.id) - inOrch.has(b.id)) : 0) || radiusOf(b) - radiusOf(a));
  arr.forEach(t => {
    const dead = t.cat === "zaniklá", dim = mode === "orch" && inOrch && !inOrch.has(t.id);
    const m = L.circleMarker([t.lat, t.lon], { radius: dim ? 3 : radiusOf(t), color: dead ? "#666" : dim ? "#b9b2a3" : "#2b2a25", weight: dead ? 1.2 : .9, dashArray: dead ? "2 2" : null, fillColor: colorOf(t, mode), fillOpacity: dead ? .45 : dim ? .6 : .9 });
    // popisek se vytváří až při najetí myší (u stovek bodů výrazně zrychlí vykreslení)
    if (lbl) m.bindTooltip(`${esc(t.invLbl)} · ${esc(t.short)}`, { permanent: true, direction: "right", offset: [radiusOf(t) + 2, 0], className: "lbl" });
    else m.once("mouseover", () => { m.bindTooltip(`<b>${esc(t.invLbl)}</b> ${esc(t.short)}<br>${t.alt ?? "?"} m n. m. · ${obvStr(t)}`, { direction: "right", offset: [radiusOf(t) + 2, 0] }).openTooltip(); });
    m.on("click", () => select(t.id));
    m.addTo(markerLayer);
  });
  // vybraný sad: domeček a spojnice k matečným stromům
  if (o && o.lat != null) {
    for (const g of o.genotypes) {
      const t = app.byId[g.tree]; if (!t || !t.has) continue;
      const isSel = app.sel === t.id;
      L.polyline([[o.lat, o.lon], [t.lat, t.lon]], { color: isSel ? "#d9481c" : g.color, weight: isSel ? 3 : 1.6, opacity: isSel ? 1 : .75, dashArray: isSel ? null : "4 4", interactive: false }).addTo(orchLayer);
      if (isSel) L.tooltip({ permanent: true, direction: "center", className: "dist-lbl" }).setLatLng([(o.lat + t.lat) / 2, (o.lon + t.lon) / 2]).setContent(fmt1(hav(o, t)) + " km").addTo(orchLayer);
    }
    L.marker([o.lat, o.lon], { icon: L.divIcon({ html: '<div style="font-size:24px;line-height:24px">🏡</div>', className: "", iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 1000 })
      .bindTooltip(esc(o.name)).on("click", () => { app.orch = o.id; showTab("vOrch"); }).addTo(orchLayer);
  }
  const s = app.sel && app.byId[app.sel];
  if (s && s.has) L.circleMarker([s.lat, s.lon], { radius: radiusOf(s) + 4, color: "#d9481c", weight: 3.5, fill: false, interactive: false }).addTo(selLayer);
  drawLegend();
}
function drawLegend() {
  const mode = $("colorBy").value; let h = "";
  const grad = (st, a, b, t) => `<b>${t}</b><div class="grad" style="background:linear-gradient(90deg,${[0, .25, .5, .75, 1].map(f => ramp(st, f)).join(",")})"></div><div style="display:flex;justify-content:space-between"><span>${a}</span><span>${b}</span></div>`;
  if (mode === "obv") h = grad(R_OBV, "0 cm", OBV_MAX + "+ cm", "Obvod kmene");
  if (mode === "alt") h = grad(R_ALT, ALT_MIN + " m", ALT_MAX + " m", "Nadmořská výška");
  if (mode === "year") h = grad(R_YEAR, Y_MIN, Y_MAX, "Rok posledního měření");
  const cnt = fn => { const c = {}; FILT.forEach(t => { const k = fn(t); c[k] = (c[k] || 0) + 1; }); return c; };
  if (mode === "typ") { const c = cnt(t => t.tg); h = "<b>Typ stanoviště</b>" + TYP_GROUPS.map(([k, l, col]) => `<div class="row"><span class="sw" style="background:${col}"></span>${l} <span class="muted">(${c[k] || 0})</span></div>`).join(""); }
  if (mode === "cat") { const c = cnt(t => t.cat); h = "<b>Kategorie</b>" + CATS.map(([k, l, col]) => `<div class="row"><span class="sw" style="background:${col}"></span>${l} <span class="muted">(${c[k] || 0})</span></div>`).join(""); }
  if (mode === "orch") { const o = app.byOrch[$("mapOrch").value]; h = o ? `<b>Genotypy – ${esc(o.name)}</b><div class="muted">barvy jako v plánu sadu, ostatní stromy šedě</div>` : `<b>Genotyp v sadu</b><div class="muted">Vyberte sad v nabídce „Sad“.</div>`; }
  if (!["typ", "cat", "orch"].includes(mode)) h += `<div class="row muted"><span class="sw" style="background:${NODATA}"></span>bez údaje</div>`;
  if ($("sizeObv").checked && mode !== "orch") h += `<div class="muted" style="margin-top:4px">velikost bodu = obvod kmene</div>`;
  h += `<div class="row muted"><span class="sw" style="background:#ddd;border-style:dashed"></span>zaniklý / nenalezený strom</div>`;
  if ($("mapOrch").value) h += `<div class="row"><span style="font-size:14px">🏡</span> sad a spojnice k matečným stromům</div>`;
  const nog = FILT.filter(t => !t.has).length; if (nog) h += `<div class="muted" style="margin-top:3px">${nog} vybraných stromů bez GPS</div>`;
  $("legend").innerHTML = h;
}
function fitFiltered() {
  const pts = FILT.filter(t => t.has).map(t => [t.lat, t.lon]); if (!pts.length || !map) return;
  if (pts.length === 1) map.setView(pts[0], 15); else map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
}
// výběr bodu v mapě (pro nový strom / změnu polohy)
export function pickOnMap() {
  return new Promise(res => {
    showTab("vMap");
    $("pickBar").classList.add("on"); $("map").classList.add("picking");
    const done = v => { $("pickBar").classList.remove("on"); $("map").classList.remove("picking"); map.off("click", onClick); $("pickCancel").onclick = null; res(v); };
    const onClick = e => done({ lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7) });
    map.on("click", onClick); $("pickCancel").onclick = () => done(null);
  });
}

/* ======================= TOOLTIP (grafy) ======================= */
function initTip() {
  const tip = $("tip");
  document.addEventListener("mousemove", e => {
    const el = e.target.closest && e.target.closest("[data-tip]"); if (!el) { tip.style.display = "none"; return; }
    tip.innerHTML = el.dataset.tip; tip.style.display = "block"; const w = tip.offsetWidth; tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 12) + "px"; tip.style.top = (e.clientY + 14) + "px";
  });
  document.addEventListener("click", e => {
    const el = e.target.closest && e.target.closest("[data-sel],[data-area]"); if (!el || !el.closest(".charts")) return;
    if (el.dataset.sel) select(el.dataset.sel, { fly: false }); else if (el.dataset.area) { setArea(el.dataset.area); showTab("vMap"); }
  });
}

/* ======================= LOKALITY ======================= */
function renderLoc() {
  // lokality s jediným stromem v katalogu se jako karty nezobrazují (počítá se celý katalog, ne filtr)
  const groups = {}; FILT.forEach(t => { if ((AREAS[t.area] || []).length < 2) return; (groups[t.area] = groups[t.area] || []).push(t); });
  const L_ = Object.entries(groups).map(([a, ts]) => {
    const al = ts.map(t => t.alt).filter(v => v != null), ob = ts.map(t => t.obv).filter(Boolean), g = ts.filter(t => t.has);
    return { a, ts, n: ts.length, amin: al.length ? Math.min(...al) : null, amax: al.length ? Math.max(...al) : null, omax: ob.length ? Math.max(...ob) : 0, ob, lon: g.length ? g.reduce((s, t) => s + t.lon, 0) / g.length : 99, cv: ts.filter(t => t.cv).flatMap(t => t.cv) };
  });
  const s = $("locSort").value;
  L_.sort({ n: (a, b) => b.n - a.n || a.a.localeCompare(b.a, "cs"), name: (a, b) => a.a.localeCompare(b.a, "cs"), obv: (a, b) => b.omax - a.omax, alt: (a, b) => (b.amax ?? 0) - (a.amax ?? 0), lon: (a, b) => a.lon - b.lon }[s]);
  $("locGrid").innerHTML = L_.map(l => {
    const W = 226, H = 16, ticks = l.ob.map(o => `<rect x="${Math.min(W - 2, o / 400 * W).toFixed(1)}" y="2" width="2" height="${H - 4}" rx="1" fill="${ramp(R_OBV, o / OBV_MAX)}" stroke="#2b2a25" stroke-width=".3"/>`).join("");
    return `<div class="loc" data-a="${esc(l.a)}"><h5>${esc(l.a)}<span>${l.n}</span></h5>
    <div class="lm">${l.amin != null ? (l.amin === l.amax ? l.amin : l.amin + "–" + l.amax) + " m n. m." : "výška neuvedena"} · největší ${l.omax ? Math.round(l.omax) + " cm" : "—"}</div>
    <svg width="${W}" height="${H}"><rect x="0" y="0" width="${W}" height="${H}" rx="3" fill="#f1ece0"/>${ticks}</svg>
    ${l.cv.length ? `<div class="cvs">${[...new Set(l.cv)].slice(0, 8).map(c => `<i>${esc(c)}</i>`).join("")}${l.cv.length > 8 ? `<i>+${l.cv.length - 8}</i>` : ""}</div>` : ""}</div>`;
  }).join("") || `<p class="muted">Filtru neodpovídá žádná lokalita.</p>`;
}

/* ======================= PŘEHLED ======================= */
const AX = "#6f6a5e", GRID = "#eee6d6";
function histogram(svg, vals, step, lo, hi, colorFn, unit) {
  const W = 520, H = 250, l = 40, r = 10, t = 10, b = 34; svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = "";
  const bins = []; for (let x = lo; x < hi; x += step) bins.push({ x, n: 0, ts: [] });
  vals.forEach(([v, tr]) => { let i = Math.floor((v - lo) / step); i = Math.max(0, Math.min(bins.length - 1, i)); bins[i].n++; bins[i].ts.push(tr); });
  const maxN = Math.max(1, ...bins.map(b => b.n)), nice = maxN <= 10 ? 2 : maxN <= 40 ? 10 : maxN <= 100 ? 20 : 50, top = Math.ceil(maxN / nice) * nice;
  const Y = n => t + (1 - n / top) * (H - t - b);
  for (let n = 0; n <= top; n += nice) { svgEl("line", { x1: l, x2: W - r, y1: Y(n), y2: Y(n), stroke: n ? GRID : "#cfc6b0" }, svg); const tx = svgEl("text", { x: l - 6, y: Y(n) + 4, "text-anchor": "end", "font-size": 11, fill: AX }, svg); tx.textContent = n; }
  const bw = (W - l - r) / bins.length;
  bins.forEach((bn, i) => {
    const x = l + i * bw; if (bn.n) { const y = Y(bn.n); svgEl("path", { d: `M${x + 1},${Y(0)}V${y + 3}a3,3 0 0 1 3,-3H${x + bw - 4}a3,3 0 0 1 3,3V${Y(0)}Z`, fill: colorFn(bn.x + step / 2) }, svg); }
    svgEl("rect", { x, y: t, width: bw, height: H - t - b, fill: "transparent", "data-tip": `<b>${bn.x}–${bn.x + step} ${unit}</b><br>${bn.n} stromů${bn.ts.length ? "<br><span style='opacity:.75'>" + bn.ts.slice(0, 4).map(t => esc(t.short)).join(", ") + (bn.ts.length > 4 ? "…" : "") + "</span>" : ""}` }, svg);
    if (i % 2 === 0) { const tx = svgEl("text", { x, y: H - b + 15, "text-anchor": "middle", "font-size": 11, fill: AX }, svg); tx.textContent = bn.x; }
  });
  const tx = svgEl("text", { x: (l + W - r) / 2, y: H - 3, "text-anchor": "middle", "font-size": 11.5, fill: "#2b2a25" }, svg); tx.textContent = unit === "cm" ? "obvod kmene (cm)" : "nadmořská výška (m n. m.)";
}
function hbars(svg, items, valFmt, colorFn, attr) {
  const rowH = 22, l = 210, r = 60, W = 520, H = items.length * rowH + 8; svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = "";
  const mx = Math.max(1, ...items.map(i => i.v)), X = v => l + v / mx * (W - l - r);
  items.forEach((it, k) => {
    const y = 4 + k * rowH, g = svgEl("g", { style: "cursor:pointer", "data-tip": it.tip, [attr]: it.key }, svg);
    svgEl("rect", { x: 0, y, width: W, height: rowH, fill: app.sel && it.key === app.sel ? "#f4e2d6" : "transparent" }, g);
    const tl = svgEl("text", { x: l - 8, y: y + 15, "text-anchor": "end", "font-size": 12, fill: "#2b2a25" }, g); tl.textContent = it.label.length > 32 ? it.label.slice(0, 31) + "…" : it.label;
    svgEl("path", { d: `M${l},${y + 4}H${X(it.v) - 3}a3,3 0 0 1 3,3V${y + rowH - 7}a3,3 0 0 1 -3,3H${l}Z`, fill: colorFn(it) }, g);
    const tv = svgEl("text", { x: X(it.v) + 6, y: y + 15, "font-size": 11.5, fill: AX }, g); tv.textContent = valFmt(it.v);
  });
  svgEl("line", { x1: l, x2: l, y1: 2, y2: H - 2, stroke: "#cfc6b0" }, svg);
}
export function scatter(svg, pts, xr, yr, xl, yl, xstep, ystep, band) {
  const W = 520, H = 300, l = 48, r = 12, t = 10, b = 38; svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.innerHTML = "";
  const X = v => l + (v - xr[0]) / (xr[1] - xr[0]) * (W - l - r), Y = v => t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - t - b);
  for (let v = xr[0]; v <= xr[1]; v += xstep) { svgEl("line", { x1: X(v), x2: X(v), y1: t, y2: H - b, stroke: GRID }, svg); const tx = svgEl("text", { x: X(v), y: H - b + 15, "text-anchor": "middle", "font-size": 11, fill: AX }, svg); tx.textContent = v; }
  for (let v = yr[0]; v <= yr[1]; v += ystep) { svgEl("line", { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: v === 0 ? "#cfc6b0" : GRID }, svg); const tx = svgEl("text", { x: l - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 11, fill: AX }, svg); tx.textContent = String(v).replace(".", ","); }
  if (band) svgEl("rect", { x: X(band[0]), y: t, width: X(band[1]) - X(band[0]), height: H - t - b, fill: "rgba(79,107,44,.18)" }, svg);
  const a = svgEl("text", { x: (l + W - r) / 2, y: H - 4, "text-anchor": "middle", "font-size": 11.5, fill: "#2b2a25" }, svg); a.textContent = xl;
  const c = svgEl("text", { x: 12, y: (t + H - b) / 2, "text-anchor": "middle", "font-size": 11.5, fill: "#2b2a25", transform: `rotate(-90 12 ${(t + H - b) / 2})` }, svg); c.textContent = yl;
  pts.forEach(p => {
    const sel = p.id === app.sel, cx = X(Math.max(xr[0], Math.min(xr[1], p.x))), cy = Y(Math.max(yr[0], Math.min(yr[1], p.y)));
    const g = svgEl("g", { style: "cursor:pointer", "data-sel": p.id, "data-tip": p.tip }, svg);
    svgEl("circle", { cx, cy, r: 9, fill: "transparent" }, g);
    svgEl("circle", { cx, cy, r: sel ? 7 : 4.5, fill: p.c, stroke: sel ? "#d9481c" : "#fffdf8", "stroke-width": sel ? 3 : 1.5, "fill-opacity": .9 }, g);
    if (p.label) { const tx = svgEl("text", { x: cx, y: cy + 3, "text-anchor": "middle", "font-size": 7, "font-weight": 700, fill: txtOn(p.c), "pointer-events": "none" }, g); tx.textContent = p.label; }
  });
}
function legendRow(items) { return `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin:2px 0 6px">${items.map(([l, c]) => `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:50%;background:${c}"></span>${l}</span>`).join("")}</div>`; }
function renderOver() {
  const F_ = FILT, ob = F_.filter(t => t.obv), al = F_.filter(t => t.alt != null);
  const total = app.trees.filter(t => !t.archived).length;
  $("overNote").textContent = F_.length === total ? "Všechny evidované stromy." : `Grafy ukazují ${F_.length} stromů vybraných filtrem vlevo.`;
  const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const k = [[F_.length, "stromů"], [new Set(F_.map(t => t.area)).size, "lokalit"], [F_.filter(t => t.has).length, "s GPS souřadnicí"], [ob.length ? Math.round(med(ob.map(t => t.obv))) + " cm" : "—", "medián obvodu"],
    [ob.filter(t => t.obv >= 200).length, "stromů s obvodem ≥ 200 cm"], [al.length ? Math.min(...al.map(t => t.alt)) + "–" + Math.max(...al.map(t => t.alt)) + " m" : "—", "rozpětí nadm. výšky"],
    [F_.filter(t => t.cv).length, "pojmenovaných stromů"], [F_.filter(t => t.photos.length).length, "stromů s fotografií"]];
  $("kpis").innerHTML = k.map(([v, l]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");
  histogram($("cObv"), ob.map(t => [t.obv, t]), 25, 0, 400, v => ramp(R_OBV, v / OBV_MAX), "cm");
  histogram($("cAlt"), al.map(t => [t.alt, t]), 25, 125, 500, v => ramp(R_ALT, (v - ALT_MIN) / (ALT_MAX - ALT_MIN)), "m");
  const sc = $("cScat"); scatter(sc, F_.filter(t => t.obv && t.alt != null).map(t => ({ id: t.id, x: t.alt, y: t.obv, c: TYP_COL[t.tg], tip: `<b>${esc(t.invLbl)} · ${esc(t.short)}</b><br>${t.alt} m n. m. · ${obvStr(t)}<br>typ: ${esc(t.typ || "neuvedeno")}` })), [125, 500], [0, 400], "nadmořská výška (m n. m.)", "obvod kmene (cm)", 50, 50);
  if (!sc.previousElementSibling.classList.contains("lg")) sc.insertAdjacentHTML("beforebegin", `<div class="lg">${legendRow(TYP_GROUPS.map(g => [g[1], g[2]]))}</div>`);
  hbars($("cTop"), [...ob].sort((a, b) => b.obv - a.obv).slice(0, 15).map(t => ({ key: t.id, v: t.obv, label: `${t.invLbl} · ${t.short}`, t, tip: `<b>${esc(t.short)}</b><br>${obvStr(t)}${t.obvYear ? " (" + t.obvYear + ")" : ""}<br>${t.alt ?? "?"} m n. m.` })), v => Math.round(v) + " cm", it => ramp(R_OBV, it.v / OBV_MAX), "data-sel");
  const g = {}; F_.forEach(t => g[t.area] = (g[t.area] || 0) + 1);
  hbars($("cLoc"), Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([a, n]) => ({ key: a, v: n, label: a, tip: `<b>${esc(a)}</b><br>${n} stromů` })), v => v, () => "#4f6b2c", "data-area");
  const gr = F_.filter(t => t.growth != null);
  scatter($("cGrow"), gr.map(t => ({ id: t.id, x: t.obv, y: t.growth, c: TYP_COL[t.tg], tip: `<b>${esc(t.short)}</b><br>${t.meas.filter(m => m.eq).map(m => `${m.year || "?"}: ${esc(m.text)} cm`).join("<br>")}<br>přírůstek ${fmt1(t.growth)} cm/rok` })), [0, 400], [-2, 6], "obvod při posledním měření (cm)", "přírůstek obvodu (cm/rok)", 50, 1);
}

/* ======================= TABULKA ======================= */
let tblSort = { k: "inv", dir: 1 };
const COLS = [["inv", "Inv. č."], ["short", "Název"], ["area", "Lokalita"], ["typ", "Typ"], ["alt", "N. m. (m)"], ["h", "Výška (m)"], ["kor", "Nasaz. koruny (m)"], ["obv", "Obvod (cm)"], ["obvYear", "Rok měř."], ["growth", "Přírůst. cm/rok"], ["zr", "Zrání"], ["st", "Kategorie"], ["ph", "Foto"], ["gps", "GPS"], ["note", "Poznámka"]];
function tval(t, k) { if (k === "inv") return t.invNum ?? 1e9; if (k === "st") return t.st.join(", "); if (k === "gps") return t.lat ?? 99; if (k === "obv") return t.obv ?? -1; if (k === "ph") return t.photos.length; return t[k] ?? (["alt", "h", "kor", "obvYear", "growth"].includes(k) ? -1e9 : ""); }
function renderTable() {
  const arr = [...FILT].sort((a, b) => { const va = tval(a, tblSort.k), vb = tval(b, tblSort.k); return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "cs")) * tblSort.dir; });
  $("tblInfo").textContent = `${arr.length} stromů · kliknutím na záhlaví seřadíte, kliknutím na řádek otevřete detail`;
  // jen viditelné řádky + rezerva (virtualizace pro tisíce stromů)
  const wrap = $("tblWrap"), rowH = 29, head = 30;
  const first = Math.max(0, Math.floor((wrap.scrollTop - head) / rowH) - 20), last = Math.min(arr.length, first + Math.ceil((wrap.clientHeight || 800) / rowH) + 40);
  const row = t => `<tr data-id="${t.id}" class="${app.sel === t.id ? "active" : ""}">
   <td>${esc(t.invLbl)}</td><td>${esc(t.short)}</td><td>${esc(t.area)}</td><td>${esc(t.typ || "")}</td><td class="num">${t.altTxt ? esc(t.altTxt) : t.alt ?? ""}</td><td class="num">${t.h != null ? fmtN(t.h) : ""}</td><td class="num">${t.kor != null ? fmtN(t.kor) : ""}</td>
   <td class="num">${t.obv ? esc(obvStr(t).replace(" cm", "")) : ""}</td><td class="num">${t.obvYear || ""}</td><td class="num">${t.growth != null ? fmt1(t.growth) : ""}</td><td>${esc(t.zr || "")}</td><td>${esc(t.st.join(", "))}</td><td class="num">${t.photos.length || ""}</td>
   <td style="font-size:12px">${t.has ? fmtGPS(t) : "—"}</td><td class="wrap" style="font-size:12px;color:var(--muted)" title="${esc(t.note || "")}">${esc(t.note || "")}</td></tr>`;
  $("tbl").innerHTML = `<thead><tr>${COLS.map(([k, l]) => `<th data-k="${k}">${l}${tblSort.k === k ? (tblSort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>
    <tr style="height:${first * rowH}px"></tr>${arr.slice(first, last).map(row).join("")}<tr style="height:${(arr.length - last) * rowH}px"></tr></tbody>`;
}
function exportCSV() {
  const rows = [["inv_c", "nazev", "lokalita", "lat", "lon", "presnost_gps_m", "nadm_vyska_m", "vyska_stromu_m", "nasazeni_koruny_m", "typ", "obvod_posledni", "obvod_ekviv_cm", "rok_mereni", "prirustek_cm_rok", "vsechna_mereni", "doba_zrani", "kategorie", "pocet_fotek", "poznamka", "id"]];
  [...FILT].sort(SORTS.inv).forEach(t => rows.push([t.invLbl, t.name, t.area, t.lat ?? "", t.lon ?? "", t.acc ?? "", t.altTxt || t.alt || "", t.h ?? "", t.kor ?? "", t.typ || "", t.obvTxt || "", t.obv ? Math.round(t.obv) : "", t.obvYear || "", t.growth != null ? t.growth.toFixed(2) : "",
    t.meas.map(m => `${m.year || "?"}: ${m.text}${m.author ? " (" + m.author + ")" : ""}`).join(" | "), t.zr || "", t.st.join(", "), t.photos.length, t.note || "", t.id]));
  const csv = "﻿" + rows.map(r => r.map(v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "katalog-oskerusi.csv"; a.click();
}

/* ======================= STANOVIŠTĚ ======================= */
const siteMem = {}, siteBusy = {};
function siteFor(t) { const s = t.rec.site; return siteMem[siteKey(t)] || (s && s.key === siteKey(t) ? s : null); }
async function ensureSite(t, force) {
  if (!t.has) return;
  const key = siteKey(t); if (siteBusy[key]) return;
  let cur = siteFor(t);
  if (cur && !force && (cur.at || SITE_PARTS.every(p => cur[p] && !cur[p].err))) return; // už zjištěno (případné chyby jen na vyžádání)
  if (!navigator.onLine) return;
  cur = { ...(cur || {}) };
  if (force) SITE_PARTS.forEach(p => { if (cur[p] && cur[p].err) delete cur[p]; });
  siteBusy[key] = 1; renderSiteBlocks(t);
  const S = await fetchSite(t, cur, (p, v, S) => { siteMem[key] = { ...S }; if (app.sel === t.id) renderSiteBlocks(app.byId[t.id] || t); });
  delete siteBusy[key];
  const site = { key, at: new Date().toISOString(), ...S };
  siteMem[key] = site;
  if (!app.readOnly) {
    // uloží se na pozadí; detail se nepřekresluje celý (aby se neztratil rozepsaný formulář), jen bloky stanoviště
    // chybí-li nadmořská výška, doplní se z modelu terénu
    let filledAlt = false;
    try {
      await app.repo.update("tree", t.id, r => { const p = { site }; if (r.alt == null && !r.altText && S.terr && !S.terr.err) { p.alt = Math.round(S.terr.elev); filledAlt = true; } return p; }, app.user);
      delete siteMem[key]; app.hooks.dataChanged?.(new Set([t.id]), { keepDetail: !filledAlt });
      if (filledAlt) toast("Nadmořská výška doplněna z modelu terénu DMR 5G.");
    }
    catch (e) { console.warn("uložení stanovištních údajů", e); }
  }
  if (app.sel === t.id) renderSiteBlocks(app.byId[t.id] || t);
}
const ASP8 = ["S", "SV", "V", "JV", "J", "JZ", "Z", "SZ"], ASP8L = ["sever", "severovýchod", "východ", "jihovýchod", "jih", "jihozápad", "západ", "severozápad"];
export function aspName(r, long) { if (!r) return "—"; if (r.slope < 2) return "rovina"; const k = Math.round(r.aspect / 45) % 8; return long ? ASP8L[k] : ASP8[k]; }
export function aspectColor(a) { return `hsl(${Math.round((a + 200) % 360)},62%,52%)`; }
function compassSVG(r, size) {
  const c = size / 2, R = c - 14; let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${R}" fill="#f7f2e6" stroke="#d8d0bd"/>`;
  ASP8.forEach((l, k) => { if (k % 2) return; const a = k * Math.PI / 4; s += `<text x="${c + Math.sin(a) * (R + 8)}" y="${c - Math.cos(a) * (R + 8) + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#6f6a5e">${l}</text>`; });
  if (r && r.slope >= 2) { const a = r.aspect * Math.PI / 180, L_ = R * Math.min(1, .35 + r.slope / 25 * .65), x = c + Math.sin(a) * L_, y = c - Math.cos(a) * L_; s += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${aspectColor(r.aspect)}" stroke-width="4" stroke-linecap="round"/><circle cx="${x}" cy="${y}" r="5" fill="${aspectColor(r.aspect)}" stroke="#333"/>`; }
  return s + `<circle cx="${c}" cy="${c}" r="3" fill="#333"/></svg>`;
}
function horizonSVG(h, size) {
  const c = size / 2, R = c - 14, maxA = 20, rr = a => R * (1 - Math.min(maxA, Math.max(0, a)) / maxA);
  let s = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${R}" fill="#eaf2fb" stroke="#d8d0bd"/>`;
  [5, 10, 15].forEach(a => s += `<circle cx="${c}" cy="${c}" r="${rr(a)}" fill="none" stroke="#d9e3ee" stroke-dasharray="2 2"/>`);
  const pts = HOR_AZ.map(az => { const a = az * Math.PI / 180, r = rr(h.ang[az] ?? 0); return [c + Math.sin(a) * r, c - Math.cos(a) * r]; });
  s += `<path d="M${c - R},${c}A${R},${R} 0 1,0 ${c + R},${c}A${R},${R} 0 1,0 ${c - R},${c}Z M${pts.map(p => p.join(",")).join(" L")}Z" fill="#8a7a5c" fill-opacity=".55" fill-rule="evenodd"/>`;
  ["S", "V", "J", "Z"].forEach((l, k) => { const a = k * Math.PI / 2; s += `<text x="${c + Math.sin(a) * (R + 8)}" y="${c - Math.cos(a) * (R + 8) + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#6f6a5e">${l}</text>`; });
  return s + `</svg>`;
}
function doyStr(n) { const d = new Date(Date.UTC(2021, 0, 1) + (Math.round(n) - 1) * 864e5); return d.getUTCDate() + ". " + (d.getUTCMonth() + 1) + "."; }
const riskBadge = r => r ? `<span class="risk ${r.k}">${r.label}</span>` : "—";
function renderSiteBlocks(t) {
  if (!$("blkTerr")) return;
  const S = siteFor(t) || {}, busy = !!siteBusy[siteKey(t)], anyErr = SITE_PARTS.some(p => S[p] && S[p].err), missing = SITE_PARTS.some(p => !S[p]);
  const LOADING = busy ? `<span class="muted" style="font-size:12.5px">Načítám…</span>` : `<span class="muted" style="font-size:12.5px">${navigator.onLine ? "Nezjištěno." : "Nezjištěno – zařízení je offline."}</span>`;
  const errMsg = (x, what) => `<span class="muted" style="font-size:12.5px">${what} se nepodařilo načíst${x && x.err ? " (" + esc(x.err) + ")" : ""}.</span>`;
  const r = S.terr, h = S.hor, g = S.geo, so = S.soil, b = S.bpej, c = S.clim, k = S.kat;
  $("blkTerr").innerHTML = !r ? LOADING : r.err ? errMsg(r, "Terén DMR 5G") : `<div class="compass">${compassSVG(r, 92)}<dl class="kv" style="flex:1">
    <dt>Sklon</dt><dd>${fmt1(r.slope)}°</dd><dt>Expozice</dt><dd>${aspName(r, true)}${r.slope >= 2 ? ` <span class="muted">${Math.round(r.aspect)}°</span>` : ""}</dd>
    <dt>Poloha</dt><dd>${r.pos}</dd><dt>Oslunění</dt><dd>${Math.round(r.sun)} % <span class="muted">roviny</span></dd><dt>Výška DMR</dt><dd>${fmt1(r.elev)} m <span class="muted">(evidence ${t.alt ?? "?"} m)</span></dd></dl></div>
    <div class="hint">Oslunění = intenzita přímého slunce v poledne o rovnodennosti vůči vodorovné ploše. Poloha v reliéfu z rozdílu výšky oproti okolí ve vzdálenosti 150 m.</div>`;
  const sunW = 90 - t.lat - 23.44;
  $("blkHor").innerHTML = !h ? (r && r.err ? errMsg(r, "Horizont (chybí terén)") : LOADING) : h.err ? errMsg(h, "Horizont") : `<div class="compass">${horizonSVG(h, 92)}<dl class="kv" style="flex:1">
    <dt>Otevřenost</dt><dd>${Math.round(h.svf * 100)} % oblohy</dd><dt>Horizont J</dt><dd>${fmt1(Math.max(0, h.south))}° <span class="muted">(JV–J–JZ)</span></dd>
    <dt>Zimní slunce</dt><dd>${h.south > sunW ? `<span style="color:#a23b1b">v prosinci zakryto</span>` : "v prosinci nezakryto"} <span class="muted">(v poledne ${fmt1(sunW)}°)</span></dd></dl></div>
    <div class="hint">Hnědá plocha = terén nad obzorem v 8 směrech (do 2 km). Okraj kruhu = 0°, střed = 20°.</div>`;
  const bp = !b ? LOADING : b.err ? `<span class="muted">nezjištěno – ${esc(b.err)}; BPEJ najdete u parcely v Nahlížení do KN</span>` : b.none ? `<span class="muted">bez BPEJ (nezemědělská půda – les, ostatní plocha, intravilán)</span>` : `${b.kod}${b.alt && b.alt.length ? ` <span class="muted">(na hranici s ${b.alt.join(", ")})</span>` : ""}`;
  $("blkSoil").innerHTML = `<dl class="kv"><dt>BPEJ</dt><dd>${bp}</dd>
    ${b && b.kod ? `<dt>Klim. region</dt><dd>${b.kr} – ${b.krTxt}</dd><dt>Sklon/expozice</dt><dd>${b.seTxt}</dd><dt>HPJ</dt><dd>${b.hpj} <span class="muted">(hlavní půdní jednotka)</span></dd>` : ""}
    <dt>Půdní typ</dt><dd>${!so ? LOADING : so.err ? `<span class="muted">nezjištěno (${esc(so.err)})</span>` : `${esc(so.typ || "—")}${so.wrb ? ` <span class="muted">(${esc(so.wrb)})</span>` : ""}`}</dd>
    ${so && !so.err && so.dopr ? `<dt>Doprovodný</dt><dd>${esc(so.dopr)}</dd>` : ""}${so && !so.err && so.substrat ? `<dt>Substrát</dt><dd>${esc(so.substrat)}</dd>` : ""}
    <dt>Hornina</dt><dd>${!g ? LOADING : g.err ? `<span class="muted">nezjištěno (${esc(g.err)})</span>` : esc(g.hornina || "—")}</dd>
    ${g && !g.err && g.geneze ? `<dt>Geneze</dt><dd>${esc(g.geneze)}</dd>` : ""}${g && !g.err ? `<dt>Stáří</dt><dd>${esc([g.utvar, g.oddeleni].filter(Boolean).join(", ").toLowerCase() || "—")}</dd>` : ""}
  </dl><div class="hint">Zdroje: ČGS – geologická a půdní mapa 1 : 50 000; BPEJ z LPIS (Ministerstvo zemědělství).</div>`;
  $("blkClim").innerHTML = !c ? LOADING : c.err ? errMsg(c, "Klimatická data") : `<dl class="kv">
    <dt>Srážky</dt><dd>${c.precip != null ? Math.round(c.precip) + " mm/rok" : "—"}</dd>
    <dt>Mráz po 20. 4.</dt><dd>${c.prob != null ? Math.round(c.prob * 100) + " % let" : "—"} <span class="muted">(Tmin ≤ −1 °C)</span></dd>
    ${c.lateN != null ? `<dt>Dnů s mrazem</dt><dd>${fmt1(c.lateN)} <span class="muted">ročně mezi 20. 4. a 31. 5.</span></dd>` : ""}
    <dt>Posl. jarní mráz</dt><dd>${c.last ? "průměrně " + doyStr(c.last) : "—"}</dd><dt>Riziko pozdních mrazů</dt><dd>${riskBadge(S.risk)}</dd></dl>
    ${S.risk ? `<div class="hint">${S.risk.why.join("; ")}.</div>` : ""}
    <div class="hint">Reanalýza ERA5/ERA5-Land přes Open-Meteo, rozlišení zhruba 9–25 km, teplota přepočtena na výšku ${c.elev} m. Berte jako orientační srovnání mezi stromy.</div>`;
  $("blkKat").innerHTML = !k ? LOADING : k.err ? errMsg(k, "Katastr (RÚIAN)") : `<dl class="kv"><dt>Kat. území</dt><dd>${esc(k.ku || "—")} <span class="muted">(${k.kuKod})</span></dd>
    <dt>Parcela</dt><dd>${esc(k.cislo)} · <a href="https://nahlizenidokn.cuzk.gov.cz/ZobrazObjekt.aspx?typ=parcela&id=${k.id}" target="_blank" rel="noopener" style="color:var(--accent)">Nahlížení do KN ↗</a></dd>
    <dt>Druh pozemku</dt><dd>${esc(k.druh)}</dd><dt>Výměra</dt><dd>${k.vymera != null ? Math.round(k.vymera).toLocaleString("cs-CZ") + " m²" : "—"}</dd></dl>
    <div class="hint">Parcela podle GPS bodu stromu – u hranic pozemků ověřte v katastrální mapě.</div>`;
  const rb = $("siteRetry"); if (rb) { rb.style.display = !busy && (anyErr || missing) ? "inline-block" : "none"; rb.textContent = missing && !anyErr ? "Zjistit stanovištní údaje" : "Načíst chybějící údaje znovu"; }
  const si = $("siteInfo"); if (si) si.textContent = S.at ? `Zjištěno ${new Date(S.at).toLocaleDateString("cs-CZ")} a uloženo v katalogu.` : "";
}

/* ======================= DETAIL ======================= */
function sparkMeas(ms) {
  const pts = ms.filter(m => m.eq && m.year); if (pts.length < 2) return "";
  const W = 300, H = 70, l = 18, r = 54, t = 10, b = 16, y0 = Math.min(...pts.map(p => p.year)), y1 = Math.max(...pts.map(p => p.year)), v0 = Math.min(...pts.map(p => p.eq)), v1 = Math.max(...pts.map(p => p.eq));
  const X = y => l + (y - y0) / Math.max(1, y1 - y0) * (W - l - r), Y = v => t + (1 - (v - v0) / Math.max(1, v1 - v0)) * (H - t - b);
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" style="max-width:${W}px;margin-top:6px"><polyline points="${pts.map(p => X(p.year) + "," + Y(p.eq)).join(" ")}" fill="none" stroke="#8a3b1f" stroke-width="2"/>
    ${pts.map(p => `<circle cx="${X(p.year)}" cy="${Y(p.eq)}" r="4" fill="#8a3b1f" stroke="#fffdf8" stroke-width="1.5"/><text x="${X(p.year)}" y="${H - 3}" text-anchor="middle" font-size="10" fill="#6f6a5e">${p.year}</text>`).join("")}
    <text x="${X(y1) + 8}" y="${Y(pts[pts.length - 1].eq) + 4}" font-size="11" font-weight="600" fill="#2b2a25">${Math.round(pts[pts.length - 1].eq)} cm</text></svg>`;
}
const ST_LBL = Object.fromEntries(STATUS);
const srcLbl = m => m.source === "Kripner" ? "měření Kripner" : m.source === "poznámka" ? "z poznámky" : m.source === "starší" ? "starší měření" : m.source ? esc(m.source) : "";
export function renderDetail() {
  const el = $("detail");
  if (miniMap) { miniMap.remove(); miniMap = null; miniBase = null; }
  const t = app.byId[app.sel]; if (!t) { el.innerHTML = '<div class="empty">Vyberte strom v seznamu, na mapě nebo v tabulce.</div>'; el.classList.remove("mob"); return; }
  const c = colorOf(t), lo = Math.floor(ALT_MIN / 50) * 50, hi = Math.ceil(ALT_MAX / 50) * 50, f = a => ((a - lo) / (hi - lo) * 100).toFixed(1) + "%";
  const GEO = app.trees.filter(o => o.has && !o.archived);
  const near = t.has ? GEO.filter(o => o.id !== t.id).map(o => ({ o, d: hav(t, o) })).sort((a, b) => a.d - b.d).slice(0, 6) : [];
  const same = (AREAS[t.area] || []).length;
  const inOrch = app.orchards.filter(o => !o.archived).map(o => ({ o, pos: o.rows.flatMap(r => r.positions.map((p, i) => ({ code: r.id + i, ...p }))).filter(p => p.tree === t.id), g: o.genotypes.find(g => g.tree === t.id) })).filter(x => x.pos.length || x.g);
  const ro = app.readOnly;
  el.innerHTML = `
   <div class="hd"><span class="dot" style="background:${c};color:${txtOn(c)}">${esc(t.invLbl)}</span>
     <div style="flex:1;min-width:0"><h2>${esc(t.short)}</h2><div class="full">${esc(t.name)}</div>
       <div class="chips" style="margin-top:7px">${t.archived ? `<span class="chip st-zaniklá">vyřazený z evidence</span>` : ""}${(t.cv || []).map(v => `<span class="chip cv">´${esc(v.trim())}´</span>`).join("")}${t.st.filter(s => s !== "pojmenovaná").map(s => `<span class="chip st-${s}">${ST_LBL[s] || esc(s)}</span>`).join("")}</div>
       ${ro ? "" : `<div class="hd-actions"><button class="btn sm" id="dEdit">✎ Upravit</button></div>`}</div>
     <button class="btn" id="dClose" title="Zavřít">✕</button></div>
   ${photoSection(t)}
   <section><h4>Strom</h4><dl class="kv">
     <dt>Inv. č.</dt><dd>${esc(t.invLbl)}</dd>
     <dt>Lokalita</dt><dd><a href="#" data-area="${esc(t.area)}" style="color:var(--accent)">${esc(t.area)}</a> <span class="muted">(${plural(same, "strom", "stromy", "stromů")})</span></dd>
     <dt>GPS</dt><dd>${t.has ? `<span class="copy" title="Kliknutím zkopírujete" data-copy="${t.lat}, ${t.lon}">${fmtGPS(t)}</span>${t.acc ? ` <span class="muted">(± ${t.acc} m)</span>` : ""}` : `<span class="muted">neuvedeno</span>`}</dd>
     <dt>Nadm. výška</dt><dd>${t.alt != null ? (t.altTxt || t.alt) + " m n. m." : "—"}</dd>
     ${t.h != null ? `<dt>Výška stromu</dt><dd>${fmtN(t.h)} m</dd>` : ""}${t.kor != null ? `<dt>Nasazení koruny</dt><dd>${fmtN(t.kor)} m</dd>` : ""}
     ${t.typ ? `<dt>Typ</dt><dd>${esc(t.typ)}</dd>` : ""}${t.zr ? `<dt>Doba zrání</dt><dd>${esc(t.zr)}</dd>` : ""}
   </dl>
   ${t.alt != null ? `<div class="altbar" title="Nadmořská výška stromu v rozpětí katalogu"><div class="mk" style="left:${f(t.alt)}"></div>${[lo, (lo + hi) / 2, hi].map(a => `<span class="ax" style="left:${f(a)}">${a}</span>`).join("")}</div><div style="height:16px"></div>` : ""}
   </section>
   <section><h4>Obvod kmene</h4>${t.meas.length ? `<table class="meas">${t.meas.map(m => `<tr><td>${m.year || "?"}</td><td class="num">${esc(m.text)}${/cm/.test(m.text) ? "" : " cm"}</td><td class="muted">${(m.stems || []).length > 1 ? `ekv. ${m.eq} cm · ` : ""}${srcLbl(m)}${m.author ? " · " + esc(m.author) : ""}</td><td>${ro ? "" : `<button class="del" data-mdel="${m.id}" title="Smazat měření">✕</button>`}</td></tr>`).join("")}</table>
     ${sparkMeas(t.meas)}${t.growth != null ? `<div style="font-size:12.5px;margin-top:4px">Průměrný přírůstek <b>${fmt1(t.growth)} cm/rok</b></div>` : ""}
     <div style="font-size:11.5px;color:var(--muted);margin-top:4px">U vícekmenů je ekvivalentní obvod √(součet čtverců obvodů kmenů).</div>` : `<span class="muted">neměřeno</span>`}
     ${ro ? "" : `<form class="inline-form" id="measForm"><label>Rok<input name="year" type="number" min="1900" max="2100" value="${new Date().getFullYear()}" required></label>
       <label>Obvod (cm)<input name="text" class="w" placeholder="např. 170 nebo 105+97" required></label><label>Měřil<input name="author" class="w" value="${esc(app.user)}"></label><button class="btn sm primary">+ Přidat měření</button></form>`}</section>
   ${t.note ? `<section><h4>Poznámka</h4><div class="note">${esc(t.note)}</div></section>` : ""}
   ${inOrch.length ? `<section class="orch-detail-sec"><h4>Ve výsadbách</h4>${inOrch.map(x => `<div style="margin-bottom:6px"><a href="#" data-orch="${x.o.id}" style="color:var(--accent);font-weight:600">${esc(x.o.name)}</a>${x.g && x.g.label ? ` <span class="muted">jako „${esc(x.g.label)}“</span>` : ""}
      <div class="chips" style="margin-top:4px">${x.pos.map(p => `<span class="chip ${esc(p.supplier || "")}" title="${esc(x.o.suppliers[p.supplier]?.name || "")}">${p.code}${p.supplier ? " · " + esc(p.supplier) : ""}</span>`).join("") || `<span class="muted">genotyp bez pozice v plánu</span>`}</div></div>`).join("")}</section>` : ""}
   ${t.has ? `<section><h4>Terén stanoviště (DMR 5G)</h4><div id="blkTerr"></div></section>
   <section><h4>Horizont a zastínění</h4><div id="blkHor"></div></section>
   <section><h4>Půda a geologie</h4><div id="blkSoil"></div></section>
   <section><h4>Klima (reanalýza ERA5, ${CLIM_Y[0]}–${CLIM_Y[1]})</h4><div id="blkClim"></div></section>
   <section><h4>Katastr</h4><div id="blkKat"></div><div class="hint" id="siteInfo"></div><button class="btn" id="siteRetry" style="display:none;margin-top:10px">Načíst chybějící údaje znovu</button></section>
   <section><h4>Nejbližší evidované stromy</h4><ul class="near">${near.map(({ o, d }) => `<li data-id="${o.id}"><span>${esc(o.invLbl)} · ${esc(o.short)}</span><span>${d < 1 ? Math.round(d * 1000) + " m" : fmt1(d) + " km"}</span></li>`).join("")}</ul></section>
   <section><h4>Poloha</h4><div id="mini"></div>
     <div class="links"><a href="https://mapy.cz/turisticka?x=${t.lon}&y=${t.lat}&z=17&source=coor&id=${t.lon}%2C${t.lat}" target="_blank" rel="noopener">Mapy.com ↗</a>
     <a href="https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lon}" target="_blank" rel="noopener">Google Maps ↗</a>
     <a href="https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lon}" target="_blank" rel="noopener">Navigovat ↗</a></div></section>` : ""}
   <div class="edited">${t.rec.updated ? `Naposledy upraveno ${new Date(t.rec.updated).toLocaleString("cs-CZ")}${t.rec.updatedBy ? " · " + esc(t.rec.updatedBy) : ""}` : ""}${t.rec.history && t.rec.history.length > 1 ? ` · <a href="#" id="histBtn" style="color:var(--accent)">historie změn</a>` : ""}<div id="hist"></div></div>`;
  el.querySelector("#dClose").onclick = () => select(null);
  el.querySelector("#dEdit")?.addEventListener("click", () => app.hooks.editTree(t));
  el.querySelectorAll(".near li").forEach(li => li.addEventListener("click", () => select(li.dataset.id, { fly: true })));
  el.querySelectorAll("[data-area]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); setArea(a.dataset.area); }));
  el.querySelectorAll("[data-orch]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); app.orch = a.dataset.orch; showTab("vOrch"); }));
  el.querySelectorAll("[data-copy]").forEach(s => s.addEventListener("click", () => { navigator.clipboard && navigator.clipboard.writeText(s.dataset.copy); s.textContent = "zkopírováno ✓"; }));
  el.querySelector("#siteRetry")?.addEventListener("click", () => ensureSite(t, true));
  el.querySelector("#histBtn")?.addEventListener("click", e => {
    e.preventDefault(); const FL = { site: "stanoviště", measurements: "měření", photos: "fotky", lat: "GPS", lon: "GPS", short: "krátký název", name: "název", inv: "inv. č.", alt: "nadm. výška", height: "výška", crown: "koruna", habitat: "typ", ripening: "zrání", status: "kategorie", note: "poznámka", cultivars: "kultivar", area: "lokalita", archived: "vyřazení" };
    $("hist").innerHTML = `<ul style="margin:6px 0 0;padding-left:16px">${[...t.rec.history].reverse().slice(0, 30).map(h => `<li>${new Date(h.at).toLocaleString("cs-CZ")} · ${esc(h.by || "?")}: ${[...new Set(h.fields.map(f => FL[f] || f))].join(", ")}</li>`).join("")}</ul>`;
  });
  el.querySelectorAll("[data-mdel]").forEach(b => b.addEventListener("click", async () => {
    if (!await confirmBox("Smazat toto měření?", "Smazat", true)) return;
    await saveTree(t.id, r => ({ measurements: live(r.measurements).filter(m => m.id !== b.dataset.mdel) }), "Měření smazáno.");
  }));
  el.querySelector("#measForm")?.addEventListener("submit", async e => {
    e.preventDefault(); const fd = new FormData(e.target); const text = String(fd.get("text")).trim(); const pc = parseCirc(text);
    if (!pc || !pc.eq) { toast("Obvod se nepodařilo přečíst – zadejte číslo v cm, u vícekmenů např. 105+97.", "err"); return; }
    const m = { id: newId(8), year: +fd.get("year") || null, text, stems: pc.stems, eq: pc.eq, approx: pc.approx, author: String(fd.get("author") || "").trim() || null, source: null, date: new Date().toISOString().slice(0, 10) };
    await saveTree(t.id, r => ({ measurements: [...live(r.measurements), m] }), "Měření přidáno.");
  });
  bindPhotoSection(el, t);
  if (t.has) {
    miniMap = L.map("mini", { zoomControl: true, scrollWheelZoom: false }).setView([t.lat, t.lon], 16);
    miniBase = tileLayerFor($("mapset").value).addTo(miniMap);
    near.filter(n => n.d < 1.5).forEach(({ o }) => L.circleMarker([o.lat, o.lon], { radius: 6, color: "#333", weight: 1, fillColor: colorOf(o), fillOpacity: .9 }).bindTooltip(`${esc(o.invLbl)} ${esc(o.short)}`).on("click", () => select(o.id, { fly: true })).addTo(miniMap));
    L.circleMarker([t.lat, t.lon], { radius: 9, color: "#d9481c", weight: 3, fillColor: c, fillOpacity: 1 }).addTo(miniMap);
    if (t.acc) L.circle([t.lat, t.lon], { radius: t.acc, color: "#d9481c", weight: 1, dashArray: "3 3", fill: false }).addTo(miniMap);
    setTimeout(() => miniMap && miniMap.invalidateSize(), 60);
    renderSiteBlocks(t); ensureSite(t);
  }
  el.classList.add("mob");
}
export async function saveTree(id, patchFn, msg) {
  try {
    await app.repo.update("tree", id, patchFn, app.user);
    app.hooks.dataChanged(new Set([id]));
    if (msg) toast(msg);
    return true;
  } catch (e) { console.error(e); toast("Uložení se nepodařilo: " + esc(e.message || e), "err"); return false; }
}

/* ======================= VÝBĚR ======================= */
export function select(id, opt = {}) {
  const prevScroll = app.sel === id ? $("detail").scrollTop : 0;
  app.sel = id && app.byId[id] ? id : null;
  try { history.replaceState(null, "", app.sel ? "#strom=" + encodeURIComponent(app.sel) : location.pathname + location.search); } catch (e) {}
  renderList(); drawMarkers(); renderDetail();
  $("detail").scrollTop = prevScroll;
  if (app.tab === "vTbl") document.querySelectorAll("#tbl tr[data-id]").forEach(tr => tr.classList.toggle("active", tr.dataset.id === app.sel));
  if (app.tab === "vOver") renderOver();
  if (app.tab === "vOrch") app.hooks.renderOrchards?.();
  if (!app.sel) return;
  const t = app.byId[app.sel];
  if (opt.fly && t.has) { if (app.tab !== "vMap") showTab("vMap"); map.flyTo([t.lat, t.lon], Math.max(map.getZoom(), 15), { duration: .6 }); }
  const li = document.querySelector(`#list li[data-id="${CSS.escape(app.sel)}"]`); if (li) li.scrollIntoView({ block: "nearest" });
}

/* ======================= INIT ======================= */
export function initCatalog() {
  $("fFlags").innerHTML = FLAGS.map(([k, l]) => `<button class="fchip" data-f="${k}">${l}</button>`).join("");
  $("fFlags").addEventListener("click", e => { const b = e.target.closest(".fchip"); if (!b) return; const k = b.dataset.f; F.flags.has(k) ? F.flags.delete(k) : F.flags.add(k); b.classList.toggle("on"); applyFilters(); });
  [["q", "input"], ["fArea", "change"], ["fTyp", "change"], ["fObvMin", "input"], ["fObvMax", "input"], ["fAltMin", "input"], ["fAltMax", "input"]].forEach(([id, ev]) => $(id).addEventListener(ev, () => {
    F.q = $("q").value.trim().toLowerCase(); F.area = $("fArea").value; F.typ = $("fTyp").value;
    F.obvMin = numOrNull($("fObvMin").value); F.obvMax = numOrNull($("fObvMax").value); F.altMin = numOrNull($("fAltMin").value); F.altMax = numOrNull($("fAltMax").value);
    applyFilters(id === "fArea");
  }));
  document.querySelectorAll("[data-reset]").forEach(b => b.addEventListener("click", resetFilters));
  $("list").addEventListener("click", e => { const li = e.target.closest("li"); if (!li) return; if (li.dataset.more) { listLimit = 1e9; renderList(); return; } if (li.dataset.id) select(li.dataset.id, { fly: true }); });
  $("sort").addEventListener("change", renderList);
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => showTab(b.dataset.v)));
  map = L.map("map", { zoomSnap: .5, preferCanvas: true }).setView([50.53, 14.05], 11);
  markerLayer = L.layerGroup().addTo(map); orchLayer = L.layerGroup().addTo(map); selLayer = L.layerGroup().addTo(map);
  setBase();
  $("mapset").addEventListener("change", setBase);
  $("relief").addEventListener("change", e => {
    if (reliefLayer) { map.removeLayer(reliefLayer); reliefLayer = null; } if (!e.target.value) return;
    reliefLayer = L.tileLayer.wms("https://ags.cuzk.gov.cz/arcgis2/services/dmr5g/ImageServer/WMSServer", { layers: e.target.value, format: "image/png", transparent: true, version: "1.3.0", opacity: e.target.value.includes("Hillshade") ? .5 : .55, attribution: 'DMR 5G &copy; <a href="https://geoportal.cuzk.gov.cz" target="_blank">ČÚZK</a>' }).addTo(map);
  });
  map.on("zoomend", () => { if ($("showLbl").checked) drawMarkers(); });
  ["colorBy", "sizeObv", "showLbl"].forEach(id => $(id).addEventListener("change", () => { drawMarkers(); renderList(); }));
  $("mapOrch").addEventListener("change", () => { if ($("mapOrch").value && $("colorBy").value !== "orch") $("colorBy").value = "orch"; drawMarkers(); renderList(); });
  $("fitBtn").addEventListener("click", fitFiltered);
  $("locSort").addEventListener("change", renderLoc);
  $("locGrid").addEventListener("click", e => { const c = e.target.closest(".loc"); if (!c) return; setArea(c.dataset.a); showTab("vMap"); });
  $("tbl").addEventListener("click", e => {
    const th = e.target.closest("th"); if (th) { const k = th.dataset.k; tblSort = { k, dir: tblSort.k === k ? -tblSort.dir : (["obv", "alt", "h", "kor", "growth", "obvYear", "ph"].includes(k) ? -1 : 1) }; renderTable(); return; }
    const tr = e.target.closest("tr[data-id]"); if (tr) select(tr.dataset.id);
  });
  let tblRaf = null; $("tblWrap").addEventListener("scroll", () => { if (tblRaf) return; tblRaf = requestAnimationFrame(() => { tblRaf = null; renderTable(); }); });
  $("csvBtn").addEventListener("click", exportCSV);
  initTip();
  window.addEventListener("resize", () => { if (app.tab === "vOver") renderOver(); });
  app.hooks.select = select; app.hooks.showTab = showTab; app.hooks.pickOnMap = pickOnMap; app.hooks.saveTree = saveTree;
  app.hooks.redrawMap = drawMarkers; app.hooks.ensureSite = t => ensureSite(t);
  app.hooks.fitPoints = pts => pts.length === 1 ? map.setView(pts[0], 14) : map.fitBounds(pts, { padding: [40, 40] });
}
export function fitAll() { fitFiltered(); }
