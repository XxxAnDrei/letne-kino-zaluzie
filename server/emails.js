import { addDays, formatSk, formatSkShort } from './dates.js';

/*
 * Znenie a vzhľad e-mailov. Oddelené od odosielania, aby sa dalo prepísať bez
 * toho, aby sa človek prehrýzal cez volanie Brevo API.
 *
 * Hovorí tu Andrej v prvej osobe a vyká. Web tyká, ale ten oslovuje návštevníka;
 * e-mail ide konkrétnemu človeku, ktorého nepozná.
 *
 * Dôležité vo formuláciách: technika sa **odovzdáva**, nikam sa nevozí. Nikde
 * teda nesmie zaznieť, že sa niečo prinesie alebo doručí.
 *
 * HTML je postavené na tabuľkách a vloženými štýlmi, lebo poštové programy nič
 * iné spoľahlivo nevykreslia. Vlastné písma sa neposielajú, Instrument Serif
 * nahrádza Georgia — tvarom je najbližšie z tých, čo má každý.
 */

/* ------------------------------------------------------------- paleta */

/* Presné hodnoty zo štýlu stránky, prepočítané z oklch do hex. */
const C = {
  pozadie: '#02040a',
  panel: '#09111d',
  panelSvetly: '#101927',
  ivory: '#f5f0e6',
  ivoryDim: '#d6d1c8',
  ash: '#8d929b',
  ashDim: '#5e636c',
  amber: '#fab45f',
  linka: '#1b2432',
};

const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Consolas, 'Courier New', monospace";

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

/* ------------------------------------------------------------- stavebné diely */

const para = (text, color = C.ivoryDim) =>
  `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:${color}">${text}</p>`;

/** Blok s údajmi o termíne. Vizuálne nadväzuje na lístok na stránke. */
function ticket(ref, rows) {
  const body = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="padding:5px 18px 5px 0;font-family:${MONO};font-size:11px;letter-spacing:0.12em;` +
        `text-transform:uppercase;color:${C.ash};vertical-align:top;white-space:nowrap">${esc(k)}</td>` +
        `<td style="padding:5px 0;font-family:${SANS};font-size:15px;color:${C.ivory}">${esc(v)}</td>` +
        `</tr>`
    )
    .join('');

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
    ` style="margin:0 0 24px;background:${C.panel};border-left:3px solid ${C.amber}">` +
    `<tr><td style="padding:20px 22px">` +
    (ref
      ? `<div style="font-family:${MONO};font-size:15px;letter-spacing:0.22em;color:${C.amber};` +
        `padding-bottom:14px;border-bottom:1px solid ${C.linka};margin-bottom:14px">${esc(ref)}</div>`
      : '') +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${body}</table>` +
    `</td></tr></table>`
  );
}

/** Odkaz vyzerajúci ako tlačidlo. Bez obrázkov, aby prešiel všade. */
function button(href, label) {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">` +
    `<tr><td style="background:${C.amber};padding:13px 26px">` +
    `<a href="${esc(href)}" style="font-family:${SANS};font-size:15px;font-weight:600;` +
    `color:${C.pozadie};text-decoration:none">${esc(label)}</a>` +
    `</td></tr></table>`
  );
}

/**
 * Obálka správy: hlavička so značkou, telo, pätička s kontaktom.
 * `preview` je riadok, ktorý ukáže schránka v zozname vedľa predmetu.
 */
