import { addDays, formatSk, formatSkShort } from './dates.js';

/*
 * Znenie e-mailov. Oddelené od odosielania, aby sa dalo prepísať bez toho, aby
 * sa človek musel prehrýzať cez volanie Brevo API.
 *
 * Hovorí tu Andrej v prvej osobe a tyká, rovnako ako lístok na stránke po
 * odoslaní žiadosti. Dva rôzne tóny na tej istej veci by pôsobili čudne.
 */

function siteUrl() {
  const raw = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
  const host = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : '';
}

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Jednoduché HTML: žiadne obrázky ani vlastné písma, nech to prežije každý klient. */
function wrap(title, blocks) {
  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;',
    'font-size:15px;line-height:1.6;color:#1b1b1b;max-width:34rem">',
    `<h2 style="font-size:18px;margin:0 0 16px">${esc(title)}</h2>`,
    blocks.join(''),
    '</div>',
  ].join('');
}

const para = (text) => `<p style="margin:0 0 12px">${esc(text)}</p>`;

function table(rows) {
  const cells = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 14px 3px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
        `<td style="padding:3px 0">${esc(v)}</td></tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;margin:0 0 14px">${cells}</table>`;
}

/* Prázdny riadok sa zapíše ako ['', ''] a slúži na oddelenie skupín údajov. */
const lines = (rows) => {
  const kept = rows.filter(([k, v]) => v || k === '');
  const width = Math.max(...kept.map(([k]) => k.length)) + 2;
  return kept.map(([k, v]) => (k === '' ? '' : `${(k + ':').padEnd(width)}${v}`)).join('\n');
};

/* ------------------------------------------------------- údaje o termíne */

function slot(r, settings) {
  const back = addDays(r.date, 1);
  return [
    ['Termín', formatSk(r.date)],
    ['Prevzatie', `${settings.pickupTime} v deň premietania`],
    ['Vrátenie', `${formatSk(back)} do ${settings.returnTime}`],
    ['Náhradný termín', r.backupDate ? formatSk(r.backupDate) : ''],
  ];
}

/* ------------------------------------------------ 1. upozornenie správcovi */

export function adminNewRequest(r, settings) {
  const panel = siteUrl() ? `${siteUrl()}/spravca` : '/spravca';
  const detail = [
    ['Značka', r.ref],
    ...slot(r, settings),
    ['', ''],
    ['Meno', r.name],
    ['Telefón', r.phone],
    ['E-mail', r.email],
    ['Obec', r.municipality],
    ['Adresa', r.address],
  ];

  const text = [
    'Prišla nová žiadosť o zapožičanie letného kina.',
    '',
    lines(detail),
    ...(r.note ? ['', 'Poznámka od žiadateľa:', r.note] : []),
    '',
    'Termín je už podržaný a v kalendári sa tvári ako obsadený.',
    'Potvrdiť alebo zamietnuť ho vieš v paneli:',
    panel,
  ].join('\n');

  const html = wrap('Nová žiadosť o zapožičanie', [
    table(detail),
    r.note ? para(`Poznámka od žiadateľa: ${r.note}`) : '',
    para('Termín je už podržaný a v kalendári sa tvári ako obsadený.'),
    `<p style="margin:0"><a href="${esc(panel)}">Otvoriť panel a rozhodnúť</a></p>`,
  ]);

  return {
    subject: `Nová žiadosť ${r.ref} · ${formatSkShort(r.date)}`,
    text,
    html,
  };
}

/* --------------------------------------------- 2. potvrdenie o prijatí */

