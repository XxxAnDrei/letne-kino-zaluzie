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

## E-maily

Posiela sa šesť správ:

| Kedy                        | Komu        | O čom                                            |
| --------------------------- | ----------- | ------------------------------------------------ |
| príde žiadosť               | správcovi   | kontakt, termín, poznámka, odkaz do panela       |
| príde žiadosť               | žiadateľovi | termín je podržaný, ešte to nie je potvrdenie    |
| žiadosť sa schváli/zamietne | žiadateľovi | potvrdenie s pokynmi, alebo dôvod zamietnutia    |
| padne náhradný termín       | žiadateľovi | hlavný termín platí, náhradný už nie je voľný    |
| termín sa preloží           | žiadateľovi | starý aj nový dátum, pôvodný sa uvoľnil          |
| ráno pred premietaním       | žiadateľovi | čas prevzatia, čo pripraviť, pozor na počasie    |

Rozhodnutie odchádza len pri skutočnej zmene stavu, takže dopísanie internej
poznámky k žiadosti nikomu e-mail nepošle.

### Padnutý náhradný termín

Náhradný termín sa **zámerne neblokuje** — inak by jedna rodina držala dva
večery. Môže si ho teda kedykoľvek vziať iná rezervácia alebo ho správca zavrie
ako blokovaný deň. V oboch prípadoch o tom čakateľ dostane správu; bez nej by
sa to dozvedel až v daždi, keď sa preložiť už nemá kam.

Stĺpec `backup_alert_at` drží, že sa už písalo, takže opakované zablokovanie ani
ďalšia rezervácia na ten istý deň nepošlú tú istú správu druhýkrát. Presun
termínu značku vynuluje — s novým náhradným termínom má upozornenie opäť platiť.

### Pripomienka pred premietaním (cron)

Na Verceli nič nebeží samo od seba, funkcia sa prebudí len na požiadavku.
Pripomienku preto spúšťa **Vercel Cron**, nastavený vo `vercel.json`:

```json
"crons": [{ "path": "/api/cron/reminders", "schedule": "0 7 * * *" }]
```

Rozvrh je v UTC, takže 7:00 UTC je 9:00 v lete a 8:00 v zime.

Endpoint chráni `CRON_SECRET`. Vercel ho pri každom behu pošle sám v hlavičke
`Authorization: Bearer …`, stačí ho mať medzi premennými projektu; vygeneruj ho
napríklad cez `openssl rand -hex 32`. **Bez tejto premennej cron dostane 401** a
pripomienky sa nepošlú — endpoint potom otvorí len prihlásený správca.

Čo cron robí:

- berie **potvrdené** rezervácie na dnes aj na zajtra; keby jeden deň vypadol,
  ten, komu mala pripomienka prísť včera, ju dostane aspoň ráno v deň
  premietania a text sa sám prepne zo „zajtra" na „dnes"
- `reminded_at` zaručí, že opakované spustenie v ten istý deň nepošle nič znova
- značka sa zapíše **len tomu, komu e-mail naozaj odišiel**; keby sa označili
  všetci, výpadok Brevo by pripomienku ticho zhltol a druhý pokus by už neprišiel
- žiadosti, ktoré sú deň pred premietaním stále v stave *čaká*, sa nepripomínajú,
  ale vypíšu sa v odpovedi, nech ich správca v paneli vidí

V paneli je tlačidlo **Spustiť pripomienky teraz** — robí to isté ručne, aby sa
na overenie nemuselo čakať do rána.

Odosiela sa cez **Brevo** a cez jeho HTTP API, nie cez SMTP: serverless funkcia
žije pár sekúnd a držať v nej otvorené SMTP spojenie je pomalé. Adresa
odosielateľa musí byť v Breve overená, inak ju Brevo odmietne.

**E-mail nikdy nezhodí rezerváciu.** Keď kľúč chýba, keď Brevo vypadne alebo
odpovie chybou, žiadosť sa aj tak uloží a človek uvidí svoj lístok; dôvod sa
zapíše do logu. Na Verceli ho nájdeš v *Deployments → Runtime Logs*.

