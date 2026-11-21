import { app, $, esc, toast, confirmBox } from "./util.js";
import { newId, live, PHOTO_KINDS } from "../core/model.js";

/* ---------- načítání obrázků ze složky ---------- */
const urls = new Map(); // cesta → object URL
export async function photoURL(path) {
  if (urls.has(path)) return urls.get(path);
  const p = app.repo.photoFile(path).then(f => URL.createObjectURL(f));
  urls.set(path, p);
  try { return await p; } catch (e) { urls.delete(path); throw e; }
}
export function forgetPhotoURLs() { for (const p of urls.values()) Promise.resolve(p).then(u => URL.revokeObjectURL(u), () => {}); urls.clear(); }
// doplní src u <img data-photo="cesta"> v daném prvku
export function hydrate(root) {
  root.querySelectorAll("img[data-photo]").forEach(img => {
    const path = img.dataset.photo; img.removeAttribute("data-photo");
    photoURL(path).then(u => { img.src = u; }, () => { img.alt = "fotografie chybí ve složce"; img.closest("button")?.classList.add("missing"); });
  });
}

/* ---------- galerie v detailu stromu ---------- */
const count = n => n === 1 ? "1 foto" : n < 5 ? `${n} fotky` : `${n} fotek`;
export function photoSection(t) {
  const p = { tree: t.photos.filter(x => x.kind !== "fruit"), fruit: t.photos.filter(x => x.kind === "fruit") };
  const gal = k => {
    const a = p[k];
    if (!a.length) return `<div class="gal-h"><b>${PHOTO_KINDS[k]}</b><span>bez fotografie</span></div>`;
    return `<div class="gal-h"><b>${PHOTO_KINDS[k]}</b><span>${count(a.length)}</span></div>
      <div class="gal ${a.length === 1 ? "one" : a.length === 2 ? "two" : ""}">${a.map(x => `<button data-ph="${x.id}" title="${esc(x.caption || "")}"><img data-photo="${esc(a.length === 1 ? x.file : x.thumb || x.file)}" alt="${PHOTO_KINDS[k]}${x.caption ? " – " + esc(x.caption) : ""}" loading="lazy"></button>`).join("")}</div>`;
  };
  const drop = app.readOnly ? "" : `<div class="dropzone" id="phDrop">Přetáhněte sem fotky nebo <label>vyberte soubory<input type="file" id="phInput" accept="image/*" multiple hidden></label> · přidat jako
     <select id="phKind" style="font:inherit;font-size:12px;padding:1px 4px;border:1px solid var(--line);border-radius:5px"><option value="tree">strom</option><option value="fruit">plody</option></select><div id="phProg" class="muted"></div></div>`;
  if (!t.photos.length && app.readOnly) return "";
  return `<section><h4>Fotografie</h4>${t.photos.length ? gal("tree") + gal("fruit") : `<div class="muted" style="font-size:12.5px">Zatím žádné fotografie.</div>`}${drop}</section>`;
}
export function bindPhotoSection(el, t) {
  hydrate(el);
  el.querySelectorAll("[data-ph]").forEach(b => b.addEventListener("click", () => openLightbox(t.id, b.dataset.ph)));
  const dz = el.querySelector("#phDrop"); if (!dz) return;
  const inp = el.querySelector("#phInput");
  inp.addEventListener("change", () => { addPhotos(t.id, [...inp.files], el.querySelector("#phKind").value); inp.value = ""; });
  dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("over"); addPhotos(t.id, [...e.dataTransfer.files].filter(f => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name)), el.querySelector("#phKind").value); });
}

