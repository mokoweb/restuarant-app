const CACHE_NAME= "mws-restaurant-project";
const offlineUrl = "index.html";


 const urlsToCache = [
   offlineUrl,
    '/',
   "/restaurant.html",
   "/css/styles.css",
   "/data/restaurants.json",
   "/js/dbhelper.js",
   "/js/main.js",  
	"/js/sw.js",  
   "/js/restaurant_info.js",
   "https://stackpath.bootstrapcdn.com/bootstrap/4.2.1/css/bootstrap.min.css",
   "https://code.jquery.com/jquery-3.3.1.slim.min.js",
   "https://stackpath.bootstrapcdn.com/bootstrap/4.2.1/js/bootstrap.min.js",
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
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});



// intercept all fetch requests
// return cached asset, idb data, or fetch from network
self.addEventListener('fetch', e => {
  const request = e.request;
  const requestUrl = new URL(request.url);
  
  // 1. filter Ajax Requests
  if (requestUrl.port === '1337') {
    e.respondWith(idbRestaurantResponse(request));
  }
  else {
    e.respondWith(cacheResponse(request));
  }
});



let k = 0;
function idbRestaurantResponse(request, id) {
  // return ALL records from objectStore if more than one
  // if no match then fetch json, write to idb, & return response

  return dbPromise.then(db => {
      return db
        .transaction(store)
        .objectStore(store)
        .getAll().then(restaurants => {
      if (restaurants.length) {
        return restaurants;
      }
      return fetch(request)
        .then(response => response.json())
        .then(json => {
          json.forEach(restaurant => {  
            console.log('fetch idb write', ++k, restaurant.id, restaurant.name);
            idbKeyVal.set('restaurants', restaurant); 
          });
          return json;
        });
    })
    .then(response => new Response(JSON.stringify(response)))
    .catch(error => {
      return new Response(error, {
        status: 404,
        statusText: 'Bad request'
      });
    });
}

self.addEventListener('fetch', function(event) {
	
	var request = event.request;	
  event.respondWith(
    caches.match(request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // IMPORTANT: Clone the request. A request is a stream and
        // can only be consumed once. Since we are consuming this
        // once by cache and once by the browser for fetch, we need
        // to clone the response.
        var fetchRequest = request.clone();

        return fetch(fetchRequest).then(
          function(response) {
            // Check if we received a valid response
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            var responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(request, responseToCache);
              });

            return response;
          }
        );
      })
    );
});

self.addEventListener('sync', async (event) => {
  if (event.tag == 'syncFavorites') {
    event.waitUntil(
      SyncHelper.syncFavorites().catch((err) => {
        if (event.lastChance) {
          SyncHelper.clearStore('offlineFavorites');
        }
      }),
    );
  }
  if (event.tag == 'syncReviews') {
    event.waitUntil(
      SyncHelper.syncReviews()
        .then(function() {
          self.registration.showNotification('Review Posted!');
        })
        .catch((err) => {
          if (event.lastChance) {
            self.registration.showNotification(
              'Some of your reviews have failed to be posted online',
            );
            SyncHelper.clearStore('offlineReviews');
          } else {
            self.registration.showNotification(
              'Some reviews not be posted online, but they will be saved offline for now',
            );
          }
        }),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
