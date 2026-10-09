/* FoodApp PWA: caché de la aplicación, no de pedidos ni de usuarios. */
'use strict';

const CACHE_VERSION = 'foodapp-20261009-v1';
const APP_CACHE = `foodapp-shell-${CACHE_VERSION}`;
const CDN_CACHE = `foodapp-libs-${CACHE_VERSION}`;
const CACHE_PREFIX = 'foodapp-';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './pwa.js',
  './offline.html',
  './icons/icon.svg',
  './icons/icon-48.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(name => name.startsWith(CACHE_PREFIX) && ![APP_CACHE, CDN_CACHE].includes(name))
        .map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Solo los recursos estáticos de estas CDN. Nunca guardar llamadas a Supabase.
const STATIC_CDN = new Set(['cdn.jsdelivr.net', 'unpkg.com']);

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Los datos, imágenes y autenticación de Supabase siempre utilizan la red.
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  if (req.mode === 'navigate') {
    if (url.origin !== self.location.origin) return;
    event.respondWith(networkFirst(req, APP_CACHE, './offline.html'));
    return;
  }

  if (url.origin === self.location.origin) {
    // Activos versionados se obtienen de la caché, pero la actualización del SW renueva la versión.
    event.respondWith(
      caches.match(req).then(cached => cached || networkFirst(req, APP_CACHE))
    );
    return;
  }

  // Conservar las bibliotecas de interfaz ya descargadas para evitar una pantalla en blanco sin conexión.
  if (STATIC_CDN.has(url.hostname) && ['script','style','font'].includes(req.destination)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (response && (response.ok || response.type === 'opaque')) {
          const cache = await caches.open(CDN_CACHE);
          cache.put(req, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw error;
      }
    })());
  }
});