/* ---------- zpracování nových fotek ---------- */
export async function addPhotos(treeId, files, kind) {
  if (!files.length) return;
  const prog = $("phProg"); const added = []; const failed = [];
  for (const [i, f] of files.entries()) {
    if (prog) prog.textContent = `Zpracovávám ${i + 1} z ${files.length}…`;
    try {
      const pr = await processImage(f);
      const id = newId(8), file = `foto/${treeId}/${id}.webp`, thumb = `foto/${treeId}/${id}.t.webp`;
      await app.repo.writePhoto(treeId, `${id}.webp`, pr.display.blob);
      await app.repo.writePhoto(treeId, `${id}.t.webp`, pr.thumb.blob);
      added.push({ id, kind, file, thumb, caption: null, date: pr.exif.date || null, w: pr.display.w, h: pr.display.h, author: app.user || null, gps: pr.exif.gps || null, original: f.name });
    } catch (e) { console.error(e); failed.push(`${f.name}: ${e.message}`); }
  }
  if (added.length) await app.hooks.saveTree(treeId, r => ({ photos: [...live(r.photos), ...added] }), `Přidáno ${count(added.length)}.`);
  if (failed.length) toast("Některé fotky se nepodařilo zpracovat:<br>" + failed.map(esc).join("<br>"), "err");
  if (prog) prog.textContent = "";
}
export async function processImage(file) {
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) throw new Error("formát HEIC prohlížeč neumí – v telefonu nastavte fotky jako JPG (Nejkompatibilnější)");
  const buf = await file.arrayBuffer();
  const exif = readExif(buf);
  const bmp = await createImageBitmap(new Blob([buf], { type: file.type }), { imageOrientation: "from-image" });
  const make = async (max, q) => {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d"); ctx.imageSmoothingQuality = "high"; ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, "image/webp", q));
    if (!blob || blob.type !== "image/webp") throw new Error("prohlížeč neumí uložit WebP (použijte Chrome nebo Edge)");
    return { blob, w, h };
  };
  const out = { display: await make(1600, .72), thumb: await make(320, .65), exif };
  bmp.close && bmp.close();
  return out;
}
// minimální čtečka EXIF (JPEG): datum pořízení a GPS
export function readExif(buf) {
  const res = {};
  try {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return res;
    let o = 2;
    while (o < v.byteLength - 4) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) { parseTiff(v, o + 10, res); break; }
      if ((m & 0xFF00) !== 0xFF00) break; o += 2 + len;
    }
  } catch (e) {}
  return res;
}
function parseTiff(v, t, res) {
  const le = v.getUint16(t) === 0x4949, u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
  const ifd = (off, cb) => { const n = u16(t + off); for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; cb(u16(e), u16(e + 2), u32(e + 4), e + 8); } };
  const str = (p, n) => { let s = ""; for (let i = 0; i < n - 1; i++) s += String.fromCharCode(v.getUint8(p + i)); return s; };
  const rat = p => u32(p) / (u32(p + 4) || 1);
  let exifOff = null, gpsOff = null;
  ifd(u32(t + 4), (tag, type, cnt, vp) => { if (tag === 0x8769) exifOff = u32(vp); if (tag === 0x8825) gpsOff = u32(vp); if (tag === 0x0132 && !res.date) res.date = fmtDate(str(t + u32(vp), cnt)); });
  if (exifOff) ifd(exifOff, (tag, type, cnt, vp) => { if (tag === 0x9003) res.date = fmtDate(str(t + u32(vp), cnt)); });
  if (gpsOff) {
    const g = {};
    ifd(gpsOff, (tag, type, cnt, vp) => {
      if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(vp));
      if ((tag === 2 || tag === 4) && cnt === 3) { const p = t + u32(vp); g[tag] = rat(p) + rat(p + 8) / 60 + rat(p + 16) / 3600; }
    });
    if (g[2] != null && g[4] != null) res.gps = { lat: +(g[1] === "S" ? -g[2] : g[2]).toFixed(7), lon: +(g[3] === "W" ? -g[4] : g[4]).toFixed(7) };
  }
}
const fmtDate = s => /^\d{4}:\d\d:\d\d/.test(s) ? s.slice(0, 10).replace(/:/g, "-") : null;

