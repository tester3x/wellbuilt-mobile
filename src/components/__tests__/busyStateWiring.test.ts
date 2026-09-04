/**
 * Source-wiring proofs for the canonical busy-state components and their
 * integration into record.tsx. (This project has no RN render harness — the
 * timing/guard LOGIC is unit-tested in busyDisplay.test.ts, singleFlight.test.ts,
 * and submitTiming.test.ts; here we pin that the React glue uses them correctly
 * and that busy state can never get stuck.)
 */
import * as fs from 'fs';
import * as path from 'path';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const overlay = read('../WellBuiltBusyOverlay.tsx');
const button = read('../WellBuiltAsyncButton.tsx');
const record = read('../../../app/record.tsx');

describe('WellBuiltBusyOverlay — delayed display, long relabel, safe cleanup', () => {
  test('uses the canonical thresholds (~200ms delay, ~5s long)', () => {
    expect(overlay).toContain('BUSY_DELAY_MS = 200');
    expect(overlay).toContain('BUSY_LONG_MS = 5000');
  });
  test('does not paint until the delay fires (no flash), then arms the long timer', () => {
    expect(overlay).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{\s*setShown\(true\)/);
    expect(overlay).toContain('setLong(true), longRunningMs');
    expect(overlay).toContain('if (!shown) return null;');
  });
  test('clears both timers on hide/unmount — never a stuck overlay', () => {
    expect(overlay).toContain('clearTimeout(showTimer.current)');
    expect(overlay).toContain('clearTimeout(longTimer.current)');
    expect(overlay).toMatch(/return clear;/); // effect cleanup
  });
  test('announces once to screen readers (not the changing label)', () => {
    expect(overlay).toContain('AccessibilityInfo.announceForAccessibility');
    expect(overlay).toContain('announced.current');
    expect(overlay).toContain('accessibilityRole="progressbar"');
    expect(overlay).toContain('accessibilityState={{ busy: true }}');
  });
  test('uses the WellBuilt accent (#2563EB), not a new invented color', () => {
    expect(overlay).toContain("WELLBUILT_ACCENT = '#2563EB'");
    expect(overlay).toContain('color={WELLBUILT_ACCENT}');
  });
});

describe('WellBuiltAsyncButton — one op per tap, stable width, safe cleanup', () => {
  test('guards duplicate taps with the single-flight primitive', () => {
    expect(button).toContain("from '../utils/singleFlight'");
    expect(button).toContain('flight.current.running');
  });
  test('disables the control while busy and locks its width', () => {
    expect(button).toContain('disabled={busy || disabled}');
    expect(button).toContain('minWidth: lockedWidth');
  });
  test('never setState after unmount (no stuck spinner on nav away)', () => {
    expect(button).toContain('if (mounted.current');
    expect(button).toMatch(/mounted\.current = false/);
  });
  test('shows a small inline spinner (contained, screen stays usable)', () => {
    expect(button).toContain('size="small"');
  });
});

describe('record.tsx — submit is guarded, instrumented, and overlay-covered', () => {
  test('imports the canonical overlay and the timing tracer', () => {
    expect(record).toContain("from '../src/components/WellBuiltBusyOverlay'");
    expect(record).toContain("from '../src/telemetry/submitTiming'");
  });
  test('a synchronous in-flight guard is set before the first await', () => {
    const submit = record.slice(record.indexOf('const handleSubmit'));
    const guardIdx = submit.indexOf('submitInFlightRef.current = true');
    const firstAwait = submit.indexOf('await ');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstAwait); // guard precedes any await
  });
  test('a finally always clears busy + guard and ends the trace', () => {
    const submit = record.slice(record.indexOf('const handleSubmit'));
    expect(submit).toContain('} finally {');
    // These three appear ONLY in the finally (guard-clear + trace-end are unique).
    expect(submit).toContain('submitInFlightRef.current = false');
    expect(submit).toContain('trace.end(submitOutcome)');
    // finally precedes the function close and follows the catch.
    const finIdx = submit.indexOf('} finally {');
    expect(submit.indexOf('submitInFlightRef.current = false')).toBeGreaterThan(finIdx);
    expect(submit.indexOf('trace.end(submitOutcome)')).toBeGreaterThan(finIdx);
  });
  test('renders the blocking overlay driven by isSending with localized labels', () => {
    expect(record).toContain('<WellBuiltBusyOverlay');
    expect(record).toContain('visible={isSending}');
    expect(record).toContain("t('record.busySavingEdit')");
    expect(record).toContain("t('record.busySendingPull')");
    expect(record).toContain("t('record.busyStillSending')");
    expect(record).toContain("t('record.busyStillSaving')");
  });
  test('marks the key phases around the network round-trip on both paths', () => {
    for (const p of ['tap', 'validation', 'requestBegin', 'serverAck', 'durableWrite', 'reconcile', 'navigate']) {
      expect(record).toContain(`trace.mark('${p}')`);
    }
  });
});

describe('busy-state i18n keys exist in both locales', () => {
  const keys = [
    'record.busySendingPull', 'record.busySavingEdit',
    'record.busyStillSending', 'record.busyStillSaving',
    'busy.saving', 'busy.deleting', 'busy.loading', 'busy.working', 'busy.stillWorking',
  ];
  const get = (o: any, p: string) => p.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);
  test.each(keys)('%s in en + es', (k) => {
    expect(get(en, k)).toBeTruthy();
    expect(get(es, k)).toBeTruthy();
  });
  test('canonical labels use the real ellipsis glyph (…)', () => {
    expect((en as any).record.busySendingPull).toContain('…');
    expect((es as any).record.busySendingPull).toContain('…');
    expect((en as any).record.busySendingPull).not.toContain('...');
  });
});
