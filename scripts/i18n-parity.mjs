/**
 * Locale key parity + placeholder drift check for en/es.
 * Exit 1 on failure (usable in CI / jest shell).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/en.json'), 'utf8'));
const es = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/es.json'), 'utf8'));

function flatten(o, p = '') {
  let keys = [];
  for (const [a, b] of Object.entries(o || {})) {
    const n = p ? `${p}.${a}` : a;
    if (b && typeof b === 'object' && !Array.isArray(b)) keys = keys.concat(flatten(b, n));
    else keys.push(n);
  }
  return keys;
}

function get(o, pathStr) {
  return pathStr.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), o);
}

function placeholders(s) {
  if (typeof s !== 'string') return [];
  const m = s.match(/\{\{[^}]+\}\}/g) || [];
  return m.map((x) => x.slice(2, -2).trim()).sort();
}

const ek = flatten(en);
const sk = flatten(es);
const eSet = new Set(ek);
const sSet = new Set(sk);
const onlyEn = ek.filter((k) => !sSet.has(k));
const onlyEs = sk.filter((k) => !eSet.has(k));
const phMismatches = [];
for (const k of ek) {
  if (!sSet.has(k)) continue;
  const pe = placeholders(get(en, k));
  const ps = placeholders(get(es, k));
  if (JSON.stringify(pe) !== JSON.stringify(ps)) {
    phMismatches.push({ k, en: pe, es: ps });
  }
}

const report = {
  enKeys: ek.length,
  esKeys: sk.length,
  onlyEn,
  onlyEs,
  placeholderMismatches: phMismatches,
  ok: onlyEn.length === 0 && onlyEs.length === 0 && phMismatches.length === 0,
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
