import { getSettings } from './db.js';
import { addDays, isIsoDate, today } from './dates.js';
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

function text(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function normalisePhone(value) {
  const raw = text(value).replace(/[\s\-()/.]/g, '');
  if (/^00/.test(raw)) return `+${raw.slice(2)}`;
  if (/^0\d{9}$/.test(raw)) return `+421${raw.slice(1)}`;
  return raw;
}

export function validateReservation(body) {
  const settings = getSettings();
  const errors = {};
  const clean = {};

  if (text(body.web)) errors.web = 'Neplatná požiadavka.';

  const date = text(body.date);
  const status = dateStatus(date);
  if (status !== 'free') errors.date = STATUS_MESSAGES[status] || STATUS_MESSAGES.invalid;
  clean.date = date;

  const backupDate = text(body.backupDate);
  if (backupDate) {
    if (!isIsoDate(backupDate)) {
      errors.backupDate = 'Náhradný termín má neplatný formát.';
    } else if (backupDate === date) {
      errors.backupDate = 'Náhradný termín musí byť iný ako hlavný.';
    } else if (backupDate < addDays(today(), settings.leadDays)) {
      errors.backupDate = 'Náhradný termín je príliš blízko.';
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

  const email = text(body.email).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    errors.email = 'E-mail nevyzerá správne.';
  }
  clean.email = email || null;

  const address = text(body.address);
  if (address.length < 5 || address.length > 120) {
    errors.address = 'Uveď ulicu a číslo domu vo Veľkom Záluží.';
  }
  clean.address = address;

  const people = Number(body.people);
  if (!Number.isInteger(people) || people < 1 || people > settings.maxPeople) {
    errors.people = `Počet osôb zadaj v rozsahu 1 – ${settings.maxPeople}.`;
  }
  clean.people = people;

  const note = text(body.note);
  if (note.length > 500) errors.note = 'Poznámka je príliš dlhá (max. 500 znakov).';
  clean.note = note || null;

  for (const [field, label] of [
    ['power', 'Potvrď prosím prístup k elektrine.'],
    ['garden', 'Potvrď prosím vhodnú rovnú plochu.'],
    ['terms', 'Bez súhlasu s podmienkami to, žiaľ, nejde.'],
  ]) {
    if (body[field] !== true && body[field] !== 'true' && body[field] !== 'on') {
      errors[field] = label;
    }
    clean[field] = 1;
  }
  // Wi-Fi je len informácia pre správcu — premietať sa dá aj z USB kľúča.
  clean.wifi = body.wifi === true || body.wifi === 'true' || body.wifi === 'on' ? 1 : 0;

  return { errors, clean, settings };
}

export { STATUS_MESSAGES };
