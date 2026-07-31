/*
 * Test e-mailov a pripomienok.
 *
 *   node scripts/test-emails.mjs
 *
 * Beží celý v jednom procese a s vlastnou databázou v ./data/test-emails,
 * takže ostrým dátam sa nemôže dostať pod ruku. Brevo nahrádza zachytávač
 * navesený na globálny fetch — mailer, šablóny, routy aj databáza sú
 * skutočné, iba odchádzajúca HTTP požiadavka končí v poli.
 *
 * Prechádza všetko, čo sa posiela mimo bežnej žiadosti: padnutý náhradný
 * termín (obsadený aj zablokovaný), pripomienku deň pred premietaním aj jej
 * záchranu v deň premietania, presun termínu, ochranu cron endpointu a to,
 * že zlyhané odoslanie sa neoznačí ako hotové.
 */
process.env.DATA_DIR = process.env.DATA_DIR || './data/test-emails';
process.env.DATABASE_URL = '';
process.env.BREVO_API_KEY = 'xkeysib-test';
process.env.MAIL_FROM = 'kino@example.sk';
process.env.MAIL_ADMIN = 'patanko@example.sk';
process.env.ADMIN_PASSWORD = 'test-heslo';
process.env.SESSION_SECRET = 'test-secret';
process.env.CRON_SECRET = 'tajomstvo-cronu';
process.env.RES_BURST_MAX = '9999';
process.env.RES_LIMIT_MAX = '9999';
process.env.LOGIN_MAX = '9999';

import fs from 'node:fs';
import { addDays, today } from '../server/dates.js';

fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

/* ---------------------------------------------------- zachytávač e-mailov */

