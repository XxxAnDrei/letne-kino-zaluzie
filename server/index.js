// Musí byť prvý import — napĺňa process.env skôr, než si ho prečíta db.js a auth.js.
import { envLoaded } from './env.js';

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db, getSettings, setSettings, SETTING_KEYS } from './db.js';
import { addDays, isIsoDate, today } from './dates.js';
import { buildAvailability } from './availability.js';
import { validateReservation } from './validate.js';
import {
  authStartupNotes,
  checkPassword,
  clearSession,
  isAuthed,
  issueSession,
  rateLimiter,
  requireAdmin,
  successLimiter,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const gsapDist = path.join(__dirname, '..', 'node_modules', 'gsap', 'dist');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  res.set({
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
  });
  next();
});

/* ---------------------------------------------------------------- verejné */

app.get('/api/availability', (req, res) => {
  const settings = getSettings();
  const from = isIsoDate(req.query.from) ? req.query.from : today();
  const fallbackTo = addDays(from, settings.horizonDays);
  let to = isIsoDate(req.query.to) ? req.query.to : fallbackTo;
  if (to < from) to = from;
  // Strop, aby sa jedným dopytom nedal vytiahnuť ľubovoľne veľký rozsah.
  const cap = addDays(from, 400);
  if (to > cap) to = cap;

  const { days, firstOpen, lastOpen, today: now } = buildAvailability(from, to);
  res.set('Cache-Control', 'no-store');
  res.json({
    today: now,
    firstOpen,
    lastOpen,
    days,
    settings: {
      pickupTime: settings.pickupTime,
      returnTime: settings.returnTime,
      maxPeople: settings.maxPeople,
      leadDays: settings.leadDays,
      seasonStart: settings.seasonStart,
      seasonEnd: settings.seasonEnd,
      paused: settings.paused,
    },
  });
});

// Dva stupne: hrubý strop proti zaplaveniu (ráta každý pokus) a jemný strop
// na skutočne vytvorené žiadosti (ráta sa až po úspechu).
const reservationBurstLimiter = rateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Priveľa požiadaviek. Skús to prosím o chvíľu.',
});
const reservationCreateLimiter = successLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Z tejto siete prišlo priveľa žiadostí. Ozvi sa mi prosím telefonicky.',
});

const nextRef = db.prepare(
  `SELECT IFNULL(MAX(CAST(substr(ref, 9) AS INTEGER)), 0) AS max FROM reservations WHERE ref LIKE ?`
);
const insertReservation = db.prepare(`
  INSERT INTO reservations
    (ref, date, backup_date, name, phone, email, address, people, note,
     confirm_power, confirm_wifi, confirm_garden, confirm_terms,
     status, created_at, updated_at)
  VALUES
    (@ref, @date, @backupDate, @name, @phone, @email, @address, @people, @note,
     @power, @wifi, @garden, @terms,
     'pending', @now, @now)
`);

const createReservation = db.transaction((clean) => {
  const year = clean.date.slice(0, 4);
  const { max } = nextRef.get(`VZ-${year}-%`);
  const ref = `VZ-${year}-${String(max + 1).padStart(3, '0')}`;
  const now = new Date().toISOString();
  const info = insertReservation.run({ ...clean, ref, now });
  return { id: info.lastInsertRowid, ref };
});

app.post('/api/reservations', reservationBurstLimiter, (req, res) => {
  const { errors, clean, settings } = validateReservation(req.body || {});
  if (Object.keys(errors).length > 0) {
    res.status(400).json({ error: 'Skontroluj prosím vyznačené polia.', fields: errors });
    return;
  }
  if (!reservationCreateLimiter.check(req, res)) return;

  let created;
  try {
    created = createReservation(clean);
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({
        error: 'Tento termín práve niekto obsadil. Vyber si prosím iný.',
        fields: { date: 'Termín je už obsadený.' },
      });
      return;
    }
    throw err;
  }

  reservationCreateLimiter.record(req);
  res.status(201).json({
    ref: created.ref,
    date: clean.date,
    backupDate: clean.backupDate,
    status: 'pending',
    pickupTime: settings.pickupTime,
    returnTime: settings.returnTime,
    returnDate: addDays(clean.date, 1),
  });
});

/* ------------------------------------------------------------------ admin */

