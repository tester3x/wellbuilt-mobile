import {
  startSubmitTrace,
  getRecentSubmitTraces,
  __clearSubmitTraces,
  SUBMIT_PHASES,
} from '../submitTiming';

// Deterministic monotonic clock.
let clock = 0;
beforeEach(() => {
  clock = 0;
  __clearSubmitTraces();
  jest.spyOn(globalThis.performance, 'now').mockImplementation(() => clock);
});
afterEach(() => jest.restoreAllMocks());

describe('SubmitTrace — phase timing', () => {
  test('records cumulative + per-phase durations from a monotonic clock', () => {
    const t = startSubmitTrace('create'); // marks nothing yet; start = 0
    clock = 0;
    t.mark('tap');
    clock = 5;
    t.mark('validation');
    clock = 12;
    t.mark('requestBegin');
    clock = 812;
    t.mark('serverAck'); // 800ms network
    clock = 820;
    t.mark('durableWrite');
    clock = 828;
    t.mark('reconcile');
    clock = 830;
    t.mark('navigate');
    const s = t.end('success');

    expect(s.phaseMs.serverAck).toBe(800); // the network round-trip is isolated
    expect(s.atMs.navigate).toBe(830);
    expect(s.totalMs).toBe(830);
    expect(s.op).toBe('create');
    expect(s.outcome).toBe('success');
  });

  test('mark is idempotent per phase (first timestamp wins)', () => {
    const t = startSubmitTrace('edit');
    clock = 10;
    t.mark('tap');
    clock = 999;
    t.mark('tap'); // ignored
    const s = t.end('queued');
    expect(s.atMs.tap).toBe(10);
  });

  test('end pushes a summary to the local ring (readable for diagnostics)', () => {
    const t = startSubmitTrace('create');
    t.mark('tap');
    t.end('failure');
    const ring = getRecentSubmitTraces();
    expect(ring).toHaveLength(1);
    expect(ring[0].op).toBe('create');
  });

  test('phase constant order matches the documented 10-phase sequence', () => {
    expect(SUBMIT_PHASES).toEqual([
      'tap', 'validation', 'durableWrite', 'sessionRetrieval', 'authReadiness',
      'revalidation', 'requestBegin', 'serverAck', 'reconcile', 'navigate',
    ]);
  });
});

describe('SubmitTrace — privacy (no sensitive payload can be recorded)', () => {
  test('the summary exposes only operational metadata keys', () => {
    const t = startSubmitTrace('create').setOnline(true).setWarmAuth(true);
    t.mark('tap');
    const s = t.end('success');
    expect(Object.keys(s).sort()).toEqual(
      ['atMs', 'online', 'op', 'outcome', 'phaseMs', 'totalMs', 'traceId', 'warmAuth'].sort(),
    );
  });

  test('serialized trace contains no identity / well / value / token strings', () => {
    // The API accepts none of these — there is no channel to leak them. Prove it
    // by driving a full trace and scanning the serialized ring.
    const t = startSubmitTrace('edit').setOnline(false).setWarmAuth(false);
    for (const p of ['tap', 'validation', 'requestBegin', 'serverAck', 'navigate'] as const) {
      clock += 3;
      t.mark(p);
    }
    t.end('queued');
    const blob = JSON.stringify(getRecentSubmitTraces());
    // traceId is `${op}-${monotonic}-${seq}` — op is a fixed enum, never identity.
    expect(blob).not.toMatch(/passcode|token|driverId|driverName|Gabriel|Gunslinger|bbls?|payload/i);
  });

  test('traceId carries only op + counters, never identity', () => {
    const t = startSubmitTrace('create');
    expect(t.traceId).toMatch(/^create-\d+-\d+$/);
  });
});
