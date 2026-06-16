const CACHE_NAME = 'v1';

self.addEventListener('install', (event) => self.skipWaiting());

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(fetch(event.request)
        .then((res) => {
            if (res.status === 200) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return res;
        })
        .catch(() => caches.match(event.request)));
});