import { app, $, esc, modal, toast, confirmBox, txtOn, fmt1, svgEl, TAB20, plural } from "./util.js";
import { emptyOrchard, parseCoords, hav } from "../core/model.js";
import { aspName, aspectColor } from "./catalog.js";

let editing = false;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* ---------- pomocné ---------- */
const cur = () => app.byOrch[app.orch] || null;
const geno = (o, treeId) => o.genotypes.find(g => g.tree === treeId);
const labelOf = (o, treeId) => { const g = geno(o, treeId), t = app.byId[treeId]; return (g && g.label) || (t ? t.short : "?"); };
function nextColor(o) { const used = new Set(o.genotypes.map(g => g.color)); return TAB20.find(c => !used.has(c)) || TAB20[o.genotypes.length % TAB20.length]; }
async function saveOrch(id, patchFn, msg) {
  try { await app.repo.update("orchard", id, patchFn, app.user); app.hooks.dataChanged(new Set([id])); if (msg) toast(msg); return true; }
  catch (e) { console.error(e); toast("Uložení se nepodařilo: " + esc(e.message), "err"); return false; }
}
export function refreshOrchardOptions() {
  const s = $("mapOrch"), v = s.value;
  s.innerHTML = `<option value="">žádný</option>` + app.orchards.filter(o => !o.archived).map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("");
  s.value = app.byOrch[v] ? v : "";
}

/* ---------- vykreslení záložky ---------- */
export function renderOrchards() {
  const list = app.orchards.filter(o => !o.archived).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  if (!app.byOrch[app.orch] && list.length) app.orch = list[0].id;
  $("orchList").innerHTML = list.map(o => {
    const n = o.rows.reduce((s, r) => s + r.positions.filter(p => p.tree).length, 0);
    return `<div class="oc${o.id === app.orch ? " on" : ""}" data-o="${o.id}"><b>${esc(o.name)}</b><span>${plural(o.genotypes.length, "genotyp", "genotypy", "genotypů")} · ${plural(n, "strom", "stromy", "stromů")}</span></div>`;
  }).join("") + (app.readOnly ? "" : `<button class="btn" id="oNew" style="width:100%">+ Nový sad</button>`) + (list.length ? "" : `<p class="muted" style="font-size:12.5px">Zatím není evidován žádný sad.</p>`);
  $("orchList").querySelectorAll("[data-o]").forEach(d => d.addEventListener("click", () => { app.orch = d.dataset.o; editing = false; renderOrchards(); }));
  $("oNew")?.addEventListener("click", () => openOrchardForm(null));
  const o = cur(); const el = $("orchMain");
  if (!o) { el.innerHTML = `<div class="muted" style="padding:20px">Vyberte nebo založte sad.</div>`; return; }
  const placed = o.rows.reduce((s, r) => s + r.positions.filter(p => p.tree).length, 0), total = o.rows.reduce((s, r) => s + r.positions.length, 0);
  el.innerHTML = `
    <div class="ohead"><div><h2>${esc(o.name)}</h2><div class="muted" style="font-size:12.5px">${esc(o.note || "")}</div>
      <div class="muted" style="font-size:12.5px;margin-top:4px">${plural(o.genotypes.length, "genotyp", "genotypy", "genotypů")} · ${placed} z ${plural(total, "pozice", "pozic", "pozic")} osazeno${o.altRange ? ` · ${o.altRange[0]}–${o.altRange[1]} m n. m.` : ""}${o.lat != null ? ` · ${o.lat.toFixed(5)} N, ${o.lon.toFixed(5)} E` : ""}</div></div>
      <div class="acts"><button class="btn" id="oMap">Na mapě</button>${app.readOnly ? "" : `<button class="btn${editing ? " primary" : ""}" id="oEditPlan">${editing ? "✓ Hotovo" : "✎ Upravit plán"}</button><button class="btn" id="oEdit">Údaje sadu</button>`}</div></div>
    ${editing ? `<div class="msgs"><li class="warn">Režim úprav: klikněte na pozici pro přiřazení genotypu, na „+“ pro přidání pozice, na název řady pro její úpravu.</li></div>` : `<p class="muted" style="font-size:12.5px;margin:10px 0 0">Kliknutím na strom v plánu otevřete detail matečného stromu a zvýrazníte všechny jeho výsadby.</p>`}
    <div class="planwrap"><svg class="plan${editing ? " editing" : ""}" id="plan"></svg></div>
    ${editing ? `<div style="margin-top:8px;display:flex;gap:8px"><button class="btn" id="oAddRow">+ Přidat řadu</button><button class="btn" id="oLayout">Popisky plánu</button></div>` : ""}
    <h3>Genotypy</h3><div class="scrollv" style="padding:0;overflow:auto"><table class="tbl" id="oTbl"></table></div>
    <h3>Nadmořská výška matečných stromů vs. sad</h3><p class="note muted" style="font-size:12.5px">${o.altRange ? `Zelený pás = nadmořská výška sadu (${o.altRange[0]}–${o.altRange[1]} m n. m.). ` : ""}Body nalevo pocházejí z nižších, teplejších poloh.</p>
    <svg id="oAlt" width="100%"></svg>
    <h3>Terén stanovišť matečných stromů</h3><p class="note muted" style="font-size:12.5px" id="oTerrNote"></p>
    <div class="charts" style="display:flex;gap:28px;flex-wrap:wrap"><figure style="margin:0"><svg id="oRose" width="380" height="380"></svg><figcaption class="muted" style="font-size:12px;max-width:380px">Růžice expozic: směr = kam svah stromu směřuje, vzdálenost od středu = sklon.</figcaption></figure>
      <figure style="margin:0"><svg id="oSun" width="440" height="380"></svg><figcaption class="muted" style="font-size:12px;max-width:440px">Oslunění vs. nadmořská výška: vlevo nahoře teplá a nízká stanoviště, vpravo dole chladnější.</figcaption></figure></div>`;
  $("oMap").onclick = () => { $("mapOrch").value = o.id; $("colorBy").value = "orch"; app.hooks.showTab("vMap"); app.hooks.redrawMap(); fitOrch(o); };
  $("oEditPlan")?.addEventListener("click", () => { editing = !editing; renderOrchards(); });
  $("oEdit")?.addEventListener("click", () => openOrchardForm(o));
  $("oAddRow")?.addEventListener("click", () => addRow(o));
  $("oLayout")?.addEventListener("click", () => openLayoutForm(o));
  drawPlan(o); renderGenoTable(o); drawAltChart(o); drawTerr(o);
}
function fitOrch(o) {
  const pts = o.genotypes.map(g => app.byId[g.tree]).filter(t => t && t.has).map(t => [t.lat, t.lon]);
  if (o.lat != null) pts.push([o.lat, o.lon]);
  if (pts.length) setTimeout(() => app.hooks.fitPoints(pts), 80);
}

