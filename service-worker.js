// Cache-first PWA shell
const CACHE='spendfree-v3';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); });
self.addEventListener('fetch',e=>{ const u=new URL(e.request.url); if(u.origin===location.origin||u.host.includes('cdn.jsdelivr.net')){ e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{ const clone=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,clone)); return resp; }))); } });