function page({ title, preview, blocks, foot = true }) {
  const web = siteUrl();
  return (
    `<!doctype html><html lang="sk"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark light">` +
    `<title>${esc(title)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.pozadie}">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preview)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"` +
    ` style="background:${C.pozadie};padding:28px 12px">` +
    `<tr><td align="center">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"` +
    ` style="max-width:600px;width:100%;text-align:left">` +

    /* hlavička */
    `<tr><td style="padding:0 0 26px;border-bottom:1px solid ${C.linka}">` +
    `<div style="font-family:${SERIF};font-size:21px;color:${C.ivory};line-height:1.1">Letné kino</div>` +
    `<div style="font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;` +
    `color:${C.ashDim};padding-top:5px">Veľké Zálužie</div>` +
    `</td></tr>` +

    /* telo */
    `<tr><td style="padding:30px 0 0">` +
    `<h1 style="margin:0 0 20px;font-family:${SERIF};font-size:29px;font-weight:400;` +
    `line-height:1.15;color:${C.ivory}">${esc(title)}</h1>` +
    blocks.join('') +
    `</td></tr>` +

    /* pätička */
    (foot
      ? `<tr><td style="padding:10px 0 0;border-top:1px solid ${C.linka}">` +
        `<div style="font-family:${SANS};font-size:14px;line-height:1.7;color:${C.ivoryDim};padding-top:18px">` +
        `Andrej Práznovský<br>` +
        `<a href="tel:+421911705236" style="color:${C.ash};text-decoration:none">+421 911 705 236</a>` +
        (web
          ? `<br><a href="${esc(web)}" style="color:${C.ash};text-decoration:none">${esc(web.replace(/^https:\/\//, ''))}</a>`
          : '') +
        `</div></td></tr>`
      : '') +

    `</table></td></tr></table></body></html>`
  );
}

/* --------------------------------------------------- text pre čítanie bez HTML */

/* Prázdny riadok sa zapíše ako ['', ''] a oddeľuje skupiny údajov. */
const lines = (rows) => {
  const kept = rows.filter(([k, v]) => v || k === '');
  const width = Math.max(...kept.map(([k]) => k.length)) + 2;
  return kept.map(([k, v]) => (k === '' ? '' : `${(k + ':').padEnd(width)}${v}`)).join('\n');
};

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
  const web = siteUrl();
  const panel = web ? `${web}/spravca` : '/spravca';
  const termin = slot(r, settings);
  const osoba = [
    ['Meno', r.name],
    ['Telefón', r.phone],
    ['E-mail', r.email],
    ['Obec', r.municipality],
    ['Adresa', r.address],
  ];

  const text = [
    'Prišla nová žiadosť o zapožičanie letného kina.',
    '',
    lines([['Značka', r.ref], ...termin, ['', ''], ...osoba]),
    ...(r.note ? ['', 'Poznámka od žiadateľa:', r.note] : []),
    '',
    'Termín je už podržaný a v kalendári sa tvári ako obsadený.',
    'Potvrdiť alebo zamietnuť ho vieš v paneli:',
    panel,
  ].join('\n');

  const html = page({
    title: 'Nová žiadosť',
    preview: `${r.name}, ${formatSkShort(r.date)}, ${r.municipality}`,
    blocks: [
      ticket(r.ref, termin),
      ticket(null, osoba),
      r.note ? para(`<b style="color:${C.ivory}">Poznámka od žiadateľa:</b><br>${esc(r.note)}`) : '',
      para('Termín je už podržaný a v kalendári sa tvári ako obsadený.'),
      button(panel, 'Otvoriť panel a rozhodnúť'),
    ],
    foot: false,
  });

  return { subject: `Nová žiadosť ${r.ref} · ${formatSkShort(r.date)}`, text, html };
}

/* --------------------------------------------- 2. potvrdenie o prijatí */

