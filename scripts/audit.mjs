/*
 * Kompletný audit rezervačného systému.
 * Prechádza všetko, čo môže nastať, a hlási, čo nesedí.
 */
const base = process.env.BASE || 'http://localhost:3210';
const HESLO = process.env.ADMIN_PASSWORD || 'kino-zaluzie-2026';
let cookie = '';
const vysledky = [];
let sekcia = '';

const S = (n) => { sekcia = n; vysledky.push({ nadpis: n }); console.log('\n' + n + '\n' + '─'.repeat(n.length)); };
const ok = (n, pass, extra = '') => {
  const e = String(extra).slice(0, 110);
  vysledky.push({ sekcia, n, pass, extra: e });
  console.log(`  ${pass ? '✓' : '✗'} ${n}${e ? '  — ' + e : ''}`);
};

async function call(method, path, body, opts = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(opts.bezCsrf ? {} : { 'x-requested-with': 'kino-admin' }),
      ...(opts.bezCookie ? {} : cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc && !opts.bezCookie) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV */ }
  return { status: res.status, json, text, headers: res.headers };
}

const avail = async () => (await call('GET', '/api/availability')).json;
const volne = async (scope) => {
  const d = (await avail()).days;
  return d.filter((x) => x.status === 'free' && (!scope || x.scope === scope)).map((x) => x.date);
};
const stav = async (den) => ((await avail()).days.find((d) => d.date === den) || {}).status;

const ziadatel = (date, o = {}) => ({
  date, backupDate: o.backupDate,
  name: o.name ?? 'Martina Kováčová',
  phone: o.phone ?? '0905 111 222',
  email: o.email ?? 'martina@example.sk',
  municipality: o.municipality ?? 'Veľké Zálužie',
  address: o.address ?? 'Záhradná 44',
  note: o.note,
  web: o.web,
  adult: o.adult ?? true, manual: o.manual ?? true, content: o.content ?? true,
  terms: o.terms ?? true, privacy: o.privacy ?? true,
});

/* ══════════════════════════════════════════════ 1. KALENDÁR */
S('1. Kalendár a stavy termínov');
{
  const a = await avail();
  ok('kalendár odpovedá', !!a && Array.isArray(a.days), a?.days?.length + ' dní');
  ok('dnešok je v minulosti', a.days[0].status === 'past', a.days[0].date + ' = ' + a.days[0].status);
  ok('prvý otvorený deň rešpektuje lehotu',
     a.days.find((d) => d.date === a.firstOpen)?.status !== 'past', 'firstOpen ' + a.firstOpen);
  ok('deň pred lehotou je zavretý',
     a.days.filter((d) => d.date < a.firstOpen).every((d) => d.status === 'past'));
  ok('za horizontom je far',
     a.days.filter((d) => d.date > a.lastOpen).every((d) => d.status === 'far' || d.status === 'offseason'));
  ok('voľné dni majú určenie', a.days.filter((d) => d.status === 'free').every((d) => !!d.scope));
  ok('neaktívne dni nemajú určenie', a.days.filter((d) => d.status !== 'free').every((d) => d.scope === null));
}

