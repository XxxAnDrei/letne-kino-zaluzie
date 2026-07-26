import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'kino.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ref           TEXT    NOT NULL UNIQUE,
    date          TEXT    NOT NULL,
    backup_date   TEXT,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL,
    email         TEXT,
    address       TEXT    NOT NULL,
    people        INTEGER NOT NULL,
    note          TEXT,
    confirm_power   INTEGER NOT NULL DEFAULT 0,
    confirm_wifi    INTEGER NOT NULL DEFAULT 0,
    confirm_garden  INTEGER NOT NULL DEFAULT 0,
    confirm_terms   INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'pending',
    admin_note    TEXT,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blackouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL UNIQUE,
    reason      TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_res_date   ON reservations(date);
  CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
`);

/*
 * Jeden termín = jedna aktívna rezervácia. Čiastočný unikátny index rieši
 * súbeh dvoch prihlášok na ten istý deň na úrovni databázy, nie aplikácie —
 * druhý INSERT spadne na constraint namiesto toho, aby prešiel.
 */
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_res_active_date
    ON reservations(date)
    WHERE status IN ('pending', 'approved');
`);

const DEFAULT_SETTINGS = {
  season_start: '05-01',
  season_end: '09-30',
  lead_days: '2',
  horizon_days: '120',
  pickup_time: '17:00',
  return_time: '10:00',
  max_people: '60',
  paused: '0',
};

const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
);
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return {
    seasonStart: out.season_start,
    seasonEnd: out.season_end,
    leadDays: Number(out.lead_days),
    horizonDays: Number(out.horizon_days),
    pickupTime: out.pickup_time,
    returnTime: out.return_time,
    maxPeople: Number(out.max_people),
    paused: out.paused === '1',
  };
}

const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

export function setSettings(patch) {
  const write = db.transaction((entries) => {
    for (const [key, value] of entries) upsertSetting.run(key, String(value));
  });
  write(Object.entries(patch).filter(([key]) => SETTING_KEYS.includes(key)));
  return getSettings();
}