/* ---------- prohlížeč fotek ---------- */
let lb = { tree: null, i: 0, list: [] };
export function openLightbox(treeId, photoId) {
  const t = app.byId[treeId]; if (!t) return;
  lb.tree = treeId;
  lb.list = [...t.photos.filter(x => x.kind !== "fruit"), ...t.photos.filter(x => x.kind === "fruit")];
  lb.i = Math.max(0, lb.list.findIndex(p => p.id === photoId));
  showLb(); $("lb").classList.add("on");
}
function showLb() {
  const t = app.byId[lb.tree]; const x = lb.list[lb.i]; if (!t || !x) return closeLb();
  const img = $("lbImg"); img.removeAttribute("src"); img.alt = x.caption || "";
  photoURL(x.file).then(u => { if (lb.list[lb.i] === x) img.src = u; }, () => { img.alt = "Soubor fotografie ve složce chybí."; });
  const extra = x.caption && !(t.short + " " + t.name).toLowerCase().includes(x.caption.replace(/´/g, "").toLowerCase()) ? ` – ${esc(x.caption)}` : "";
  $("lbCap").innerHTML = `<span><b>${PHOTO_KINDS[x.kind] || "Foto"}</b> · ${esc(t.invLbl)} ${esc(t.short)}${extra}${x.date ? ` · ${new Date(x.date).toLocaleDateString("cs-CZ")}` : ""}${x.author ? ` · ${esc(x.author)}` : ""}</span><span class="n">${lb.i + 1} / ${lb.list.length}</span>
    ${app.readOnly ? "" : `<button class="btn" id="lbKind">změnit na ${x.kind === "fruit" ? "strom" : "plody"}</button><button class="btn" id="lbCaption">popis</button><button class="btn" id="lbDel">smazat</button>`}`;
  $("lbPrev").style.display = $("lbNext").style.display = lb.list.length > 1 ? "" : "none";
  $("lbKind")?.addEventListener("click", () => updatePhoto(x.id, { kind: x.kind === "fruit" ? "tree" : "fruit" }));
  $("lbCaption")?.addEventListener("click", () => { const c = prompt("Popis fotografie:", x.caption || ""); if (c !== null) updatePhoto(x.id, { caption: c.trim() || null }); });
  $("lbDel")?.addEventListener("click", async () => {
    if (!await confirmBox("Smazat tuto fotografii z katalogu?", "Smazat", true)) return;
    const ok = await app.hooks.saveTree(lb.tree, r => ({ photos: live(r.photos).filter(p => p.id !== x.id) }), "Fotografie smazána.");
    if (ok) { await app.repo.removePhotoFile(x.file); if (x.thumb) await app.repo.removePhotoFile(x.thumb); reopen(); }
  });
}
async function updatePhoto(pid, patch) {
  const ok = await app.hooks.saveTree(lb.tree, r => ({ photos: live(r.photos).map(p => p.id === pid ? { ...p, ...patch } : p) }));
  if (ok) reopen(pid);
}
function reopen(pid) {
  const t = app.byId[lb.tree]; if (!t || !t.photos.length) return closeLb();
  const cur = pid || lb.list[Math.min(lb.i, lb.list.length - 2)]?.id;
  openLightbox(lb.tree, cur);
}
function closeLb() { $("lb").classList.remove("on"); }
export function initLightbox() {
  $("lbX").onclick = closeLb;
  $("lbPrev").onclick = () => { lb.i = (lb.i - 1 + lb.list.length) % lb.list.length; showLb(); };
  $("lbNext").onclick = () => { lb.i = (lb.i + 1) % lb.list.length; showLb(); };
  $("lb").addEventListener("click", e => { if (e.target.id === "lb") closeLb(); });
  document.addEventListener("keydown", e => {
    if (!$("lb").classList.contains("on") || document.querySelector(".modal-bg")) return;
    if (e.key === "Escape") closeLb(); else if (e.key === "ArrowLeft") $("lbPrev").click(); else if (e.key === "ArrowRight") $("lbNext").click();
  });
}