const loginLimiter = rateLimiter({
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

const VALID_STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'done'];

app.get('/api/admin/reservations', requireAdmin, (req, res) => {
  const status = VALID_STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(name LIKE ? OR phone LIKE ? OR address LIKE ? OR ref LIKE ? OR email LIKE ?)');
    params.push(...Array(5).fill(`%${q}%`));
  }
  const sql = `SELECT * FROM reservations ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY date ASC, id ASC`;

  res.set('Cache-Control', 'no-store');
  res.json({
    reservations: db.prepare(sql).all(...params),
    counts: Object.fromEntries(
      db
        .prepare('SELECT status, COUNT(*) AS n FROM reservations GROUP BY status')
        .all()
        .map((r) => [r.status, r.n])
    ),
    today: today(),
  });
});

app.patch('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
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
    typeof req.body?.adminNote === 'string' ? req.body.adminNote.slice(0, 1000) : existing.admin_note;

  try {
    db.prepare(
      'UPDATE reservations SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?'
    ).run(status ?? existing.status, adminNote, new Date().toISOString(), id);
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({ error: 'Na tento termín už je iná aktívna rezervácia.' });
      return;
    }
    throw err;
  }
  res.json({ reservation: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) });
});

app.delete('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM reservations WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) {
    res.status(404).json({ error: 'Rezervácia sa nenašla.' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/admin/blackouts', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ blackouts: db.prepare('SELECT * FROM blackouts ORDER BY date ASC').all() });
});

app.post('/api/admin/blackouts', requireAdmin, (req, res) => {
  const date = req.body?.date;
  if (!isIsoDate(date)) {
    res.status(400).json({ error: 'Neplatný dátum.' });
    return;
  }
  const active = db
    .prepare("SELECT ref FROM reservations WHERE date = ? AND status IN ('pending','approved')")
    .get(date);
  if (active) {
    res.status(409).json({ error: `Na ${date} je aktívna rezervácia ${active.ref}.` });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;
  db.prepare(
    'INSERT INTO blackouts (date, reason, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason'
  ).run(date, reason, new Date().toISOString());
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/blackouts/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM blackouts WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) {
    res.status(404).json({ error: 'Blokácia sa nenašla.' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ settings: getSettings() });
});

app.patch('/api/admin/settings', requireAdmin, (req, res) => {
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
  res.json({ settings: setSettings(patch) });
});

const CSV_COLUMNS = [
  ['ref', 'Značka'],
  ['date', 'Termín'],
  ['backup_date', 'Náhradný termín'],
  ['status', 'Stav'],
  ['name', 'Meno'],
  ['phone', 'Telefón'],
  ['email', 'E-mail'],
  ['address', 'Adresa'],
  ['people', 'Osôb'],
  ['note', 'Poznámka'],
  ['admin_note', 'Interná poznámka'],
  ['created_at', 'Vytvorené'],
];

app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM reservations ORDER BY date ASC').all();
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    CSV_COLUMNS.map(([, label]) => escape(label)).join(';'),
    ...rows.map((row) => CSV_COLUMNS.map(([key]) => escape(row[key])).join(';')),
  ].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="rezervacie-${today()}.csv"`);
  // BOM, aby Excel korektne otvoril diakritiku.
  res.send(`﻿${csv}`);
});

/* ----------------------------------------------------------------- static */

app.use(
  '/vendor/gsap',
  express.static(gsapDist, { maxAge: '30d', immutable: true, index: false })
);
app.use(
  express.static(publicDir, {
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (/[\\/]media[\\/]|[\\/]fonts[\\/]/.test(filePath)) {
        res.set('Cache-Control', 'public, max-age=2592000, immutable');
      }
      if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    },
  })
);

app.get('/spravca', (req, res) => res.sendFile(path.join(publicDir, 'spravca.html')));
app.get('/pravidla', (req, res) => res.redirect(301, '/#pravidla'));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Nenájdené.' });
    return;
  }
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

app.use((err, req, res, _next) => {
  console.error('[chyba]', err);
  if (res.headersSent) return;
  const wantsJson = req.path.startsWith('/api/');
  res.status(500);
  if (wantsJson) res.json({ error: 'Na serveri nastala chyba. Skús to prosím znova.' });
  else res.send('Na serveri nastala chyba.');
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Letné kino Veľké Zálužie — http://localhost:${port}`);
  console.log(`Správca rezervácií      — http://localhost:${port}/spravca`);
  if (envLoaded) console.log(`  načítané z .env: ${envLoaded} premenných`);
  for (const note of authStartupNotes()) console.log(`  ! ${note}`);
});
