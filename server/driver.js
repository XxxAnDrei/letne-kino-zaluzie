import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Dva ovládače za jedným rozhraním:
 *   DATABASE_URL=postgres://…   → Postgres (Supabase)
 *   TURSO_DATABASE_URL=libsql://… → Turso
 *   inak                        → lokálny SQLite súbor
 *
 * Volajúci kód píše SQL so zástupnými `?` a ovládač si ho preloží. Rozdiely
 * medzi dialektmi sú sústredené sem a do schémy, nikde inde.
 */

function pickKind() {
  const url = process.env.DATABASE_URL || '';
  if (/^postgres(ql)?:\/\//.test(url)) return 'postgres';
  return 'sqlite';
}

export const kind = pickKind();

/* Postgres číta $1, $2…; SQL v projekte je písané s `?`. */
function toDollar(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${(i += 1)}`);
}

/* ------------------------------------------------------------- Postgres */

async function makePostgres() {
  const { default: postgres } = await import('postgres');
  /*
   * `prepare: false` je nutné pre Supavisor v transakčnom režime, ktorý
   * Supabase odporúča pre serverless. Malý `max` preto, že každá inštancia
   * funkcie si drží vlastný pool.
   */
  const sql = postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: Number(process.env.PGPOOL_MAX || 3),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

  const wrap = (runner) => ({
    async all(text, args = []) {
      return Array.from(await runner.unsafe(toDollar(text), args));
    },
    async get(text, args = []) {
      const rows = await runner.unsafe(toDollar(text), args);
      return rows.length ? rows[0] : null;
    },
    async run(text, args = []) {
      const res = await runner.unsafe(toDollar(text), args);
      return { changes: res.count ?? 0 };
    },
  });

  const base = wrap(sql);
  return {
    ...base,
    async tx(fn) {
      return sql.begin((t) => fn(wrap(t)));
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/* --------------------------------------------------------------- SQLite */

async function makeSqlite() {
  const { createClient } = await import('@libsql/client');

  let url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    url = `file:${path.join(dataDir, 'kino.sqlite')}`;
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  const wrap = (runner) => ({
    async all(sql, args = []) {
      return (await runner.execute({ sql, args })).rows;
    },
    async get(sql, args = []) {
      const { rows } = await runner.execute({ sql, args });
      return rows.length ? rows[0] : null;
    },
    async run(sql, args = []) {
      const res = await runner.execute({ sql, args });
      return { changes: res.rowsAffected };
    },
  });

  const base = wrap(client);
  return {
    ...base,
    async tx(fn) {
      const t = await client.transaction('write');
      try {
        const out = await fn(wrap(t));
        await t.commit();
        return out;
      } catch (err) {
        await t.rollback().catch(() => {});
        throw err;
      }
    },
    async close() {
      client.close?.();
    },
  };
}

export const db = kind === 'postgres' ? await makePostgres() : await makeSqlite();

/** Popis pripojenia do štartovacieho výpisu. */
export function describe() {
  if (kind === 'postgres') return 'Postgres (Supabase)';
  return process.env.TURSO_DATABASE_URL ? 'Turso (vzdialená)' : 'lokálny súbor';
}
