/* Service worker: gör appen tillgänglig offline.
   Höj VERSION vid varje ny utgåva så att användarna får de nya filerna. */
const VERSION = "tidrapport-v1.0.0";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./config.json",
  "./tidrapport-mall.xlsx",
  "./vendor/jszip.min.js",
  "./vendor/jspdf.umd.min.js",
  "./icons/logo.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // appen hämtar aldrig något från andra webbplatser

  // Inställningar från administratören: nätverket först, så att ändringar slår igenom direkt.
  if (url.pathname.endsWith("/config.json")) {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Övriga filer: cachen först, annars nätverket.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
