// Service worker: aplikace (kód, styly, ikony) se uloží pro běh bez internetu.
// Data katalogu sem nepatří – ta jsou ve složce na disku. Mapové podklady a online služby se neukládají.
const VERSION = "__VERSION__";
const CACHE = "oskeruse-" + VERSION;
const FILES = __FILES__;
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("oskeruse-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true }) || (e.request.mode === "navigate" ? await c.match("index.html") : null);
    return hit || fetch(e.request);
  }));
});
