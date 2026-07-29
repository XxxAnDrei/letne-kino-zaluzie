import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';
import { encode as encodeBySquare, PaymentOptions, CurrencyCode } from 'bysquare/pay';

import { db, getSettings, setSettings, init, SETTING_KEYS, SCOPES } from './db.js';
import { addDays, isIsoDate, today } from './dates.js';
import { buildAvailability } from './availability.js';
import { validateReservation } from './validate.js';
import {
  checkPassword,
  clearSession,
  isAuthed,
  issueSession,
  rateLimiter,
  requireAdmin,
  successLimiter,
} from './auth.js';
import { adminAddress, mailStatus, sendAll, sendMail } from './mailer.js';
import { adminNewRequest, guestDecision, guestReceived } from './emails.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(express.json({ limit: '32kb' }));

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
  ].join('; '),
};

app.use((req, res, next) => {
  res.set(SECURITY_HEADERS);
  next();
});

/* Schéma sa pripraví raz za život inštancie; ďalšie požiadavky čakajú na ňu. */
app.use((req, res, next) => {
  init().then(() => next(), next);
});

/* Chyby v async handleroch dostane Express aj bez try/catch v každej route. */
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/* ---------------------------------------------------------------- verejné */

app.get(
  '/api/availability',
  route(async (req, res) => {
    const settings = await getSettings();
    const from = isIsoDate(req.query.from) ? req.query.from : today();
    let to = isIsoDate(req.query.to) ? req.query.to : addDays(from, settings.horizonDays);
    if (to < from) to = from;
    // Strop, aby sa jedným dopytom nedal vytiahnuť ľubovoľne veľký rozsah.
    const cap = addDays(from, 400);
    if (to > cap) to = cap;

    const { days, firstOpen, lastOpen, today: now } = await buildAvailability(from, to);
    res.set('Cache-Control', 'no-store');
    res.json({
      today: now,
      firstOpen,
      lastOpen,
      days,
      settings: {
        pickupTime: settings.pickupTime,
        returnTime: settings.returnTime,
        leadDays: settings.leadDays,
        seasonStart: settings.seasonStart,
        seasonEnd: settings.seasonEnd,
        paused: settings.paused,
        defaultScope: settings.defaultScope,
        homeMunicipality: settings.homeMunicipality,
      },
    });
  })
);

// Dva stupne: hrubý strop proti zaplaveniu (ráta každý pokus) a jemný strop
// na skutočne vytvorené žiadosti (ráta sa až po úspechu).
const reservationBurstLimiter = rateLimiter({
  bucket: 'res-burst',
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Priveľa požiadaviek. Skús to prosím o chvíľu.',
});
const reservationCreateLimiter = successLimiter({
  bucket: 'res-create',
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Z tejto siete prišlo priveľa žiadostí. Ozvi sa mi prosím telefonicky.',
});

/*
 * Značka a vloženie prebiehajú v jednej transakcii, aby dve súčasné žiadosti
 * nedostali rovnaké číslo. Dvojité obsadenie termínu navyše chytí čiastočný
 * unikátny index.
 */