export function guestReceived(r, settings) {
  const detail = [['Značka', r.ref], ...slot(r, settings)];

  const text = [
    'Dobrý deň,',
    '',
    'žiadosť o zapožičanie letného kina mi prišla a termín som Vám zatiaľ podržal.',
    'V kalendári je už označený ako obsadený, takže Vám ho medzitým nikto nevezme.',
    '',
    lines(detail),
    '',
    'Toto ešte nie je potvrdená rezervácia. Overím si údaje a ozvem sa Vám',
    'telefonicky, zvyčajne do dvoch dní. Potvrdenie potom príde aj e-mailom.',
    '',
    'Ak sa medzitým niečo zmení alebo termín už nepotrebujete, dajte mi prosím',
    'vedieť, nech ho môže dostať niekto ďalší.',
    '',
    'Andrej Práznovský',
    '+421 911 705 236',
  ].join('\n');

  const html = wrap('Žiadosť je u mňa', [
    para('Dobrý deň,'),
    para(
      'žiadosť o zapožičanie letného kina mi prišla a termín som Vám zatiaľ podržal. ' +
        'V kalendári je už označený ako obsadený, takže Vám ho medzitým nikto nevezme.'
    ),
    table(detail),
    para(
      'Toto ešte nie je potvrdená rezervácia. Overím si údaje a ozvem sa Vám telefonicky, ' +
        'zvyčajne do dvoch dní. Potvrdenie potom príde aj e-mailom.'
    ),
    para(
      'Ak sa medzitým niečo zmení alebo termín už nepotrebujete, dajte mi prosím vedieť, ' +
        'nech ho môže dostať niekto ďalší.'
    ),
    para('Andrej Práznovský, +421 911 705 236'),
  ]);

  return { subject: `Žiadosť ${r.ref} je u mňa`, text, html };
}

/* --------------------------------------- 3. rozhodnutie o žiadosti */

export function guestDecision(r, settings, status) {
  const detail = [['Značka', r.ref], ...slot(r, settings)];

  if (status === 'approved') {
    const text = [
      'Dobrý deň,',
      '',
      'termín je potvrdený, letné kino je Vaše.',
      '',
      lines(detail),
      '',
      'Čo bude treba mať pripravené:',
      'rovnú plochu aspoň 6 × 4 metre bez ostrých predmetov pod plátnom,',
      'zásuvku 230 V v dosahu 20 metrov a možnosť zakotviť plátno do trávy.',
      'Predlžovačku aj kolíky prinesiem. Postavenie zaberie asi desať minút',
      'a ukážem Vám, čo kam patrí.',
      '',
      'Ak by v ten večer pršalo, ozvite sa mi. Máme dohodnutý náhradný termín',
      'alebo nájdeme iný voľný.',
      '',
      'Andrej Práznovský',
      '+421 911 705 236',
    ].join('\n');

    const html = wrap('Termín je potvrdený', [
      para('Dobrý deň,'),
      para('termín je potvrdený, letné kino je Vaše.'),
      table(detail),
      para(
        'Pripravte si prosím rovnú plochu aspoň 6 × 4 metre bez ostrých predmetov pod ' +
          'plátnom, zásuvku 230 V v dosahu 20 metrov a možnosť zakotviť plátno do trávy. ' +
          'Predlžovačku aj kolíky prinesiem. Postavenie zaberie asi desať minút a ukážem ' +
          'Vám, čo kam patrí.'
      ),
      para(
        'Ak by v ten večer pršalo, ozvite sa mi. Máme dohodnutý náhradný termín alebo ' +
          'nájdeme iný voľný.'
      ),
      para('Andrej Práznovský, +421 911 705 236'),
    ]);

    return { subject: `Termín ${formatSkShort(r.date)} je potvrdený · ${r.ref}`, text, html };
  }

  const text = [
    'Dobrý deň,',
    '',
    `žiadosť ${r.ref} na ${formatSk(r.date)} sa mi tentoraz nepodarilo potvrdiť.`,
    ...(r.adminNote ? ['', `Dôvod: ${r.adminNote}`] : []),
    '',
    'Termín sa práve vrátil do kalendára ako voľný pre niekoho ďalšieho.',
    'Ak máte záujem o iný večer, vyberte si prosím nový termín na stránke',
    'alebo mi zavolajte a dohodneme sa.',
    '',
    'Andrej Práznovský',
    '+421 911 705 236',
  ].join('\n');

  const html = wrap('Žiadosť sa tentoraz nepodarilo potvrdiť', [
    para('Dobrý deň,'),
    para(`žiadosť ${r.ref} na ${formatSk(r.date)} sa mi tentoraz nepodarilo potvrdiť.`),
    r.adminNote ? para(`Dôvod: ${r.adminNote}`) : '',
    para('Termín sa práve vrátil do kalendára ako voľný pre niekoho ďalšieho.'),
    para(
      'Ak máte záujem o iný večer, vyberte si prosím nový termín na stránke alebo mi ' +
        'zavolajte a dohodneme sa.'
    ),
    para('Andrej Práznovský, +421 911 705 236'),
  ]);

  return { subject: `Žiadosť ${r.ref} nebola potvrdená`, text, html };
}
