/**
 * Thaasbai - Service Worker
 * Enables offline play and auto-updates
 */

// IMPORTANT: Increment this version to trigger update
const CACHE_VERSION = 196;
const CACHE_NAME = `thaasbai-v${CACHE_VERSION}`;
const OFFLINE_URL = '/';

// Assets to cache for offline use
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dhiha-ei.html',
  '/digu.html',
  '/admin.html',
  '/customer.html',
  '/css/base.css',
  '/css/dhiha-ei.css',
  '/css/digu.css',
  '/css/admin.css',
  '/css/customer.css',
  '/css/portal-common.css',
  '/js/multiplayer.js',
  '/js/bundle.js',
  '/js/digu-bundle.js',
  '/js/dhiha-ei-bundle.js',
  '/js/digu.js',
  '/sponsors.json',
  '/campaigns.json',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/ooredoo-logo.svg',
  '/icons/ooredoo-sponsor.svg',
  // Critical PWA icons
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-180x180.png',
  '/icons/icon-152x152.png',
  '/icons/icon-167x167.png',
  '/icons/icon-120x120.png',
  // Fonts
  '/fonts/Faruma.woff2',
  '/fonts/Faruma.woff',
  // Language files
  '/lang/en.json',
  '/lang/dv.json'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install v' + CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching app shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        // Force the waiting service worker to become active immediately
        console.log('[ServiceWorker] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[ServiceWorker] Cache failed:', error);
      })
  );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate v' + CACHE_VERSION);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => (cacheName.startsWith('thaasbai-') || cacheName.startsWith('dhiha-ei-')) && cacheName !== CACHE_NAME)
            .map((cacheName) => {
              console.log('[ServiceWorker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        // Take control of all clients immediately
        console.log('[ServiceWorker] Claiming clients');
        return self.clients.claim();
      })
      .then(() => {
        // Notify all clients that a new version is active
        return self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
          });
        });
      })
  );
});

// Fetch event - Network first for HTML, stale-while-revalidate for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip WebSocket and Socket.IO requests
  if (url.pathname.includes('/socket.io')) {
    return;
  }

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // Network-first strategy for HTML (always get latest)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((cachedResponse) => cachedResponse || caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  // Network-first for CSS and JS (get latest, fallback to cache)
  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );
    return;
  }

  // Cache-first for other static assets (images, etc.)
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Update cache in background
          fetch(request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, response));
              }
            })
            .catch(() => {});

          return cachedResponse;
        }

        return fetch(request)
          .then((response) => {
            if (!response.ok && response.type !== 'opaque') {
              return response;
            }

            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseClone));

            return response;
          })
          .catch(() => {
            if (request.destination === 'image') {
              return new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#001825" width="100" height="100"/></svg>',
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            }

            if (request.mode === 'navigate') {
              return caches.match(OFFLINE_URL);
            }

            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
          });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  if (event.data === 'checkForUpdate') {
    // Force update check
    self.registration.update();
  }
});
