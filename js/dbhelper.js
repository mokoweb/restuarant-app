'use strict';

(function() {
  function toArray(arr) {
    return Array.prototype.slice.call(arr);
  }

  function promisifyRequest(request) {
    return new Promise(function(resolve, reject) {
      request.onsuccess = function() {
        resolve(request.result);
      };

      request.onerror = function() {
        reject(request.error);
      };
    });
  }

  function promisifyRequestCall(obj, method, args) {
    var request;
    var p = new Promise(function(resolve, reject) {
      request = obj[method].apply(obj, args);
      promisifyRequest(request).then(resolve, reject);
    });

    p.request = request;
    return p;
  }

  function promisifyCursorRequestCall(obj, method, args) {
    var p = promisifyRequestCall(obj, method, args);
    return p.then(function(value) {
      if (!value) return;
      return new Cursor(value, p.request);
    });
  }

  function proxyProperties(ProxyClass, targetProp, properties) {
    properties.forEach(function(prop) {
      Object.defineProperty(ProxyClass.prototype, prop, {
        get: function() {
          return this[targetProp][prop];
        },
        set: function(val) {
          this[targetProp][prop] = val;
        }
      });
    });
  }

  function proxyRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function proxyMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return this[targetProp][prop].apply(this[targetProp], arguments);
      };
    });
  }

  function proxyCursorRequestMethods(ProxyClass, targetProp, Constructor, properties) {
    properties.forEach(function(prop) {
      if (!(prop in Constructor.prototype)) return;
      ProxyClass.prototype[prop] = function() {
        return promisifyCursorRequestCall(this[targetProp], prop, arguments);
      };
    });
  }

  function Index(index) {
    this._index = index;
  }

  proxyProperties(Index, '_index', [
    'name',
    'keyPath',
    'multiEntry',
    'unique'
  ]);

  proxyRequestMethods(Index, '_index', IDBIndex, [
    'get',
    'getKey',
    'getAll',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(Index, '_index', IDBIndex, [
    'openCursor',
    'openKeyCursor'
  ]);

  function Cursor(cursor, request) {
    this._cursor = cursor;
    this._request = request;
  }

  proxyProperties(Cursor, '_cursor', [
    'direction',
    'key',
    'primaryKey',
    'value'
  ]);

  proxyRequestMethods(Cursor, '_cursor', IDBCursor, [
    'update',
    'delete'
  ]);

  // proxy 'next' methods
  ['advance', 'continue', 'continuePrimaryKey'].forEach(function(methodName) {
    if (!(methodName in IDBCursor.prototype)) return;
    Cursor.prototype[methodName] = function() {
      var cursor = this;
      var args = arguments;
      return Promise.resolve().then(function() {
        cursor._cursor[methodName].apply(cursor._cursor, args);
        return promisifyRequest(cursor._request).then(function(value) {
          if (!value) return;
          return new Cursor(value, cursor._request);
        });
      });
    };
  });

  function ObjectStore(store) {
    this._store = store;
  }

  ObjectStore.prototype.createIndex = function() {
    return new Index(this._store.createIndex.apply(this._store, arguments));
  };

  ObjectStore.prototype.index = function() {
    return new Index(this._store.index.apply(this._store, arguments));
  };

  proxyProperties(ObjectStore, '_store', [
    'name',
    'keyPath',
    'indexNames',
    'autoIncrement'
  ]);

  proxyRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'put',
    'add',
    'delete',
    'clear',
    'get',
    'getAll',
    'getKey',
    'getAllKeys',
    'count'
  ]);

  proxyCursorRequestMethods(ObjectStore, '_store', IDBObjectStore, [
    'openCursor',
    'openKeyCursor'
  ]);

  proxyMethods(ObjectStore, '_store', IDBObjectStore, [
    'deleteIndex'
  ]);

  function Transaction(idbTransaction) {
    this._tx = idbTransaction;
    this.complete = new Promise(function(resolve, reject) {
      idbTransaction.oncomplete = function() {
        resolve();
      };
      idbTransaction.onerror = function() {
        reject(idbTransaction.error);
      };
      idbTransaction.onabort = function() {
        reject(idbTransaction.error);
      };
    });
  }

  Transaction.prototype.objectStore = function() {
    return new ObjectStore(this._tx.objectStore.apply(this._tx, arguments));
  };

  proxyProperties(Transaction, '_tx', [
    'objectStoreNames',
    'mode'
  ]);

  proxyMethods(Transaction, '_tx', IDBTransaction, [
    'abort'
  ]);

  function UpgradeDB(db, oldVersion, transaction) {
    this._db = db;
    this.oldVersion = oldVersion;
    this.transaction = new Transaction(transaction);
  }

  UpgradeDB.prototype.createObjectStore = function() {
    return new ObjectStore(this._db.createObjectStore.apply(this._db, arguments));
  };

  proxyProperties(UpgradeDB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(UpgradeDB, '_db', IDBDatabase, [
    'deleteObjectStore',
    'close'
  ]);

  function DB(db) {
    this._db = db;
  }

  DB.prototype.transaction = function() {
    return new Transaction(this._db.transaction.apply(this._db, arguments));
  };

  proxyProperties(DB, '_db', [
    'name',
    'version',
    'objectStoreNames'
  ]);

  proxyMethods(DB, '_db', IDBDatabase, [
    'close'
  ]);

  // Add cursor iterators
  // TODO: remove this once browsers do the right thing with promises
  ['openCursor', 'openKeyCursor'].forEach(function(funcName) {
    [ObjectStore, Index].forEach(function(Constructor) {
      // Don't create iterateKeyCursor if openKeyCursor doesn't exist.
      if (!(funcName in Constructor.prototype)) return;

      Constructor.prototype[funcName.replace('open', 'iterate')] = function() {
        var args = toArray(arguments);
        var callback = args[args.length - 1];
        var nativeObject = this._store || this._index;
        var request = nativeObject[funcName].apply(nativeObject, args.slice(0, -1));
        request.onsuccess = function() {
          callback(request.result);
        };
      };
    });
  });

  // polyfill getAll
  [Index, ObjectStore].forEach(function(Constructor) {
    if (Constructor.prototype.getAll) return;
    Constructor.prototype.getAll = function(query, count) {
      var instance = this;
      var items = [];

      return new Promise(function(resolve) {
        instance.iterateCursor(query, function(cursor) {
          if (!cursor) {
            resolve(items);
            return;
          }
          items.push(cursor.value);

          if (count !== undefined && items.length == count) {
            resolve(items);
            return;
          }
          cursor.continue();
        });
      });
    };
  });

  var exp = {
    open: function(name, version, upgradeCallback) {
      var p = promisifyRequestCall(indexedDB, 'open', [name, version]);
      var request = p.request;

      if (request) {
        request.onupgradeneeded = function(event) {
          if (upgradeCallback) {
            upgradeCallback(new UpgradeDB(request.result, event.oldVersion, request.transaction));
          }
        };
      }

      return p.then(function(db) {
        return new DB(db);
      });
    },
    delete: function(name) {
      return promisifyRequestCall(indexedDB, 'deleteDatabase', [name]);
    }
  };

  if (typeof module !== 'undefined') {
    module.exports = exp;
    module.exports.default = module.exports;
  }
  else {
    self.idb = exp;
  }
}());




