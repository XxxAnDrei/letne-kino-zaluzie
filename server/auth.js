import crypto from 'node:crypto';

import { db } from './db.js';

const COOKIE_NAME = 'vz_kino_admin';
const SESSION_HOURS = 12;

const isProd = process.env.NODE_ENV === 'production';

let adminPassword = process.env.ADMIN_PASSWORD || '';
let generatedPassword = false;
if (!adminPassword) {
  adminPassword = crypto.randomBytes(9).toString('base64url');
  generatedPassword = true;
}

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ephemeralSecret = !process.env.SESSION_SECRET;

export function authStartupNotes() {
  const notes = [];
  if (generatedPassword) {
    notes.push(
      `ADMIN_PASSWORD nie je nastavené — na tento beh platí dočasné heslo: ${adminPassword}`
    );
  }
  if (ephemeralSecret) {
    notes.push('SESSION_SECRET nie je nastavené — po reštarte servera sa správca odhlási.');
  }
  if (isProd && (generatedPassword || ephemeralSecret)) {
    notes.push('V produkcii nastav ADMIN_PASSWORD aj SESSION_SECRET v premenných prostredia.');
  }
  return notes;
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

/** Konštantné porovnanie cez SHA-256, aby dĺžka hesla neunikala cez čas odpovede. */
export function checkPassword(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

export function issueSession(res) {
  const expires = Date.now() + SESSION_HOURS * 3600_000;
  const payload = Buffer.from(JSON.stringify({ exp: expires })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: SESSION_HOURS * 3600_000,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isAuthed(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function requireAdmin(req, res, next) {
  if (!isAuthed(req)) {
    res.status(401).json({ error: 'Prihlásenie je potrebné.' });
    return;
  }
  // Cookie je SameSite=Lax, takže vlastná hlavička stačí ako ochrana proti CSRF
  // pri zmenových operáciách — bežný cross-site formulár ju nevie nastaviť.
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'kino-admin') {
    res.status(403).json({ error: 'Neplatná požiadavka.' });
    return;
  }
  next();
}

/*
 * Počítadlo pokusov žije v databáze, nie v pamäti procesu. Na Verceli beží
 * každá požiadavka potenciálne v inej inštancii, takže počítadlo v pamäti
 * by nechránilo pred ničím.
 */
async function countHits(bucket, key, windowMs, now) {
  const since = now - windowMs;
  // Upratovanie len pre tento kľúč — lacné a ohraničené.
  await db.run('DELETE FROM rate_hits WHERE bucket = ? AND key = ? AND at < ?', [
    bucket,
    key,
    since,
  ]);
  const row = await db.get(
    'SELECT COUNT(*) AS n, MIN(at) AS oldest FROM rate_hits WHERE bucket = ? AND key = ? AND at >= ?',
    [bucket, key, since]
  );
  return { count: row ? Number(row.n) : 0, oldest: row && row.oldest ? Number(row.oldest) : now };
}

async function recordHit(bucket, key, now) {
  await db.run('INSERT INTO rate_hits (bucket, key, at) VALUES (?, ?, ?)', [bucket, key, now]);
}

function tooMany(res, message, windowMs, oldest, now) {
  res.set('Retry-After', String(Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000))));
  res.status(429).json({ error: message });
}

/** Middleware: zaráta každú požiadavku, ktorá cez neho prejde. */
export function rateLimiter({ bucket, windowMs, max, message }) {
  return async (req, res, next) => {
    try {
      const now = Date.now();
      const key = req.ip || 'neznamy';
      const { count, oldest } = await countHits(bucket, key, windowMs, now);
      if (count >= max) return tooMany(res, message, windowMs, oldest, now);
      await recordHit(bucket, key, now);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Limit, ktorý sa zaráta až po úspechu. Neúspešná validácia tak nemíňa
 * rozpočet — inak by sa človek po pár preklepoch vo formulári zamkol
 * na hodinu, a za jednou obecnou IP adresou býva viac domácností.
 */
export function successLimiter({ bucket, windowMs, max, message }) {
  return {
    async check(req, res) {
      const now = Date.now();
      const key = req.ip || 'neznamy';
      const { count, oldest } = await countHits(bucket, key, windowMs, now);
      if (count >= max) {
        tooMany(res, message, windowMs, oldest, now);
        return false;
      }
      return true;
    },
    async record(req) {
      await recordHit(bucket, req.ip || 'neznamy', Date.now());
    },
  };
}
