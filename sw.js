// Rattletrap's service worker. It keeps a copy of the game in the browser, so Rattletrap opens offline
// and can be installed like an app. It answers from that copy straight away, then quietly fetches
// a fresh copy for next time, so updates arrive without anyone having to bump a version number.

const CACHE = "rattletrap";
const FILES = [
  "./", "index.html", "style.css", "game.js", "vendor/planck.min.js", "manifest.webmanifest",
  "fonts/nunito.woff2", "icons/icon.svg", "icons/icon-192.png",
  ...["star", "crash", "mission", "best", "fanfare", "tick"].map((name) => `sounds/${name}.mp3`),
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  url.search = ""; // ignore anything after "?" in the address
  const key = url.href;

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const saved = await cache.match(key);
    const fresh = fetch(event.request).then((response) => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    event.waitUntil(fresh.catch(() => {}));
    return saved || fresh;
  }));
});
