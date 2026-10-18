// ZEBEN · Service worker: la app abre rápido, funciona como app instalada y recibe avisos.
const CACHE = "zeben-v2";
const SHELL = ["./", "index.html", "app.js", "manifest.json", "icon-192.png", "icon-512.png", "privacidad.html", "legal.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Los cambios que subas a GitHub se ven al momento. Solo se guardan los archivos de la propia app. Los datos (Supabase) nunca se guardan en caché.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache": pregunta siempre al servidor si hay versión nueva; si no hay, usa la guardada sin descargar de nuevo
    fetch(new Request(url.href, { cache: "no-cache", credentials: "same-origin" })).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "ZEBEN", body: e.data && e.data.text() }; }
  const url = typeof d.url === "string" && d.url.startsWith("./") ? d.url : "./";
  e.waitUntil(self.registration.showNotification(String(d.title || "ZEBEN").slice(0, 80), {
    body: String(d.body || "").slice(0, 200), tag: String(d.tag || "zeben"), icon: "icon-192.png", badge: "icon-192.png", data: { url },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