/**
 * Common database helper functions.
 */
class DBHelper {

  /**
   * Database URL.
   * Change this to restaurants.json file location on your server.
   */
 static get DATABASE_URL() {
    const port = 1337; // Change this to your server port
    //return './data/restaurants.json';
  //return 'https://mokoweb.github.io/restaurant-app/data/restaurants.json';

  return `http://localhost:${port}/`;
  }
    static get RESTAURANTS_URL() {
    return `${this.DATABASE_URL}restaurants/`;
  }

  static OpenIndexDB(){
  //service worker
  if (!window.navigator.serviceWorker){
        console.error('ServiceWorker registration failed');
    return Promise.resolve();
  }
  
  //for indexDB

    return idb.open('restaurant-db', 2, function (upgradeDb) {
      switch (upgradeDb.oldVersion) {
        case 0:
          upgradeDb.createObjectStore('restaurantDB', {
            keyPath: 'id'
          });
        case 1:
          const reviewsStore = upgradeDb.createObjectStore('reviews', {
            keyPath: 'id', autoIncrement: true
          });
          reviewsStore.createIndex('restaurant_id', 'restaurant_id');
         case 2:
         upgradeDb.createObjectStore('offlineReviews', { autoIncrement: true });
      }
    });
  }



    /**
   * Fetch all restaurants. **/
   
   static fetchRestaurants(callback) {
     return DBHelper.fetchDataFromIDB()
      .then(restaurants => {

        if(!restaurants.length) {
          //console.log('fetching from server');
           return DBHelper.fetchRestaurantFromServer();
        }
        return Promise.resolve(restaurants);
      })
    .then(data =>{ // Success response from server!
      callback(null, data);
    })
    .catch(err =>{ // Any errors.
    
     callback(err, null);
    })
  }



 /**
   * get restaurants data from the server
   */
static fetchRestaurantFromServer() {
  return fetch(DBHelper.RESTAURANTS_URL)
    .then(resp => {
      return resp.json();
    })
    .then(restaurants => {
      DBHelper.storeResponseToIDB(restaurants);
      return restaurants;
    });

   }



