import { app, $, esc, modal, toast, confirmBox, fmt1 } from "./util.js";
import { emptyTree, parseCoords, validateTree, hav, STATUS, newId } from "../core/model.js";
import { readExif } from "./photos.js";

const HABITATS = ["L", "S", "E", "VL", "P", "VLP", "S (E)", "E(L)"];
const num = v => { if (v == null || String(v).trim() === "") return null; const n = +String(v).replace(",", "."); return isNaN(n) ? null : n; };
const str = v => { const s = String(v ?? "").trim(); return s || null; };

function nextInv() {
  const n = app.trees.map(t => t.invNum).filter(v => v != null);
  return String((n.length ? Math.max(...n) : 0) + 1);
}

export function openTreeForm(t, preset = {}) {
  const isNew = !t;
  const r = t ? t.rec : { ...emptyTree(), inv: nextInv(), ...preset };
  const areas = [...new Set(app.trees.map(x => x.rec.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs"));
  const gpsTxt = r.lat != null ? `${r.lat}, ${r.lon}` : "";
  const m = modal(`
    <div class="mhead"><h3>${isNew ? "Nový strom" : "Upravit strom – " + esc(t.short)}</h3><button class="btn icon" data-close title="Zavřít">✕</button></div>
    <div class="mbody">
      <ul class="msgs" id="tfMsgs"></ul>
      <form class="form" id="tf" autocomplete="off">
        <label>Inventární číslo<input name="inv" value="${esc(r.inv ?? "")}"></label>
        <label>Lokalita<input name="area" list="tfAreas" value="${esc(r.area ?? "")}" placeholder="např. Bílinka"><datalist id="tfAreas">${areas.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
        <label class="full">Krátký název<input name="short" value="${esc(r.short ?? "")}" placeholder="např. Bílinka VII – Ohnivka" required></label>
        <label class="full">Celý název<input name="name" value="${esc(r.name ?? "")}" placeholder="doplní se automaticky: Oskeruše + krátký název"></label>
        <label>Místo (upřesnění)<input name="place" value="${esc(r.place ?? "")}"></label>
        <label>Pojmenování / kultivar<input name="cultivars" value="${esc((r.cultivars || []).join(", "))}" placeholder="více oddělte čárkou"></label>
        <label class="full">GPS souřadnice
          <span class="row2"><input name="gps" value="${esc(gpsTxt)}" placeholder="50.5272475, 14.0108600 nebo odkaz z Mapy.com" style="flex:3">
          <button type="button" class="btn" id="tfPick" title="Vybrat místo v mapě">📍 v mapě</button>
          <label class="btn" title="Převzít polohu z fotky (EXIF)">📷 z fotky<input type="file" id="tfPhoto" accept="image/jpeg" hidden></label></span>
          <span class="hintline" id="tfGpsInfo"></span></label>
        <label>Přesnost GPS (± m)<input name="acc" inputmode="decimal" value="${esc(r.acc ?? "")}"></label>
        <label>Nadmořská výška (m)<input name="alt" inputmode="decimal" value="${esc(r.altText || (r.alt ?? ""))}"></label>
        <label>Výška stromu (m)<input name="height" inputmode="decimal" value="${esc(r.height ?? "")}"></label>
        <label>Nasazení koruny (m)<input name="crown" inputmode="decimal" value="${esc(r.crown ?? "")}"></label>
        <label>Typ stanoviště<input name="habitat" list="tfHab" value="${esc(r.habitat ?? "")}" placeholder="L / S / E …"><datalist id="tfHab">${HABITATS.map(h => `<option value="${h}">`).join("")}</datalist></label>
        <label>Doba zrání<input name="ripening" value="${esc(r.ripening ?? "")}" placeholder="např. pol. IX."></label>
        <label class="full">Kategorie<span class="checks">${STATUS.map(([k, l]) => `<label><input type="checkbox" name="status" value="${k}"${(r.status || []).includes(k) ? " checked" : ""}> ${l}</label>`).join("")}</span></label>
        <label class="full">Poznámka<textarea name="note">${esc(r.note ?? "")}</textarea></label>
      </form>
    </div>
    <div class="mfoot">${isNew ? "" : `<button class="btn danger left" id="tfArch">${r.archived ? "Vrátit do evidence" : "Vyřadit z evidence"}</button>`}
      <button class="btn" data-close>Zrušit</button><button class="btn primary" id="tfSave">${isNew ? "Založit strom" : "Uložit"}</button></div>`, { wide: true });
  const f = m.el.querySelector("#tf");
  const read = () => {
    const fd = new FormData(f);
    const g = parseCoords(fd.get("gps"));
    const altRaw = str(fd.get("alt")); const altN = num(altRaw);
    const short = str(fd.get("short"));
    return {
      inv: str(fd.get("inv")), short, name: str(fd.get("name")) || (short ? "Oskeruše " + short : null), area: str(fd.get("area")), place: str(fd.get("place")),
      cultivars: String(fd.get("cultivars") || "").split(",").map(s => s.trim()).filter(Boolean),
      lat: g ? g.lat : null, lon: g ? g.lon : null, acc: num(fd.get("acc")),
      alt: altN != null ? Math.round(altN) : (altRaw && /\d/.test(altRaw) ? parseInt(altRaw) : null), altText: altN == null && altRaw ? altRaw : null,
      height: num(fd.get("height")), crown: num(fd.get("crown")), habitat: str(fd.get("habitat")), ripening: str(fd.get("ripening")),
      status: fd.getAll("status"), note: str(fd.get("note")),
      _gpsBad: !!String(fd.get("gps") || "").trim() && !g,
    };
  };
  const check = () => {
    const v = read(); const msgs = validateTree({ ...r, ...v }, app.trees.map(x => x.rec));
    if (v._gpsBad) msgs.unshift({ lvl: "err", msg: "Souřadnice se nepodařilo přečíst." });
    if (v.lat != null) {
      const near = app.trees.filter(o => o.id !== r.id && o.has && !o.archived).map(o => ({ o, d: hav(v, o) })).filter(x => x.d < 0.03).sort((a, b) => a.d - b.d);
      if (near.length) msgs.push({ lvl: "warn", msg: `Do 30 m je už evidovaný strom: ${near.slice(0, 3).map(x => `<a href="#" data-near="${x.o.id}" style="color:inherit">${esc(x.o.invLbl)} ${esc(x.o.short)}</a> (${Math.round(x.d * 1000)} m)`).join(", ")}. Není to tentýž?` });
      $("tfGpsInfo").textContent = `${v.lat.toFixed(7)} N, ${v.lon.toFixed(7)} E`;
    } else $("tfGpsInfo").textContent = "";
    $("tfMsgs").innerHTML = msgs.map(x => `<li class="${x.lvl}">${x.lvl === "err" || x.msg.includes("<a") ? x.msg : esc(x.msg)}</li>`).join("");
    $("tfMsgs").querySelectorAll("[data-near]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); m.close(); app.hooks.select(a.dataset.near, { fly: true }); }));
    return { v, msgs };
  };
  f.addEventListener("input", check); check();
  m.el.querySelector("#tfPick").addEventListener("click", async () => {
    m.wrap.style.display = "none";
    const p = await app.hooks.pickOnMap();
    m.wrap.style.display = "";
    if (p) { f.gps.value = `${p.lat}, ${p.lon}`; check(); }
  });
  m.el.querySelector("#tfPhoto").addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return;
    const ex = readExif(await file.arrayBuffer());
    if (ex.gps) { f.gps.value = `${ex.gps.lat}, ${ex.gps.lon}`; check(); toast("Poloha převzata z fotky."); }
    else toast("Fotka neobsahuje polohu GPS.", "err");
    e.target.value = "";
  });
  m.el.querySelector("#tfArch")?.addEventListener("click", async () => {
    const arch = !r.archived;
    if (arch && !await confirmBox(`Vyřadit strom „${esc(t.short)}“ z evidence? Zůstane uložený a dá se vrátit (filtr „vyřazené“).`, "Vyřadit", true)) return;
    if (await app.hooks.saveTree(t.id, () => ({ archived: arch }), arch ? "Strom vyřazen z evidence." : "Strom vrácen do evidence.")) m.close();
  });
  m.el.querySelector("#tfSave").addEventListener("click", async () => {
    const { v, msgs } = check();
    if (msgs.some(x => x.lvl === "err")) { toast("Opravte prosím chyby ve formuláři.", "err"); return; }
    delete v._gpsBad;
    const btn = m.el.querySelector("#tfSave"); btn.disabled = true;
    try {
      if (isNew) {
        const rec = await app.repo.create("tree", { ...emptyTree(r.id), ...v, measurements: r.measurements || [], photos: [] }, app.user);
        app.hooks.dataChanged(new Set([rec.id]));
        m.close(); app.hooks.select(rec.id, { fly: true }); toast("Strom založen.");
      } else {
        if (await app.hooks.saveTree(t.id, () => v, "Uloženo.")) m.close();
      }
    } catch (e) { toast("Uložení se nepodařilo: " + esc(e.message), "err"); }
    btn.disabled = false;
  });
}
