import fs from 'fs';

let p = fs.readFileSync('app/performance.tsx', 'utf8');
p = p.replace(
  '<Text style={styles.emptyText}>No wells found</Text>',
  "<Text style={styles.emptyText}>{t('performance.empty')}</Text>",
);
fs.writeFileSync('app/performance.tsx', p);

const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8'));
const es = JSON.parse(fs.readFileSync('src/i18n/locales/es.json', 'utf8'));
Object.assign(en.performance, {
  selectWell: 'Select Well',
  close: 'Close',
  avgAccuracy: 'Avg Accuracy',
  total: 'Total',
  recentPulls: 'Recent Pulls',
  noPullData: 'No pull data available',
});
Object.assign(es.performance, {
  selectWell: 'Seleccionar Pozo',
  close: 'Cerrar',
  avgAccuracy: 'Precisión Prom',
  total: 'Total',
  recentPulls: 'Extracciones Recientes',
  noPullData: 'No hay datos de extracciones',
});
fs.writeFileSync('src/i18n/locales/en.json', JSON.stringify(en, null, 2) + '\n');
fs.writeFileSync('src/i18n/locales/es.json', JSON.stringify(es, null, 2) + '\n');

let d = fs.readFileSync('app/performance-detail.tsx', 'utf8');
const pairs = [
  [
    '<Text style={styles.pickerTitle}>Select Well</Text>',
    "<Text style={styles.pickerTitle}>{t('performance.selectWell')}</Text>",
  ],
  [
    '<Text style={styles.pickerClose}>Close</Text>',
    "<Text style={styles.pickerClose}>{t('performance.close')}</Text>",
  ],
  [
    '<Text style={styles.mainAccuracyLabel}>Avg Accuracy</Text>',
    "<Text style={styles.mainAccuracyLabel}>{t('performance.avgAccuracy')}</Text>",
  ],
  [
    '<Text style={styles.statCellLabel}>Total</Text>',
    "<Text style={styles.statCellLabel}>{t('performance.total')}</Text>",
  ],
  [
    '<Text style={styles.tableTitle}>Recent Pulls</Text>',
    "<Text style={styles.tableTitle}>{t('performance.recentPulls')}</Text>",
  ],
  [
    '<Text style={styles.emptyTableText}>No pull data available</Text>',
    "<Text style={styles.emptyTableText}>{t('performance.noPullData')}</Text>",
  ],
];
for (const [a, b] of pairs) {
  if (d.includes(a)) {
    d = d.split(a).join(b);
    console.log('ok', a.slice(0, 40));
  } else console.log('miss', a.slice(0, 50));
}
fs.writeFileSync('app/performance-detail.tsx', d);
console.log('done');
