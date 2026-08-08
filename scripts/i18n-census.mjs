import fs from 'fs';
import path from 'path';

function walk(d, acc = []) {
  if (!fs.existsSync(d)) return acc;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git', 'android', 'ios', 'dist'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(e.name) && !p.includes('__tests__')) acc.push(p);
  }
  return acc;
}

const files = ['app', 'components', 'src/components'].flatMap((r) => walk(r));
const hits = [];

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\n/);
  lines.forEach((line, i) => {
    const trim = line.trim();
    if (
      trim.startsWith('//') ||
      trim.startsWith('*') ||
      trim.startsWith('import ') ||
      line.includes('console.') ||
      /t\(\s*['"`]/.test(line)
    ) {
      return;
    }
    for (const m of line.matchAll(/Alert\.alert\(\s*['"]([^'"]{2,})['"]/g)) {
      hits.push({ f, i: i + 1, k: 'Alert', s: m[1] });
    }
    for (const m of line.matchAll(/>\s*([A-Z][A-Za-z0-9 ,.'!?%/()\-]{3,80})\s*</g)) {
      hits.push({ f, i: i + 1, k: 'JSX', s: m[1] });
    }
    // template/hardcoded UI strings in our badge fallback
    if (
      /This packet was edited|Detailed before|Not Installed|No Logs|Failed to|Loading\.\.\.|Error|Success|Cancel|OK/.test(
        line,
      ) &&
      /['"`]/.test(line)
    ) {
      hits.push({ f, i: i + 1, k: 'lit', s: line.trim().slice(0, 120) });
    }
  });
}

const by = {};
for (const h of hits) by[h.f] = (by[h.f] || 0) + 1;
console.log('total', hits.length);
console.log(
  Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${n}\t${f}`)
    .join('\n'),
);
console.log('---');
hits.forEach((h) => console.log(`${h.f}:${h.i} [${h.k}] ${JSON.stringify(h.s)}`));