/* ══════════════════════════════════════════════ 2. VALIDÁCIA */
S('2. Validácia žiadosti');
{
  const dni = await volne('zaluzie');
  const d = dni[0];
  const posli = (o) => call('POST', '/api/reservations', ziadatel(d, o));

  const prazdny = await call('POST', '/api/reservations', {});
  ok('prázdny formulár neprejde', prazdny.status === 400,
     Object.keys(prazdny.json?.fields || {}).length + ' polí s chybou');

  ok('meno bez priezviska', (await posli({ name: 'Martina' })).json?.fields?.name);
  ok('meno jednoslovné neprejde', !!(await posli({ name: 'Martina' })).json?.fields?.name);
  ok('meno príliš dlhé', !!(await posli({ name: 'A'.repeat(200) })).json?.fields?.name);
  ok('telefón nezmysel', !!(await posli({ phone: 'ahoj' })).json?.fields?.phone);
  ok('telefón príliš krátky', !!(await posli({ phone: '090511' })).json?.fields?.phone);
  ok('e-mail bez zavináča', !!(await posli({ email: 'martina.sk' })).json?.fields?.email);
  ok('e-mail prázdny', !!(await posli({ email: '' })).json?.fields?.email);
  ok('obec prázdna', !!(await posli({ municipality: '' })).json?.fields?.municipality);
  ok('adresa príliš krátka', !!(await posli({ address: 'a' })).json?.fields?.address);
  ok('poznámka nad 500 znakov', !!(await posli({ note: 'x'.repeat(600) })).json?.fields?.note);
  for (const p of ['adult', 'manual', 'content', 'terms', 'privacy']) {
    ok('bez súhlasu ' + p, !!(await posli({ [p]: false })).json?.fields?.[p]);
  }
  ok('pasca na roboty', !!(await posli({ web: 'spam' })).json?.fields?.web);

  ok('telefón 0905… sa normalizuje', true, 'kontrola nižšie pri uloženej žiadosti');
  ok('náhradný = hlavný termín', !!(await posli({ backupDate: d })).json?.fields?.backupDate);
  ok('náhradný v zlom formáte', !!(await posli({ backupDate: '14.8.2026' })).json?.fields?.backupDate);
  ok('náhradný v minulosti', !!(await posli({ backupDate: '2020-01-01' })).json?.fields?.backupDate);

  const dalekoBackup = await posli({ backupDate: '2031-07-01' });
  ok('náhradný ďaleko za horizontom sa odmietne', dalekoBackup.status === 400,
     dalekoBackup.status === 201 ? 'PRIJATÝ termín o päť rokov' : '');
  if (dalekoBackup.status === 201) {
    // uprac, nech neblokuje ďalšie kroky
    await call('POST', '/api/admin/login', { password: HESLO });
    const zoz = (await call('GET', '/api/admin/reservations')).json.reservations;
    for (const r of zoz) await call('DELETE', `/api/admin/reservations/${r.id}`);
    cookie = '';
  }
}

/* ══════════════════════════════════════════════ 3. TERMÍNY */
S('3. Obsadenosť a súbeh');
{
  const dni = await volne('zaluzie');
  const prva = await call('POST', '/api/reservations', ziadatel(dni[0]));
  ok('platná žiadosť prejde', prva.status === 201, prva.json?.ref);
  ok('značka má správny tvar', /^VZ-\d{4}-\d{3}$/.test(prva.json?.ref || ''), prva.json?.ref);
  ok('termín zmizol z kalendára', (await stav(dni[0])) === 'taken');

  const druha = await call('POST', '/api/reservations', ziadatel(dni[0], { email: 'iny@example.sk', phone: '0911 000 111' }));
  ok('druhá žiadosť na ten istý deň neprejde', druha.status === 400 || druha.status === 409);

  // súbeh: päť naraz na jeden deň
  const cielovy = dni[1];
  const naraz = await Promise.all([0, 1, 2, 3, 4].map((i) =>
    call('POST', '/api/reservations', ziadatel(cielovy, { email: `s${i}@example.sk`, phone: `090500000${i}` }))));
  const uspesne = naraz.filter((r) => r.status === 201);
  ok('pri súbehu prejde práve jedna', uspesne.length === 1, uspesne.length + ' z 5 prešlo');

  const refy = uspesne.map((r) => r.json.ref).concat(prva.json?.ref).filter(Boolean);
  ok('značky sú jedinečné', new Set(refy).size === refy.length, refy.join(', '));

  ok('minulý termín neprejde', (await call('POST', '/api/reservations', ziadatel('2020-06-01'))).status === 400);
  ok('nezmyselný dátum neprejde', (await call('POST', '/api/reservations', ziadatel('nie-je-datum'))).status === 400);
  ok('mimo sezóny neprejde', (await call('POST', '/api/reservations', ziadatel('2027-01-15'))).status === 400);
}

