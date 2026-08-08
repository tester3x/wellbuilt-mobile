import fs from 'fs';
const s = fs.readFileSync('app/manager.tsx', 'utf8');
const hits = [];
s.split(/\n/).forEach((line, i) => {
  if (/t\(|console\.|import |\/\//.test(line)) return;
  if (
    /alert\.show\(['"][A-Z]/.test(line) ||
    />[A-Za-z][A-Za-z ]{3,}</.test(line) ||
    /placeholder="[A-Z]/.test(line)
  ) {
    hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  }
});
console.log('manager remaining UI candidates', hits.length);
hits.forEach((h) => console.log(h));

for (const f of ['app/performance.tsx', 'app/performance-detail.tsx']) {
  const t = fs.readFileSync(f, 'utf8');
  const h = [];
  t.split(/\n/).forEach((line, i) => {
    if (/t\(|console\.|import |\/\//.test(line)) return;
    if (/>[A-Z][a-zA-Z ]{3,}</.test(line) || /"[A-Z][a-z].{8,}"/.test(line) && /Text|setError|label/.test(line)) {
      h.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
  console.log(f, h.length);
  h.slice(0, 20).forEach((x) => console.log(x));
}
