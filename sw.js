// Service Worker for enhanced performance and offline support
const CACHE_NAME = 'inflaatio-v1.2';
const STATIC_CACHE = 'inflaatio-static-v1.2';
const DYNAMIC_CACHE = 'inflaatio-dynamic-v1.2';

// Files to cache immediately
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/inflation-site-css.css',
    '/inflation-site-js-optimized.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;900&display=swap',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// API endpoints that should be cached with network-first strategy
const API_ENDPOINTS = [
    'https://sheets.googleapis.com/v4/spreadsheets/'
];

// Install event - cache static assets
self.addEventListener('install', event => {
    console.log('📦 Service Worker installing...');
    
    event.waitUntil(
        caches.open(STATIC_CACHE).then(cache => {
            console.log('📦 Caching static assets...');
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.warn('⚠️ Some assets failed to cache:', err);
                // Continue anyway - don't block installation
            });
        }).then(() => {
            console.log('✅ Static assets cached successfully');
            return self.skipWaiting();
        })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
    console.log('🔄 Service Worker activating...');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(cacheName => 
                        cacheName.startsWith('inflaatio-') && 
                        cacheName !== STATIC_CACHE && 
                        cacheName !== DYNAMIC_CACHE
                    )
                    .map(cacheName => {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    })
            );
        }).then(() => {
            console.log('✅ Service Worker activated');
            return self.clients.claim();
        })
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Handle different types of requests with different strategies
    if (isStaticAsset(request)) {
        event.respondWith(cacheFirst(request));
    } else if (isApiRequest(request)) {
        event.respondWith(networkFirst(request));
    } else if (isImageRequest(request)) {
        event.respondWith(cacheFirst(request));
    } else {
        event.respondWith(staleWhileRevalidate(request));
    }
});

// Check if request is for static assets
function isStaticAsset(request) {
    const url = new URL(request.url);
    return STATIC_ASSETS.some(asset => request.url.includes(asset)) ||
           url.pathname.endsWith('.css') ||
           url.pathname.endsWith('.js') ||
           url.hostname === 'fonts.googleapis.com' ||
           url.hostname === 'fonts.gstatic.com' ||
           url.hostname === 'cdn.jsdelivr.net';
}

// Check if request is for API data
function isApiRequest(request) {
    return API_ENDPOINTS.some(endpoint => request.url.includes(endpoint));
}

// Check if request is for images
function isImageRequest(request) {
    return request.destination === 'image' ||
           /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(new URL(request.url).pathname);
}

// Cache First Strategy - for static assets
async function cacheFirst(request) {
    try {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.error('Cache first strategy failed:', error);
        
        // Return offline fallback if available
        if (request.destination === 'document') {
            return caches.match('/offline.html') || new Response('Offline', { status: 503 });
        }
        
        return new Response('Network error', { status: 503 });
    }
}

// Network First Strategy - for API data
async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, networkResponse.clone());
            
            // Set expiration time for API cache (5 minutes)
            const expirationTime = Date.now() + (5 * 60 * 1000);
            cache.put(request.url + '_timestamp', new Response(expirationTime.toString()));
        }
        
        return networkResponse;
    } catch (error) {
        console.warn('Network request failed, trying cache:', error);
        
        // Check if cached data is still valid
        const cache = await caches.open(DYNAMIC_CACHE);
        const timestampResponse = await cache.match(request.url + '_timestamp');
        
        if (timestampResponse) {
            const timestamp = parseInt(await timestampResponse.text());
            if (Date.now() < timestamp) {
                const cachedResponse = await cache.match(request);
                if (cachedResponse) {
                    return cachedResponse;
                }
            }
        }
        
        return new Response('Network unavailable', { status: 503 });
    }
}

// Stale While Revalidate Strategy - for other resources
async function staleWhileRevalidate(request) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const cachedResponse = await cache.match(request);
    
    const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(error => {
        console.warn('Stale while revalidate fetch failed:', error);
        return cachedResponse || new Response('Network error', { status: 503 });
    });
    
    return cachedResponse || fetchPromise;
}

// Background sync for data updates (optional)
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync-inflation-data') {
        console.log('🔄 Background sync: Updating inflation data...');
        event.waitUntil(updateInflationData());
    }
});

// Function to update inflation data in background
async function updateInflationData() {
    try {
        const cache = await caches.open(DYNAMIC_CACHE);
        const API_KEY = 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g';
        const SHEET_ID = '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8';
        
        const urls = [
            `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Raakadata!A:F?key=${API_KEY}`,
            `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Key%20Metrics!A:B?key=${API_KEY}`
        ];
        
        await Promise.all(urls.map(url => 
            fetch(url).then(response => {
                if (response.ok) {
                    cache.put(url, response.clone());
                }
            }).catch(console.warn)
        ));
        
        console.log('✅ Background data update completed');
    } catch (error) {
        console.error('❌ Background data update failed:', error);
    }
}

// Push notifications for data updates (optional)
self.addEventListener('push', event => {
    if (event.data) {
        const data = event.data.json();
        const options = {
            body: data.body || 'Uusia inflaatiotietoja saatavilla',
            icon: '/icon-192.png',
            badge: '/badge-72.png',
            tag: 'inflation-update',
            requireInteraction: true,
            actions: [
                {
                    action: 'view',
                    title: 'Näytä',
                    icon: '/action-view.png'
                },
                {
                    action: 'dismiss',
                    title: 'Ohita',
                    icon: '/action-dismiss.png'
                }
            ]
        };
        
        event.waitUntil(
            self.registration.showNotification(
                data.title || 'Inflaatio-seuranta',
                options
            )
        );
    }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'view') {
        event.waitUntil(
            clients.openWindow('/?utm_source=push_notification')
        );
    }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'inflation-data-sync') {
        event.waitUntil(updateInflationData());
    }
});

// Message handling for manual cache updates
self.addEventListener('message', event => {
    if (event.data && event.data.type) {
        switch (event.data.type) {
            case 'SKIP_WAITING':
                self.skipWaiting();
                break;
                
            case 'UPDATE_CACHE':
                event.waitUntil(updateInflationData());
                break;
                
            case 'CLEAR_CACHE':
                event.waitUntil(
                    caches.keys().then(cacheNames =>
                        Promise.all(
                            cacheNames
                                .filter(name => name.startsWith('inflaatio-dynamic'))
                                .map(name => caches.delete(name))
                        )
                    )
                );
                break;
        }
    }
});

// Error handling
self.addEventListener('error', event => {
    console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('Service Worker unhandled rejection:', event.reason);
});