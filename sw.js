const cacheName= "mws-restaurant-project";
const offlineUrl = "index.html";


 const urlsToCache = [
   offlineUrl,
    '/',
   "/restaurant.html",
   "/css/styles.css",
   "/data/restaurants.json",
   "/js/dbhelper.js",
   "/css/all.min.css",
   "/js/main.js",    
   "/js/restaurant_info.js",
    '/img/1.jpg',
    '/img/2.jpg',
    '/img/3.jpg',
    '/img/4.jpg',
    '/img/5.jpg',
    '/img/6.jpg',
    '/img/7.jpg',
    '/img/8.jpg',
    '/img/9.jpg',
    '/img/10.jpg',
    '/img/15.jpg',
  '/img/icons-512.png',
  '/img/icons-192.png',
    'https://unpkg.com/leaflet@1.3.1/dist/leaflet.js',
    'https://unpkg.com/leaflet@1.3.1/dist/leaflet.css',
'restaurant.html?id=1', 'restaurant.html?id=2', 'restaurant.html?id=3', 'restaurant.html?id=4',
 'restaurant.html?id=5', 'restaurant.html?id=6', 'restaurant.html?id=7', 'restaurant.html?id=8',
 'restaurant.html?id=9', 'restaurant.html?id=10' ]; 



self.addEventListener('install', function(event) {
  // Perform install steps
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      }).catch(err => console.log(err))
  );
});




self.addEventListener('fetch', event => {
  const storageUrl = event.request.url.split(/[?#]/)[0];
  if (event.request.method.toLowerCase() === 'get') {
    event.respondWith(
      caches.open(cacheName)
      .then(cache => {
        return cache.match(event.request)
          .then(response => {
            const fetchPromise = fetch(event.request)
              .then(networkResponse => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
              })
            return response || fetchPromise;
          })
      })
      .catch(err => console.log(err))
    );
  }
});
 