V paneli je sekcia **E-maily**: ukáže, ktorá premenná chýba alebo z akej adresy
sa posiela, a tlačidlom odošle skúšobnú správu. Vráti presné znenie odpovede
od Brevo, nie len kód chyby.

### Povolené IP adresy v Breve

Brevo má v *Settings → Security → Authorised IPs* prepínač, ktorý pustí API
volania len z uvedených adries. Ak je pre API kľúče zapnutý, **odosielanie
z Vercelu nebude fungovať**: funkcie bežia na AWS a IP adresu dostávajú
zakaždým inú, takže žiadna nebude na zozname. Prejaví sa to ako `401` a v logu
Brevo nie je nič, lebo požiadavka je odmietnutá skôr, než správa vznikne.

Dopĺňať adresy do zoznamu nemá zmysel, pribúdajú prakticky denne. Riešením je
**Deactivate for API keys**. Ochranu potom nesie samotný kľúč, ktorý je len
v premenných hostingu a označený ako citlivý.

Znenie správ je v `server/emails.js`, oddelené od odosielania, takže sa dá
prepísať bez zasahovania do volania API.

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
| `BREVO_API_KEY`       | kľúč k Brevu; bez neho sa e-maily neposielajú                    |
| `MAIL_FROM`           | adresa odosielateľa, overená v Breve                             |
| `MAIL_ADMIN`          | kam chodia upozornenia o nových žiadostiach                       |
| `CRON_SECRET`         | chráni `/api/cron/reminders`; bez neho cron dostane 401           |
| `SITE_URL`            | verejná adresa stránky pre odkazy v e-mailoch                    |
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
- **Vonkajší obrys plátna vo výkrese** — kótovaná je premietacia plocha
  `3,70 × 2,10 m` (uhlopriečka 168″, formát 16 : 9). Rám okolo nej je zatiaľ
  ilustračný, lebo vonkajší rozmer nafúknutého plátna nie je odmeraný. Keď ho
  budeš mať, prepíš `d-frame` v SVG so `class="draw--scale"`; mierka výkresu je
  81 jednotiek na meter.
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
  mailer.js       odosielanie cez Brevo, nikdy nezhodí rezerváciu
  emails.js       znenie troch správ, oddelené od odosielania
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

## Audit rezervácií

`scripts/audit.mjs` prejde 87 kontrol proti bežiacemu serveru: stavy kalendára,
validáciu každého poľa, súbeh piatich žiadostí na jeden termín, prístup do
panela, správu žiadostí, blokovanie, nastavenia, export a obmedzenie počtu.

```bash
npm start                 # v druhom okne
node scripts/audit.mjs
```

Limity sa dajú na čas auditu zdvihnúť, inak si ich skript sám vyčerpá a zvyšok
kontrol potom padá na 429:

```bash
RES_LIMIT_MAX=500 RES_BURST_MAX=500 LOGIN_MAX=500 npm start
```

Tie isté premenné slúžia aj v prevádzke, keby za jednou obecnou IP adresou bolo
priveľa domácností a limit im zamykal susedov.

## Test e-mailov a pripomienok

`scripts/test-emails.mjs` prejde 46 kontrol nad všetkým, čo sa posiela mimo
bežnej žiadosti: padnutý náhradný termín (obsadený aj zablokovaný), pripomienku
deň pred premietaním aj jej záchranu v deň premietania, presun termínu, ochranu
cron endpointu a to, že zlyhané odoslanie sa neoznačí ako hotové.

```bash
node scripts/test-emails.mjs
```

Server si spúšťa sám a píše do vlastnej databázy v `./data/test-emails`, takže
ostrým dátam sa nemôže dostať pod ruku. Brevo nahrádza zachytávač navesený na
globálny `fetch` — mailer, šablóny, routy aj databáza sú skutočné, do siete sa
však nič nepošle a **nepotrebuje ani platný kľúč**.