const posta = [];
let odmietaj = null; // adresa, pri ktorej sa Brevo zatvári ako pokazené
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.brevo.com')) {
    const m = JSON.parse(opts.body);
    const komu = m.to.map((t) => t.email).join(',');
    if (odmietaj && komu === odmietaj) {
      return new Response(JSON.stringify({ message: 'testovacie zlyhanie' }), {
        status: 500, headers: { 'content-type': 'application/json' },
      });
    }
    posta.push({ to: komu, subject: m.subject, text: m.textContent || '' });
    return new Response(JSON.stringify({ messageId: 'x' + posta.length }), {
      status: 201, headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(url, opts);
};

const { app } = await import('../server/app.js');
const { init } = await import('../server/db.js');
await init();

const PORT = 3455;
const server = app.listen(PORT);
const base = `http://127.0.0.1:${PORT}`;

/* ------------------------------------------------------------- pomocníci */

let cookie = '';
async function call(method, path, body, extra = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-requested-with': 'kino-admin',
      ...(cookie ? { cookie } : {}),
      ...(extra.headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc && !extra.noCookie) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

let pass = 0, fail = 0;
const ok = (n, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${n}${extra ? '  — ' + extra : ''}`); }
  else { fail += 1; console.log(`  ✗ ${n}${extra ? '  — ' + extra : ''}`); }
};
const S = (n) => console.log('\n' + n + '\n' + '─'.repeat(n.length));
const naAdresu = (a) => posta.filter((m) => m.to === a);
const vyprazdni = () => { posta.length = 0; };

const ziadost = (date, backupDate, email) => ({
  date, backupDate, name: 'Jana Testovacia', phone: '0901234567', email,
  municipality: 'Veľké Zálužie', address: 'Hlavná 1',
  adult: true, manual: true, content: true, terms: true, privacy: true,
});

/* =========================================================== príprava */

await call('POST', '/api/admin/login', { password: 'test-heslo' });
// Lehota vopred na 0, nech sa dá rezervovať aj zajtrajšok.
await call('PATCH', '/api/admin/settings', { lead_days: '0', season_start: '01-01', season_end: '12-31' });

const D_zajtra = addDays(today(), 1);
const D3 = addDays(today(), 3);
const D5 = addDays(today(), 5);
const D7 = addDays(today(), 7);
const D9 = addDays(today(), 9);

/* =========================================================== 1 */

S('1. Padol náhradný termín — obsadila ho iná rezervácia');

vyprazdni();
const a = await call('POST', '/api/reservations', ziadost(D3, D5, 'cakatel@example.sk'));
ok('rezervácia A vznikla', a.status === 201, a.json?.ref || a.text.slice(0, 80));
ok('A dostala potvrdenie o prijatí', naAdresu('cakatel@example.sk').length === 1);
ok('správcovi prišlo upozornenie', naAdresu('patanko@example.sk').length === 1);

vyprazdni();
const b = await call('POST', '/api/reservations', ziadost(D5, D7, 'druhy@example.sk'));
ok('rezervácia B obsadila D5 (náhradný termín A)', b.status === 201);
const alert = naAdresu('cakatel@example.sk');
ok('A dostala upozornenie na padnutý náhradný termín', alert.length === 1,
   alert[0]?.subject);
ok('upozornenie hovorí o náhradnom, nie hlavnom termíne',
   Boolean(alert[0] && /náhradn/i.test(alert[0].subject) && alert[0].text.includes('obsadila ho iná rezervácia')));
ok('hlavný termín A sa v texte potvrdzuje ako platný',
   Boolean(alert[0] && /platí a nič sa s ním nedeje/.test(alert[0].text)));
ok('B nedostala žiadne upozornenie o náhradnom termíne',
   naAdresu('druhy@example.sk').every((m) => !/náhradn/i.test(m.subject)));

/* =========================================================== 2 */

S('2. Padol náhradný termín — zablokoval ho správca');

const c = await call('POST', '/api/reservations', ziadost(D7 === D5 ? D9 : addDays(today(), 11), addDays(today(), 13), 'treti@example.sk'));
ok('rezervácia C vznikla', c.status === 201, c.json?.ref);

vyprazdni();
const bo = await call('POST', '/api/admin/blackouts', { date: addDays(today(), 13), reason: 'servis' });
ok('blokácia prešla', bo.status === 201, JSON.stringify(bo.json));
ok('C dostala upozornenie', naAdresu('treti@example.sk').length === 1);
ok('dôvod je zavretý deň, nie cudzia rezervácia',
   Boolean(naAdresu('treti@example.sk')[0]?.text.includes('musel som ten deň zavrieť')));
ok('odpoveď hlási počet upozornení', bo.json?.upozornenia === 1, String(bo.json?.upozornenia));

vyprazdni();
const boZnova = await call('POST', '/api/admin/blackouts', { date: addDays(today(), 13), reason: 'stále servis' });
ok('opakovaná blokácia prešla', boZnova.status === 201);
ok('druhýkrát sa už nepíše', naAdresu('treti@example.sk').length === 0);

/* =========================================================== 3 */

S('3. Pripomienka deň pred premietaním');

vyprazdni();
const z = await call('POST', '/api/reservations', ziadost(D_zajtra, null, 'zajtra@example.sk'));
ok('rezervácia na zajtra vznikla', z.status === 201, z.json?.ref || z.text.slice(0, 90));

const zoznam = await call('GET', '/api/admin/reservations');
const zajtrajsia = zoznam.json?.reservations?.find((r) => r.ref === z.json?.ref);
vyprazdni();
const potvrd = await call('PATCH', `/api/admin/reservations/${zajtrajsia?.id}`, { status: 'approved' });
ok('rezervácia potvrdená', potvrd.status === 200);
ok('prišlo potvrdenie termínu', naAdresu('zajtra@example.sk').length === 1);

vyprazdni();
const cron1 = await call('POST', '/api/cron/reminders');
ok('cron prebehol', cron1.status === 200, JSON.stringify(cron1.json));
ok('poslal práve jednu pripomienku', cron1.json?.poslane === 1);
const prip = naAdresu('zajtra@example.sk')[0];
ok('pripomienka hovorí „zajtra"', Boolean(prip && /zajtra/i.test(prip.subject)), prip?.subject);
ok('obsahuje čas prevzatia', Boolean(prip && prip.text.includes('17:00')));
ok('obsahuje zoznam na prípravu', Boolean(prip && prip.text.includes('6 × 4 metre')));

vyprazdni();
const cron2 = await call('POST', '/api/cron/reminders');
ok('druhé spustenie neposlalo nič', cron2.json?.poslane === 0);
ok('a neposlalo ani e-mail', posta.length === 0);

/* =========================================================== 4 */

S('4. Pripomienka v deň premietania (záchrana za zmeškaný cron)');

vyprazdni();
const dnesR = await call('POST', '/api/reservations', ziadost(today(), null, 'dnes@example.sk'));
if (dnesR.status !== 201) {
  ok('rezervácia na dnes vznikla', false, dnesR.text.slice(0, 110));
} else {
  const zz = await call('GET', '/api/admin/reservations');
  const dnesna = zz.json.reservations.find((r) => r.ref === dnesR.json.ref);
  await call('PATCH', `/api/admin/reservations/${dnesna.id}`, { status: 'approved' });
  vyprazdni();
  const cron3 = await call('POST', '/api/cron/reminders');
  const p = naAdresu('dnes@example.sk')[0];
  ok('cron zachytil aj dnešný termín', cron3.json?.poslane === 1, JSON.stringify(cron3.json));
  ok('text sa prepol na „dnes"', Boolean(p && /dnes/i.test(p.subject) && !/zajtra/i.test(p.subject)), p?.subject);
}

/* =========================================================== 5 */

S('5. Nepotvrdené rezervácie sa hlásia zvlášť');

// Zajtrajšok aj dnešok sú obsadené z predošlých krokov — uvoľní sa zajtrajšok,
// nech na ňom môže vzniknúť žiadosť, ktorá zostane v stave „čaká".
const vsetky = await call('GET', '/api/admin/reservations');
const naZajtra = vsetky.json.reservations.find((r) => r.date === D_zajtra);
await call('DELETE', `/api/admin/reservations/${naZajtra.id}`);

vyprazdni();
const cakajuca = await call('POST', '/api/reservations', ziadost(D_zajtra, null, 'nikto@example.sk'));
ok('žiadosť na zajtra vznikla a zostáva v stave čaká', cakajuca.status === 201,
   cakajuca.json?.ref || cakajuca.text.slice(0, 90));

vyprazdni();
const cron4 = await call('POST', '/api/cron/reminders');
ok('nepotvrdenej sa pripomienka neposiela',
   !naAdresu('nikto@example.sk').some((m) => /premietate/i.test(m.subject)));
ok('cron ju vypíše ako nepotvrdenú',
   (cron4.json?.nepotvrdene || []).some((x) => x.ref === cakajuca.json.ref),
   JSON.stringify(cron4.json?.nepotvrdene));

/* =========================================================== 6 */

S('6. Presun termínu');

const p1 = addDays(today(), 20);
const p2 = addDays(today(), 22);
const pr = await call('POST', '/api/reservations', ziadost(p1, p2, 'presun@example.sk'));
ok('rezervácia na presun vznikla', pr.status === 201, pr.json?.ref);
const zoz2 = await call('GET', '/api/admin/reservations');
const presunut = zoz2.json.reservations.find((r) => r.ref === pr.json.ref);

vyprazdni();
const mv = await call('POST', `/api/admin/reservations/${presunut.id}/move`);
ok('presun na náhradný termín prešiel', mv.status === 200, JSON.stringify(mv.json?.reservation?.date));
const mail = naAdresu('presun@example.sk')[0];
ok('žiadateľ dostal správu o preložení', Boolean(mail), mail?.subject);
ok('správa obsahuje starý aj nový dátum',
   Boolean(mail && mail.text.includes('preložil') && mail.text.includes('Značka')));
ok('nový dátum je náhradný termín', mv.json?.reservation?.date === p2);
ok('náhradný termín sa vyprázdnil', mv.json?.reservation?.backup_date === null);
ok('značky pripomienky a upozornenia sa vynulovali',
   mv.json?.reservation?.reminded_at === null && mv.json?.reservation?.backup_alert_at === null);

/* =========================================================== 7 */

S('7. Ochrana cron endpointu');

const bezVsetkeho = await realFetch(base + '/api/cron/reminders');
ok('bez prihlásenia a bez tajomstva → 401', bezVsetkeho.status === 401, String(bezVsetkeho.status));

const zlyKluc = await realFetch(base + '/api/cron/reminders', {
  headers: { authorization: 'Bearer nespravne-tajomstvo' },
});
ok('so zlým tajomstvom → 401', zlyKluc.status === 401, String(zlyKluc.status));

const spravnyKluc = await realFetch(base + '/api/cron/reminders', {
  headers: { authorization: 'Bearer tajomstvo-cronu' },
});
ok('so správnym tajomstvom → 200', spravnyKluc.status === 200, String(spravnyKluc.status));

const bezCsrf = await realFetch(base + '/api/cron/reminders', {
  method: 'POST', headers: { cookie },
});
ok('POST s cookie ale bez hlavičky X-Requested-With → 401', bezCsrf.status === 401, String(bezCsrf.status));

/* =========================================================== 8 */

S('8. Zlyhané odoslanie sa nezaznačí a skúsi sa znova');

// Potvrdíme čakajúcu žiadosť na zajtra, ale Brevo pri nej odmietne.
const zoz3 = await call('GET', '/api/admin/reservations');
const cakala = zoz3.json.reservations.find((r) => r.ref === cakajuca.json.ref);
await call('PATCH', `/api/admin/reservations/${cakala.id}`, { status: 'approved' });

odmietaj = 'nikto@example.sk';
vyprazdni();
const cronZle = await call('POST', '/api/cron/reminders');
ok('cron hlási neúspech', cronZle.status === 502 && cronZle.json?.ok === false, String(cronZle.status));
ok('poslané 0, preskočené 1',
   cronZle.json?.poslane === 0 && cronZle.json?.preskocene === 1,
   JSON.stringify({ p: cronZle.json?.poslane, s: cronZle.json?.preskocene }));
ok('chyba nesie značku rezervácie',
   (cronZle.json?.chyby || []).some((x) => x.ref === cakajuca.json.ref),
   JSON.stringify(cronZle.json?.chyby));

odmietaj = null;
vyprazdni();
const cronZnova = await call('POST', '/api/cron/reminders');
ok('druhý pokus pripomienku naozaj pošle', cronZnova.json?.poslane === 1,
   JSON.stringify(cronZnova.json));
ok('a dorazila na správnu adresu',
   naAdresu('nikto@example.sk').some((m) => /premietate/i.test(m.subject)));

/* =========================================================== koniec */

console.log('\n' + '═'.repeat(60));
console.log(`prešlo ${pass}, zlyhalo ${fail}`);
server.close();
process.exit(fail ? 1 : 0);
