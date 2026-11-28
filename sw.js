/* ============================================================
   sw.js — Utanginamo PWA v9 (offline-first, cache-first shell)
   CORE files must all cache or the install aborts (the old working version
   stays in charge). OPTIONAL files (icons, fonts) are best-effort, so a
   missing/renamed icon never blocks installing or offline use.
   User data (IndexedDB) is never touched by the service worker.
   ============================================================ */
const CACHE = "utanginamo-v9";
const CORE = [
  "./", "./index.html", "./manifest.json", "./css/styles.css",
  "./js/icons.js", "./js/finance.js", "./js/utils.js", "./js/db.js", "./js/helpers.js", "./js/security.js", "./js/backup.js", "./js/install.js", "./js/ics.js",
  "./js/dashboard.js", "./js/borrowers.js", "./js/loans.js", "./js/payments.js", "./js/calendar.js", "./js/reports.js", "./js/settings.js", "./js/app.js", "./js/updates.js",
];
const OPTIONAL = [
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-192.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png", "./icons/shortcut-add-96.png", "./favicon.ico",
  "./fonts/newsreader-400.woff2", "./fonts/newsreader-500.woff2", "./fonts/newsreader-400-italic.woff2", "./fonts/plex-sans-400.woff2", "./fonts/plex-sans-500.woff2", "./fonts/plex-mono-400.woff2", "./fonts/plex-mono-600.woff2",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of CORE) {
      const res = await fetch(url, { cache: "reload" });
      if (!res.ok) throw new Error(`Cannot cache ${url} (${res.status})`);
      await cache.put(url, res);
    }
    await Promise.allSettled(OPTIONAL.map(async (url) => { const r = await fetch(url, { cache: "reload" }); if (r.ok) await cache.put(url, r); }));
    // No skipWaiting: the page asks for activation (updates.js), so updates never interrupt work.
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
    if (cached) {   // serve instantly, refresh quietly in the background
      fetch(request).then(res => { if (res && res.status === 200 && new URL(request.url).origin === location.origin) caches.open(CACHE).then(c => c.put(request, res)); }).catch(() => {});
      return cached;
    }
    return fetch(request).then(res => {
      if (res && res.status === 200 && new URL(request.url).origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
      return res;
    }).catch(() => Response.error());
  }));
});