async function createReservation(clean) {
  const year = clean.date.slice(0, 4);
  const now = new Date().toISOString();
  return db.tx(async (tx) => {
    const row = await tx.get(
      `SELECT COALESCE(MAX(CAST(substr(ref, 9) AS INTEGER)), 0) AS max
         FROM reservations WHERE ref LIKE ?`,
      [`VZ-${year}-%`]
    );
    const ref = `VZ-${year}-${String(Number(row.max) + 1).padStart(3, '0')}`;
    await tx.run(
      `INSERT INTO reservations
         (ref, date, backup_date, name, phone, email, municipality, address, note,
          confirm_adult, confirm_manual, confirm_content, confirm_terms, confirm_privacy,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        ref,
        clean.date,
        clean.backupDate,
        clean.name,
        clean.phone,
        clean.email,
        clean.municipality,
        clean.address,
        clean.note,
        clean.adult,
        clean.manual,
        clean.content,
        clean.terms,
        clean.privacy,
        now,
        now,
      ]
    );
    return { ref };
  });
}

app.post(
  '/api/reservations',
  reservationBurstLimiter,
  route(async (req, res) => {
    const { errors, clean, settings } = await validateReservation(req.body || {});
    if (Object.keys(errors).length > 0) {
      res.status(400).json({ error: 'Skontroluj prosím vyznačené polia.', fields: errors });
      return;
    }
    if (!(await reservationCreateLimiter.check(req, res))) return;

    let created;
    try {
      created = await createReservation(clean);
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err.message))) {
        res.status(409).json({
          error: 'Tento termín práve niekto obsadil. Vyber si prosím iný.',
          fields: { date: 'Termín je už obsadený.' },
        });
        return;
      }
      throw err;
    }

    await reservationCreateLimiter.record(req);

    /*
     * Čaká sa tu zámerne. Po odoslaní odpovede môže serverless funkcia
     * kedykoľvek skončiť, takže rozposielanie na pozadí by sa nemuselo stihnúť.
     * Ak e-mail zlyhá, rezervácia je aj tak uložená a človek vidí svoj lístok.
     */
    const forMail = { ...clean, ref: created.ref, backupDate: clean.backupDate };
    await sendAll([
      adminAddress() && { to: adminAddress(), ...adminNewRequest(forMail, settings) },
      { to: clean.email, toName: clean.name, ...guestReceived(forMail, settings) },
    ]);

    res.status(201).json({
      ref: created.ref,
      date: clean.date,
      backupDate: clean.backupDate,
      status: 'pending',
      pickupTime: settings.pickupTime,
      returnTime: settings.returnTime,
      returnDate: addDays(clean.date, 1),
      oz: settings.oz.name,
    });
  })
);

/* --------------------------------------------------- dobrovoľný príspevok */

/*
 * QR podľa štandardu PAY by square, teda ten, ktorý čítajú slovenské bankové
 * aplikácie. Suma je voliteľná — bez nej si ju človek doplní v banke sám,
 * čo je presne zámer: príspevok nemá byť predpísaný.
 */
function buildPayQr(oz, amount) {
  const payment = {
    type: PaymentOptions.PaymentOrder,
    bankAccounts: [{ iban: oz.iban.replace(/\s+/g, '') }],
    currencyCode: CurrencyCode.EUR,
    paymentNote: oz.note,
    beneficiary: { name: oz.name },
  };
  if (amount) payment.amount = amount;
  return encodeBySquare({ payments: [payment] });
}

app.get(
  '/api/donation',
  route(async (req, res) => {
    const { oz } = await getSettings();
    const raw = Number(req.query.amount);
    // Prázdna, nulová alebo nezmyselná suma znamená QR bez predpísanej sumy.
    const amount =
      Number.isFinite(raw) && raw > 0 && raw <= 10000 ? Math.round(raw * 100) / 100 : null;

    let qr = null;
    try {
      qr = await QRCode.toString(buildPayQr(oz, amount), {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 0,
        color: { dark: '#f2ece0', light: '#00000000' },
      });
    } catch (err) {
      console.error('[qr]', err);
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ oz, amount, qr });
  })
);

/* ------------------------------------------------------------------ admin */

const loginLimiter = rateLimiter({
  bucket: 'login',
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Priveľa pokusov o prihlásenie. Skús to o 15 minút.',
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!checkPassword(req.body?.password)) {
    res.status(401).json({ error: 'Nesprávne heslo.' });
    return;
  }
  issueSession(res);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ authed: isAuthed(req) });
});

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'done', 'moved'];

app.get(
  '/api/admin/reservations',
  requireAdmin,
  route(async (req, res) => {
    const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const where = [];
    const params = [];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (q) {
      where.push(
        '(name LIKE ? OR phone LIKE ? OR address LIKE ? OR ref LIKE ? OR email LIKE ? OR municipality LIKE ?)'
      );
      params.push(...Array(6).fill(`%${q}%`));
    }

    const reservations = await db.all(
      `SELECT * FROM reservations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY date ASC, id ASC`,
      params
    );
    const counts = await db.all('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status');

    res.set('Cache-Control', 'no-store');
    res.json({
      reservations,
      counts: Object.fromEntries(counts.map((r) => [r.status, Number(r.n)])),
      today: today(),
    });
  })
);

app.patch(
  '/api/admin/reservations/:id',
  requireAdmin,
  route(async (req, res) => {
    const id = Number(req.params.id);
    const existing = await db.get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Rezervácia sa nenašla.' });
      return;
    }

    const status = req.body?.status;
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Neznámy stav.' });
      return;
    }
    const adminNote =
      typeof req.body?.adminNote === 'string'
        ? req.body.adminNote.slice(0, 1000)
        : existing.admin_note;

    try {
      await db.run('UPDATE reservations SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?', [
        status ?? existing.status,
        adminNote,
        new Date().toISOString(),
        id,
      ]);
    } catch (err) {
      if (/UNIQUE|constraint/i.test(String(err.message))) {
        res.status(409).json({ error: 'Na tento termín už je iná aktívna rezervácia.' });
        return;
      }
      throw err;
    }

    const updated = await db.get('SELECT * FROM reservations WHERE id = ?', [id]);

    /*
     * Rozhodnutie sa posiela len pri skutočnej zmene stavu. Bez tejto podmienky
     * by človeku prišiel e-mail aj vtedy, keď si k žiadosti dopíšeš poznámku.
     */
    if (status && status !== existing.status && (status === 'approved' || status === 'rejected')) {
      const settings = await getSettings();
      await sendAll([
        {
          to: updated.email,
          toName: updated.name,
          ...guestDecision(
            {
              ref: updated.ref,
              date: updated.date,
              backupDate: updated.backup_date,
              name: updated.name,
              adminNote: status === 'rejected' ? updated.admin_note : null,
            },
            settings,
            status
          ),
        },
      ]);
    }

    res.json({ reservation: updated });
  })
);

/*
 * Diagnostika e-mailov. Bez nej sa chýbajúca premenná hľadá naslepo: stránka
 * sa tvári úplne rovnako, či sa e-mail poslal alebo nie. GET len ukáže stav,
 * POST skúsi naozaj odoslať a vráti presnú odpoveď Brevo.
 */
app.get(
  '/api/admin/mail',
  requireAdmin,
  route(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(mailStatus());
  })
);

app.post(
  '/api/admin/mail/test',
  requireAdmin,
  route(async (_req, res) => {
    const stav = mailStatus();
    if (!stav.pripravene) {
      res.status(400).json({ error: `E-mail nie je nastavený, chýba: ${stav.chyba.join(', ')}`, stav });
      return;
    }
    const cielova = stav.upozorneniaNa || stav.odosielatel;
    const teraz = new Date().toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
    const vysledok = await sendMail({
      to: cielova,
      subject: 'Skúšobný e-mail z letného kina',
      text:
        `Toto je skúšobná správa z rezervačnej stránky letného kina.\n\n` +
        `Ak ti prišla, odosielanie funguje a upozornenia o nových žiadostiach\n` +
        `budú chodiť na túto adresu.\n\nOdoslané: ${teraz}\n`,
    });
    if (!vysledok.ok) {
      res.status(502).json({
        error: vysledok.detail
          ? `${vysledok.error} — ${vysledok.detail}`
          : `Brevo správu neprijalo: ${vysledok.error}`,
        stav,
      });
      return;
    }
    res.json({ ok: true, odoslaneNa: cielova, stav });
  })
);

app.delete(
  '/api/admin/reservations/:id',
  requireAdmin,
  route(async (req, res) => {
    const { changes } = await db.run('DELETE FROM reservations WHERE id = ?', [
      Number(req.params.id),
    ]);
    if (changes === 0) {
      res.status(404).json({ error: 'Rezervácia sa nenašla.' });
      return;
    }
    res.json({ ok: true });
  })
);

/*
 * Presun na náhradný termín. Pôvodný deň sa tým uvoľní späť do kalendára,
 * takže o neho môže požiadať niekto ďalší.
 */
app.post(
  '/api/admin/reservations/:id/move',
  requireAdmin,
  route(async (req, res) => {
    const id = Number(req.params.id);
    const row = await db.get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!row) {
      res.status(404).json({ error: 'Rezervácia sa nenašla.' });
      return;
    }
    const target = isIsoDate(req.body?.date) ? req.body.date : row.backup_date;
    if (!isIsoDate(target)) {
      res.status(400).json({ error: 'Táto rezervácia nemá náhradný termín. Zadaj dátum.' });
      return;
    }
    const clash = await db.get(
      "SELECT ref FROM reservations WHERE date = ? AND id <> ? AND status IN ('pending','approved')",
      [target, id]
    );
    if (clash) {
      res.status(409).json({ error: `Na ${target} je už aktívna rezervácia ${clash.ref}.` });
      return;
    }

    await db.run(
      `UPDATE reservations
          SET moved_from = COALESCE(moved_from, date), date = ?, backup_date = NULL, updated_at = ?
        WHERE id = ?`,
      [target, new Date().toISOString(), id]
    );
    res.json({ reservation: await db.get('SELECT * FROM reservations WHERE id = ?', [id]) });
  })
);

/* Odovzdávací a preberací zoznam. Položky sa ukladajú ako JSON pole názvov. */
app.post(
  '/api/admin/reservations/:id/handover',
  requireAdmin,
  route(async (req, res) => {
    const id = Number(req.params.id);
    const row = await db.get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!row) {
      res.status(404).json({ error: 'Rezervácia sa nenašla.' });
      return;
    }
    const phase = req.body?.phase === 'return' ? 'return' : 'handout';
    const items = Array.isArray(req.body?.items)
      ? JSON.stringify(req.body.items.slice(0, 40).map((v) => String(v).slice(0, 60)))
      : null;
    const note =
      typeof req.body?.conditionNote === 'string'
        ? req.body.conditionNote.slice(0, 1000)
        : row.condition_note;
    const stamp = new Date().toISOString();

    await db.run(
      phase === 'handout'
        ? 'UPDATE reservations SET handout_at = ?, handout_items = ?, condition_note = ?, updated_at = ? WHERE id = ?'
        : 'UPDATE reservations SET return_at = ?, return_items = ?, condition_note = ?, updated_at = ? WHERE id = ?',
      [stamp, items, note, stamp, id]
    );
    res.json({ reservation: await db.get('SELECT * FROM reservations WHERE id = ?', [id]) });
  })
);

/* ------------------------------------------------------- blokované termíny */

app.get(
  '/api/admin/blackouts',
  requireAdmin,
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ blackouts: await db.all('SELECT * FROM blackouts ORDER BY date ASC') });
  })
);

app.post(
  '/api/admin/blackouts',
  requireAdmin,
  route(async (req, res) => {
    const date = req.body?.date;
    if (!isIsoDate(date)) {
      res.status(400).json({ error: 'Neplatný dátum.' });
      return;
    }
    const active = await db.get(
      "SELECT ref FROM reservations WHERE date = ? AND status IN ('pending','approved')",
      [date]
    );
    if (active) {
      res.status(409).json({ error: `Na ${date} je aktívna rezervácia ${active.ref}.` });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;
    await db.run(
      'INSERT INTO blackouts (date, reason, created_at) VALUES (?, ?, ?) ON CONFLICT (date) DO UPDATE SET reason = excluded.reason',
      [date, reason, new Date().toISOString()]
    );
    res.status(201).json({ ok: true });
  })
);

app.delete(
  '/api/admin/blackouts/:id',
  requireAdmin,
  route(async (req, res) => {
    const { changes } = await db.run('DELETE FROM blackouts WHERE id = ?', [Number(req.params.id)]);
    if (changes === 0) {
      res.status(404).json({ error: 'Blokácia sa nenašla.' });
      return;
    }
    res.json({ ok: true });
  })
);

/* ----------------------------------------- pravidlá termínov a blokovanie */

app.get(
  '/api/admin/slot-rules',
  requireAdmin,
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ rules: await db.all('SELECT * FROM slot_rules ORDER BY date ASC') });
  })
);

app.post(
  '/api/admin/slot-rules',
  requireAdmin,
  route(async (req, res) => {
    const { date, scope } = req.body || {};
    if (!isIsoDate(date)) {
      res.status(400).json({ error: 'Neplatný dátum.' });
      return;
    }
    if (!SCOPES.includes(scope)) {
      res.status(400).json({ error: 'Neznáme určenie termínu.' });
      return;
    }
    await db.run(
      'INSERT INTO slot_rules (date, scope, created_at) VALUES (?, ?, ?) ON CONFLICT (date) DO UPDATE SET scope = excluded.scope',
      [date, scope, new Date().toISOString()]
    );
    res.status(201).json({ ok: true });
  })
);

app.delete(
  '/api/admin/slot-rules/:date',
  requireAdmin,
  route(async (req, res) => {
    const { changes } = await db.run('DELETE FROM slot_rules WHERE date = ?', [req.params.date]);
    if (changes === 0) {
      res.status(404).json({ error: 'Pravidlo sa nenašlo.' });
      return;
    }
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/blocklist',
  requireAdmin,
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ entries: await db.all('SELECT * FROM blocklist ORDER BY created_at DESC') });
  })
);

app.post(
  '/api/admin/blocklist',
  requireAdmin,
  route(async (req, res) => {
    const value = typeof req.body?.value === 'string' ? req.body.value.trim().toLowerCase() : '';
    if (value.length < 5) {
      res.status(400).json({ error: 'Zadaj telefón alebo e-mail.' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;
    await db.run(
      'INSERT INTO blocklist (value, reason, created_at) VALUES (?, ?, ?) ON CONFLICT (value) DO UPDATE SET reason = excluded.reason',
      [value, reason, new Date().toISOString()]
    );
    res.status(201).json({ ok: true });
  })
);

app.delete(
  '/api/admin/blocklist/:id',
  requireAdmin,
  route(async (req, res) => {
    const { changes } = await db.run('DELETE FROM blocklist WHERE id = ?', [Number(req.params.id)]);
    if (changes === 0) {
      res.status(404).json({ error: 'Záznam sa nenašiel.' });
      return;
    }
    res.json({ ok: true });
  })
);

/* --------------------------------------------------------------- nastavenia */

app.get(
  '/api/admin/settings',
  requireAdmin,
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ settings: await getSettings() });
  })
);

app.patch(
  '/api/admin/settings',
  requireAdmin,
  route(async (req, res) => {
    const patch = {};
    for (const key of SETTING_KEYS) {
      if (req.body && Object.hasOwn(req.body, key)) patch[key] = req.body[key];
    }
    if (patch.season_start && !/^\d{2}-\d{2}$/.test(patch.season_start)) {
      res.status(400).json({ error: 'Začiatok sezóny zadaj v tvare MM-DD.' });
      return;
    }
    if (patch.season_end && !/^\d{2}-\d{2}$/.test(patch.season_end)) {
      res.status(400).json({ error: 'Koniec sezóny zadaj v tvare MM-DD.' });
      return;
    }
    if (patch.default_scope && !SCOPES.includes(patch.default_scope)) {
      res.status(400).json({ error: 'Neznáme predvolené určenie termínov.' });
      return;
    }
    if (patch.oz_iban && !/^SK\d{22}$/.test(String(patch.oz_iban).replace(/\s+/g, ''))) {
      res.status(400).json({ error: 'IBAN musí byť slovenský, v tvare SK a 22 číslic.' });
      return;
    }
    res.json({ settings: await setSettings(patch) });
  })
);

const CSV_COLUMNS = [
  ['ref', 'Značka'],
  ['date', 'Termín'],
  ['backup_date', 'Náhradný termín'],
  ['moved_from', 'Presunuté z'],
  ['status', 'Stav'],
  ['name', 'Meno'],
  ['phone', 'Telefón'],
  ['email', 'E-mail'],
  ['municipality', 'Obec'],
  ['address', 'Adresa'],
  ['note', 'Poznámka'],
  ['admin_note', 'Interná poznámka'],
  ['handout_at', 'Prevzaté'],
  ['return_at', 'Vrátené'],
  ['condition_note', 'Stav vybavenia'],
  ['created_at', 'Vytvorené'],
];

app.get(
  '/api/admin/export.csv',
  requireAdmin,
  route(async (req, res) => {
    const rows = await db.all('SELECT * FROM reservations ORDER BY date ASC');
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      CSV_COLUMNS.map(([, label]) => escape(label)).join(';'),
      ...rows.map((row) => CSV_COLUMNS.map(([key]) => escape(row[key])).join(';')),
    ].join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="rezervacie-${today()}.csv"`);
    // BOM, aby Excel korektne otvoril diakritiku.
    res.send(`﻿${csv}`);
  })
);

/* ----------------------------------------------------------------- static */

/*
 * Na Verceli statiku obsluhuje CDN a sem sa dostanú len /api/*. Lokálne
 * si ju vezme na starosť Express, aby `npm start` stačil na plnú stránku.
 */
export function mountStatic() {
  app.use(
    express.static(publicDir, {
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (/[\\/](media|fonts|vendor)[\\/]/.test(filePath)) {
          res.set('Cache-Control', 'public, max-age=2592000, immutable');
        }
        if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('/spravca', (req, res) => res.sendFile(path.join(publicDir, 'spravca.html')));
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Nenájdené.' });
      return;
    }
    res.status(404).sendFile(path.join(publicDir, '404.html'));
  });
}

export function mountErrors() {
  app.use((err, req, res, _next) => {
    console.error('[chyba]', err);
    if (res.headersSent) return;
    res.status(500);
    if (req.path.startsWith('/api/')) {
      res.json({ error: 'Na serveri nastala chyba. Skús to prosím znova.' });
    } else {
      res.send('Na serveri nastala chyba.');
    }
  });
}
