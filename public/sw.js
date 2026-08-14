const CACHE = "mini-chat-v3-shell";
const SHELL = ["/chat.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
      return response;
    }).catch(() => caches.match(event.request).then(r => r || caches.match("/chat.html")))
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const room = event.notification.data?.room || "";
  event.waitUntil(
    clients.matchAll({type:"window",includeUncontrolled:true}).then(list => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({type:"open-room",room});
          return c.focus();
        }
      }
      return clients.openWindow("/chat.html" + (room ? "?open=" + encodeURIComponent(room) : ""));
    })
  );
});