/* ---------- plán sadu ---------- */
function drawPlan(o) {
  const svg = $("plan"); svg.innerHTML = "";
  const COLW = 240, X0 = 110, nR = Math.max(1, o.rows.length), maxLen = Math.max(1, ...o.rows.map(r => r.positions.length + (editing ? 1 : 0)));
  const gaps = (o.layout && o.layout.gaps) || [];
  const Y = i => 150 + i * 62 + 38 * gaps.filter(g => g.after < i).length;
  const W = X0 + nR * COLW - 20, H = Y(maxLen - 1) + 90;
  // plán se přizpůsobí šířce panelu (nejvýš skutečná velikost)
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.width = "100%"; svg.style.maxWidth = W + "px"; svg.style.minWidth = Math.min(W, 640) + "px"; svg.style.height = "auto";
  svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#fffdf8" }, svg);
  const tt = svgEl("text", { x: W / 2, y: 34, "text-anchor": "middle", "font-size": 18, "font-weight": 600, fill: "#2b2a25" }, svg); tt.textContent = "Rozmístění genotypů (číslo = inv. č.)";
  const t2 = svgEl("text", { x: W / 2, y: 56, "text-anchor": "middle", "font-size": 13, fill: "#6f6a5e" }, svg); t2.textContent = "pozice = řada + číslo stromu";
  if (o.layout?.top) { const n = svgEl("text", { x: 40, y: 92, "font-size": 13, fill: "#2b2a25", "font-weight": 600 }, svg); n.textContent = o.layout.top; }
  gaps.forEach(g => {
    const y = Y(g.after) + 36; svgEl("rect", { x: 20, y, width: W - 40, height: 36, fill: "#f5e6c4", rx: 4 }, svg);
    if (g.label) { const tx = svgEl("text", { x: W / 2, y: y + 23, "text-anchor": "middle", "font-size": 12, fill: "#9a7a35" }, svg); tx.textContent = g.label; }
  });
  if (o.layout?.bottom) { const n = svgEl("text", { x: W - 160, y: H - 40, "font-size": 12, fill: "#b0861f" }, svg); n.textContent = o.layout.bottom; }
  const selTree = app.sel;
  o.rows.forEach((row, ri) => {
    const x = X0 + ri * COLW;
    svgEl("line", { x1: x, y1: 130, x2: x, y2: Y(Math.max(0, row.positions.length - 1)) + 20, stroke: "#e2dccd", "stroke-width": 2, "stroke-dasharray": "2 5" }, svg);
    const rl = svgEl("text", { x, y: H - 12, "text-anchor": "middle", "font-size": 14, "font-weight": 600, fill: editing ? "#8a3b1f" : "#2b2a25", style: editing ? "cursor:pointer;text-decoration:underline" : null }, svg);
    rl.textContent = row.label || "řada " + row.id;
    if (editing) rl.addEventListener("click", () => openRowForm(o, ri));
    row.positions.forEach((p, i) => {
      const y = Y(i), t = p.tree ? app.byId[p.tree] : null, g = p.tree ? geno(o, p.tree) : null;
      const fill = g ? g.color : "#fff";
      const cls = ["pos"]; if (!p.tree) cls.push("empty"); if (selTree && p.tree === selTree) cls.push("hl"); else if (selTree && o.genotypes.some(x => x.tree === selTree)) cls.push("dim");
      const gr = svgEl("g", { class: cls.join(" "), tabindex: 0 }, svg);
      const ttl = svgEl("title", {}, gr); ttl.textContent = p.tree ? `${row.id}${i} · ${labelOf(o, p.tree)}${t ? ` (inv. č. ${t.invLbl})` : ""}${p.note ? " – " + p.note : ""}` : `${row.id}${i} · volná pozice`;
      svgEl("circle", { class: "c", cx: x, cy: y, r: 20, fill }, gr);
      const tn = svgEl("text", { x, y: y + 4, "text-anchor": "middle", "font-size": t && t.invLbl.length > 2 ? 11 : 12.5, "font-weight": 700, fill: p.tree ? txtOn(fill) : "#aaa", "pointer-events": "none" }, gr);
      tn.textContent = t ? t.invLbl : p.tree ? "?" : "";
      const nm = svgEl("text", { x: x + 30, y: y - 3, "font-size": 12.5, fill: p.tree ? "#2b2a25" : "#aaa" }, gr); nm.textContent = p.tree ? labelOf(o, p.tree) : "volná pozice";
      const cd = svgEl("text", { x: x + 30, y: y + 13, "font-size": 11.5, fill: "#6f6a5e" }, gr);
      cd.innerHTML = `<tspan font-weight="700" fill="#2b2a25">${row.id}${i}</tspan>${p.supplier ? ` · <tspan fill="${o.suppliers[p.supplier]?.color || "#6f6a5e"}">${esc(o.suppliers[p.supplier]?.name || p.supplier)}</tspan>` : ""}${p.note ? " · " + esc(p.note) : ""}`;
      gr.addEventListener("click", () => editing ? openPosForm(o, ri, i) : p.tree && app.hooks.select(p.tree));
    });
    if (editing) {
      const y = Y(row.positions.length);
      const ad = svgEl("g", { class: "addpos" }, svg);
      svgEl("rect", { x: x - 20, y: y - 20, width: 40, height: 40, rx: 20, fill: "#fff", stroke: "#c9bfa9", "stroke-dasharray": "3 3" }, ad);
      const pl = svgEl("text", { x, y: y + 6, "text-anchor": "middle", "font-size": 20, fill: "#8a3b1f", "pointer-events": "none" }, ad); pl.textContent = "+";
      const tl = svgEl("title", {}, ad); tl.textContent = "Přidat pozici na konec řady";
      ad.addEventListener("click", () => saveOrch(o.id, r => ({ rows: r.rows.map((x, k) => k === ri ? { ...x, positions: [...x.positions, { tree: null, supplier: null }] } : x) })));
    }
  });
}

