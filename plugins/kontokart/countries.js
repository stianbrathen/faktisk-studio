// Faktisk Studio · Kontokart · landkoordinater (omtrentlig midtpunkt / hovedstad). Norske navn + vanlige varianter.
var KK_LAND = {
  'norge': [61, 9.5], 'danmark': [56, 9.5], 'sverige': [60.1, 15.6], 'finland': [62, 25.7], 'island': [64.9, -18.6],
  'storbritannia': [53.5, -1.8], 'uk': [53.5, -1.8], 'england': [52.4, -1.5], 'irland': [53.2, -8.2], 'frankrike': [46.6, 2.4],
  'nederland': [52.2, 5.5], 'belgia': [50.6, 4.6], 'luxembourg': [49.8, 6.1], 'sveits': [46.8, 8.2], 'østerrike': [47.6, 14.1],
  'tyskland': [51.2, 10.4], 'italia': [42.8, 12.6], 'spania': [40.4, -3.7], 'portugal': [39.6, -8.0], 'polen': [52.1, 19.4],
  'tsjekkia': [49.8, 15.5], 'slovakia': [48.7, 19.7], 'ungarn': [47.2, 19.4], 'romania': [45.9, 24.9], 'bulgaria': [42.7, 25.5],
  'hellas': [39.1, 22.9], 'tyrkia': [39.0, 35.2], 'kypros': [35.1, 33.4], 'russland': [56.0, 38.0], 'ukraina': [49.0, 31.4],
  'hviterussland': [53.7, 28.0], 'belarus': [53.7, 28.0], 'estland': [58.6, 25.0], 'latvia': [56.9, 24.6], 'litauen': [55.2, 23.9],
  'serbia': [44.0, 20.9], 'kroatia': [45.1, 15.2], 'bosnia-hercegovina': [43.9, 17.7], 'albania': [41.2, 20.2], 'kosovo': [42.6, 20.9],
  'nord-makedonia': [41.6, 21.7], 'moldova': [47.4, 28.4], 'georgia': [42.3, 43.4], 'armenia': [40.1, 45.0], 'aserbajdsjan': [40.1, 47.6],
  'israel': [31.0, 34.9], 'palestina': [31.9, 35.2], 'libanon': [33.9, 35.9], 'syria': [35.0, 38.5], 'jordan': [31.2, 36.5],
  'irak': [33.2, 43.7], 'iran': [32.4, 53.7], 'saudi-arabia': [23.9, 45.1], 'de forente arabiske emirater': [24.3, 54.4], 'emiratene': [24.3, 54.4],
  'qatar': [25.3, 51.2], 'kuwait': [29.3, 47.5], 'jemen': [15.6, 48.5], 'oman': [21.5, 55.9],
  'egypt': [26.8, 30.8], 'libya': [26.3, 17.2], 'tunisia': [33.9, 9.5], 'algerie': [28.0, 1.7], 'marokko': [31.8, -7.1],
  'nigeria': [9.1, 8.7], 'ghana': [7.9, -1.0], 'senegal': [14.5, -14.5], 'kamerun': [7.4, 12.4], 'etiopia': [9.1, 40.5],
  'kenya': [-0.0, 37.9], 'uganda': [1.4, 32.3], 'tanzania': [-6.4, 34.9], 'somalia': [5.2, 46.2], 'sudan': [12.9, 30.2],
  'sør-afrika': [-30.6, 22.9], 'zimbabwe': [-19.0, 29.2], 'kongo': [-4.0, 21.8], 'angola': [-11.2, 17.9],
  'pakistan': [30.4, 69.3], 'afghanistan': [33.9, 67.7], 'india': [20.6, 78.9], 'bangladesh': [23.7, 90.4], 'sri lanka': [7.9, 80.8],
  'nepal': [28.4, 84.1], 'kasakhstan': [48.0, 66.9], 'usbekistan': [41.4, 64.6], 'kina': [35.9, 104.2], 'mongolia': [46.9, 103.8],
  'japan': [36.2, 138.3], 'sør-korea': [35.9, 127.8], 'nord-korea': [40.3, 127.5], 'taiwan': [23.7, 121.0], 'hongkong': [22.3, 114.2],
  'vietnam': [14.1, 108.3], 'thailand': [15.9, 100.9], 'kambodsja': [12.6, 105.0], 'laos': [19.9, 102.5], 'myanmar': [21.9, 95.9],
  'malaysia': [4.2, 102.0], 'singapore': [1.35, 103.8], 'indonesia': [-0.8, 113.9], 'filippinene': [12.9, 121.8],
  'australia': [-25.3, 133.8], 'new zealand': [-40.9, 174.9], 'usa': [39.5, -98.4], 'canada': [56.1, -106.3], 'mexico': [23.6, -102.6],
  'cuba': [21.5, -77.8], 'brasil': [-14.2, -51.9], 'argentina': [-38.4, -63.6], 'chile': [-35.7, -71.5], 'colombia': [4.6, -74.3],
  'venezuela': [6.4, -66.6], 'peru': [-9.2, -75.0], 'ecuador': [-1.8, -78.2], 'bolivia': [-16.3, -63.6]
};
var KK_ALIAS = { 'germany': 'tyskland', 'spain': 'spania', 'philippines': 'filippinene', 'united states': 'usa', 'us': 'usa',
  'denmark': 'danmark', 'norway': 'norge', 'sweden': 'sverige', 'united kingdom': 'storbritannia', 'netherlands': 'nederland',
  'france': 'frankrike', 'italy': 'italia', 'poland': 'polen', 'russia': 'russland', 'ukraine': 'ukraina', 'turkey': 'tyrkia',
  'türkiye': 'tyrkia', 'china': 'kina', 'south africa': 'sør-afrika', 'uae': 'de forente arabiske emirater', 'brazil': 'brasil',
  'vietnam': 'vietnam', 'south korea': 'sør-korea', 'greece': 'hellas', 'belgium': 'belgia', 'austria': 'østerrike',
  'switzerland': 'sveits', 'czech republic': 'tsjekkia', 'czechia': 'tsjekkia', 'hungary': 'ungarn', 'egypt': 'egypt' };
function kkLand(name) {
  var k = String(name || '').trim().toLowerCase();
  k = KK_ALIAS[k] || k;
  return KK_LAND[k] ? { lat: KK_LAND[k][0], lon: KK_LAND[k][1] } : null;
}
