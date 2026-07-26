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
