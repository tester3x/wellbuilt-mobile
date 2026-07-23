// GOLDEN FIXTURES — canonical route colors.
// This fixture block is intentionally IDENTICAL in both repos
// (wellbuilt-mobile and wellbuilt-dashboard); it IS the cross-repo
// contract. If a value changes here it must change in the twin file.
import * as fs from 'fs';
import * as path from 'path';
import {
  ROUTE_PALETTE,
  UNROUTED_COLOR,
  canonicalRouteColor,
  getRouteColor,
  normalizeRouteKey,
} from '../routeColor';

/** Real production routes — every one must keep exactly this color. */
const GOLDEN: Record<string, string> = {
  'Acme Newtown': '#4080e0',
  'Dunn County': '#e0c040',
  'Gabriels': '#d06060',
  'Gunslingers': '#20c0c0',
  'Montana': '#e06090',
  'River Bottoms': '#20a080',
  'Stock Yards': '#e0a020',
  'Test Route': '#c0a060',
  'Watford': '#4060b0',
};

describe('golden fixtures — exact canonical colors', () => {
  test.each(Object.entries(GOLDEN))('%s → %s', (route, hex) => {
    expect(getRouteColor(route)).toBe(hex);
  });

  test('all real routes resolve to DISTINCT colors', () => {
    const colors = Object.keys(GOLDEN).map(getRouteColor);
    expect(new Set(colors).size).toBe(colors.length);
  });

  test('whitespace and capitalization variants collapse to the same color', () => {
    expect(getRouteColor('  Gabriels  ')).toBe(GOLDEN['Gabriels']);
    expect(getRouteColor('GABRIELS')).toBe(GOLDEN['Gabriels']);
    expect(getRouteColor('gabriels')).toBe(GOLDEN['Gabriels']);
    expect(getRouteColor('Test  Route')).toBe(GOLDEN['Test Route']);
    expect(normalizeRouteKey('  Test   Route ')).toBe('test route');
  });

  test('missing/blank/Unrouted names resolve to neutral gray, never a crash', () => {
    expect(getRouteColor('')).toBe(UNROUTED_COLOR);
    expect(getRouteColor('   ')).toBe(UNROUTED_COLOR);
    expect(getRouteColor('Unrouted')).toBe(UNROUTED_COLOR);
    expect(canonicalRouteColor(null)).toBe(UNROUTED_COLOR);
    expect(canonicalRouteColor(undefined)).toBe(UNROUTED_COLOR);
    expect(canonicalRouteColor(42)).toBe(getRouteColor('42')); // coerced, deterministic
  });

  test("Mike's rule: the NAME generates the color — nothing can override it", () => {
    // The resolver accepts no explicit color, no route id, no options of
    // any kind — the parameters do not exist.
    const src = fs.readFileSync(path.join(__dirname, '../routeColor.ts'), 'utf8');
    expect(src).not.toContain('explicitColor');
    expect(src).not.toContain('routeId');
    expect(src).not.toContain('isValidHexColor');
    // A smuggled override object cannot change the name-generated color:
    // it is coerced to a junk name and hashed like any other name — the
    // supplied hex is NEVER returned.
    const smuggled = canonicalRouteColor({ name: 'Gabriels', explicitColor: '#fff' } as unknown as string);
    expect(smuggled).not.toBe('#fff');
    expect(smuggled).not.toBe('#ffffff');
    // Legacy well_config.color-shaped strings are just names, never colors.
    expect(getRouteColor('rgb(150, 210, 152)')).not.toBe('rgb(150, 210, 152)');
    expect(ROUTE_PALETTE).toContain(getRouteColor('rgb(150, 210, 152)'));
  });

  test('a rename may change the color — expected and deterministic', () => {
    expect(getRouteColor('Gabriels')).toBe(GOLDEN['Gabriels']);
    expect(getRouteColor('Gabriels North')).not.toBe(GOLDEN['Gabriels']);
    expect(getRouteColor('Gabriels North')).toBe(getRouteColor('  gabriels   NORTH '));
  });
});

describe('assignment/set independence — the same route, the same color, everywhere', () => {
  const ALL = Object.keys(GOLDEN);

  test('color never depends on which routes a driver is assigned', () => {
    // Driver A: only Gabriels. Driver B: eight routes. Customer admin: all.
    const subsets = [
      ['Gabriels'],
      ALL.filter((r) => r !== 'Montana'),
      ALL,
      ['Test Route', 'Gabriels'],
      ['Watford'],
    ];
    for (const subset of subsets) {
      for (const route of subset) {
        expect(getRouteColor(route)).toBe(GOLDEN[route]);
      }
    }
  });

  test('color never depends on index, sort order, or reordering of the list', () => {
    const orders = [
      [...ALL],
      [...ALL].reverse(),
      [...ALL].sort(() => 0.5 - ((Math.abs(Math.sin(1)) * 1000) % 1)), // fixed pseudo-shuffle
    ];
    for (const order of orders) {
      order.forEach((route, index) => {
        expect(getRouteColor(route)).toBe(GOLDEN[route]);
        expect(index).toBeGreaterThanOrEqual(0); // index exists but is irrelevant
      });
    }
  });

  test('inserting/removing unrelated routes changes nothing', () => {
    expect(getRouteColor('Gabriels')).toBe(GOLDEN['Gabriels']);
    // "Add" three unrelated routes and "remove" two — pure functions have
    // no set state, so the mapping cannot move.
    for (const r of ['Brand New Route', 'Another One', 'Zebra']) getRouteColor(r);
    expect(getRouteColor('Gabriels')).toBe(GOLDEN['Gabriels']);
    expect(getRouteColor('Test Route')).toBe(GOLDEN['Test Route']);
  });

  test('palette keeps readable contrast on the dark UI', () => {
    for (const hex of ROUTE_PALETTE) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(lum).toBeGreaterThan(0.15); // visible against #05060B
    }
  });
});

describe('wiring — every WB-M surface uses the ONE canonical resolver', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');

  test('Settings, tank-screen route header, and summary all import the shared resolver', () => {
    for (const file of ['../../../app/settings.tsx', '../../../app/(tabs)/index.tsx', '../../../app/summary.tsx']) {
      const src = read(file);
      expect(src).toContain("from '../src/services/routeColor'".replace(
        '../src', file.includes('(tabs)') ? '../../src' : '../src',
      ));
      expect(src).toContain('getRouteColor(');
    }
  });

  test('no duplicate/obsolete palette or hash implementations remain in the app', () => {
    const resolver = read('../routeColor.ts');
    expect(resolver).not.toContain('5381');          // old djb2 removed
    expect(resolver).not.toContain('getRouteColorHex'); // duplicate impl removed
    for (const file of ['../../../app/settings.tsx', '../../../app/(tabs)/index.tsx', '../../../app/summary.tsx']) {
      const src = read(file);
      expect(src).not.toMatch(/5381|fnv1a|ROUTE_PALETTE\s*=/); // no local color logic
    }
  });
});
