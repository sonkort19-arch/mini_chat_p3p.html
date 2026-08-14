const CACHE="mini-chat-max-v4";
const SHELL=["/chat.html","/app.css","/app.js","/manifest.webmanifest","/icon.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);if(u.pathname.startsWith("/api/"))return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match("/chat.html"))));});
self.addEventListener("notificationclick",e=>{e.notification.close();const room=e.notification.data?.room||"";e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{for(const c of list){if("focus" in c){c.postMessage({type:"open-room",room});return c.focus();}}return clients.openWindow("/chat.html"+(room?"?room="+encodeURIComponent(room):""));}));});
