const CACHE = 'sincro-v8';
const FILES = [
  'index.html',
  'parte_combustible.html',
  'parte_servicio_diario.html',
  'orden_reparacion.html',
  'storage.js',
  'drivesync.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('sincro-') && k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }))
  );
});