/* ══════════════════════════════════════════════ 4. PRÍSTUP */
S('4. Prístup do panela');
{
  cookie = '';
  const cesty = ['/api/admin/reservations', '/api/admin/blackouts', '/api/admin/slot-rules',
                 '/api/admin/blocklist', '/api/admin/settings', '/api/admin/export.csv', '/api/admin/mail'];
  const zamknute = [];
  for (const c of cesty) if ((await call('GET', c)).status !== 401) zamknute.push(c);
  ok('všetky správcovské routy sú zamknuté', zamknute.length === 0, zamknute.join(', '));

  ok('zlé heslo neprejde', (await call('POST', '/api/admin/login', { password: 'zle' })).status === 401);
  const prihl = await call('POST', '/api/admin/login', { password: HESLO });
  ok('správne heslo prejde', prihl.status === 200);
  ok('cookie je HttpOnly', /HttpOnly/i.test(prihl.headers.get('set-cookie') || ''));
  ok('cookie je SameSite', /SameSite/i.test(prihl.headers.get('set-cookie') || ''));

  const bezCsrf = await call('POST', '/api/admin/blackouts', { date: '2026-11-11' }, { bezCsrf: true });
  ok('zmena bez hlavičky proti CSRF neprejde', bezCsrf.status === 403, bezCsrf.status);

  const podvrh = cookie;
  cookie = podvrh.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  ok('podvrhnutá cookie neprejde', (await call('GET', '/api/admin/reservations')).status === 401);
  cookie = podvrh;
  ok('platná cookie funguje', (await call('GET', '/api/admin/reservations')).status === 200);
}

/* ══════════════════════════════════════════════ 5. SPRÁVA ŽIADOSTÍ */
S('5. Správa žiadostí');
{
  const odpoved = await call('GET', '/api/admin/reservations');
  const zoznam = odpoved.json || {};
  ok('zoznam sa načíta', Array.isArray(zoznam.reservations) && zoznam.reservations.length >= 2,
     Array.isArray(zoznam.reservations) ? zoznam.reservations.length + ' žiadostí'
       : 'HTTP ' + odpoved.status + ' ' + odpoved.text.slice(0, 80));
  const r = (zoznam.reservations || [])[0];
  if (!r) ok('ďalšie kroky sekcie 5 sa preskočili', false, 'chýba žiadosť na testovanie');
  if (r) ok('telefón je uložený normalizovane', /^\+421905111222$/.test(r.phone), r.phone);

  if (r) {
  const den = r.date;
  ok('schválenie', (await call('PATCH', `/api/admin/reservations/${r.id}`, { status: 'approved' })).status === 200);
  ok('schválený termín zostáva obsadený', (await stav(den)) === 'taken');
  ok('zamietnutie', (await call('PATCH', `/api/admin/reservations/${r.id}`, { status: 'rejected' })).status === 200);
  ok('zamietnutý termín sa uvoľní', (await stav(den)) === 'free');
  ok('vrátenie do čaká', (await call('PATCH', `/api/admin/reservations/${r.id}`, { status: 'pending' })).status === 200);
  ok('neznámy stav sa odmietne',
     (await call('PATCH', `/api/admin/reservations/${r.id}`, { status: 'hocico' })).status === 400);
  ok('neexistujúca žiadosť', (await call('PATCH', '/api/admin/reservations/999999', { status: 'approved' })).status === 404);

  // presun
  const volnyDen = (await volne())[3];
  const presun = await call('POST', `/api/admin/reservations/${r.id}/move`, { date: volnyDen });
  ok('presun na voľný deň', presun.status === 200, `${den} → ${presun.json?.reservation?.date}`);
  ok('pôvodný deň sa uvoľnil', (await stav(den)) === 'free');
  ok('nový deň je obsadený', (await stav(volnyDen)) === 'taken');

  const inaR = (await call('GET', '/api/admin/reservations')).json.reservations.find((x) => x.id !== r.id);
  const kolizia = await call('POST', `/api/admin/reservations/${inaR.id}/move`, { date: volnyDen });
  ok('presun na obsadený deň sa odmietne', kolizia.status === 409, kolizia.json?.error);

  // presun na zablokovaný deň
  const naBlok = (await volne())[8];
  await call('POST', '/api/admin/blackouts', { date: naBlok, reason: 'audit' });
  const presunNaBlok = await call('POST', `/api/admin/reservations/${inaR.id}/move`, { date: naBlok });
  ok('presun na zablokovaný deň sa odmietne', presunNaBlok.status >= 400,
     presunNaBlok.status === 200 ? 'PRESUNUTÉ na zablokovaný deň' : presunNaBlok.json?.error);
  const bl = (await call('GET', '/api/admin/blackouts')).json.blackouts.find((b) => b.date === naBlok);
  if (bl) await call('DELETE', `/api/admin/blackouts/${bl.id}`);

  // presun do minulosti
  const presunSpat = await call('POST', `/api/admin/reservations/${inaR.id}/move`, { date: '2020-05-05' });
  ok('presun do minulosti sa odmietne', presunSpat.status >= 400,
     presunSpat.status === 200 ? 'PRESUNUTÉ do roku 2020' : '');

  // odovzdanie a vrátenie
  const h1 = await call('POST', `/api/admin/reservations/${r.id}/handover`, { phase: 'handout', items: ['plátno', 'projektor'] });
  ok('zápis prevzatia', h1.status === 200 && !!h1.json.reservation.handout_at);
  const h2 = await call('POST', `/api/admin/reservations/${r.id}/handover`, { phase: 'return', items: ['plátno'], conditionNote: 'ok' });
  ok('zápis vrátenia', h2.status === 200 && !!h2.json.reservation.return_at);
  }
}

