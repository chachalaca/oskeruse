import { live } from "../core/model.js";

// sdílený stav aplikace
export const app = {
  repo: null, readOnly: false, user: "", folderName: "",
  trees: [], byId: {}, orchards: [], byOrch: {},
  sel: null, orch: null, tab: "vMap",
  hooks: {},           // funkce registrované jednotlivými částmi UI (vzájemné volání bez cyklických importů)
};
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmt1 = v => v.toFixed(1).replace(".", ",");
export const fmtN = v => v == null ? "—" : String(Math.round(v * 10) / 10).replace(".", ",");
export const plural = (n, a, b, c) => `${n} ${n === 1 ? a : n > 1 && n < 5 ? b : c}`;
export function txtOn(c) { let r, g, b; if (c.startsWith("rgb")) { [r, g, b] = c.match(/\d+/g).map(Number); } else { r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16); } return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#222" : "#fff"; }
export function ramp(stops, f) { f = Math.max(0, Math.min(1, f)) * (stops.length - 1); const i = Math.min(stops.length - 2, Math.floor(f)), r = f - i; return `rgb(${stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * r))})`; }
export const R_OBV = [[255, 247, 188], [254, 196, 79], [236, 112, 20], [153, 52, 4], [90, 30, 4]];
export const R_ALT = [[255, 237, 160], [161, 218, 180], [65, 182, 196], [34, 94, 168], [12, 44, 132]];
export const R_YEAR = [[237, 248, 233], [161, 217, 155], [65, 171, 93], [0, 90, 50]];
export const OBV_MAX = 320, NODATA = "#d6d0c4";
export const TYP_GROUPS = [["L", "L – lesní", "#2e8b57"], ["S", "S – solitéra", "#e0861a"], ["E", "E", "#3060c8"], ["X", "ostatní (VL, P, …)", "#a8329a"], ["", "neuvedeno", "#cfc8b8"]];
export const TYP_COL = Object.fromEntries(TYP_GROUPS.map(g => [g[0], g[2]]));
export const CATS = [["památná", "památná", "#8a3b1f"], ["pojmenovaná", "pojmenovaná (kultivar)", "#e0861a"], ["mladá", "mladý strom / výsadba", "#2e8b57"], ["zaniklá", "zaniklá / nenalezena", "#777"], ["", "ostatní", "#cfc8b8"]];
// paleta pro genotypy v sadu (tab20, jako v původním plánu)
export const TAB20 = ["#1f77b4", "#aec7e8", "#ff7f0e", "#ffbb78", "#2ca02c", "#98df8a", "#d62728", "#ff9896", "#9467bd", "#c5b0d5", "#8c564b", "#c49c94", "#e377c2", "#f7b6d2", "#7f7f7f", "#c7c7c7", "#bcbd22", "#dbdb8d", "#17becf", "#9edae5"];
function typGroup(typ) { if (!typ) return ""; return typ === "L" || typ === "S" || typ === "E" ? typ : (/^S \(E\)$/.test(typ) ? "S" : /^E\(L\)$/.test(typ) ? "E" : "X"); }

// záznam ze souboru → objekt pro zobrazení (odvozené hodnoty)
export function derive(rec) {
  const t = { rec, id: rec.id, inv: rec.inv ?? null, name: rec.name || rec.short || "(bez názvu)", short: rec.short || rec.name || "(bez názvu)",
    area: rec.area || "(bez lokality)", cv: rec.cultivars && rec.cultivars.length ? rec.cultivars : null, acc: rec.acc ?? null,
    alt: rec.alt ?? null, altTxt: rec.altText ?? null, h: rec.height ?? null, kor: rec.crown ?? null, typ: rec.habitat ?? null,
    zr: rec.ripening ?? null, note: rec.note ?? null, st: [...(rec.status || [])], archived: !!rec.archived };
  t.invNum = t.inv ? parseInt(t.inv) : null; if (isNaN(t.invNum)) t.invNum = null;
  t.invLbl = t.inv ? String(t.inv) : "—";
  t.has = rec.lat != null && rec.lon != null; if (t.has) { t.lat = rec.lat; t.lon = rec.lon; }
  t.meas = live(rec.measurements).slice().sort((a, b) => (a.year || 0) - (b.year || 0));
  const ms = t.meas.filter(m => m.eq);
  const last = ms[ms.length - 1];
  t.obv = last ? last.eq : null; t.obvTxt = last ? last.text : null; t.obvYear = last ? last.year : null; t.stemsN = last ? (last.stems || []).length : null; t.obvApprox = last ? !!last.approx : false;
  t.lastYear = Math.max(0, ...t.meas.map(m => m.year || 0)) || null;
  const ok = ms.filter(m => m.year && !m.approx);
  t.growth = null;
  if (ok.length >= 2) { const a = ok[0], b = ok[ok.length - 1]; if (b.year - a.year >= 3 && (b.stems || []).length === (a.stems || []).length) t.growth = (b.eq - a.eq) / (b.year - a.year); }
  t.cat = CATS.find(c => c[0] && (t.st.includes(c[0]) || (c[0] === "zaniklá" && t.st.includes("nenalezena"))))?.[0] || "";
  t.tg = typGroup(t.typ);
  t.photos = live(rec.photos);
  t.search = (t.invLbl + " " + t.name + " " + (t.note || "") + " " + t.area + " " + (t.cv || []).join(" ")).toLowerCase();
  return t;
}
export function fmtGPS(t) { return `${t.lat.toFixed(7)}N, ${t.lon.toFixed(7)}E`; }
export function obvStr(t) { return t.obv ? (t.stemsN > 1 ? `${t.obvTxt} cm` : `${t.obvApprox ? "cca " : ""}${Math.round(t.obv)} cm`) : "—"; }

/* ---------- drobné UI ---------- */
let toastT = null;
export function toast(msg, kind = "") {
  const el = $("toast"); el.innerHTML = msg; el.className = "toast on " + kind;
  clearTimeout(toastT); toastT = setTimeout(() => el.className = "toast", kind === "err" ? 7000 : 3500);
}
// modální dialog: vrací element obsahu; close() zavře
export function modal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement("div"); wrap.className = "modal-bg";
  wrap.innerHTML = `<div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); document.removeEventListener("keydown", key); onClose && onClose(); };
  const key = e => { if (e.key === "Escape" && document.body.lastElementChild === wrap) close(); };
  document.addEventListener("keydown", key);
  wrap.addEventListener("mousedown", e => { if (e.target === wrap) close(); });
  wrap.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
  const first = wrap.querySelector("input,select,textarea"); if (first) setTimeout(() => first.focus(), 30);
  return { el: wrap.firstElementChild, close, wrap };
}
export function confirmBox(msg, ok = "Ano", danger = false) {
  return new Promise(res => {
    const m = modal(`<div class="mbody"><p style="margin:0 0 4px">${msg}</p></div><div class="mfoot"><button class="btn" data-close>Zpět</button><button class="btn ${danger ? "danger" : "primary"}" id="cfOk">${ok}</button></div>`, { onClose: () => res(false) });
    m.el.querySelector("#cfOk").addEventListener("click", () => { res(true); m.wrap.remove(); });
  });
}
export const NS = "http://www.w3.org/2000/svg";
export function svgEl(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
