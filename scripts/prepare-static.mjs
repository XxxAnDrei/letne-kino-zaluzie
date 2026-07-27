/*
 * GSAP sa kopíruje z node_modules do public/vendor, aby ho vedelo obslúžiť
 * CDN aj lokálny Express rovnako. Priečinok je v .gitignore — vzniká pri
 * inštalácii aj pri nasadení.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', 'gsap', 'dist');
const to = path.join(root, 'public', 'vendor', 'gsap');

const FILES = [
  'gsap.min.js',
  'ScrollTrigger.min.js',
  'SplitText.min.js',
  'DrawSVGPlugin.min.js',
];

fs.mkdirSync(to, { recursive: true });
let copied = 0;
for (const file of FILES) {
  const src = path.join(from, file);
  if (!fs.existsSync(src)) {
    console.error(`chýba ${src} — je nainštalovaný balík gsap?`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(to, file));
  copied += 1;
}
console.log(`vendor: skopírovaných ${copied} súborov GSAP do public/vendor/gsap`);

/* ------------------------------------------------- adresy pre zdieľanie */

/*
 * Facebook a Messenger si relatívnu adresu obrázka nedomyslia — buď je
 * absolútna, alebo náhľad odkazu ostane bez obrázka. Doména sa dozvie až pri
 * nasadení, tak sa dopĺňa tu.
 *
 * VERCEL_PROJECT_PRODUCTION_URL je produkčná doména projektu; keď si pridáš
 * vlastnú, Vercel sem dá ju, takže netreba nič prepisovať. Bez tejto premennej
 * (čiže lokálne) sa nemení nič a súbor zostane taký, aký je v gite.
 */
function origin() {
  const raw = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || '';
  const host = raw
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();
  // Bez poriadneho názvu domény radšej nechaj adresy tak, než vyrobiť „https:///".
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return '';
  return `https://${host}`;
}

/* Najprv sa odstrihne prípadná stará doména, takže sa to dá pustiť opakovane. */
function absolutise(html, base) {
  const swap = (value) => base + value.replace(/^https?:\/\/[^/]+/, '');
  return html
    .replace(
      /(<link rel="canonical" href=")([^"]*)(")/,
      (_, a, url, b) => a + swap(url) + b
    )
    .replace(
      /(<meta property="og:(?:url|image)" content=")([^"]*)(")/g,
      (_, a, url, b) => a + swap(url) + b
    );
}

const base = origin();
if (base) {
  const page = path.join(root, 'public', 'index.html');
  fs.writeFileSync(page, absolutise(fs.readFileSync(page, 'utf8'), base));
  console.log(`zdieľanie: adresy nastavené na ${base}`);
} else {
  console.log('zdieľanie: doména neznáma, adresy zostávajú relatívne');
}
