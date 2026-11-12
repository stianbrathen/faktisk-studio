// Prikkeklode · ferdige steder for nedtrekkslista (hovedstaden brukes som punkt). [navn, breddegrad, lengdegrad]
var FPK_COUNTRIES = [
  ['Norge', 59.91, 10.75], ['Sverige', 59.33, 18.07], ['Danmark', 55.68, 12.57], ['Finland', 60.17, 24.94], ['Island', 64.15, -21.94],
  ['Tyskland', 52.52, 13.40], ['Storbritannia', 51.51, -0.13], ['Irland', 53.35, -6.26], ['Frankrike', 48.86, 2.35], ['Spania', 40.42, -3.70],
  ['Portugal', 38.72, -9.14], ['Italia', 41.90, 12.50], ['Nederland', 52.37, 4.90], ['Belgia', 50.85, 4.35], ['Sveits', 46.95, 7.45],
  ['Østerrike', 48.21, 16.37], ['Polen', 52.23, 21.01], ['Tsjekkia', 50.08, 14.44], ['Ungarn', 47.50, 19.04], ['Romania', 44.43, 26.10],
  ['Bulgaria', 42.70, 23.32], ['Hellas', 37.98, 23.73], ['Serbia', 44.79, 20.45], ['Kroatia', 45.81, 15.98], ['Estland', 59.44, 24.75],
  ['Latvia', 56.95, 24.11], ['Litauen', 54.69, 25.28], ['Ukraina', 50.45, 30.52], ['Hviterussland', 53.90, 27.57], ['Russland', 55.76, 37.62],
  ['Moldova', 47.01, 28.86], ['Georgia', 41.72, 44.79], ['Armenia', 40.18, 44.51], ['Aserbajdsjan', 40.41, 49.87], ['Tyrkia', 39.93, 32.86],
  ['Kypros', 35.17, 33.36], ['Israel', 31.77, 35.21], ['Libanon', 33.89, 35.50], ['Syria', 33.51, 36.29], ['Jordan', 31.95, 35.93],
  ['Irak', 33.31, 44.36], ['Iran', 35.69, 51.39], ['Saudi-Arabia', 24.71, 46.68], ['De forente arabiske emirater', 24.45, 54.38], ['Qatar', 25.29, 51.53],
  ['Egypt', 30.04, 31.24], ['Libya', 32.89, 13.19], ['Tunisia', 36.81, 10.18], ['Algerie', 36.75, 3.06], ['Marokko', 34.02, -6.83],
  ['Nigeria', 9.08, 7.40], ['Ghana', 5.60, -0.19], ['Senegal', 14.72, -17.47], ['Etiopia', 9.03, 38.74], ['Kenya', -1.29, 36.82],
  ['Sør-Afrika', -25.75, 28.19], ['Afghanistan', 34.56, 69.21], ['Pakistan', 33.68, 73.05], ['India', 28.61, 77.21], ['Bangladesh', 23.81, 90.41],
  ['Nepal', 27.72, 85.32], ['Sri Lanka', 6.93, 79.86], ['Kasakhstan', 51.17, 71.45], ['Usbekistan', 41.30, 69.24], ['Kina', 39.90, 116.41],
  ['Hongkong', 22.32, 114.17], ['Taiwan', 25.03, 121.57], ['Japan', 35.68, 139.69], ['Sør-Korea', 37.57, 126.98], ['Nord-Korea', 39.04, 125.76],
  ['Mongolia', 47.89, 106.91], ['Myanmar', 19.76, 96.08], ['Thailand', 13.76, 100.50], ['Vietnam', 21.03, 105.85], ['Kambodsja', 11.56, 104.93],
  ['Laos', 17.98, 102.63], ['Malaysia', 3.14, 101.69], ['Singapore', 1.35, 103.82], ['Indonesia', -6.21, 106.85], ['Filippinene', 14.60, 120.98],
  ['Australia', -35.28, 149.13], ['New Zealand', -41.29, 174.78], ['USA', 38.91, -77.04], ['Canada', 45.42, -75.70], ['Mexico', 19.43, -99.13],
  ['Cuba', 23.11, -82.37], ['Colombia', 4.71, -74.07], ['Venezuela', 10.48, -66.90], ['Peru', -12.05, -77.04], ['Brasil', -15.79, -47.88],
  ['Chile', -33.45, -70.67], ['Argentina', -34.60, -58.38]
];
