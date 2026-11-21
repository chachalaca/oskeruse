import { app, $, esc } from "./util.js";
import { validateTree, live } from "../core/model.js";

let photoReport = null;
export function checkSummary() {
  const R = app.repo; if (!R) return { n: 0 };
  const inv = new Map();
  app.trees.filter(t => !t.archived && t.inv).forEach(t => { const k = String(t.inv).trim(); (inv.get(k) || inv.set(k, []).get(k)).push(t); });
  const dups = [...inv.entries()].filter(([, a]) => a.length > 1);
  const brokenRefs = [];
  app.orchards.forEach(o => o.rows.forEach(r => r.positions.forEach((p, i) => { if (p.tree && !app.byId[p.tree]) brokenRefs.push({ o, code: r.id + i }); })));
  const n = R.errors.length + R.conflicts.length + dups.length + brokenRefs.length;
  return { n, dups, brokenRefs };
}
export function updateBadge() { const s = checkSummary(); $("checkBadge").textContent = s.n || ""; }

export function renderCheck() {
  const R = app.repo, s = checkSummary();
  const link = t => `<a data-id="${t.id}">${esc(t.invLbl)} · ${esc(t.short)}</a>`;
  const warn = app.trees.filter(t => !t.archived).map(t => ({ t, e: validateTree(t.rec, []).filter(x => x.f !== "inv") })).filter(x => x.e.length);
  const noGps = app.trees.filter(t => !t.archived && !t.has);
  const section = (title, items, okText) => `<h3>${title}</h3>${items.length ? `<ul>${items.join("")}</ul>` : `<p class="ok">✓ ${okText}</p>`}`;
  $("checkWrap").innerHTML = `<div class="check">
    <p class="muted" style="font-size:12.5px;margin-top:4px">Složka: <b>${esc(app.folderName)}</b> · ${app.trees.length} souborů stromů · ${app.orchards.length} sadů${app.readOnly ? " · <b>jen pro čtení</b>" : ""}.
      Konfliktní kopie od Syncthingu se slučují automaticky při načtení; tady zůstávají jen ty, které sloučit nešlo.</p>
    ${section("Soubory, které nejde načíst", R.errors.map(e => `<li><code>${esc(e.path)}</code> – ${esc(e.msg)}</li>`), "Všechny soubory jsou v pořádku.")}
    ${section("Nesloučené konfliktní kopie", R.conflicts.map(c => `<li><code>${esc(c.dir)}/${esc(c.name)}</code>${app.readOnly ? " (v režimu jen pro čtení se neslučují)" : ""}</li>`), "Žádné konflikty.")}
    ${section("Duplicitní inventární čísla", s.dups.map(([k, a]) => `<li>${esc(k)}: ${a.map(link).join(", ")}</li>`), "Inventární čísla jsou jedinečná.")}
    ${section("Pozice v sadech s neexistujícím stromem", s.brokenRefs.map(b => `<li>${esc(b.o.name)}, pozice ${esc(b.code)}</li>`), "Všechny pozice odkazují na existující stromy.")}
    ${section("Upozornění k údajům stromů", warn.slice(0, 200).map(x => `<li>${link(x.t)}: ${x.e.map(e => esc(e.msg)).join(" ")}</li>`), "Bez upozornění.")}
    <h3>Stromy bez GPS (${noGps.length})</h3>${noGps.length ? `<ul>${noGps.map(t => `<li>${link(t)}</li>`).join("")}</ul>` : `<p class="ok">✓ Všechny stromy mají souřadnice.</p>`}
    <h3>Soubory fotografií</h3><div id="phCheck">${photoReport ? photoReport : `<button class="btn" id="phCheckBtn">Zkontrolovat soubory fotek</button> <span class="muted" style="font-size:12.5px">porovná záznamy fotek se soubory ve složce <code>foto/</code></span>`}</div>
  </div>`;
  $("checkWrap").querySelectorAll("a[data-id]").forEach(a => a.addEventListener("click", () => app.hooks.select(a.dataset.id, { fly: true })));
  $("phCheckBtn")?.addEventListener("click", async () => {
    $("phCheck").textContent = "Kontroluji…";
    const files = new Set(await R.listPhotoFiles());
    const refs = new Set(), missing = [];
    app.trees.forEach(t => live(t.rec.photos).forEach(p => [p.file, p.thumb].filter(Boolean).forEach(f => { refs.add(f); if (!files.has(f)) missing.push({ t, f }); })));
    const orphan = [...files].filter(f => !refs.has(f));
    photoReport = `<p>${files.size} souborů, ${refs.size} odkazů ze záznamů.</p>
      ${missing.length ? `<p>Chybějící soubory (záznam existuje, soubor ne – možná se ještě synchronizuje):</p><ul>${missing.slice(0, 100).map(m => `<li>${link(m.t)}: <code>${esc(m.f)}</code></li>`).join("")}</ul>` : `<p class="ok">✓ Žádné chybějící soubory.</p>`}
      ${orphan.length ? `<p>Soubory bez záznamu (${orphan.length}):</p><ul>${orphan.slice(0, 100).map(f => `<li><code>${esc(f)}</code></li>`).join("")}</ul>` : `<p class="ok">✓ Žádné osiřelé soubory.</p>`}`;
    renderCheck();
  });
}
export function initCheck() { app.hooks.renderCheck = renderCheck; }
