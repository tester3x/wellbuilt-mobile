/**
 * Regression guard for the reachable-string localization sweep (vc54).
 *
 * Two things are pinned here:
 *  1. The specific user-facing English literals that were localized this pass
 *     are GONE from the reachable screens (so they can't silently reappear).
 *  2. Every i18n key introduced for them resolves in BOTH locales.
 *
 * Wire/VBA formats, numeric placeholders, sentinels, and manager.tsx dead code
 * are intentionally out of scope and are NOT asserted here.
 */
import * as fs from 'fs';
import * as path from 'path';
import en from '../locales/en.json';
import es from '../locales/es.json';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

const get = (o: any, p: string): unknown =>
  p.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);

// Keys added (or reused) by the sweep, referenced from code.
const REQUIRED_KEYS = [
  'common.offline',
  'record.clearFormTitle', 'record.clearFormBody', 'record.errorNoWell',
  'record.futureTimeTitle', 'record.futureTimeFix', 'record.futureTimeUseCurrent',
  'record.editNeedsAttentionTitle',
  'record.toastPullUpdatedTitle', 'record.toastPullUpdatedBody',
  'record.toastEditSavedTitle', 'record.toastEditSavedBody',
  'record.toastSavedOnPhoneTitle', 'record.toastSavedOnPhoneBody',
  'record.bottomHint',
  'history.viewerHistoryTitle', 'history.tryAdjustingFilters', 'history.viewerEmptyBody',
  'driverLogin.legalNamePlaceholder',
  'settings.clearHistoryTitle', 'settings.clearHistoryBody', 'settings.clearHistoryConfirm',
  'settings.clearedTitle', 'settings.clearedBody',
  'settings.deleteRecipientTitle', 'settings.deleteRecipientBody', 'settings.deleteConfirm',
  'settings.savedTitle', 'settings.templateSavedBody',
  'settings.freeTier', 'settings.wellsCount', 'settings.customTemplateSuffix',
  'settings.recipientNamePlaceholder', 'settings.phoneOrGroupLabel', 'settings.phoneLabel',
  'settings.phoneOrGroupPlaceholder', 'settings.templateFieldsHelp',
  'summary.tanksCount_one', 'summary.tanksCount_other',
  'wellData.errorTimeout', 'wellData.errorUnknown', 'wellData.errorFetchFailed', 'wellData.footerNote',
  'syncStatus.backOnlineTitle', 'syncStatus.backOnlineBody_one', 'syncStatus.backOnlineBody_other',
  'appSwitcher.jsaMigrationBody', 'appSwitcher.shiftTimer',
];

// literal English strings that must NO LONGER appear in each reachable screen.
const GONE: Record<string, string[]> = {
  'app/record.tsx': [
    "'Pull updated'", "'Edit saved'", "'Saved on this phone'",
    "'Clear Form'", "'Future time detected'", "'Edit Needs Attention'",
    '`Bottom: ${bottomLevelHint}`', 'formatDateLabel(dateTime)',
  ],
  'app/history.tsx': [
    "'Your Pull History'", "'Try adjusting your filters'",
    'This screen shows your personal pull history',
  ],
  'app/settings.tsx': [
    '"Clear Pull History"', '"Delete Recipient"', '"Message template saved successfully"',
    'FREE TIER', '/ 5 wells', "' - Custom template'",
  ],
  'app/well-data.tsx': [
    'Request timed out. Is WellBuilt running',
    'Data from WellBuilt - Last updated:',
  ],
  'src/components/SyncToast.tsx': [
    "title: 'Back online'", 'submitted. Waiting for confirmation.',
  ],
  'src/components/AppSwitcher.tsx': [
    "'Shift Timer'", 'JSA sign-in has moved to a secure',
  ],
};

describe('localization sweep — keys present in both locales', () => {
  test.each(REQUIRED_KEYS)('%s resolves in en and es', (k) => {
    expect(get(en, k)).toBeTruthy();
    expect(get(es, k)).toBeTruthy();
  });

  test('interpolated toast/body keys carry their placeholders', () => {
    expect(get(en, 'record.toastPullUpdatedBody')).toContain('{{wellName}}');
    expect(get(es, 'record.toastPullUpdatedBody')).toContain('{{wellName}}');
    expect(get(en, 'record.bottomHint')).toContain('{{hint}}');
    expect(get(es, 'record.bottomHint')).toContain('{{hint}}');
    expect(get(en, 'wellData.footerNote')).toContain('{{timestamp}}');
    expect(get(es, 'wellData.footerNote')).toContain('{{timestamp}}');
  });

  test('template-field help keeps the literal {token} names untranslated', () => {
    for (const tok of ['{well}', '{top}', '{bottom}', '{time}', '{time24}', '{bbls}']) {
      expect(get(en, 'settings.templateFieldsHelp')).toContain(tok);
      expect(get(es, 'settings.templateFieldsHelp')).toContain(tok);
    }
  });
});

describe('record.tsx date display is locale-aware while the wire format stays en-US (HB1-safe)', () => {
  const src = read('app/record.tsx');
  test('picker labels route through the app-locale formatters', () => {
    expect(src).toContain('formatAppDate(dateTime)');
    expect(src).toContain('formatAppTime(dateTime)');
    expect(src).toContain("import { formatAppDate, formatAppTime } from '../src/i18n/format'");
  });
  test('the stored packet dateTime companion is still built en-US (server re-derives it in that format)', () => {
    expect(src).toContain("formatPacketDateTime");
    expect(src).toMatch(/formatPacketDateTime = \(d: Date\) => `\$\{d\.toLocaleDateString\('en-US'\)\}/);
  });
});

describe('localization sweep — hardcoded English removed from reachable screens', () => {
  for (const [file, literals] of Object.entries(GONE)) {
    const src = read(file);
    test.each(literals)(`${file} no longer contains %s`, (lit) => {
      expect(src.includes(lit)).toBe(false);
    });
  }
});