  static fetchStoredObjectById(table, idx, id) {
    return DBHelper.OpenIndexDB()
      .then(db => {
        if (!db) return;

        const store = db.transaction(table).objectStore(table);
        const indexId = store.index(idx);
        return indexId.getAll(id);
      });
  }

/**fecth review by restaurant Id **/
static fetchReviewsByRestaurantId(id, callback) {

    fetch(`${DBHelper.DATABASE_URL}reviews/?restaurant_id=${id}`)
      .then(response => response.json())
      .then(reviews => {

          
          //storeReviewToIDB(reviews)
          return DBHelper.OpenIndexDB().then(db => {
          if(!db) return;
          let tx = db.transaction("reviews", "readwrite");
          let Dbstore = tx.objectStore("reviews");
          reviews.forEach(review => {
            Dbstore.put(review);

              });
           callback(null, reviews);
        });
        })  
      .catch(error => {
        console.log('fetching from IDB couldn"t fetch from server');
        return DBHelper.fetchStoredObjectById('reviews', 'restaurant_id', id)
          .then((storedReviews) => {
            callback (null, storedReviews); 
          }).catch(err => callback(err, null));
      });

    
  }



    /**
   * function to store Response To IndexDB
   */

static storeResponseToIDB(restaurants){
  return DBHelper.OpenIndexDB().then(db => {
    if(!db) return;
    let tx = db.transaction("restaurantDB", "readwrite");
    let Dbstore = tx.objectStore("restaurantDB");
    restaurants.forEach(restaurant => {
      Dbstore.put(restaurant);

    });
    return tx.complete;
  });

   }

  /**
   * Add offline review.
   */
  static addOfflineReview(review) {
        console.log(review, '.....posting')
        return DBHelper.OpenIndexDB().then(db => {
        if (!db) return;
        const tx = db.transaction('offlineReviews', 'readwrite');
        const store = tx.objectStore('offlineReviews');
        store.put(review);
        return tx.complete;
         });
}

   static fetchDataFromIDB(){
  return DBHelper.OpenIndexDB().then(db => {
    if(!db) return;
    let Dbstore = db
    .transaction("restaurantDB")
    .objectStore("restaurantDB");

    return Dbstore.getAll();
  });

   }

    static postReview(review) {
    
    let reviewSend = {
      "name": review.name,
      "rating": parseInt(review.rating),
      "comments": review.comments,
      "restaurant_id": parseInt(review.restaurant_id)
    };
    let addReview = true;
    // Check if online
    if (!navigator.onLine && (addReview=== true)) {
      return DBHelper.addOfflineReview(review)
      .then(DBHelper.processOffline())
      .catch(err=> console.error(err, 'error adding offline review'));
      return;
    }
    
    console.log('Sending review: ', reviewSend);
    var fetch_options = {
      method: 'POST',
      body: JSON.stringify(reviewSend),
      headers: new Headers({
        'Content-Type': 'application/json'
      })
    };
    fetch(`http://localhost:1337/reviews`, fetch_options).then((response) => {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.indexOf('application/json') !== -1) {
          return response.json();
        } else {
          return 'API call successfull'
        }
      })
      .then((data) => {
        console.log(`Fetch successful!`)
      })
      .catch(error => console.log('error:', error));
  }



