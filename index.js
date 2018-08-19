	document.addEventListener("DOMContentLoaded", fetchCurrencies);

	let currencyFrom = document.getElementById('currfrom');

	let currencyTo = document.getElementById('currto');

	const baseUrl = 'https://free.currencyconverterapi.com/api/v5/';

	document.getElementById('convertButton').addEventListener('click', computeConversion);

	function fetchCurrencies() {
		fetch(`${baseUrl}currencies`)
		
			.then((response)=>{
				response.json().then((data) =>{
					
				let currencies = data.results;
				
				populateSelectBoxes(currencies);
				})})
				.catch(err => console.log(err));
	}

	function populateSelectBoxes(currencies) {
		for ( currency in currencies) {
			
			let optionFrom = document.createElement('option');
			let optionTo = document.createElement('option');
			
			optionFrom.text = `${currencies[currency].currencyName} (${currency})`;
			optionFrom.value = currency;
			
			currencyFrom.appendChild(optionFrom);
			
			optionTo.text = `${currencies[currency].currencyName} (${currency})`;
			optionTo.value = currency;
			
			currencyTo.appendChild(optionTo);  
		}
	}
	//service worker
	if ('serviceWorker' in navigator) {
		window.addEventListener('load', function() {
			navigator.serviceWorker.register('./sw.js').then(function(registration) {
				// Registration was successful
				console.log('ServiceWorker registration successful with scope: ', registration.scope);
			}, (err) =>{
				// log to console if registration failed
				console.log('ServiceWorker registration failed: ', err);
			});
		});
	}
	
	//for indexDB
	let dbPromise = idb.open('convert-db', 4, (upgradeDb) =>{
			
		let rateStore = upgradeDb.createObjectStore('rates', {
			keyPath: 'pairs'
		});
	});
	
	function computeConversion() {
		let fromCurrency = currencyFrom.options[currencyFrom.selectedIndex].value;
		let toCurrency = currencyTo.options[currencyTo.selectedIndex].value;
		
		let amount = Number(document.getElementById('amount').value);
		
		if(!amount) { 
		//put a notificatio here for the user
					mySnackBar('Enter an Amount!');
					return; }
		
		let query = `${fromCurrency}_${toCurrency}`;
		let url =  `${baseUrl}convert?q=${query}&compact=ultra`;
	
		//check if value is in the DB
		dbPromise.then((db) =>{
			let tx = db.transaction('rates', 'readwrite');
			let rateStore = tx.objectStore('rates');
			
			//console.log('i am query', query);
			return rateStore.get(query); 
		}).then((value) =>{
			
				if (value === undefined || value === null) {
				fetch(url)  
				.then((response) =>{  
						if (response.status !== 200) {  
							console.warn('Looks like there was a problem. Status Code: ' + response.status);  
							return;  
						}
						
						return response.json();
						}).then((data) =>{
								
									let val = data[query];
									
									if (val) {
										
											//create transaction
											//store the value
											dbPromise.then((db) =>{
												let tx = db.transaction('rates', 'readwrite');
												let rateStore = tx.objectStore('rates');
												
												rateStore.put({
													pairs: query,
													convertRate: val
												});
												return tx.complete;
												
											}).then(()=> {
												
												//then compute conversion
												let total = parseFloat(val) * parseFloat(amount);
												document.getElementById('convertedCurrency').value = total.toFixed(2);
											});
										} else {
												let err = new Error(`Your query: ${query} returned in an empty result, try again `);
												//console.log(err);
												mySnackBar(err);
												
											}
									}).catch(() => {
												//I want to display to the user, if unable to fetch result online
												//console.log("Network error please try again");
												mySnackBar("Network error please try again");// output notice to user
												
											});
				} else {
					//console.log('The value of pairs is:', value); for example {pairs: "LYD_FKP", convertRate: 0.553614}
					
					let rate = value.convertRate; //gets only the convert rate
					
					//then compute conversion
					let total = parseFloat(rate) * parseFloat(amount);
					
					//console.log(total);
					document.getElementById('convertedCurrency').value = total.toFixed(2);
					
				}
				}).catch(() => {
				console.log("Error", err);
				});
	}
	
	//show snackbar notification function
	function mySnackBar(message) {
    let x = document.getElementById("snackbar");
    x.className = "show";
	document.getElementById("demo").innerHTML = message;
    setTimeout(()=>{ x.className = x.className.replace("show", ""); }, 3000);
}
