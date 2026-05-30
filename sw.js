// Service worker — cache-first appshell + runtime caching for /src and
// /icons. Bumps cache version per build so deployments invalidate
// cleanly (the GitHub Pages workflow rewrites __BUILD__ at deploy).
const VERSION = "__BUILD__";
const SHELL_CACHE = "declanbike-shell-" + VERSION;
const RUNTIME_CACHE = "declanbike-runtime-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has("nocache")) return;

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === "basic") {
        const cache = await caches.open(
          url.pathname.startsWith("/src/") || url.pathname.startsWith("/icons/")
            ? RUNTIME_CACHE : SHELL_CACHE
        );
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const fallback = await caches.match("./index.html");
      if (fallback) return fallback;
      throw err;
    }
  })());
});
