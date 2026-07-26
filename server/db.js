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
    moved_from    TEXT,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL,
    email         TEXT    NOT NULL,
    municipality  TEXT    NOT NULL,
    address       TEXT    NOT NULL,
    note          TEXT,
    confirm_adult   INTEGER NOT NULL DEFAULT 0,
    confirm_manual  INTEGER NOT NULL DEFAULT 0,
    confirm_content INTEGER NOT NULL DEFAULT 0,
    confirm_terms   INTEGER NOT NULL DEFAULT 0,
    confirm_privacy INTEGER NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'pending',
    admin_note    TEXT,
    handout_at    TEXT,
    handout_items TEXT,
    return_at     TEXT,
    return_items  TEXT,
    condition_note TEXT,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blackouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL UNIQUE,
    reason      TEXT,
    created_at  TEXT NOT NULL
  );

  /* Kto smie o termín požiadať počas úvodnej fázy. */
  CREATE TABLE IF NOT EXISTS slot_rules (
    date       TEXT PRIMARY KEY,
    scope      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  /* Telefón alebo e-mail, ktorému sa žiadosť neprijme. */
  CREATE TABLE IF NOT EXISTS blocklist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    value      TEXT NOT NULL UNIQUE,
    reason     TEXT,
    created_at TEXT NOT NULL
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

/* ---------------------------------------------------------------- migrácie */

/*
 * Staršia schéma evidovala počet osôb a mala menej potvrdení. Nové stĺpce
 * sa dopĺňajú po jednom — ALTER TABLE ADD COLUMN je v SQLite lacný a bezpečný,
 * takže existujúce rezervácie zostanú zachované.
 */
const columns = new Set(db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name));
const addColumn = (name, ddl) => {
  if (!columns.has(name)) db.exec(`ALTER TABLE reservations ADD COLUMN ${name} ${ddl}`);
};
addColumn('municipality', "TEXT NOT NULL DEFAULT 'Veľké Zálužie'");
addColumn('moved_from', 'TEXT');
addColumn('confirm_adult', 'INTEGER NOT NULL DEFAULT 0');
addColumn('confirm_manual', 'INTEGER NOT NULL DEFAULT 0');
addColumn('confirm_content', 'INTEGER NOT NULL DEFAULT 0');
addColumn('confirm_privacy', 'INTEGER NOT NULL DEFAULT 0');
addColumn('handout_at', 'TEXT');
addColumn('handout_items', 'TEXT');
addColumn('return_at', 'TEXT');
addColumn('return_items', 'TEXT');
addColumn('condition_note', 'TEXT');

/* ---------------------------------------------------------------- nastavenia */

const DEFAULT_SETTINGS = {
  season_start: '05-01',
  season_end: '09-30',
  lead_days: '2',
  horizon_days: '120',
  pickup_time: '17:00',
  return_time: '10:00',
  paused: '0',

  // Úvodná fáza: prednosť majú Zálužania. Správca to vie prepnúť globálne
  // alebo pre konkrétny deň cez slot_rules.
  default_scope: 'zaluzie',
  home_municipality: 'Veľké Zálužie',

  oz_name: 'Šport Veľké Zálužie',
  oz_address: 'Cintorínska 411/26, 951 35 Veľké Zálužie',
  oz_ico: '55954138',
  oz_form: 'občianske združenie',
  oz_bank: 'Slovenská sporiteľňa',
  oz_iban: 'SK6409000000005224430491',
  oz_registration:
    'Ministerstvo vnútra Slovenskej republiky, 22. 12. 2023, číslo VVS/1-900/90-68646-1',
  pay_note: 'Dobrovolny prispevok - komunitne projekty',
};

const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
);
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value);

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
export const SCOPES = ['zaluzie', 'all', 'approval'];

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
    paused: out.paused === '1',
    defaultScope: SCOPES.includes(out.default_scope) ? out.default_scope : 'zaluzie',
    homeMunicipality: out.home_municipality,
    oz: {
      name: out.oz_name,
      address: out.oz_address,
      ico: out.oz_ico,
      form: out.oz_form,
      bank: out.oz_bank,
      iban: out.oz_iban,
      registration: out.oz_registration,
      note: out.pay_note,
    },
  };
}

const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function setSettings(patch) {
  const write = db.transaction((entries) => {
    for (const [key, value] of entries) upsertSetting.run(key, String(value));
  });
  write(Object.entries(patch).filter(([key]) => SETTING_KEYS.includes(key)));
  return getSettings();
}
