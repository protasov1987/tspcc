const APP_VERSION = '0.16.29';
const CACHE_VERSION = `pwa-shell-v${APP_VERSION}`;
const APP_SHELL_CACHE = `tspcc-${CACHE_VERSION}`;
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  `/style.css?v=${APP_VERSION}`,
  `/barcodeScanner.js?v=${APP_VERSION}`,
  `/dashboard.js?v=${APP_VERSION}`,
  `/js/app.02.loading-ui.js?v=${APP_VERSION}`,
  `/js/app.03.skeletons.registry.js?v=${APP_VERSION}`,
  `/js/app.00.state.js?v=${APP_VERSION}`,
  `/js/app.10.utils.js?v=${APP_VERSION}`,
  `/js/app.20.routeModel.js?v=${APP_VERSION}`,
  `/js/app.30.imdx.js?v=${APP_VERSION}`,
  `/js/app.40.store.js?v=${APP_VERSION}`,
  `/js/app.50.auth.js?v=${APP_VERSION}`,
  `/js/app.60.render.dashboard.js?v=${APP_VERSION}`,
  `/js/app.70.render.cards.js?v=${APP_VERSION}`,
  `/js/app.71.cardRoute.modal.js?v=${APP_VERSION}`,
  `/js/app.72.directories.pages.js?v=${APP_VERSION}`,
  `/js/app.73.receipts.js?v=${APP_VERSION}`,
  `/js/app.73.receipts-list.js?v=${APP_VERSION}`,
  `/js/app.74.approvals.js?v=${APP_VERSION}`,
  `/js/app.75.production.js?v=${APP_VERSION}`,
  `/js/app.80.timer.js?v=${APP_VERSION}`,
  `/js/app.81.navigation.js?v=${APP_VERSION}`,
  `/js/app.82.forms.js?v=${APP_VERSION}`,
  `/js/app.83.render.common.js?v=${APP_VERSION}`,
  `/js/app.90.usersAccess.js?v=${APP_VERSION}`,
  `/js/app.95.messenger.js?v=${APP_VERSION}`,
  `/js/app.96.webpush.js?v=${APP_VERSION}`,
  `/js/app.99.init.js?v=${APP_VERSION}`,
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png'
];

function toCacheKey(requestUrl) {
  const url = new URL(requestUrl);
  return url.origin === self.location.origin
    ? `${url.pathname}${url.search || ''}`
    : requestUrl;
}

async function warmAppShellCache() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await Promise.all(
    APP_SHELL_URLS.map(async (assetUrl) => {
      try {
        const response = await fetch(assetUrl, { cache: 'no-store' });
        if (!response || !response.ok) return;
        await cache.put(assetUrl, response.clone());
      } catch (err) {
        console.warn('[SW] Failed to precache asset', assetUrl, err);
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    warmAppShellCache().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith('tspcc-') && cacheName !== APP_SHELL_CACHE)
        .map((cacheName) => caches.delete(cacheName))
    )).then(() => self.clients.claim())
  );
});

async function handleNavigationRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch (err) {
    const cachedIndex = await cache.match('/index.html');
    if (cachedIndex) return cachedIndex;
    throw err;
  }
}

async function handleStaticAssetRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cacheKey = toCacheKey(request.url);
  const cached = await cache.match(cacheKey);
  if (cached) {
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          cache.put(cacheKey, response.clone());
        }
      })
      .catch(() => {});
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  const isStaticAsset = /\.(?:css|js|png|jpg|jpeg|svg|webp|ico|woff2?|ttf|json|webmanifest)$/i.test(url.pathname);
  if (isStaticAsset) {
    event.respondWith(handleStaticAssetRequest(request));
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    payload = {};
  }

  const title = payload.title || 'Уведомление';
  const body = payload.body || '';
  const url = payload.url || '/';

  const options = {
    body,
    data: { url }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