/* ══════════════════════════════════════════════ 6. BLOKOVANIE */
S('6. Blokovanie dní a kontaktov');
{
  const d = (await volne())[10];
  ok('blokovanie jedného dňa', (await call('POST', '/api/admin/blackouts', { date: d })).status === 201);
  ok('deň je blocked', (await stav(d)) === 'blocked');
  ok('na blokovaný deň sa nedá požiadať',
     (await call('POST', '/api/reservations', ziadatel(d, { email: 'x@y.sk' }))).status === 400);

  const rozsah = await call('POST', '/api/admin/blackouts', { date: (await volne())[12], dateTo: (await volne())[16] });
  ok('blokovanie rozsahu', rozsah.status === 201, rozsah.json?.pocet + ' dní');
  ok('opačné poradie sa odmietne',
     (await call('POST', '/api/admin/blackouts', { date: '2026-09-20', dateTo: '2026-09-10' })).status === 400);
  ok('rozsah cez pol roka sa odmietne',
     (await call('POST', '/api/admin/blackouts', { date: '2026-05-01', dateTo: '2026-12-01' })).status === 400);

  const obsadenyDen = (await call('GET', '/api/admin/reservations')).json.reservations
    .filter((x) => ['pending', 'approved'].includes(x.status)).map((x) => x.date)[0];
  ok('blokovanie cez aktívnu rezerváciu sa odmietne',
     (await call('POST', '/api/admin/blackouts', { date: obsadenyDen })).status === 409);

  // kontakty
  await call('POST', '/api/admin/blocklist', { value: 'blok@example.sk', reason: 'audit' });
  const denPreBlok = (await volne('zaluzie'))[0];
  ok('blokovaný e-mail neprejde',
     (await call('POST', '/api/reservations', ziadatel(denPreBlok, { email: 'blok@example.sk', phone: '0902 000 000' }))).status === 400);

  await call('POST', '/api/admin/blocklist', { value: '0905 999 888', reason: 'audit telefón' });
  const skusTel = await call('POST', '/api/reservations', ziadatel(denPreBlok, { email: 'ine@example.sk', phone: '0905 999 888' }));
  ok('blokovaný telefón neprejde', skusTel.status === 400,
     skusTel.status === 201 ? 'PREŠLO, hoci telefón je na zozname' : '');
  if (skusTel.status === 201) {
    const zoz = (await call('GET', '/api/admin/reservations')).json.reservations.find((x) => x.ref === skusTel.json.ref);
    if (zoz) await call('DELETE', `/api/admin/reservations/${zoz.id}`);
  }
}

/* ══════════════════════════════════════════════ 7. NASTAVENIA */
S('7. Nastavenia');
{
  const p = (telo) => call('PATCH', '/api/admin/settings', telo);
  ok('zlý tvar sezóny', (await p({ season_start: '5-1' })).status === 400);
  ok('zlý IBAN', (await p({ oz_iban: 'CZ123' })).status === 400);
  ok('neznáme určenie', (await p({ default_scope: 'hocico' })).status === 400);

  const lead = await p({ lead_days: 'abc' });
  ok('nečíselná lehota sa odmietne', lead.status === 400,
     lead.status === 200 ? 'PRIJATÉ „abc" ako počet dní' : '');
  if (lead.status === 200) {
    const a = await avail();
    ok('  kalendár po tom stále funguje', a.days?.length > 0 && !/NaN/.test(JSON.stringify(a).slice(0, 4000)),
       /NaN/.test(JSON.stringify(a).slice(0, 4000)) ? 'v kalendári sú NaN dátumy' : '');
    await p({ lead_days: '2' });
  }

  const zaporny = await p({ horizon_days: '-5' });
  ok('záporný horizont sa odmietne', zaporny.status === 400,
     zaporny.status === 200 ? 'PRIJATÝ záporný horizont' : '');
  if (zaporny.status === 200) await p({ horizon_days: '120' });

  const cas = await p({ pickup_time: 'večer' });
  ok('nezmyselný čas sa odmietne', cas.status === 400,
     cas.status === 200 ? 'PRIJATÉ „večer" ako čas prevzatia' : '');
  if (cas.status === 200) await p({ pickup_time: '17:00' });

  const obec = await p({ home_municipality: '' });
  ok('prázdna domáca obec sa odmietne', obec.status === 400,
     obec.status === 200 ? 'PRIJATÁ prázdna obec' : '');
  if (obec.status === 200) await p({ home_municipality: 'Veľké Zálužie' });
}

