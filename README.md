# Oskeruše – katalog stromů a sadů

Aplikace (PWA) pro evidenci oskeruší Českého středohoří a výsadeb (sadů). Spojuje dřívější
`oskerusovy-katalog-ceske-stredohori.html` a `oskerusovy-sad-kostalov.html` do jedné aplikace.

- **Data jsou ve složce na disku**, kterou mezi sebou sdílíte přes **Syncthing**. Žádný server ani cloud.
- Aplikace složku čte a zapisuje přímo (File System Access API) – **úpravy jen v Chrome nebo Edge** na počítači.
  Safari a Firefox umí katalog jen prohlížet („Otevřít jen pro čtení…“).
- Funguje offline (kromě mapových podkladů a zjišťování stanovištních údajů z online služeb).

## Struktura složky katalogu

```
katalog/                     ← tuto složku sdílí Syncthing
  oskeruse.json              značka složky katalogu
  stromy/<id>.json           jeden soubor = jeden strom
  sady/<id>.json             jeden soubor = jeden sad (řady, pozice, genotypy, dodavatelé)
  foto/<id stromu>/<id>.webp     fotografie (max. 1600 px)
  foto/<id stromu>/<id>.t.webp   náhled (320 px)
```

- Každý záznam má časy změn jednotlivých polí (`_ts`) a krátkou historii změn (kdo, kdy, která pole).
- Když dva lidé upraví tentýž strom bez synchronizace, Syncthing vytvoří konfliktní kopii
  (`…sync-conflict-….json`). Aplikace ji **sloučí automaticky** – u každého pole vyhraje novější změna,
  měření a fotky se spojí, smazané položky se nevrátí. Nesloučitelné kopie ukáže v záložce *Kontrola dat*.
- Stromy se nemažou, jen **vyřazují z evidence** (`archived`) – smazání souboru by se přes Syncthing šířilo
  a offline zařízení by mohlo strom vrátit.
- Stanovištní údaje (terén DMR 5G, horizont, půda, geologie, BPEJ, klima, katastr) se zjistí při prvním
  otevření detailu stromu a **uloží se do souboru stromu** – ostatní je pak mají bez dalších dotazů.

## Pro uživatele: první spuštění

1. Nainstalujte **Syncthing** a připojte se ke sdílené složce katalogu (návod níže).
2. Otevřete aplikaci v Chrome/Edge – buď z adresy (GitHub Pages), nebo soubor `index.html` z rozbalené
   složky aplikace.
3. Vyplňte své jméno a klikněte na **Vybrat složku katalogu…** → vyberte sdílenou složku → **Povolit**
   (v nainstalované aplikaci zvolte „Povolit při každé návštěvě“).
4. Aplikaci lze nainstalovat: ikona v adresním řádku nebo menu → *Nainstalovat stránku jako aplikaci*
   (jen pokud je otevřená z adresy https://, ne ze souboru).

## Pro správce

```bash
npm install
npm run build          # → dist/ (index.html, app.js, app.css, sw.js, manifest, ikony)
npm run serve          # http://localhost:8080 (na localhost jde aplikace i nainstalovat)
npm test               # testy datového modelu, slučování a úložiště (Node)
node test/e2e.mjs data # end-to-end test ve skutečném Chrome nad kopií složky `data`
```

`dist/` je hotová aplikace – lze ji zveřejnit na GitHub Pages (workflow `.github/workflows/pages.yml`)
nebo zkopírovat do sdílené složky a otevírat `index.html` přímo ze souboru (funguje bez serveru,
jen se nedá „nainstalovat“ a neaktualizuje se sama). Zveřejňuje se **jen kód, žádná data**.
Pro GitHub Pages doporučuji vlastní doménu hned od začátku – data v prohlížeči (mezipaměť, oprávnění ke složce)
jsou vázaná na adresu, takže pozdější přechod na vlastní server pak znamená jen změnu DNS.

### Převod původních dat

```bash
node tools/import-legacy.mjs --out data \
  --catalog "~/vysadby/oskerusovy-katalog-ceske-stredohori (3).html" \
  --orchard ~/vysadby/kostalov/oskerusovy-sad-kostalov.html \
  --photos ~/Downloads/Fotografie-sad
```

Importuje se jen do prázdné složky. Id stromů jsou odvozená z obsahu, takže opakovaný import dá stejný výsledek.
Fotky se přiřazují podle inv. č. na začátku názvu souboru (`Stromy/…` = strom, `Plody/…` = plody).
Výsledná složka `data/` je počáteční obsah sdílené složky katalogu – přesuňte ji do Syncthingu.

### Kód

| Soubor | Co dělá |
|---|---|
| `src/core/model.js` | datový model, úpravy s časovými značkami, slučování verzí, kontroly (bez DOM, sdílí Node i prohlížeč) |
| `src/core/repo.js` | úložiště nad složkou: načítání s mezipamětí, zápis (vždy nad aktuální verzí z disku), konflikty, fotky |
| `src/core/idb.js` | mezipaměť načtených souborů a nastavení v IndexedDB |
| `src/core/site.js` | stanovištní údaje z veřejných služeb (ČÚZK, ČGS, MZe, Open-Meteo) |
| `src/ui/catalog.js` | seznam, filtry, mapa, lokality, grafy, tabulka, detail stromu |
| `src/ui/orchard.js` | sady: plán (editovatelný), genotypy, grafy |
| `src/ui/edit.js`, `photos.js`, `check.js` | formulář stromu, fotky (převod na WebP v prohlížeči), kontrola dat |
| `tools/nodefs.mjs` | rozhraní složky nad `node:fs` – stejný `repo.js` běží v importu i testech |

## Syncthing – nastavení pro skupinu

1. Každý si nainstaluje Syncthing (macOS: aplikace *Syncthing*; Windows: *Syncthing Windows Setup*).
2. Jeden člověk přidá složku `katalog` (*Add Folder*) a nasdílí ji ostatním zařízením (výměna Device ID).
3. Doporučené nastavení složky:
   - *File Versioning* → **Staggered** (každé zařízení si drží starší verze souborů = záloha s historií),
   - typ složky **Send & Receive**.
4. Ideálně jedno zařízení trvale zapnuté (Raspberry Pi, NAS), aby se změny potkaly, i když nejsou všichni online zároveň.
