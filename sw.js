/* ============================================================
   sw.js — Utanginamo PWA v8 (offline-first, cache-first shell)
   Install FAILS if any shell file can't be cached, so a broken
   update never replaces a working cache. User data (IndexedDB)
   is never touched by the service worker.
   ============================================================ */
const CACHE = "utanginamo-v8";
// CORE files must all cache or the install aborts (the old working version stays in charge).
const CORE = [
  "./", "./index.html", "./manifest.json", "./css/styles.css",
  "./js/icons.js", "./js/finance.js", "./js/utils.js", "./js/db.js", "./js/helpers.js", "./js/security.js", "./js/backup.js",
  "./js/dashboard.js", "./js/borrowers.js", "./js/loans.js", "./js/payments.js", "./js/calendar.js", "./js/reports.js", "./js/settings.js", "./js/app.js", "./js/updates.js",
];
// Icons are best-effort: a missing/renamed icon never blocks the app from installing or working offline.
const OPTIONAL = ["./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png", "./icons/shortcut-add-96.png"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of CORE) {
      const res = await fetch(url, { cache: "reload" });
      if (!res.ok) throw new Error(`Cannot cache ${url} (${res.status})`);   // abort → old SW + cache stay active
      await cache.put(url, res);
    }
    await Promise.allSettled(OPTIONAL.map(async (url) => { const r = await fetch(url, { cache: "reload" }); if (r.ok) await cache.put(url, r); }));
    // No skipWaiting: the page asks for activation (see updates.js) so updates never interrupt work.
  })());
});

self.addEventListener("message", e => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("utanginamo-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then(cached => cached || fetch(request).catch(() =>
      new Response("<h2>Utanginamo</h2><p>Open the app once with internet to enable offline mode.</p>", { headers: { "Content-Type": "text/html" } }))));
    return;
  }
  e.respondWith(caches.match(request).then(cached => {
    const net = fetch(request).then(res => {
      if (res && res.status === 200 && new URL(request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
      return res;
    }).catch(() => null);
    return cached || net;
  }));
});