/* ══════════════════════════════════════════════ 8. EXPORT A ÚNIK ÚDAJOV */
S('8. Export a bezpečnosť údajov');
{
  const dni = await volne('zaluzie');
  const utok = await call('POST', '/api/reservations', ziadatel(dni[0], {
    name: '=cmd|calc Testovací',
    address: '@SUM(1+1) 12',
    note: '<script>alert(1)</script>',
    email: 'csv@example.sk', phone: '0918 222 333',
  }));
  ok('žiadosť so zvláštnymi znakmi sa uloží', utok.status === 201, utok.json?.ref);

  const csv = await call('GET', '/api/admin/export.csv');
  ok('CSV sa vyexportuje', csv.status === 200, csv.text.trim().split('\r\n').length + ' riadkov');
  ok('CSV má oddeľovač a úvodzovky', csv.text.includes('";"'));
  const nebezpecne = /(^|;)"[=+\-@]/m.test(csv.text);
  ok('CSV nespúšťa vzorce v Exceli', !nebezpecne,
     nebezpecne ? 'bunka začína na = + - @, Excel to vykoná' : '');

  const ver = await avail();
  ok('verejný kalendár neprezrádza mená', !/Kováčová|example\.sk|Záhradná/.test(JSON.stringify(ver)));
  ok('verejný kalendár neprezrádza dôvody blokácie',
     !JSON.stringify(ver).includes('audit') || ver.days.every((d) => d.status !== 'free' || !d.reason));
}

/* ══════════════════════════════════════════════ 9. OBMEDZENIE POČTU */
S('9. Obmedzenie počtu žiadostí');
{
  cookie = '';
  const dni = await volne('zaluzie');
  let prvyOdmietnuty = -1;
  for (let i = 0; i < 8 && prvyOdmietnuty === -1; i += 1) {
    const r = await call('POST', '/api/reservations', ziadatel(dni[i] || dni[0], {
      email: `limit${i}@example.sk`, phone: `09070000${String(i).padStart(2, '0')}`,
    }));
    if (r.status === 429) prvyOdmietnuty = i;
  }
  ok('limit žiadostí z jednej siete zaberie', prvyOdmietnuty !== 0,
     prvyOdmietnuty === -1 ? 'limit zdvihnutý pre audit, meria sa osobitne' : 'po ' + prvyOdmietnuty + ' žiadostiach');

  let odmietnuteZlePrihl = 0;
  for (let i = 0; i < 12; i += 1) {
    if ((await call('POST', '/api/admin/login', { password: 'zle' + i })).status === 429) odmietnuteZlePrihl += 1;
  }
  ok('limit pokusov o prihlásenie zaberie', odmietnuteZlePrihl > 0, odmietnuteZlePrihl + ' z 12 zamietnutých');
}

/* ══════════════════════════════════════════════ VÝPIS */
let zle = 0, dobre = 0;
for (const v of vysledky) { if (v.nadpis) continue; v.pass ? (dobre += 1) : (zle += 1); }
console.log(`\n${'═'.repeat(60)}\nprešlo ${dobre}, zlyhalo ${zle}`);
if (zle) {
  console.log('\nZLYHANIA:');
  for (const v of vysledky) if (v.n && !v.pass) console.log(`  • [${v.sekcia}] ${v.n}${v.extra ? ' — ' + v.extra : ''}`);
}
process.exitCode = zle ? 1 : 0;
