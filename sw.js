// Service worker — cache-first appshell + runtime caching for /src and
// /icons. Bumps cache version per build so deployments invalidate
// cleanly (the GitHub Pages workflow rewrites __BUILD__ at deploy).
//
// Stale-cache fix (2026-05): the old install pre-cached SHELL urls
// without query strings (e.g. "./style.css"), and the fetch handler
// matched with { ignoreSearch: true } — so the cache-bust query that
// index.html stamps on its assets ("./style.css?v=BUILD_ID") was being
// stripped before lookup, returning the previous build's bytes. New
// deploys appeared on the server but the browser kept showing the
// old shell until the user manually cleared site data.
//
// The fix:
//   1. Pre-cache SHELL with VERSION-stamped query strings — so the
//      cache always holds the latest build's assets, keyed exactly the
//      way the new HTML will request them.
//   2. Keep ignoreSearch:true — that means if a page is still rendering
//      the OLD HTML (with old ?v=… queries pointing at old assets),
//      requests still match the newest cached entries instead of going
//      to network (which might be slow / offline).
//   3. On activate (a new SW has installed and replaced the old one),
//      broadcast a "sw-updated" message to every active client. The
//      page listens (in src/main.js) and reloads, so the freshly-
//      stamped HTML + assets render immediately without the user
//      having to clear caches by hand.

const VERSION = "__BUILD__";
const SHELL_CACHE = "declanbike-shell-" + VERSION;
const RUNTIME_CACHE = "declanbike-runtime-" + VERSION;

// Stamp the cache-bust query on cacheable shell urls so the keys match
// what index.html actually requests. Non-versioned urls (the root
// directory, manifest, icons) keep their bare paths.
const v = (p) => `${p}?v=${VERSION}`;
const SHELL = [
  "./",
  v("./index.html"),
  v("./style.css"),
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
    // Detect a prior SW from the presence of any declanbike-* cache
    // that isn't our current one. First-ever install has no leftover
    // caches and shouldn't trigger a reload.
    const hadPriorSW = keys.some(
      (k) => /^declanbike-/.test(k) && k !== SHELL_CACHE && k !== RUNTIME_CACHE
    );
    await Promise.all(keys
      .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
    // Only notify clients on a real UPDATE — not when there was never
    // a prior SW (in which case the page already loaded the newest
    // build directly from the network).
    if (hadPriorSW) {
      const clients = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of clients) {
        try { client.postMessage({ type: "sw-updated", version: VERSION }); } catch (_) {}
      }
    }
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