/* ---------- tabulka genotypů ---------- */
function renderGenoTable(o) {
  const sups = Object.keys(o.suppliers || {});
  const rows = o.genotypes.map(g => ({ g, t: app.byId[g.tree], pos: o.rows.flatMap(r => r.positions.map((p, i) => ({ code: r.id + i, ...p }))).filter(p => p.tree === g.tree) }));
  rows.sort((a, b) => (a.t?.invNum ?? 1e9) - (b.t?.invNum ?? 1e9));
  $("oTbl").innerHTML = `<thead><tr><th>Inv. č.</th><th>Genotyp</th><th>Matečný strom</th><th>N. m. (m)</th><th>Obvod</th><th>Pozice v sadu</th>${sups.map(s => `<th>${esc(o.suppliers[s].name)}</th>`).join("")}<th>Od sadu</th><th>Foto</th>${app.readOnly ? "" : "<th></th>"}</tr></thead><tbody>${rows.map(({ g, t, pos }) => `
    <tr data-id="${g.tree}" class="${app.sel === g.tree ? "active" : ""}"><td><span class="dot sm" style="background:${g.color};color:${txtOn(g.color)}">${esc(t ? t.invLbl : "?")}</span></td>
    <td>${esc(g.label || (t && t.short) || "?")}</td><td>${t ? esc(t.short) : `<span style="color:#a23b1b">strom chybí v katalogu</span>`}</td><td class="num">${t?.alt ?? "—"}</td><td class="num">${t?.obv ? Math.round(t.obv) + " cm" : "—"}</td>
    <td>${pos.map(p => p.code + (p.supplier ? " · " + esc(p.supplier) : "")).join(", ") || "—"}</td>${sups.map(s => `<td>${esc((g.supply || {})[s] || "—")}</td>`).join("")}
    <td class="num">${t && t.has && o.lat != null ? fmt1(hav(o, t)) + " km" : "—"}</td><td class="num">${t?.photos.length || ""}</td>${app.readOnly ? "" : `<td><button class="btn sm" data-g="${g.tree}">upravit</button></td>`}</tr>`).join("")}</tbody>`;
  $("oTbl").onclick = e => {
    const b = e.target.closest("[data-g]"); if (b) { openGenoForm(o, b.dataset.g); return; }
    const tr = e.target.closest("tr[data-id]"); if (tr && app.byId[tr.dataset.id]) app.hooks.select(tr.dataset.id);
  };
}

