# RadioPlayer

Lokalni web player za internetski radio i WebSDR prijemnike. Radi na Windowsima (primarno) i Linuxu.
Nema vanjskih ovisnosti – treba samo [Node.js](https://nodejs.org) 18 ili noviji.

## Desktop aplikacija (Windows .exe)

`dist\RadioPlayer-1.0.0.exe` je samostalna aplikacija: jedna datoteka, bez instalacije i bez Node.js-a.
Dvoklik otvara vlastiti prozor; ništa ne ostaje raditi u pozadini nakon zatvaranja.

- Minimiziranje skriva prozor u traku sa satom; radio nastavlja svirati. Klik na ikonu vraća prozor,
  desni klik nudi sviraj/pauza, sljedeći favorit i izlaz. Zatvaranje prozora (✕) gasi aplikaciju.
- Podaci (favoriti, memorije, postavke) su u `%APPDATA%\radioplayer\data`.
- Exe nije digitalno potpisan, pa Windows SmartScreen pri prvom pokretanju može pitati
  „Više informacija → Ipak pokreni“.
- „Odredi automatski“ lokaciju u Postavkama ne radi u desktop verziji – upiši širinu i dužinu ručno.
- Prijenosna verzija se pri svakom pokretanju raspakira u privremenu mapu, pa start traje nekoliko sekundi.

Ponovna izgradnja (treba Node.js):

```
npm install
npm run dist
```

`npm run desktop` pokreće desktop verziju bez pakiranja (za razvoj), a `npm run icon` ponovno
iscrtava `desktop/icon.png` iz `public/icon.svg`. Za Linux: `npm run dist:linux` (AppImage, gradi se na Linuxu).

## Desktop aplikacija (macOS)

macOS verzija se ne može izgraditi na Windowsima (Appleovi alati za pakiranje rade samo na macOS-u).
Dva načina:

**Na Macu** (treba Node.js): kopiraj mapu projekta bez `node_modules` i `dist`, pa

```
npm install
npm run dist:mac
```

U `dist/` nastaju `RadioPlayer-1.0.0-mac-arm64.dmg` (Apple Silicon, M1–M4) i `…-mac-x64.dmg` (Intel), plus `.zip` inačice.

**Preko GitHuba (bez Maca):** stavi projekt u GitHub repozitorij, pa Actions → „Build“ → *Run workflow*
(ili push oznake `v1.0.0`). Workflow `.github/workflows/build.yml` gradi macOS i Windows verziju;
gotove datoteke su pod *Artifacts*.

Aplikacija nije potpisana Apple Developer certifikatom niti notarizirana, pa je macOS pri prvom
pokretanju blokira. Otvori je desnim klikom → **Open** → **Open**, ili u *System Settings → Privacy & Security*
klikni **Open Anyway**. Ako javi da je „oštećena“, u Terminalu pokreni:

```
xattr -cr /Applications/RadioPlayer.app
```

Podaci su na macOS-u u `~/Library/Application Support/radioplayer/data`.
Web verzija radi i na macOS-u: `sh start.sh` (treba Node.js).

## Web verzija (preglednik)

- **Windows:** dvoklik na `start.bat` (otvori preglednik na http://127.0.0.1:8642/)
- **Linux:** `sh start.sh` ili `node server.js --open`

Port se mijenja varijablom okoline `PORT`, npr. `set PORT=9000` prije pokretanja.
Web i desktop verzija koriste isti kod (`server.js` + `public/`), ali odvojene podatke.

## Što zna

| Kartica | Opis |
|---|---|
| **Lokalno** | Stanice iz odabrane države (zadano Hrvatska), filtar po regiji, sortiranje |
| **Pretraga** | Cijeli svijet: ime, država, žanr, jezik, kodek, kvaliteta |
| **Žanrovi** | Gotovi žanrovi + sve oznake iz baze, opcionalno samo za jednu državu |
| **Karta stanica** | Stanice s koordinatama na karti (OpenStreetMap) |
| **WebSDR** | ~1800 KiwiSDR / OpenWebRX / WebSDR prijemnika: popis ili karta, udaljenost od tebe, slobodna mjesta, KV ili VHF/UHF |
| **Skener** | Ugrađeni KiwiSDR tuner (0–30 MHz) sa S-metrom, squelchom, memorijama i skeniranjem (memorije ili raspon frekvencija). Streamovi kontrole leta (LiveATC), policije/vatrogasaca i vlastiti streamovi |
| **Favoriti** | Omiljene stanice i SDR-ovi, vlastiti streamovi, povijest slušanja |

Player traka: vizualizator spektra, „trenutno svira“ (ICY metapodaci), automatsko gašenje,
tipke za medije u Windowsima, razmaknica za play/pauzu.

## Izvori podataka

- Radio stanice: [radio-browser.info](https://www.radio-browser.info) – besplatna, otvorena baza besplatnih streamova.
- KiwiSDR: javni popis s [kiwisdr.com/public](http://kiwisdr.com/public/) (preko rx.linkfanel.net).
- OpenWebRX / WebSDR / KiwiSDR: [receiverbook.de](https://www.receiverbook.de).
- websdr.org ne dopušta automatsko preuzimanje popisa, pa je u aplikaciji samo poveznica na njega.

Popisi SDR-ova se spremaju 30 min u memoriju i u `data/sdr-cache.json` (rezerva ako izvori ne rade).

## Napomene

- **Ugrađeni tuner** radi samo s KiwiSDR prijemnicima (njihov protokol je jednostavan). OpenWebRX i WebSDR
  otvaraju se u ugrađenom prozoru ili novom tabu – tamo se zvuk pokreće klikom unutar stranice.
- Neki KiwiSDR-ovi iza `proxy.kiwisdr.com` ne prihvaćaju vanjski klijent – tada koristi „Otvori ovdje“.
- KV pokriva 0–30 MHz. Za VHF/UHF (zračni promet 118–137 MHz, repetitori 2 m / 70 cm, PMR) u kartici WebSDR
  odaberi „VHF / UHF“ – to su OpenWebRX prijemnici s RTL-SDR i sličnim uređajima.
- Javni prijemnici imaju ograničen broj mjesta – aplikacija se odspaja čim prijeđeš na drugi izvor.
- Favoriti, memorije i postavke su u mapi `data/` (izvoz/uvoz u Postavkama).
- Poslužitelj sluša samo na `127.0.0.1`. Za pristup s drugih uređaja u mreži: `HOST=0.0.0.0`.
