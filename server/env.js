import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Načíta .env z koreňa projektu, ak existuje.
 *
 * Robí sa to ručne a bez závislosti zámerne: Node má síce --env-file, ale ten
 * by pribil projekt na konkrétnu verziu a musel by sa opakovať v každom
 * spúšťacom príkaze. Premenné, ktoré už v prostredí sú, sa neprepisujú —
 * na hostingu tak vždy vyhrá nastavenie platformy nad súborom v obraze.
 */
function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return 0;
  }

  let loaded = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.hasOwn(process.env, key)) continue;

    let value = trimmed.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    }

    process.env[key] = value;
    loaded += 1;
  }
  return loaded;
}

/*
 * Beží pri importe, nie až z tela servera. db.js aj auth.js čítajú
 * process.env už počas svojho vyhodnotenia a ESM importy sa vykonajú skôr než
 * telo modulu — kým je tento import v index.js prvý, hodnoty sú načasu.
 */
export const envLoaded = loadEnv();

