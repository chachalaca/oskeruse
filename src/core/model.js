// Datový model katalogu – čisté funkce bez DOM, sdílené aplikací v prohlížeči i nástroji v Node.
//
// Uložení na disku (složka synchronizovaná Syncthingem):
//   oskeruse.json            značka složky katalogu
//   stromy/<id>.json         jeden soubor = jeden strom
//   sady/<id>.json           jeden soubor = jeden sad (výsadba)
//   foto/<id stromu>/<id fotky>.webp      zobrazovací velikost
//   foto/<id stromu>/<id fotky>.t.webp    náhled
//
// Každý záznam nese časové značky jednotlivých polí (_ts). Díky nim lze dvě verze téhož
// souboru (např. konfliktní kopii od Syncthingu) sloučit automaticky: u každého pole vyhrává
// novější změna. Položky seznamů s id (měření, fotky) se slučují po položkách, smazání je
// záznam "deleted" (tombstone), aby se smazaná položka při slučování nevrátila.

export const SCHEMA = 1;
export const APP_MARKER = "oskeruse.json";
export const DIRS = { tree: "stromy", orchard: "sady", photo: "foto" };

// pole s identifikovanými položkami – slučují se po položkách
const COLLECTIONS = { tree: ["measurements", "photos"], orchard: [] };
const META = new Set(["schema", "type", "id", "_ts", "updated", "updatedBy", "created", "createdBy", "history"]);
const HISTORY_MAX = 60;

// pořadí klíčů v souboru (pro čitelnost a stabilní diffy)
const ORDER = {
  tree: ["schema", "type", "id", "inv", "name", "short", "area", "place", "cultivars", "lat", "lon", "acc", "alt", "altText",
    "height", "crown", "habitat", "ripening", "status", "archived", "note", "measurements", "photos", "site", "legacy",
    "created", "createdBy", "updated", "updatedBy", "_ts", "history"],
  orchard: ["schema", "type", "id", "name", "place", "lat", "lon", "altRange", "note", "suppliers", "genotypes", "rows", "layout",
    "archived", "created", "createdBy", "updated", "updatedBy", "_ts", "history"],
};

export const STATUS = [
  ["pojmenovaná", "pojmenovaná"], ["památná", "památná"], ["mladá", "mladý strom / výsadba"],
  ["poškozená", "poškozená"], ["zaniklá", "zaniklá"], ["nenalezena", "nenalezena"],
];
export const PHOTO_KINDS = { tree: "Strom", fruit: "Plody" };

/* ---------------- id a čas ---------------- */
const B32 = "abcdefghijkmnpqrstuvwxyz23456789"; // bez l, o, 0, 1
export function newId(n = 10) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  let s = ""; for (const x of b) s += B32[x % 32];
  return s;
}
export const nowISO = () => new Date().toISOString();

/* ---------------- nové záznamy ---------------- */
export function emptyTree(id = newId()) {
  return { schema: SCHEMA, type: "tree", id, inv: null, name: "", short: "", area: "", place: null, cultivars: [],
    lat: null, lon: null, acc: null, alt: null, altText: null, height: null, crown: null, habitat: null, ripening: null,
    status: [], archived: false, note: null, measurements: [], photos: [], site: null, _ts: {}, history: [] };
}
export function emptyOrchard(id = newId()) {
  return { schema: SCHEMA, type: "orchard", id, name: "", place: null, lat: null, lon: null, altRange: null, note: null,
    suppliers: {}, genotypes: [], rows: [], layout: { gaps: [], top: null, bottom: null }, archived: false, _ts: {}, history: [] };
}

/* ---------------- obvod kmene ---------------- */
// "170" | "105+97+36" | "cca 200" | "2x 150" → {stems:[...], eq, approx}
export function parseCirc(text) {
  if (text == null) return null;
  const s = String(text).replace(/,/g, ".").trim();
  if (!s) return null;
  const approx = /cca|~|asi|odhad/i.test(s) || null;
  const stems = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter(v => v > 0 && v < 2000);
  if (!stems.length) return { stems: [], eq: null, approx };
  const eq = Math.round(Math.sqrt(stems.reduce((a, c) => a + c * c, 0)));
  return { stems, eq, approx };
}

