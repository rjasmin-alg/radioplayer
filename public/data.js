// Statički podaci: žanrovi, memorije za KV skener, streamovi skenera.
'use strict';

// [oznaka u radio-browser bazi, prikazni naziv, boja]
window.GENRES = [
  ['pop', 'Pop', '#e84393'], ['rock', 'Rock', '#d63031'], ['jazz', 'Jazz', '#6c5ce7'],
  ['classical', 'Klasična', '#a1785c'], ['electronic', 'Elektronska', '#0984e3'], ['dance', 'Dance', '#00b894'],
  ['house', 'House', '#00a8a8'], ['techno', 'Techno', '#2d3436'], ['trance', 'Trance', '#4834d4'],
  ['hip hop', 'Hip hop', '#e17055'], ['rnb', 'R&B', '#b33771'], ['soul', 'Soul', '#cc8e35'],
  ['funk', 'Funk', '#f0932b'], ['blues', 'Blues', '#30336b'], ['country', 'Country', '#a0522d'],
  ['folk', 'Folk', '#6a8d3f'], ['reggae', 'Reggae', '#27ae60'], ['metal', 'Metal', '#535c68'],
  ['punk', 'Punk', '#c0392b'], ['alternative', 'Alternativa', '#8e44ad'], ['indie', 'Indie', '#16a085'],
  ['ambient', 'Ambient', '#487eb0'], ['chillout', 'Chillout', '#40739e'], ['lounge', 'Lounge', '#8c7ae6'],
  ['oldies', 'Oldies', '#b8860b'], ['60s', '60-e', '#e1b12c'], ['70s', '70-e', '#c23616'],
  ['80s', '80-e', '#e056fd'], ['90s', '90-e', '#22a6b3'], ['schlager', 'Schlager', '#f368e0'],
  ['latin', 'Latino', '#ff6b35'], ['world music', 'World', '#218c74'], ['narodna', 'Narodna', '#9c6644'],
  ['tamburica', 'Tamburica', '#7d5a50'], ['dalmatian', 'Dalmatinska / klapa', '#1e6f9f'], ['balkan', 'Balkan', '#a4373a'],
  ['news', 'Vijesti', '#57606f'], ['talk', 'Govorni', '#6d7a8a'], ['sports', 'Sport', '#2e8b57'],
  ['christian', 'Duhovna', '#7f8fa6'], ['children', 'Za djecu', '#fbc531'], ['soundtrack', 'Filmska', '#353b48'],
];

// Memorije za KiwiSDR (frekvencija u kHz). Pokrivaju 0–30 MHz.
window.MEMORY_PRESETS = {
  'Zrakoplovstvo (VOLMET, ocean)': [
    [5505, 'usb', 'Shannon VOLMET'], [8957, 'usb', 'Shannon VOLMET'], [13264, 'usb', 'Shannon VOLMET'],
    [5450, 'usb', 'RAF VOLMET'], [11253, 'usb', 'RAF VOLMET'],
    [2872, 'usb', 'Shanwick Oceanic'], [5598, 'usb', 'Shanwick Oceanic'], [8879, 'usb', 'Shanwick Oceanic'], [13306, 'usb', 'Shanwick Oceanic'],
    [6676, 'usb', 'Bangkok VOLMET'], [10051, 'usb', 'Gander VOLMET'],
  ],
  'Pomorstvo': [
    [2182, 'usb', 'Pomorski poziv / pogibelj'], [4125, 'usb', 'Pomorski poziv'], [6215, 'usb', 'Pomorski poziv'],
    [8291, 'usb', 'Pomorski poziv'], [12290, 'usb', 'Pomorski poziv'], [518, 'usb', 'NAVTEX'],
  ],
  'Vremenski signali': [
    [77.5, 'cw', 'DCF77 Mainflingen'], [2500, 'am', 'WWV'], [5000, 'am', 'WWV / RWM'], [10000, 'am', 'WWV'],
    [15000, 'am', 'WWV'], [7850, 'usb', 'CHU Kanada'], [4996, 'am', 'RWM Moskva'],
  ],
  'Radioamateri': [
    [1840, 'lsb', '160 m'], [3700, 'lsb', '80 m'], [3760, 'lsb', '80 m (IARU R1 hitno)'], [7100, 'lsb', '40 m'], [7150, 'lsb', '40 m'],
    [10120, 'cw', '30 m (CW)'], [14200, 'usb', '20 m'], [14230, 'usb', '20 m SSTV'], [18130, 'usb', '17 m'],
    [21250, 'usb', '15 m'], [24950, 'usb', '12 m'], [28500, 'usb', '10 m'],
  ],
  'Radiodifuzija (KV)': [
    [3990, 'am', '75 m pojas'], [6000, 'am', '49 m pojas'], [6070, 'am', '49 m (CFRX i dr.)'], [7300, 'am', '41 m pojas'],
    [9600, 'am', '31 m pojas'], [11800, 'am', '25 m pojas'], [13700, 'am', '22 m pojas'], [15400, 'am', '19 m pojas'],
    [17700, 'am', '16 m pojas'], [21600, 'am', '13 m pojas'],
  ],
  'SV / DV (srednji i dugi val)': [
    [153, 'am', 'DV – Radio Romania Antena Satelor'], [198, 'am', 'DV – BBC R4'], [531, 'am', 'SV'], [612, 'am', 'SV'],
    [1134, 'am', 'SV'], [1215, 'am', 'SV'], [1440, 'am', 'SV'],
  ],
  'CB i ostalo': [
    [26965, 'am', 'CB kanal 1'], [27065, 'am', 'CB kanal 9 (hitni)'], [27185, 'am', 'CB kanal 19'], [27555, 'usb', 'CB 27.555 USB'],
    [4625, 'usb', 'UVB-76 „Buzzer“'], [7880, 'usb', 'DWD vremenski faks'], [10100.8, 'usb', 'DWD RTTY'],
  ],
};

// LiveATC streamovi (provjereno da rade) – pune se izravno s d.liveatc.net
window.LIVEATC = [
  ['ljlj_app', 'Ljubljana Approach (LJLJ)', 'SI'],
  ['kjfk_twr', 'New York JFK Tower', 'US'],
  ['klax_twr', 'Los Angeles LAX Tower', 'US'],
  ['ksfo_twr', 'San Francisco SFO Tower', 'US'],
  ['katl_twr', 'Atlanta ATL Tower', 'US'],
];

// Oznake u radio-browser bazi koje sadrže skener streamove
window.SCANNER_TAGS = [
  ['police scanner', 'Policija'], ['fire scanner', 'Vatrogasci'], ['ems scanner', 'Hitna pomoć'],
  ['scanner', 'Skener (općenito)'], ['air traffic control', 'Kontrola leta'], ['airport', 'Zračne luke'],
];
