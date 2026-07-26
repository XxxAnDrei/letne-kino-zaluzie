# Letné kino u vás na záhrade — Veľké Zálužie

Jednostránka s rezervačným kalendárom na bezplatné zapožičanie nafukovacieho
plátna, projektora a reproduktora rodinám vo Veľkom Záluží. Súčasťou je skrytý
správcovský panel, v ktorom sa žiadosti schvaľujú.

```
verejná stránka   /
správca           /spravca
```

## Rýchly štart

```bash
npm install
cp .env.example .env      # doplň ADMIN_PASSWORD a SESSION_SECRET
npm start
```

Beží na `http://localhost:3000`. Ak `ADMIN_PASSWORD` nenastavíš, server si
vygeneruje dočasné heslo a vypíše ho do konzoly pri štarte.

## Ako funguje obsadenosť

Termín je **jeden večer**: prevzatie o 17:00, vrátenie na druhý deň do 10:00.
Blokuje sa preto len deň prevzatia — nasledujúci večer už môže ísť niekomu inému.

Deň je v kalendári voľný, pokiaľ neplatí ani jedno z tohto:

| Stav        | Kedy nastane                                                     |
| ----------- | ---------------------------------------------------------------- |
| `taken`     | existuje žiadosť v stave *čaká* alebo *potvrdené*                 |
| `blocked`   | správca deň ručne zablokoval (dovolenka, servis)                  |
| `past`      | je v minulosti alebo bližšie než lehota na overenie (`lead_days`) |
| `offseason` | mimo sezóny letného kina                                          |
| `far`       | za horizontom, na ktorý sa dá rezervovať (`horizon_days`)         |
| `paused`    | príjem žiadostí je dočasne pozastavený                            |

Žiadosť **drží termín hneď po odoslaní**, aby ho medzitým nedostal niekto druhý.
Ak ju zamietneš alebo zrušíš, deň sa automaticky vráti do kalendára ako voľný.

Dvojité obsadenie rieši čiastočný unikátny index priamo v databáze, nie
aplikačná logika — pri dvoch súčasných žiadostiach na ten istý deň prejde prvá
a druhá dostane zrozumiteľnú chybu.

Náhradný termín (pre prípad dažďa) sa **eviduje, ale neblokuje** — inak by jedna
rodina obsadila dva večery. Vidíš ho v paneli pri každej žiadosti.

## Správcovský panel

Na `/spravca`, nikde na stránke naň nevedie odkaz. Prihlásenie je na heslo,
relácia trvá 12 hodín.

- schvaľovanie, zamietanie, rušenie a označenie za vybavené
- interná poznámka ku každej žiadosti
- ručné blokovanie dní
- nastavenia: sezóna, časy prevzatia a vrátenia, lehota vopred, horizont,
  maximálny počet osôb, pozastavenie príjmu
- export všetkých rezervácií do CSV (otvorí sa aj v Exceli s diakritikou)

## Premenné prostredia

| Premenná           | Načo je                                                        |
| ------------------ | -------------------------------------------------------------- |
| `ADMIN_PASSWORD`   | heslo do panela                                                  |
| `SESSION_SECRET`   | podpisuje prihlasovaciu cookie; bez neho odhlásenie pri reštarte |
| `PORT`             | port servera (predvolene 3000)                                   |
| `NODE_ENV`         | `production` zapne `secure` cookie — vyžaduje HTTPS              |
| `DATA_DIR`         | kam sa ukladá SQLite databáza                                    |
| `TRUST_PROXY_HOPS` | počet proxy vrstiev pred aplikáciou (hosting zvyčajne 1)         |

## Nasadenie

Aplikácia potrebuje **trvalý disk** — databáza je SQLite súbor. Serverless
hostingy typu Vercel preto nesedia.

```bash
docker build -t letne-kino .
docker run -d --name letne-kino \
  -p 3000:3000 \
  -v letne-kino-data:/data \
  -e ADMIN_PASSWORD='...' \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  letne-kino
```

Na Render/Railway/Fly stačí pripojiť disk na `/data` a nastaviť premenné.
Pred aplikáciu daj HTTPS (reverzná proxy alebo hosting to rieši sám) — bez neho
sa v produkcii neprenesie prihlasovacia cookie.

**Zálohovanie:** stačí kopírovať `data/kino.sqlite`. Pri bežiacom serveri použi
`sqlite3 data/kino.sqlite ".backup zaloha.sqlite"`, aby si nechytil rozpísanú
transakciu.

## Čo si ešte doplň

- **Telefón a meno v pätičke** — `public/index.html`, hľadaj `TODO`.
- **Sezónu a časy** — priamo v paneli, netreba zasahovať do kódu.
- Fotky a video sú v `public/media/`. Ak ich vymeníš, zachovaj názvy alebo
  uprav odkazy v `index.html`.

## Ako je to postavené

Bez build kroku — čo je v `public/`, to prehliadač dostane.

```
server/
  index.js        routy, bezpečnostné hlavičky, statické súbory
  db.js           SQLite schéma a nastavenia
  availability.js jediný zdroj pravdy o tom, či je termín voľný
  validate.js     validácia žiadosti so slovenskými hláškami
  auth.js         prihlásenie správcu, obmedzenie počtu pokusov
  dates.js        práca s dátumami v čase Europe/Bratislava
public/
  index.html      verejná stránka
  spravca.html    panel
  assets/js/      motion.js (GSAP), booking.js (kalendár), admin.js
  assets/fonts/   Instrument Sans + Serif, lokálne (nič sa neťahá z Googlu)
  media/          video a fotky
```

Fonty sú self-hostované zámerne — stránka nikam neposiela IP adresy
návštevníkov a funguje aj bez prístupu na cudzie CDN.

Animácie bežia na GSAP + ScrollTrigger a sú celé v `motion.js`. Rezervácia je od
nich oddelená: keby sa GSAP nenačítal, kalendár aj formulár fungujú ďalej.
Pri zapnutom `prefers-reduced-motion` sa pohyb vypne a obsah zostane statický.
