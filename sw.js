/* Service worker: gör appen tillgänglig offline.
   Höj VERSION vid varje ny utgåva så att användarna får de nya filerna. */
const VERSION = "tidrapport-v1.5.0";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./bibliotek.js",
  "./manifest.webmanifest",
  "./config.json",
  "./tidrapport-mall.xlsx",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", (e) => {
  // cache: "reload" hämtar filerna direkt från servern, så att en ny version aldrig blandas med gamla filer ur webbläsarens cache.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting()));
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

  // Appens egna filer (sidan, kod, stil, inställningar): nätverket först, så att en ny version används direkt.
  // Utan uppkoppling används den sparade kopian, så appen fungerar även offline.
  const fresh = req.mode === "navigate" || /\.(html|js|css|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (fresh) {
    // En navigeringsförfrågan kan inte kopieras med egna inställningar, därför hämtas den via sin adress.
    e.respondWith(
      fetch(req.mode === "navigate" ? req.url : req, {cache: "no-store"})
        .then((res) => {
          if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, {ignoreSearch: true}).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }

  // Övrigt (bilder, Excel-mall): cachen först, annars nätverket.
  e.respondWith(caches.match(req, {ignoreSearch: true}).then((hit) => hit || fetch(req)));
});
