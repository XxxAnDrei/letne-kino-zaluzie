# Letné kino u vás na záhrade — Veľké Zálužie

Jednostránka s rezervačným kalendárom na bezplatné zapožičanie nafukovacieho
plátna, projektora a reproduktora. Súčasťou je sekcia s dobrovoľným príspevkom
pre občianske združenie Šport Veľké Zálužie a skrytý správcovský panel,
v ktorom sa žiadosti schvaľujú.

Počas úvodnej fázy majú pri prideľovaní termínov prednosť obyvatelia Veľkého
Zálužia. Jednotlivé dni sa dajú otvoriť aj pre okolité obce.

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

Každý voľný termín nesie navyše **určenie**, teda pre koho je otvorený:

| Určenie    | Kto môže požiadať                                     |
| ---------- | ----------------------------------------------------- |
| `zaluzie`  | iba obyvatelia Veľkého Zálužia (predvolené)           |
| `all`      | aj záujemcovia z okolitých obcí                       |
| `approval` | ktokoľvek, ale termín potvrdzuješ individuálne        |

Predvolené určenie sa nastavuje globálne, jednotlivé dni sa prepínajú v paneli.
Obec sa porovnáva bez ohľadu na diakritiku a veľkosť písmen, takže „velke
zaluzie" prejde rovnako ako „Veľké Zálužie".

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
  predvolené určenie termínov, pozastavenie príjmu
- presun na náhradný termín pri zlom počasí — pôvodný deň sa uvoľní späť
- odovzdávací a preberací zoznam s časom, položkami a stavom vybavenia
- určenie termínov pre Zálužie / okolité obce / po dohode
- blokovanie problémových kontaktov (telefón alebo e-mail)
- údaje občianskeho združenia vrátane IBAN, ktoré idú do QR platby
- export všetkých rezervácií do CSV (otvorí sa aj v Exceli s diakritikou)

## Dobrovoľný príspevok

Sekcia je zámerne oddelená od rezervácie — príspevok nikdy nie je podmienkou
odoslania žiadosti a formulár sa bez neho odošle úplne rovnako.

QR kód sa generuje na serveri podľa štandardu **PAY by square**, takže ho
prečítajú slovenské bankové aplikácie. Bez zadanej sumy vznikne QR, do ktorého
si človek doplní sumu sám; to je zámer, nie nedorobok. Ako záloha slúži odkaz
na `payme.sk` s predvyplneným účtom.

Údaje združenia (názov, IBAN, správa) sú v HTML aj staticky, aby stránka dávala
zmysel bez JavaScriptu, a po načítaní sa zosúladia s tým, čo má správca uložené
v nastaveniach.

## Premenné prostredia

| Premenná           | Načo je                                                        |
| ------------------ | -------------------------------------------------------------- |
| `ADMIN_PASSWORD`      | heslo do panela                                                  |
| `SESSION_SECRET`      | podpisuje prihlasovaciu cookie; bez neho odhlásenie pri reštarte |
| `DATABASE_URL`        | adresa Postgresu (Supabase); má prednosť pred Tursom              |
| `TURSO_DATABASE_URL`  | adresa Turso databázy                                             |
| `TURSO_AUTH_TOKEN`    | token k Turso databáze                                            |
| `PGPOOL_MAX`          | veľkosť fondu pripojení k Postgresu (predvolene 3)                |
| `PORT`                | port servera (predvolene 3000), na Verceli sa ignoruje           |
| `NODE_ENV`            | `production` zapne `secure` cookie — vyžaduje HTTPS              |
| `DATA_DIR`            | kam sa ukladá lokálna databáza                                    |
| `TRUST_PROXY_HOPS`    | počet proxy vrstiev pred aplikáciou (hosting zvyčajne 1)         |

## Databáza

Server hovorí s tromi druhmi úložiska cez jedno rozhranie v `server/driver.js`.
Vyberie si podľa premenných prostredia:

| Čo je nastavené                        | Kam sa pripojí          |
| -------------------------------------- | ----------------------- |
| `DATABASE_URL=postgres://…`            | Postgres (Supabase)     |
| `TURSO_DATABASE_URL=libsql://…`        | Turso                   |
| nič z toho                             | lokálny súbor v `DATA_DIR` |

Dopyty sú písané raz, so zástupnými `?`; pre Postgres si ich ovládač preloží na
`$1, $2…`. Rozdiely medzi dialektmi sú len dva a oba sú v `server/db.js`: typ
primárneho kľúča a typ celého čísla. Ostatné — `ON CONFLICT`, `COALESCE`,
čiastočný unikátny index — funguje v SQLite aj v Postgrese rovnako.

Vďaka tomu sa dá medzi Supabase a Tursom prepnúť zmenou premennej prostredia,
bez zásahu do kódu. Schéma sa vytvorí sama pri prvej požiadavke.

## Nasadenie na Vercel

Serverless funkcia má dočasný súborový systém, takže lokálny súbor tam nestačí —
rezervácie by sa po každom nasadení stratili. Treba hostovanú databázu.

### So Supabase