export function guestReceived(r, settings) {
  const termin = slot(r, settings);

  const text = [
    'Dobrý deň,',
    '',
    'žiadosť o zapožičanie letného kina mi prišla a termín som Vám zatiaľ podržal.',
    'V kalendári je už označený ako obsadený, takže Vám ho medzitým nikto nevezme.',
    '',
    lines([['Značka', r.ref], ...termin]),
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

  const html = page({
    title: 'Žiadosť je u mňa',
    preview: `Termín ${formatSkShort(r.date)} som Vám podržal, ozvem sa do dvoch dní.`,
    blocks: [
      para('Dobrý deň,'),
      para(
        'žiadosť o zapožičanie letného kina mi prišla a termín som Vám zatiaľ podržal. ' +
          'V kalendári je už označený ako obsadený, takže Vám ho medzitým nikto nevezme.'
      ),
      ticket(r.ref, termin),
      para(
        'Toto ešte nie je potvrdená rezervácia. Overím si údaje a ozvem sa Vám telefonicky, ' +
          'zvyčajne do dvoch dní. Potvrdenie potom príde aj e-mailom.'
      ),
      para(
        'Ak sa medzitým niečo zmení alebo termín už nepotrebujete, dajte mi prosím vedieť, ' +
          'nech ho môže dostať niekto ďalší.'
      ),
    ],
  });

  return { subject: `Žiadosť ${r.ref} je u mňa`, text, html };
}

/* --------------------------------------- 3. rozhodnutie o žiadosti */

export function guestDecision(r, settings, status) {
  const termin = slot(r, settings);
  const web = siteUrl();

  if (status === 'approved') {
    const text = [
      'Dobrý deň,',
      '',
      'termín je potvrdený, letné kino je Vaše.',
      '',
      lines([['Značka', r.ref], ...termin]),
      '',
      'Techniku si preberiete u mňa v dohodnutom čase. Pri odovzdaní Vám ukážem,',
      'čo kam patrí; postavenie potom zaberie asi desať minút.',
      '',
      'Čo si treba pripraviť doma:',
      'rovnú plochu aspoň 6 × 4 metre bez ostrých predmetov pod plátnom,',
      'zásuvku 230 V v dosahu 20 metrov a možnosť zakotviť plátno do trávy.',
      'Predlžovačka aj kotviace kolíky sú súčasťou balenia.',
      '',
      'Ak by v ten večer pršalo, ozvite sa mi. Máme dohodnutý náhradný termín',
      'alebo nájdeme iný voľný.',
      '',
      'Andrej Práznovský',
      '+421 911 705 236',
    ].join('\n');

    const html = page({
      title: 'Termín je potvrdený',
      preview: `${formatSk(r.date)}, prevzatie o ${settings.pickupTime}.`,
      blocks: [
        para('Dobrý deň,'),
        para('termín je potvrdený, letné kino je Vaše.'),
        ticket(r.ref, termin),
        para(
          'Techniku si preberiete u mňa v dohodnutom čase. Pri odovzdaní Vám ukážem, čo kam ' +
            'patrí; postavenie potom zaberie asi desať minút.'
        ),
        para(
          `<b style="color:${C.ivory}">Čo si treba pripraviť doma:</b> rovnú plochu aspoň ` +
            '6 × 4 metre bez ostrých predmetov pod plátnom, zásuvku 230 V v dosahu 20 metrov ' +
            'a možnosť zakotviť plátno do trávy. Predlžovačka aj kotviace kolíky sú súčasťou balenia.'
        ),
        para(
          'Ak by v ten večer pršalo, ozvite sa mi. Máme dohodnutý náhradný termín alebo ' +
            'nájdeme iný voľný.'
        ),
      ],
    });

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

  const html = page({
    title: 'Žiadosť sa nepodarilo potvrdiť',
    preview: `Termín ${formatSkShort(r.date)} je opäť voľný v kalendári.`,
    blocks: [
      para('Dobrý deň,'),
      para(`žiadosť <b style="color:${C.ivory}">${esc(r.ref)}</b> na ${esc(formatSk(r.date))} sa mi tentoraz nepodarilo potvrdiť.`),
      r.adminNote ? ticket(null, [['Dôvod', r.adminNote]]) : '',
      para('Termín sa práve vrátil do kalendára ako voľný pre niekoho ďalšieho.'),
      para('Ak máte záujem o iný večer, vyberte si prosím nový termín alebo mi zavolajte a dohodneme sa.'),
      web ? button(`${web}/#terminy`, 'Pozrieť voľné termíny') : '',
    ],
  });

  return { subject: `Žiadosť ${r.ref} nebola potvrdená`, text, html };
}