static processOffline() {
    window.addEventListener('online', (event) => {
  console.log('Open offline queue & return cursor');
     return DBHelper.OpenIndexDB().then(db => {
      if (!db) return;
      const tx = db.transaction(['offlineReviews'], 'readwrite');
      const store = tx.objectStore('offlineReviews');
      return store.openCursor();
    })
      .then(function nextRequest (cursor) {
        if (!cursor) {
          console.log('cursor done.');
          return;
        }
        // console.log('cursor', cursor.value.data.name, cursor.value.data);
        console.log('cursor.value', cursor.value);

        const offline_key = cursor.key;
       
        const data = cursor.value.data;
        const review_key = cursor.value.review_key;
        // const body = data ? JSON.stringify(data) : '';
        const body = data;

        
       // Setup the request
 
    
        var headers = new Headers();
        // Set some Headers
        headers.set('Accept', 'application/json');
          

        fetch(`${DBHelper.DATABASE_URL}reviews`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }).then(response => response.json())
          .then(data => {
            // data is the returned record
            console.log('Received updated record from DB Server', data);

            // 1. Delete http request record from offline store
             return DBHelper.OpenIndexDB().then(db => {
              const tx = db.transaction(['offlineReviews'], 'readwrite');
              tx.objectStore('offlineReviews').delete(offline_key);
              return tx.complete;
            })
              .then(() => console.log('offline rec delete success!'))
              .catch(err => console.log('offline store error', err));
            
          }).catch(err => {
            console.log(err, 'fetch error.');
            return;
          });
        return cursor.continue().then(nextRequest);
      })
      .then(() => console.log('Done cursoring'))
      .catch(err => console.log('Error opening cursor', err));
 }); }

    
  /**
   * Fetch a restaurant by its ID.
   */
  
  static fetchRestaurantById(id, callback) {
    // fetch all restaurants with proper error handling.
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        const restaurant = restaurants.find(r => r.id == id);
        if (restaurant) { // Got the restaurant
          callback(null, restaurant);
        } else { // Restaurant does not exist in the database
          callback('Restaurant does not exist', null);
        }
      }
    });
  }
  /**
   * Fetch restaurants by a cuisine type with proper error handling.
   */
  static fetchRestaurantByCuisine(cuisine, callback) {
    // Fetch all restaurants  with proper error handling
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Filter restaurants to have only given cuisine type
        const results = restaurants.filter(r => r.cuisine_type == cuisine);
        callback(null, results);
      }
    });
  }

  /**
   * Fetch restaurants by a neighborhood with proper error handling.
   */
  static fetchRestaurantByNeighborhood(neighborhood, callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Filter restaurants to have only given neighborhood
        const results = restaurants.filter(r => r.neighborhood == neighborhood);
        callback(null, results);
      }
    });
  }

  /**
   * Fetch restaurants by a cuisine and a neighborhood with proper error handling.
   */
  static fetchRestaurantByCuisineAndNeighborhood(cuisine, neighborhood, callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        let results = restaurants
        if (cuisine != 'all') { // filter by cuisine
          results = results.filter(r => r.cuisine_type == cuisine);
        }
        if (neighborhood != 'all') { // filter by neighborhood
          results = results.filter(r => r.neighborhood == neighborhood);
        }
        callback(null, results);
      }
    });
  }

  /**
   * Fetch all neighborhoods with proper error handling.
   */
  static fetchNeighborhoods(callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Get all neighborhoods from all restaurants
        const neighborhoods = restaurants.map((v, i) => restaurants[i].neighborhood)
        // Remove duplicates from neighborhoods
        const uniqueNeighborhoods = neighborhoods.filter((v, i) => neighborhoods.indexOf(v) == i)
        callback(null, uniqueNeighborhoods);
      }
    });
  }

  /**
   * Fetch all cuisines with proper error handling.
   */
  static fetchCuisines(callback) {
    // Fetch all restaurants
    DBHelper.fetchRestaurants((error, restaurants) => {
      if (error) {
        callback(error, null);
      } else {
        // Get all cuisines from all restaurants
        const cuisines = restaurants.map((v, i) => restaurants[i].cuisine_type)
        // Remove duplicates from cuisines
        const uniqueCuisines = cuisines.filter((v, i) => cuisines.indexOf(v) == i)
        callback(null, uniqueCuisines);
      }
    });
  }

  /**
   * Restaurant page URL.
   */
  static urlForRestaurant(restaurant) {
    return (`./restaurant.html?id=${restaurant.id}`);
  }

  /**
   * Restaurant image URL.
   */
  static imageUrlForRestaurant(restaurant) {
    if(restaurant.photograph === undefined)
      return (`/img/15.jpg`);
    return (`/img/${restaurant.photograph}.jpg`);
  }
  /**
   * Map marker for a restaurant.
   */
   static mapMarkerForRestaurant(restaurant, map) {
    // https://leafletjs.com/reference-1.3.0.html#marker  
    const marker = new L.marker([restaurant.latlng.lat, restaurant.latlng.lng],
      {title: restaurant.name,
      alt: restaurant.name,
      url: DBHelper.urlForRestaurant(restaurant)
      })
      marker.addTo(newMap);
    return marker;
  } 

   //functions to mark and Unmark Favorite button
  static setFavorite(id) { 
  fetch(`${DBHelper.RESTAURANTS_URL}${id}/?is_favorite=true`, {
    method: 'PUT'
  });
}


// http://localhost:1337/restaurants/<restaurant_id>/?is_favorite=false
static unSetFavorite(id) { 
  fetch(`${DBHelper.RESTAURANTS_URL}${id}/?is_favorite=false`, {
    method: 'PUT'
  });
}
  /* static mapMarkerForRestaurant(restaurant, map) {
    const marker = new google.maps.Marker({
      position: restaurant.latlng,
      title: restaurant.name,
      url: DBHelper.urlForRestaurant(restaurant),
      map: map,
      animation: google.maps.Animation.DROP}
    );
    return marker;
  } */

}