1. Vytvor projekt na [supabase.com](https://supabase.com). Netreba v ňom nič
   klikať: tabuľky si aplikácia založí sama.
2. **Project Settings → Database → Connection string → Transaction pooler.**
   Skopíruj adresu s portom **6543**, nie 5432. Doplň do nej heslo k databáze.
3. **Vercel**: naimportuj repozitár a nastav `DATABASE_URL`, `ADMIN_PASSWORD`,
   `SESSION_SECRET` a `NODE_ENV=production`.
4. Nasaď.

Prečo port 6543: priame pripojenie na 5432 drží jedno spojenie na inštanciu
funkcie a Supabase by ich pri návale minul. Pooler (Supavisor) v transakčnom
režime ich zdieľa; ovládač preto beží s vypnutými *prepared statements*, čo
tento režim vyžaduje.

**Na čo si dať pozor:** projekt v bezplatnom pásme Supabase sa po približne
týždni bez jediného dopytu uspí a prvá ďalšia požiadavka počká, kým sa zobudí.
Pri sezónnej stránke sa to stane cez zimu takmer isto. Nie je to porucha a dáta
sa nestrácajú, ale ak chceš mať istotu, buď si projekt raz za čas otvor, alebo
zvoľ Turso — to sa neuspáva.

### S Tursom

```bash
turso db create letne-kino
turso db show letne-kino --url      # → TURSO_DATABASE_URL
turso db tokens create letne-kino   # → TURSO_AUTH_TOKEN
```

Na Verceli potom nastav `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`ADMIN_PASSWORD`, `SESSION_SECRET` a `NODE_ENV=production`.

Ako je to poskladané:

- `public/` obsluhuje CDN, `api/index.js` je jediná serverless funkcia
  a `vercel.json` presmeruje `/api/*` na ňu
- `npm run build` skopíruje GSAP z `node_modules` do `public/vendor`
- bezpečnostné hlavičky sú aj vo `vercel.json`, lebo statiku Express nevidí

Ak by po prvom nasadení niektorá `/api/*` cesta vracala 404, pozri sa na
`rewrites` vo `vercel.json` — to je jediné miesto, kde sa smerovanie rieši.

**Zálohovanie:** v Supabase `Database → Backups`, prípadne `pg_dump "$DATABASE_URL"
> zaloha.sql`. Pri Turse `turso db shell letne-kino .dump > zaloha.sql`.

## Nasadenie na vlastný server

Rovnaký kód beží aj klasicky. Bez `DATABASE_URL` a `TURSO_DATABASE_URL` použije
lokálny súbor, takže stačí pripojiť trvalý disk na `/data`:

```bash
docker build -t letne-kino .
docker run -d --name letne-kino \
  -p 3000:3000 \
  -v letne-kino-data:/data \
  -e ADMIN_PASSWORD='...' \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  letne-kino
```

Pred aplikáciu daj HTTPS — bez neho sa v produkcii neprenesie prihlasovacia
cookie. Zálohovanie je vtedy kopírovanie `data/kino.sqlite`.

## Čo si ešte doplň

- **Sezónu a časy** — priamo v paneli, netreba zasahovať do kódu.
- **Rozmery plátna vo výkrese** — `≈ 5,2 × 3,4 m` v `index.html` je odvodené
  z uhlopriečky 200 palcov. Ak máš údaje svojho kusu, prepíš ich; sú na
  jednom mieste v SVG so `class="draw--scale"`.
- V `public/media/` je len video a poster do hero. Ak ich vymeníš, zachovaj
  názvy alebo uprav `data-desktop` a `data-mobile` na prvku videa.

## Ako je to postavené

Bez build kroku — čo je v `public/`, to prehliadač dostane.

```
api/
  index.js        vstupný bod pre Vercel — exportuje tú istú aplikáciu
server/
  app.js          všetky routy a bezpečnostné hlavičky
  index.js        lokálny beh: statické súbory a app.listen
  driver.js       pripojenie k Postgresu, Turse alebo lokálnemu súboru
  db.js           schéma a nastavenia
  availability.js jediný zdroj pravdy o tom, či je termín voľný
  validate.js     validácia žiadosti so slovenskými hláškami
  auth.js         prihlásenie správcu, obmedzenie počtu pokusov
  env.js          načíta .env bez závislosti
  dates.js        práca s dátumami v čase Europe/Bratislava
public/
  index.html      verejná stránka
  spravca.html    panel
  assets/js/      motion.js (GSAP), booking.js (kalendár),
                  donation.js (príspevok a QR), admin.js
  assets/fonts/   Instrument Sans + Serif, lokálne (nič sa neťahá z Googlu)
  media/          video a poster do hero
```

Grafika mimo hero nie sú fotky, ale kreslené SVG priamo v `index.html` —
mierkový výkres plátna v sekcii „Čo potrebuješ zabezpečiť" a elevácia záhrady v scéne
večera. Sú inline preto, že ich animuje GSAP podľa pozície scrollu a potrebuje
sa dostať na jednotlivé skupiny (`#gScreen`, `#gKit`, `#gPeople` a ďalšie).

Fonty sú self-hostované zámerne — stránka nikam neposiela IP adresy
návštevníkov a funguje aj bez prístupu na cudzie CDN.

Obmedzovanie počtu žiadostí je v databáze, nie v pamäti procesu. Na Verceli
beží každá požiadavka potenciálne v inej inštancii, takže počítadlo v pamäti
by nechránilo pred ničím.

Animácie bežia na GSAP + ScrollTrigger a sú celé v `motion.js`. Rezervácia je od
nich oddelená: keby sa GSAP nenačítal, kalendár aj formulár fungujú ďalej.
Pri zapnutom `prefers-reduced-motion` sa pohyb vypne a obsah zostane statický.
