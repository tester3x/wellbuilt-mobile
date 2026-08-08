import {
  appLocaleTag,
  formatAppDateTime,
  formatAppNumber,
  pickPluralForm,
  setAppLanguageForFormatting,
} from '../format';
import en from '../locales/en.json';
import es from '../locales/es.json';

describe('app language vs device locale formatting', () => {
  afterEach(() => {
    setAppLanguageForFormatting('en');
  });

  test('appLocaleTag follows selected app language', () => {
    setAppLanguageForFormatting('es');
    expect(appLocaleTag()).toBe('es-US');
    setAppLanguageForFormatting('en');
    expect(appLocaleTag()).toBe('en-US');
  });

  test('formatAppDateTime differs EN vs ES for same instant', () => {
    const d = new Date('2026-08-07T15:30:00.000Z');
    const opts: Intl.DateTimeFormatOptions = {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    };
    const enS = formatAppDateTime(d, opts, 'en');
    const esS = formatAppDateTime(d, opts, 'es');
    expect(enS).not.toEqual(esS);
  });

  test('formatAppNumber returns finite string', () => {
    expect(formatAppNumber(1234, undefined, 'en')).toMatch(/1/);
    expect(formatAppNumber(1234, undefined, 'es')).toMatch(/1/);
  });
});

describe('plural forms (EN/ES count patterns)', () => {
  test('pickPluralForm: 0 and 2+ use other; 1 uses one', () => {
    expect(pickPluralForm(0, { one: '1 pull', other: 'N pulls' })).toBe('N pulls');
    expect(pickPluralForm(1, { one: '1 pull', other: 'N pulls' })).toBe('1 pull');
    expect(pickPluralForm(2, { one: '1 pull', other: 'N pulls' })).toBe('N pulls');
  });

  test('readyWithLoads locale strings cover singular and plural', () => {
    expect((en as any).well.readyWithLoads_one).toContain('{{count}}');
    expect((en as any).well.readyWithLoads_one).toMatch(/load/);
    expect((en as any).well.readyWithLoads_other).toMatch(/loads/);
    expect((es as any).well.readyWithLoads_one).toMatch(/carga/);
    expect((es as any).well.readyWithLoads_other).toMatch(/cargas/);
  });

  test('history pullsCount plural keys', () => {
    expect((en as any).history.pullsCount_one).toBe('{{count}} pull');
    expect((en as any).history.pullsCount_other).toBe('{{count}} pulls');
    expect((es as any).history.pullsCount_one).toContain('extracción');
    expect((es as any).history.pullsCount_other).toContain('extracciones');
  });

  test('manager count interpolations exist', () => {
    expect((en as any).manager.moreHistory).toContain('{{count}}');
    expect((en as any).manager.cleanupDeleted).toContain('{{count}}');
    expect((es as any).manager.cleanupDeleted).toContain('{{count}}');
  });
});
