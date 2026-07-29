import { db, kind, describe } from './driver.js';

export { db, describe };

/* ------------------------------------------------------------------ schéma */

/*
 * Jediné, čo sa medzi dialektmi líši, sú typy kľúčov a celých čísel.
 * Zvyšok SQL — ON CONFLICT, čiastočný unikátny index, COALESCE — je
 * v SQLite aj v Postgrese rovnaký.
 */
const T =
  kind === 'postgres'
    ? { id: 'BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY', int: 'SMALLINT', big: 'BIGINT' }
    : { id: 'INTEGER PRIMARY KEY AUTOINCREMENT', int: 'INTEGER', big: 'INTEGER' };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reservations (
    id            ${T.id},
    ref           TEXT NOT NULL UNIQUE,
    date          TEXT NOT NULL,
    backup_date   TEXT,
    moved_from    TEXT,
    name          TEXT NOT NULL,
    phone         TEXT NOT NULL,
    email         TEXT NOT NULL,
    municipality  TEXT NOT NULL,
    address       TEXT NOT NULL,
    note          TEXT,
    confirm_adult   ${T.int} NOT NULL DEFAULT 0,
    confirm_manual  ${T.int} NOT NULL DEFAULT 0,
    confirm_content ${T.int} NOT NULL DEFAULT 0,
    confirm_terms   ${T.int} NOT NULL DEFAULT 0,
    confirm_privacy ${T.int} NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'pending',
    admin_note    TEXT,
    handout_at    TEXT,
    handout_items TEXT,
    return_at     TEXT,
    return_items  TEXT,
    condition_note TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blackouts (
    id         ${T.id},
    date       TEXT NOT NULL UNIQUE,
    reason     TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS slot_rules (
    date       TEXT PRIMARY KEY,
    scope      TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS blocklist (
    id         ${T.id},
    value      TEXT NOT NULL UNIQUE,
    reason     TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  /*
   * Obmedzovanie počtu žiadostí musí byť v databáze, nie v pamäti procesu.
   * Serverless funkcia beží pri každej požiadavke potenciálne inde, takže
   * počítadlo v pamäti by nechránilo nič.
   */
  `CREATE TABLE IF NOT EXISTS rate_hits (
    id     ${T.id},
    bucket TEXT NOT NULL,
    key    TEXT NOT NULL,
    at     ${T.big} NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_res_date   ON reservations(date)`,
  `CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status)`,
  `CREATE INDEX IF NOT EXISTS idx_rate       ON rate_hits(bucket, key, at)`,
  /*
   * Jeden termín = jedna aktívna rezervácia. Čiastočný unikátny index rieši
   * súbeh dvoch prihlášok na ten istý deň na úrovni databázy, nie aplikácie.
   */
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_res_active_date
     ON reservations(date) WHERE status IN ('pending', 'approved')`,
];

const DEFAULT_SETTINGS = {
  season_start: '05-01',
  season_end: '09-30',
  lead_days: '2',
  horizon_days: '120',
  pickup_time: '17:00',
  return_time: '10:00',
  paused: '0',

  // Úvodná fáza: prednosť majú Ulačania. Správca to vie prepnúť globálne
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

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
export const SCOPES = ['zaluzie', 'all', 'approval'];

/*
 * Serverless funkcia sa môže prebudiť kedykoľvek, takže sa príprava schémy
 * púšťa raz za život inštancie a ostatné požiadavky počkajú na ten istý sľub.
 */
let ready = null;
export function init() {
  if (!ready) {
    ready = (async () => {
      for (const sql of SCHEMA) await db.run(sql);
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        await db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
          [key, value]
        );
      }
    })().catch((err) => {
      ready = null; // nech to ďalšia požiadavka skúsi znova
      throw err;
    });
  }
  return ready;
}

/* --------------------------------------------------------------- nastavenia */

export async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
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

export async function setSettings(patch) {
  const entries = Object.entries(patch).filter(([key]) => SETTING_KEYS.includes(key));
  for (const [key, value] of entries) {
    await db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      [key, String(value)]
    );
  }
  return getSettings();
}