/* ---------- grafy ---------- */
function drawAltChart(o) {
  const svg = $("oAlt"); svg.innerHTML = "";
  const ts = o.genotypes.map(g => ({ g, t: app.byId[g.tree] })).filter(x => x.t && x.t.alt != null).sort((a, b) => b.t.alt - a.t.alt);
  const W = svg.clientWidth || 700, rowH = 24, top = 28, left = 190, right = 40, H = top + ts.length * rowH + 30;
  svg.setAttribute("height", H);
  const alts = ts.map(x => x.t.alt).concat(o.altRange || []);
  const x0 = Math.floor((Math.min(...alts, 200) - 20) / 25) * 25, x1 = Math.ceil((Math.max(...alts, 300) + 20) / 25) * 25;
  const sx = a => left + (a - x0) / (x1 - x0) * (W - left - right);
  for (let a = x0; a <= x1; a += 25) { svgEl("line", { x1: sx(a), x2: sx(a), y1: top - 6, y2: H - 24, stroke: "#eee6d6" }, svg); const t = svgEl("text", { x: sx(a), y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "#6f6a5e" }, svg); t.textContent = a; }
  if (o.altRange) { svgEl("rect", { x: sx(o.altRange[0]), y: top - 6, width: Math.max(2, sx(o.altRange[1]) - sx(o.altRange[0])), height: H - top - 18, fill: "rgba(79,107,44,.18)" }, svg);
    const ol = svgEl("text", { x: sx((o.altRange[0] + o.altRange[1]) / 2), y: top - 12, "text-anchor": "middle", "font-size": 11, fill: "#4f6b2c", "font-weight": 600 }, svg); ol.textContent = "sad"; }
  ts.forEach(({ g, t }, k) => {
    const y = top + k * rowH + rowH / 2, sel = app.sel === t.id;
    const gr = svgEl("g", { style: "cursor:pointer" }, svg); gr.addEventListener("click", () => app.hooks.select(t.id));
    const lb = svgEl("text", { x: left - 10, y: y + 4, "text-anchor": "end", "font-size": 12, fill: sel ? "#d9481c" : "#2b2a25", "font-weight": sel ? 700 : 400 }, gr); lb.textContent = `${g.label || t.short} (${t.invLbl})`;
    svgEl("line", { x1: sx(x0), x2: sx(t.alt), y1: y, y2: y, stroke: "#d8d0bd", "stroke-width": 1.5 }, gr);
    svgEl("circle", { cx: sx(t.alt), cy: y, r: 7, fill: g.color, stroke: sel ? "#d9481c" : "#333", "stroke-width": sel ? 3 : 1 }, gr);
    const v = svgEl("text", { x: sx(t.alt) + 12, y: y + 4, "font-size": 11, fill: "#6f6a5e" }, gr); v.textContent = t.alt + " m";
  });
}
function drawTerr(o) {
  const items = o.genotypes.map(g => ({ g, t: app.byId[g.tree] })).filter(x => x.t).map(x => ({ ...x, r: x.t.rec.site && x.t.rec.site.key === `${x.t.lat},${x.t.lon}` && x.t.rec.site.terr && !x.t.rec.site.terr.err ? x.t.rec.site.terr : null }));
  const have = items.filter(x => x.r).length;
  $("oTerrNote").innerHTML = `Sklon a expozice z digitálního modelu reliéfu (DMR 5G). Údaje se zjišťují při prvním otevření detailu stromu a ukládají se do katalogu – zjištěno u ${have} z ${items.length} genotypů.${have < items.length && !app.readOnly ? ` <a href="#" id="oTerrLoad" style="color:var(--accent)">Zjistit u zbývajících</a>` : ""}`;
  $("oTerrLoad")?.addEventListener("click", async e => {
    e.preventDefault(); e.target.textContent = "zjišťuji…";
    for (const x of items.filter(x => !x.r && x.t.has)) await app.hooks.ensureSite(x.t);
    renderOrchards();
  });
  const SLOPE_MAX = 25, rose = $("oRose"); rose.innerHTML = "";
  const Wr = 380, c = Wr / 2, R = 150, rr = s => Math.min(1, s / SLOPE_MAX) * R;
  [5, 10, 15, 20, 25].forEach(s => { svgEl("circle", { cx: c, cy: c, r: rr(s), fill: "none", stroke: "#e7e0d0" }, rose); const t = svgEl("text", { x: c + 3, y: c - rr(s) - 2, "font-size": 9.5, fill: "#9a937f" }, rose); t.textContent = s + "°"; });
  ["S", "SV", "V", "JV", "J", "JZ", "Z", "SZ"].forEach((l, k) => { const a = k * Math.PI / 4; svgEl("line", { x1: c, y1: c, x2: c + Math.sin(a) * R, y2: c - Math.cos(a) * R, stroke: "#eee6d6" }, rose); const t = svgEl("text", { x: c + Math.sin(a) * (R + 16), y: c - Math.cos(a) * (R + 16) + 4, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: "#6f6a5e" }, rose); t.textContent = l; });
  const dot = (svg, x, y, { g, t, r }, tip) => {
    const sel = app.sel === t.id, gr = svgEl("g", { style: "cursor:pointer" }, svg); gr.addEventListener("click", () => app.hooks.select(t.id));
    const tt = svgEl("title", {}, gr); tt.textContent = tip;
    svgEl("circle", { cx: x, cy: y, r: sel ? 9 : 7, fill: g.color, stroke: sel ? "#d9481c" : "#333", "stroke-width": sel ? 3 : 1 }, gr);
    const n = svgEl("text", { x, y: y + 3, "text-anchor": "middle", "font-size": 7, "font-weight": 700, fill: txtOn(g.color), "pointer-events": "none" }, gr); n.textContent = t.invLbl;
  };
  items.filter(x => x.r).forEach(x => { const a = x.r.aspect * Math.PI / 180, d = x.r.slope < 2 ? 0 : rr(x.r.slope); dot(rose, c + Math.sin(a) * d, c - Math.cos(a) * d, x, `${x.g.label || x.t.short}: ${fmt1(x.r.slope)}°, ${aspName(x.r, true)}`); });
  const sc = $("oSun"); sc.innerHTML = "";
  const w = 440, h = 380, l = 60, rt = 16, tp = 14, bt = 40;
  const els = items.filter(x => x.r).map(x => x.r.elev); const xs = [Math.floor((Math.min(...els, 200) - 10) / 25) * 25, Math.ceil((Math.max(...els, 300) + 10) / 25) * 25], ys = [50, 150];
  const X = v => l + (v - xs[0]) / (xs[1] - xs[0]) * (w - l - rt), Y = v => tp + (1 - (v - ys[0]) / (ys[1] - ys[0])) * (h - tp - bt);
  for (let v = xs[0]; v <= xs[1]; v += 25) { svgEl("line", { x1: X(v), x2: X(v), y1: tp, y2: h - bt, stroke: "#eee6d6" }, sc); const t = svgEl("text", { x: X(v), y: h - bt + 15, "text-anchor": "middle", "font-size": 10.5, fill: "#6f6a5e" }, sc); t.textContent = v; }
  for (let v = 50; v <= 150; v += 25) { svgEl("line", { x1: l, x2: w - rt, y1: Y(v), y2: Y(v), stroke: v === 100 ? "#cfc6b0" : "#eee6d6", "stroke-dasharray": v === 100 ? "4 3" : null }, sc); const t = svgEl("text", { x: l - 6, y: Y(v) + 4, "text-anchor": "end", "font-size": 10.5, fill: "#6f6a5e" }, sc); t.textContent = v + " %"; }
  const xl = svgEl("text", { x: (l + w - rt) / 2, y: h - 6, "text-anchor": "middle", "font-size": 11.5, fill: "#2b2a25" }, sc); xl.textContent = "nadmořská výška (DMR 5G), m";
  const yl = svgEl("text", { x: 12, y: (tp + h - bt) / 2, "text-anchor": "middle", "font-size": 11.5, fill: "#2b2a25", transform: `rotate(-90 12 ${(tp + h - bt) / 2})` }, sc); yl.textContent = "oslunění vůči rovině";
  items.filter(x => x.r).forEach(x => dot(sc, X(x.r.elev), Y(Math.max(50, Math.min(150, x.r.sun))), x, `${x.g.label || x.t.short}: ${Math.round(x.r.elev)} m, oslunění ${Math.round(x.r.sun)} %`));
}