/* ---------------- souřadnice ---------------- */
// přijme "50.5272475N, 14.0108600E", "50.52 14.01", "50°31'38.1\"N 14°0'39.1\"E", odkaz mapy.cz / Google
export function parseCoords(input) {
  if (!input) return null;
  let s = String(input).trim();
  const url = s.match(/[?&](?:x=)(-?\d+\.\d+).*?[?&]y=(-?\d+\.\d+)/); // mapy.cz: x=lon, y=lat
  if (url) return check(+url[2], +url[1]);
  const g = s.match(/(?:query=|@|q=)(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (g) return check(+g[1], +g[2]);
  const dms = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|''))?\s*([NSEWVZJ])?/gi)];
  if (dms.length >= 2) {
    const v = dms.slice(0, 2).map(m => {
      let d = +m[1].replace(",", ".") + (m[2] ? +m[2].replace(",", ".") / 60 : 0) + (m[3] ? +m[3].replace(",", ".") / 3600 : 0);
      if (m[4] && /[SWZ]/i.test(m[4])) d = -d;
      return { d, h: (m[4] || "").toUpperCase() };
    });
    if (/[EV]/.test(v[0].h) || /[N]/.test(v[1].h)) return check(v[1].d, v[0].d);
    return check(v[0].d, v[1].d);
  }
  const nums = s.replace(/(\d),(\d)/g, "$1.$2").match(/-?\d+(?:\.\d+)?/g);
  if (nums && nums.length >= 2) {
    let a = +nums[0], b = +nums[1];
    if (/^\s*-?\d+(?:\.\d+)?\s*[EV]/i.test(s)) [a, b] = [b, a];
    return check(a, b);
  }
  return null;
  function check(lat, lon) {
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
    if (lat < 40 && lon > 40) [lat, lon] = [lon, lat]; // prohozené pořadí (ČR)
    return { lat: +lat.toFixed(7), lon: +lon.toFixed(7) };
  }
}

export function hav(a, b) {
  const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/* ---------------- úpravy se značkami ---------------- */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Aplikuje změny polí (patch) na záznam, označí čas změny jednotlivých polí a zapíše historii.
// Položky kolekcí (měření, fotky) dostanou vlastní značku ts.
export function applyPatch(rec, patch, who, now = nowISO()) {
  const out = structuredClone(rec);
  out._ts = out._ts || {}; out.history = out.history || [];
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (META.has(k)) continue;
    if (COLLECTIONS[rec.type]?.includes(k)) {
      const old = new Map((out[k] || []).map(i => [i.id, i]));
      const next = (v || []).map(i => {
        const o = old.get(i.id); const { ts, ...a } = i; const { ts: ots, ...b } = o || {};
        return o && same(a, b) ? o : { ...i, ts: now };
      });
      // položky, které v novém seznamu chybí, se označí jako smazané
      for (const [id, o] of old) if (!next.some(i => i.id === id) && !o.deleted) next.push({ id, deleted: true, ts: now });
      for (const [id, o] of old) if (o.deleted && !next.some(i => i.id === id)) next.push(o);
      if (!same(next, out[k])) { out[k] = next; changed.push(k); }
      continue;
    }
    if (!same(out[k], v)) { out[k] = v ?? null; out._ts[k] = now; changed.push(k); }
  }
  if (!changed.length) return { rec, changed };
  out.updated = now; out.updatedBy = who || null;
  if (!out.created) { out.created = now; out.createdBy = who || null; }
  out.history = [...out.history, { at: now, by: who || null, fields: changed }].slice(-HISTORY_MAX);
  return { rec: out, changed };
}

// živé položky kolekce (bez smazaných)
export const live = arr => (arr || []).filter(i => !i.deleted);

