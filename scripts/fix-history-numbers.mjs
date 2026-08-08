import fs from 'fs';
let s = fs.readFileSync('app/history.tsx', 'utf8');
s = s.replace(/\{todayStats\.bbls\.toLocaleString\(\)\}/g, '{formatAppNumber(todayStats.bbls)}');
s = s.replace(/\{weekStats\.bbls\.toLocaleString\(\)\}/g, '{formatAppNumber(weekStats.bbls)}');
s = s.replace(/\{monthStats\.bbls\.toLocaleString\(\)\}/g, '{formatAppNumber(monthStats.bbls)}');
s = s.replace(/\{allTimeStats\.bbls\.toLocaleString\(\)\}/g, '{formatAppNumber(allTimeStats.bbls)}');
s = s.replace(
  /\{selectedWellStats\.bbls\.toLocaleString\(\)\}/g,
  '{formatAppNumber(selectedWellStats.bbls)}',
);
s = s.replace(
  /\{dayTotal\.bbls\.toLocaleString\(\)\} bbl/g,
  "{formatAppNumber(dayTotal.bbls)} {t('units.bbl')}",
);
fs.writeFileSync('app/history.tsx', s);
console.log('ok');
