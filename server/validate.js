import { db, getSettings } from './db.js';
import { addDays, inSeason, isIsoDate, today } from './dates.js';
import { dateStatus } from './availability.js';

const STATUS_MESSAGES = {
  taken: 'Tento termín je už obsadený. Vyber si prosím iný.',
  blocked: 'Tento termín nie je dostupný.',
  past: 'Tento termín je príliš blízko. Žiadosť pošli aspoň pár dní vopred.',
  offseason: 'Tento termín je mimo sezóny letného kina.',
  far: 'Tento termín je zatiaľ priďaleko.',
  paused: 'Príjem žiadostí je dočasne pozastavený.',
  invalid: 'Vyber si prosím platný termín.',
};

/* Potvrdenia, bez ktorých techniku požičať nemožno. */
const CONFIRMATIONS = [
  ['adult', 'Potvrď prosím, že si plnoletá osoba a preberáš zodpovednosť.'],
  ['manual', 'Potvrď prosím používanie podľa návodu a za vhodného počasia.'],
  ['content', 'Potvrď prosím zodpovednosť za výber premietaného obsahu.'],
  ['terms', 'Bez súhlasu s podmienkami to, žiaľ, nejde.'],
  ['privacy', 'Potvrď prosím, že si sa oboznámil so spracúvaním osobných údajov.'],
];

function text(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function checked(value) {
  return value === true || value === 'true' || value === 'on';
}

export function normalisePhone(value) {
  const raw = text(value).replace(/[\s\-()/.]/g, '');
  if (/^00/.test(raw)) return `+${raw.slice(2)}`;
  if (/^0\d{9}$/.test(raw)) return `+421${raw.slice(1)}`;
  return raw;
}

/** Porovnanie obce bez ohľadu na diakritiku a veľkosť písmen. */
function sameMunicipality(a, b) {
  const norm = (v) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  return norm(a) === norm(b);
}

export async function validateReservation(body) {
  const settings = await getSettings();
  const errors = {};
  const clean = {};

  if (text(body.web)) errors.web = 'Neplatná požiadavka.';

  const date = text(body.date);
  const { status, scope } = await dateStatus(date);
  if (status !== 'free') errors.date = STATUS_MESSAGES[status] || STATUS_MESSAGES.invalid;
  clean.date = date;

  /*
   * Náhradný termín sa eviduje, ale neblokuje — inak by jedna rodina obsadila
   * dva večery. Musí však dávať zmysel: dátum o päť rokov alebo uprostred zimy
   * by sa ticho uložil a vyplával by až pri daždi, keď je naň neskoro.
   */
  const backupDate = text(body.backupDate);
  if (backupDate) {
    if (!isIsoDate(backupDate)) {
      errors.backupDate = 'Náhradný termín má neplatný formát.';
    } else if (backupDate === date) {
      errors.backupDate = 'Náhradný termín musí byť iný ako hlavný.';
    } else if (backupDate < addDays(today(), settings.leadDays)) {
      errors.backupDate = 'Náhradný termín je príliš blízko.';
    } else if (backupDate > addDays(today(), settings.horizonDays)) {
      errors.backupDate = 'Náhradný termín je zatiaľ priďaleko.';
    } else if (!inSeason(backupDate, settings.seasonStart, settings.seasonEnd)) {
      errors.backupDate = 'Náhradný termín je mimo sezóny letného kina.';
    }
  }
  clean.backupDate = backupDate || null;

  const name = text(body.name);
  if (name.length < 3 || name.length > 80) {
    errors.name = 'Uveď meno a priezvisko.';
  } else if (!name.includes(' ')) {
    errors.name = 'Uveď prosím aj priezvisko.';
  }
  clean.name = name;

  const phone = normalisePhone(body.phone);
  if (!/^\+?\d{9,15}$/.test(phone)) {
    errors.phone = 'Telefón zadaj v tvare 0901 234 567 alebo +421901234567.';
  }
  clean.phone = phone;

  // E-mail je povinný — potvrdenie termínu chodí naň.
  const email = text(body.email).toLowerCase();
  if (!email) {
    errors.email = 'E-mail potrebujem, aby som ti poslal potvrdenie termínu.';
  } else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    errors.email = 'E-mail nevyzerá správne.';
  }
  clean.email = email;

  const municipality = text(body.municipality);
  if (municipality.length < 2 || municipality.length > 80) {
    errors.municipality = 'Uveď obec, v ktorej budeš premietať.';
  } else if (
    status === 'free' &&
    scope === 'zaluzie' &&
    !sameMunicipality(municipality, settings.homeMunicipality)
  ) {
    // Úvodná fáza: takto označený termín je vyhradený domácim.
    errors.municipality = `Tento termín je počas úvodnej fázy vyhradený pre obyvateľov obce ${settings.homeMunicipality}. Skús prosím termín označený ako otvorený pre okolité obce.`;
  }
  clean.municipality = municipality;

  const address = text(body.address);
  if (address.length < 5 || address.length > 120) {
    errors.address = 'Uveď ulicu a číslo domu, kde budeš premietať.';
  }
  clean.address = address;

  const note = text(body.note);
  if (note.length > 500) errors.note = 'Poznámka je príliš dlhá (max. 500 znakov).';
  clean.note = note || null;

  for (const [field, message] of CONFIRMATIONS) {
    if (!checked(body[field])) errors[field] = message;
    clean[field] = 1;
  }

  // Žiadosť z blokovaného kontaktu sa neprijme, ale dôvod sa navonok nerozvádza.
  if (!errors.phone || !errors.email) {
    const blocked = await db.get('SELECT value FROM blocklist WHERE value = ? OR value = ?', [
      clean.phone,
      clean.email,
    ]);
    if (blocked) {
      errors.phone = 'Z tohto kontaktu momentálne nie je možné poslať žiadosť. Ozvi sa mi prosím telefonicky.';
    }
  }

  return { errors, clean, settings, scope };
}

export { STATUS_MESSAGES, CONFIRMATIONS };
