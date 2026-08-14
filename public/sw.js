// Minimal service worker. Its only real job is to satisfy the "has a
// registered service worker" requirement Android/Chrome checks before
// offering the install-to-home-screen prompt (iOS doesn't need this at all,
// but it's harmless there too).
//
// Deliberately NOT a full offline cache: prayer audio/video, the dashboard
// library, and everything from Supabase is per-user and changes constantly.
// Caching any of that risks showing a signed-out visitor someone else's
// cached page, or a user a stale/deleted prayer. So this only cache-first's
// a handful of small, immutable static assets (icons, manifest) and lets
// every other request — including all page navigations and API calls — go
// straight to the network untouched.
const CACHE_NAME = "prayercanvas-shell-v1";
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {
        // Best-effort — a failed precache shouldn't block install/activation.
      })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !SHELL_ASSETS.includes(url.pathname)) {
    return; // let the browser handle it normally
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