/* ---------- formuláře ---------- */
function treeOptions() {
  return app.trees.filter(t => !t.archived).sort((a, b) => (a.invNum ?? 1e9) - (b.invNum ?? 1e9)).map(t => `<option value="${esc(t.invLbl)} · ${esc(t.short)}" data-id="${t.id}">`).join("");
}
function treeFromInput(v) {
  const s = String(v || "").trim(); if (!s) return null;
  const t = app.trees.find(t => `${t.invLbl} · ${t.short}` === s) || app.trees.filter(t => !t.archived && t.invLbl === s.split(/\s|·/)[0]);
  return Array.isArray(t) ? (t.length === 1 ? t[0] : null) : t;
}
function openPosForm(o, ri, i) {
  const row = o.rows[ri], p = row.positions[i], t = p.tree ? app.byId[p.tree] : null;
  const m = modal(`<div class="mhead"><h3>Pozice ${esc(row.id)}${i}</h3><button class="btn icon" data-close>✕</button></div>
    <div class="mbody"><form class="form" id="pf">
      <label class="full">Matečný strom (genotyp)<input name="tree" list="pfTrees" value="${t ? esc(`${t.invLbl} · ${t.short}`) : ""}" placeholder="začněte psát inv. č. nebo název"><datalist id="pfTrees">${treeOptions()}</datalist><span class="hintline" id="pfInfo"></span></label>
      <label>Dodavatel<select name="supplier"><option value="">—</option>${Object.entries(o.suppliers || {}).map(([k, s]) => `<option value="${esc(k)}"${p.supplier === k ? " selected" : ""}>${esc(s.name)} (${esc(k)})</option>`).join("")}</select></label>
      <label>Poznámka<input name="note" value="${esc(p.note || "")}" placeholder="např. uhynul 2027, dosazeno"></label>
    </form></div>
    <div class="mfoot"><button class="btn danger left" id="pfDel" title="Odstranit pozici z plánu">Odstranit pozici</button><button class="btn" id="pfClear">Uvolnit</button><button class="btn" data-close>Zrušit</button><button class="btn primary" id="pfSave">Uložit</button></div>`);
  const f = m.el.querySelector("#pf");
  const info = () => { const x = treeFromInput(f.tree.value); $("pfInfo").textContent = f.tree.value && !x ? "Strom nenalezen – vyberte ze seznamu." : x ? `${x.name}${x.alt != null ? `, ${x.alt} m n. m.` : ""}` : ""; };
  f.tree.addEventListener("input", info); info();
  const setPos = async (pos, msg) => {
    const ok = await saveOrch(o.id, r => {
      const rows = r.rows.map((x, k) => k === ri ? { ...x, positions: x.positions.map((q, j) => j === i ? pos : q) } : x);
      let genotypes = r.genotypes;
      if (pos.tree && !genotypes.some(g => g.tree === pos.tree)) genotypes = [...genotypes, { tree: pos.tree, label: app.byId[pos.tree]?.short || null, color: nextColor(r), supply: {} }];
      return { rows, genotypes };
    }, msg);
    if (ok) m.close();
  };
  m.el.querySelector("#pfSave").onclick = () => {
    const x = treeFromInput(f.tree.value);
    if (f.tree.value.trim() && !x) { toast("Vyberte strom ze seznamu.", "err"); return; }
    setPos({ tree: x ? x.id : null, supplier: f.supplier.value || null, note: f.note.value.trim() || null });
  };
  m.el.querySelector("#pfClear").onclick = () => setPos({ tree: null, supplier: null, note: null }, "Pozice uvolněna.");
  m.el.querySelector("#pfDel").onclick = async () => {
    if (!await confirmBox(`Odstranit pozici ${row.id}${i}? Následující pozice v řadě se posunou.`, "Odstranit", true)) return;
    if (await saveOrch(o.id, r => ({ rows: r.rows.map((x, k) => k === ri ? { ...x, positions: x.positions.filter((_, j) => j !== i) } : x) }), "Pozice odstraněna.")) m.close();
  };
}
function addRow(o) {
  const used = new Set(o.rows.map(r => r.id)); const id = [...LETTERS].find(l => !used.has(l)) || String(o.rows.length + 1);
  saveOrch(o.id, r => ({ rows: [...r.rows, { id, label: `řada ${id}`, positions: [{ tree: null, supplier: null }] }] }), `Přidána řada ${id}.`);
}
function openRowForm(o, ri) {
  const row = o.rows[ri];
  const m = modal(`<div class="mhead"><h3>Řada ${esc(row.id)}</h3><button class="btn icon" data-close>✕</button></div>
    <div class="mbody"><form class="form" id="rf"><label>Označení (v kódech pozic)<input name="id" value="${esc(row.id)}" maxlength="3"></label><label>Popisek pod plánem<input name="label" value="${esc(row.label || "")}"></label></form></div>
    <div class="mfoot"><button class="btn danger left" id="rfDel">Odstranit řadu</button><button class="btn" data-close>Zrušit</button><button class="btn primary" id="rfSave">Uložit</button></div>`);
  const f = m.el.querySelector("#rf");
  m.el.querySelector("#rfSave").onclick = async () => {
    const id = f.id.value.trim(); if (!id) return;
    if (o.rows.some((r, k) => k !== ri && r.id === id)) { toast("Řada s tímto označením už existuje.", "err"); return; }
    if (await saveOrch(o.id, r => ({ rows: r.rows.map((x, k) => k === ri ? { ...x, id, label: f.label.value.trim() || null } : x) }))) m.close();
  };
  m.el.querySelector("#rfDel").onclick = async () => {
    if (!await confirmBox(`Odstranit celou řadu ${esc(row.id)} (${plural(row.positions.length, "pozice", "pozice", "pozic")})?`, "Odstranit", true)) return;
    if (await saveOrch(o.id, r => ({ rows: r.rows.filter((_, k) => k !== ri) }), "Řada odstraněna.")) m.close();
  };
}
function openLayoutForm(o) {
  const L_ = o.layout || {};
  const m = modal(`<div class="mhead"><h3>Popisky plánu</h3><button class="btn icon" data-close>✕</button></div>
    <div class="mbody"><form class="form" id="lf">
      <label class="full">Text nahoře<input name="top" value="${esc(L_.top || "")}" placeholder="např. ↑ sever · průjezd od souseda"></label>
      <label class="full">Text dole<input name="bottom" value="${esc(L_.bottom || "")}" placeholder="např. ↘ nájezd"></label>
      <label class="full">Mezery mezi pozicemi<input name="gaps" value="${esc((L_.gaps || []).map(g => `${g.after}${g.label ? "=" + g.label : ""}`).join("; "))}" placeholder="0=vynechaný pás; 6=cesta"><span class="hintline">číslo pozice, za kterou je mezera (v celém sadu), případně = popisek; více oddělte středníkem</span></label>
    </form></div><div class="mfoot"><button class="btn" data-close>Zrušit</button><button class="btn primary" id="lfSave">Uložit</button></div>`);
  const f = m.el.querySelector("#lf");
  m.el.querySelector("#lfSave").onclick = async () => {
    const gaps = f.gaps.value.split(";").map(s => s.trim()).filter(Boolean).map(s => { const [a, ...l] = s.split("="); return { after: parseInt(a), label: l.join("=").trim() || null }; }).filter(g => !isNaN(g.after));
    if (await saveOrch(o.id, () => ({ layout: { gaps, top: f.top.value.trim() || null, bottom: f.bottom.value.trim() || null } }))) m.close();
  };
}
function openGenoForm(o, treeId) {
  const g = geno(o, treeId), t = app.byId[treeId], used = o.rows.some(r => r.positions.some(p => p.tree === treeId));
  const sups = Object.entries(o.suppliers || {});
  const m = modal(`<div class="mhead"><h3>Genotyp – ${esc(g.label || t?.short || "")}</h3><button class="btn icon" data-close>✕</button></div>
    <div class="mbody"><form class="form" id="gf">
      <label>Název v sadu<input name="label" value="${esc(g.label || "")}"></label>
      <label>Barva v plánu<input name="color" type="color" value="${esc(g.color)}"></label>
      ${sups.map(([k, s]) => `<label>Sazenice – ${esc(s.name)}<input name="sup_${esc(k)}" value="${esc((g.supply || {})[k] || "")}" placeholder="např. 2x 150"></label>`).join("")}
    </form></div><div class="mfoot">${used ? "" : `<button class="btn danger left" id="gfDel">Odebrat ze sadu</button>`}<button class="btn" data-close>Zrušit</button><button class="btn primary" id="gfSave">Uložit</button></div>`);
  const f = m.el.querySelector("#gf");
  m.el.querySelector("#gfSave").onclick = async () => {
    const supply = Object.fromEntries(sups.map(([k]) => [k, f["sup_" + k].value.trim() || null]));
    if (await saveOrch(o.id, r => ({ genotypes: r.genotypes.map(x => x.tree === treeId ? { ...x, label: f.label.value.trim() || null, color: f.color.value, supply } : x) }))) m.close();
  };
  m.el.querySelector("#gfDel")?.addEventListener("click", async () => { if (await saveOrch(o.id, r => ({ genotypes: r.genotypes.filter(x => x.tree !== treeId) }), "Genotyp odebrán.")) m.close(); });
}
export function openOrchardForm(o) {
  const isNew = !o; const r = o || emptyOrchard();
  const m = modal(`<div class="mhead"><h3>${isNew ? "Nový sad" : "Údaje sadu"}</h3><button class="btn icon" data-close>✕</button></div>
    <div class="mbody"><form class="form" id="of">
      <label class="full">Název<input name="name" value="${esc(r.name)}" required placeholder="např. Oskerušový sad Košťálov"></label>
      <label>Obec / místo<input name="place" value="${esc(r.place || "")}"></label>
      <label>Nadmořská výška sadu (m)<input name="alt" value="${r.altRange ? r.altRange.join("–") : ""}" placeholder="např. 295–305"></label>
      <label class="full">GPS středu sadu<span class="row2"><input name="gps" value="${r.lat != null ? `${r.lat}, ${r.lon}` : ""}" style="flex:3"><button type="button" class="btn" id="ofPick">📍 v mapě</button></span></label>
      <label class="full">Dodavatelé sazenic<input name="sup" value="${esc(Object.entries(r.suppliers || {}).map(([k, s]) => `${k}=${s.name}`).join("; "))}" placeholder="Z=Zdenda; B=Buřil"><span class="hintline">zkratka=jméno, více oddělte středníkem</span></label>
      ${isNew ? `<label>Počet řad<input name="nrows" type="number" min="1" max="26" value="3"></label><label>Pozic v řadě<input name="npos" type="number" min="1" max="200" value="10"></label>` : ""}
      <label class="full">Popis<textarea name="note">${esc(r.note || "")}</textarea></label>
    </form></div>
    <div class="mfoot">${isNew ? "" : `<button class="btn danger left" id="ofArch">Vyřadit sad</button>`}<button class="btn" data-close>Zrušit</button><button class="btn primary" id="ofSave">${isNew ? "Založit sad" : "Uložit"}</button></div>`, { wide: true });
  const f = m.el.querySelector("#of");
  m.el.querySelector("#ofPick").onclick = async () => { m.wrap.style.display = "none"; const p = await app.hooks.pickOnMap(); m.wrap.style.display = ""; if (p) f.gps.value = `${p.lat}, ${p.lon}`; };
  m.el.querySelector("#ofArch")?.addEventListener("click", async () => {
    if (!await confirmBox(`Vyřadit sad „${esc(r.name)}“? Soubor zůstane ve složce katalogu.`, "Vyřadit", true)) return;
    if (await saveOrch(r.id, () => ({ archived: true }), "Sad vyřazen.")) { m.close(); app.orch = null; renderOrchards(); }
  });
  m.el.querySelector("#ofSave").onclick = async () => {
    const name = f.name.value.trim(); if (!name) { toast("Zadejte název sadu.", "err"); return; }
    const g = parseCoords(f.gps.value); if (f.gps.value.trim() && !g) { toast("Souřadnice se nepodařilo přečíst.", "err"); return; }
    const altM = f.alt.value.match(/(\d+)\D+(\d+)/) || f.alt.value.match(/(\d+)/);
    const altRange = altM ? [+altM[1], +(altM[2] || altM[1])] : null;
    const suppliers = {};
    f.sup.value.split(";").map(s => s.trim()).filter(Boolean).forEach((s, k) => { const [a, ...b] = s.split("="); const key = a.trim(); suppliers[key] = { name: b.join("=").trim() || key, color: (r.suppliers || {})[key]?.color || ["#4f6b2c", "#8a3b1f", "#c08a2b", "#3060c8"][k % 4] }; });
    const v = { name, place: f.place.value.trim() || null, note: f.note.value.trim() || null, lat: g ? g.lat : null, lon: g ? g.lon : null, altRange, suppliers };
    try {
      if (isNew) {
        const nr = Math.min(26, +f.nrows.value || 1), np = Math.min(200, +f.npos.value || 1);
        v.rows = Array.from({ length: nr }, (_, k) => ({ id: LETTERS[k], label: `řada ${LETTERS[k]}`, positions: Array.from({ length: np }, () => ({ tree: null, supplier: null })) }));
        const rec = await app.repo.create("orchard", { ...r, ...v }, app.user);
        app.orch = rec.id; editing = true; app.hooks.dataChanged(new Set([rec.id])); toast("Sad založen – v plánu můžete přiřadit genotypy.");
        m.close();
      } else if (await saveOrch(r.id, () => v, "Uloženo.")) m.close();
    } catch (e) { toast("Uložení se nepodařilo: " + esc(e.message), "err"); }
  };
}
export function initOrchards() { app.hooks.renderOrchards = renderOrchards; }
