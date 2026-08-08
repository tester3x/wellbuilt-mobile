import fs from 'fs';

let s = fs.readFileSync('app/manager.tsx', 'utf8');
const more = [
  [
    '<Text style={styles.currentDeviceBadgeText}>THIS DEVICE</Text>',
    "<Text style={styles.currentDeviceBadgeText}>{t('manager.thisDevice')}</Text>",
  ],
  [
    'Registered: {formatDate(device.registeredAt)}',
    "{t('manager.registeredAt', { date: formatDate(device.registeredAt) })}",
  ],
  [
    'Login History ({loginHistoryEntries.length})',
    "{t('manager.loginHistory')} ({loginHistoryEntries.length})",
  ],
  [
    'No logins recorded yet',
    "{t('manager.noLoginHistory')}",
  ],
  [
    "logSourceBtnText, logSourceFilter === 'all' && styles.logSourceBtnTextActive]}>All</Text>",
    "logSourceBtnText, logSourceFilter === 'all' && styles.logSourceBtnTextActive]}>{t('manager.filterAll')}</Text>",
  ],
  [
    "logLevelBtnText, logLevelFilter === 'all' && styles.logLevelBtnTextActive]}>All</Text>",
    "logLevelBtnText, logLevelFilter === 'all' && styles.logLevelBtnTextActive]}>{t('manager.filterAll')}</Text>",
  ],
  [
    "logLevelBtnText, logLevelFilter === 'warn' && styles.logLevelBtnTextActiveWarn]}>Warn+</Text>",
    "logLevelBtnText, logLevelFilter === 'warn' && styles.logLevelBtnTextActiveWarn]}>{t('manager.filterWarn')}</Text>",
  ],
  [
    'selectAllText}>All</Text>',
    "selectAllText}>{t('manager.selectAll')}</Text>",
  ],
  [
    'prodHeaderValue}>AFR</Text>',
    "prodHeaderValue}>{t('manager.colAfr')}</Text>",
  ],
  [
    'prodHeaderValue}>Win</Text>',
    "prodHeaderValue}>{t('manager.colWin')}</Text>",
  ],
  [
    "prodHeaderWell}>Well</Text>",
    "prodHeaderWell}>{t('manager.colWell')}</Text>",
  ],
  [
    "prodHeaderValue}>Pulls</Text>",
    "prodHeaderValue}>{t('manager.colPulls')}</Text>",
  ],
];

for (const [a, b] of more) {
  if (s.includes(a)) {
    s = s.split(a).join(b);
    console.log('ok', a.slice(0, 50));
  } else {
    console.log('miss', a.slice(0, 60));
  }
}

// tab production if hardcoded
s = s.replace(
  /tab === 'production'[\s\S]{0,80}?Production/,
  (m) => m, // leave if already using t
);

fs.writeFileSync('app/manager.tsx', s);

const en = JSON.parse(fs.readFileSync('src/i18n/locales/en.json', 'utf8'));
const es = JSON.parse(fs.readFileSync('src/i18n/locales/es.json', 'utf8'));
en.manager.filterWarn = 'Warn+';
es.manager.filterWarn = 'Adv+';
en.manager.colAfr = 'AFR';
es.manager.colAfr = 'AFR';
en.manager.colWin = 'Win';
es.manager.colWin = 'Ven';
fs.writeFileSync('src/i18n/locales/en.json', JSON.stringify(en, null, 2) + '\n');
fs.writeFileSync('src/i18n/locales/es.json', JSON.stringify(es, null, 2) + '\n');
console.log('done');