/* ---------------- slučování dvou verzí ---------------- */
const tsOf = (r, k) => (r._ts && r._ts[k]) || "";
// deterministické: obě strany dojdou ke stejnému výsledku bez ohledu na pořadí
function pick(a, b, ta, tb) {
  if (ta !== tb) return ta > tb ? a : b;
  return JSON.stringify(a ?? null) >= JSON.stringify(b ?? null) ? a : b;
}
export function mergeRecords(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.id !== b.id) throw new Error(`Nelze sloučit různé záznamy ${a.id} a ${b.id}`);
  const type = a.type || b.type;
  const out = { ...a, _ts: { ...(a._ts || {}) } };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (META.has(k)) continue;
    if (COLLECTIONS[type]?.includes(k)) {
      const m = new Map();
      for (const i of [...(a[k] || []), ...(b[k] || [])]) {
        const o = m.get(i.id);
        m.set(i.id, o ? pick(o, i, o.ts || "", i.ts || "") : i);
      }
      const order = [...(a[k] || []), ...(b[k] || [])].map(i => i.id);
      out[k] = [...new Set(order)].map(id => m.get(id));
      continue;
    }
    const ta = tsOf(a, k), tb = tsOf(b, k);
    out[k] = pick(a[k], b[k], ta, tb) ?? null;
    const t = ta > tb ? ta : tb; if (t) out._ts[k] = t;
  }
  out.updated = (a.updated || "") > (b.updated || "") ? a.updated : b.updated;
  out.updatedBy = out.updated === a.updated ? a.updatedBy : b.updatedBy;
  out.created = [a.created, b.created].filter(Boolean).sort()[0] || null;
  const h = new Map();
  for (const e of [...(a.history || []), ...(b.history || [])]) h.set(e.at + "|" + e.by + "|" + e.fields.join(","), e);
  out.history = [...h.values()].sort((x, y) => x.at < y.at ? -1 : 1).slice(-HISTORY_MAX);
  return out;
}

/* ---------------- serializace ---------------- */
export function serialize(rec) {
  const order = ORDER[rec.type] || [];
  const o = {};
  for (const k of order) if (k in rec) o[k] = rec[k];
  for (const k of Object.keys(rec).sort()) if (!(k in o)) o[k] = rec[k];
  return JSON.stringify(o, null, 1) + "\n";
}
export function parseRecord(text, path) {
  let r;
  try { r = JSON.parse(text); } catch (e) { throw new Error(`${path}: neplatný JSON (${e.message})`); }
  if (!r || typeof r !== "object" || !r.id || !r.type) throw new Error(`${path}: chybí id nebo typ záznamu`);
  if (r.schema > SCHEMA) throw new Error(`${path}: záznam je z novější verze aplikace (schéma ${r.schema}) – aktualizujte aplikaci`);
  return upgrade(r);
}
// převod starších verzí formátu (zatím jen jedna verze)
function upgrade(r) { return r; }

// Syncthing pojmenovává konfliktní kopie "<jméno>.sync-conflict-20261121-101500-ABCDEFG.json"
export const CONFLICT_RE = /^(.+?)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\.[^.]+)?$/;
export function conflictBase(name) { const m = name.match(CONFLICT_RE); return m ? m[1] + (m[2] || "") : null; }
export const isTempName = n => n.startsWith(".") || n.startsWith("~") || n.endsWith(".tmp") || n.endsWith(".crswap");

/* ---------------- kontrola záznamu ---------------- */
export function validateTree(r, all = []) {
  const e = [];
  if (!r.name && !r.short) e.push({ lvl: "err", f: "name", msg: "Chybí název stromu." });
  if ((r.lat == null) !== (r.lon == null)) e.push({ lvl: "err", f: "gps", msg: "Souřadnice jsou neúplné." });
  if (r.lat != null && !(r.lat > 48.4 && r.lat < 51.2 && r.lon > 12 && r.lon < 19)) e.push({ lvl: "warn", f: "gps", msg: "Souřadnice leží mimo Českou republiku." });
  if (r.inv) {
    const dup = all.filter(o => o.id !== r.id && !o.archived && o.inv && String(o.inv).trim() === String(r.inv).trim());
    if (dup.length) e.push({ lvl: "warn", f: "inv", msg: `Inventární číslo ${r.inv} už má: ${dup.map(d => d.short || d.name).join(", ")}.` });
  }
  if (r.alt != null && !(r.alt > 100 && r.alt < 1000)) e.push({ lvl: "warn", f: "alt", msg: "Nadmořská výška vypadá neobvykle." });
  if (r.height != null && !(r.height > 0 && r.height < 40)) e.push({ lvl: "warn", f: "height", msg: "Výška stromu vypadá neobvykle." });
  for (const m of live(r.measurements)) {
    if (m.eq != null && !(m.eq > 0 && m.eq < 800)) e.push({ lvl: "warn", f: "measurements", msg: `Měření ${m.year || ""}: obvod ${m.text} vypadá neobvykle.` });
  }
  return e;
}
