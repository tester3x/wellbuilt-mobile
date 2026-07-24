// Delivery-acknowledgement invariants — regression net for the 7/23 field
// case (Test Well saaove + Gab 1 owplfa): two offline pulls flushed after
// airplane mode, delivered ONCE server-side within seconds, but their
// history entries froze at 'submitted' because the single post-flush
// reconcile raced the Cloud Function. Next-day launch re-surfaced them as
// attention + a second "sent"-sounding announcement — with NO second
// delivery (CF logs show zero invocations).
//
// These tests lock the parts that are CORRECT today:
//   1. an acknowledged packet leaves the queue and stays gone across restart;
//   2. an attempted-but-unacknowledged packet survives restart with identity;
//   3. remote success + cleanup interruption replays the SAME id only
//      (server-side exact-ID idempotency is the backstop — covered by the
//      dashboard's idempotentReplay tests);
//   4. a day-later replay reuses the persisted id, never a fresh mint;
//   5. "Delivered" is announced only after the durable status commit, and an
//      already-confirmed packet is never announced again.
//
// NOT covered here (requires the proposed fix, unimplemented): bounded
// confirmation retries after a stillUnknown pass, and suppression of the
// catch-up "Delivered" toast for stale submissions.

const mockStore: Record<string, string> = {};
const mockOnline = { value: true };
const mockMint = { counter: 0 };

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      if (failNextQueueWrite.value && k === '@wellbuilt_packet_queue') {
        failNextQueueWrite.value = false;
        throw new Error('simulated crash during queue write');
      }
      mockStore[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({
      isConnected: mockOnline.value,
      isInternetReachable: mockOnline.value,
      type: 'cellular',
    })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

const uploadCalls: any[] = [];
const uploadBehavior = { fail: false };
jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(async (params: any) => {
    if (uploadBehavior.fail) throw new Error('network down');
    uploadCalls.push(params);
    return { packetId: params.packetId, packetTimestamp: String(params.packetId).slice(0, 15), wellName: params.wellName };
  }),
  uploadEditPacket: jest.fn(),
  mintPacketId: jest.fn((wellName: string) => {
    mockMint.counter += 1;
    return `20260723_2250${String(mockMint.counter).padStart(2, '0')}_${String(wellName).replace(/\s+/g, '')}_m${mockMint.counter}`;
  }),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

// Toggled by test 3 to simulate a crash between remote success and cleanup.
const failNextQueueWrite = { value: false };

const QUEUE_KEY = '@wellbuilt_packet_queue';
const rawQueue = (): any[] => (mockStore[QUEUE_KEY] ? JSON.parse(mockStore[QUEUE_KEY]) : []);

/**
 * "Restart the app": a fresh module registry (all in-memory module state
 * gone) over the SAME AsyncStorage contents — exactly what a next-day
 * launch sees.
 */
function bootApp() {
  let mods: any = {};
  jest.isolateModules(() => {
    mods = {
      packetQueue: require('../packetQueue'),
      deliveryStatus: require('../deliveryStatus'),
      pullHistory: require('../pullHistory'),
    };
  });
  return mods;
}

/** fetch mock backed by a path→value map (null body = "not found"). */
const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    const path = m ? decodeURIComponent(m[1]) : '';
    return { ok: true, json: async () => (path in paths ? paths[path] : null) } as any;
  }) as unknown as typeof fetch;

const PULL = {
  wellName: 'Test Well',
  dateTime: '7/23/2026 10:49 PM',
  dateTimeUTC: '2026-07-24T03:49:09.356Z',
  tankLevelFeet: 92.58,
  bblsTaken: 1750,
  wellDown: false,
};

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  uploadBehavior.fail = false;
  uploadCalls.length = 0;
  failNextQueueWrite.value = false;
  jest.resetModules();
});

test('1. acknowledged packet leaves the queue durably and is NOT rehydrated after restart', async () => {
  // Session 1: queue offline, reconnect, flush succeeds.
  let app = bootApp();
  mockOnline.value = false;
  const res = await app.packetQueue.smartUploadTankPacket({ ...PULL });
  expect(res.queued).toBe(true);
  const pid = res.packetId as string;
  await app.pullHistory.addPullToHistory(PULL.wellName, PULL.dateTime, PULL.tankLevelFeet, PULL.bblsTaken, false, pid.slice(0, 15), pid, 'pending_sync');
  mockOnline.value = true;
  const flush = await app.packetQueue.flushQueue();
  expect(flush.sent).toBe(1);
  expect(rawQueue()).toHaveLength(0); // removed durably, before anything else

  // Restart (next-day launch): fresh modules, same storage.
  app = bootApp();
  expect(await app.packetQueue.getQueuedPackets()).toHaveLength(0); // never rehydrated
  // Server acknowledged long ago — reconcile confirms without any re-queue.
  const r = await app.deliveryStatus.reconcileSubmittedPulls(
    makeFetch({ [`packets/processed/${pid}`]: { packetId: pid, processedAt: '2026-07-24T03:51:48.031Z' } }),
  );
  expect(r.confirmedSent).toBe(1);
  expect(rawQueue()).toHaveLength(0);
  expect(uploadCalls.filter(c => c.packetId === pid)).toHaveLength(1); // delivered exactly once
  const entry = (await app.pullHistory.getPullHistory())[0];
  expect(entry.syncStatus).toBe('sent');
  // No longer displayed as pending anywhere.
  const counts = app.deliveryStatus.computeDeliveryCounts(await app.packetQueue.getQueuedPackets(), await app.pullHistory.getPullHistory(), Date.now());
  expect(counts.pending + counts.failed + counts.submittedTooLong).toBe(0);
});

test('2. attempted-but-unacknowledged packet survives restart with identity and retry metadata', async () => {
  let app = bootApp();
  mockOnline.value = false;
  const res = await app.packetQueue.smartUploadTankPacket({ ...PULL });
  const pid = res.packetId as string;
  mockOnline.value = true;
  uploadBehavior.fail = true; // reachable network, failing PUT — an ATTEMPT, not an ack
  const flush = await app.packetQueue.flushQueue();
  expect(flush.failed).toBe(1);
  const before = rawQueue()[0];
  expect(before.packetId).toBe(pid);
  expect(before.retryCount).toBe(1);

  // Restart: the packet is still there, identical identity, metadata intact.
  app = bootApp();
  const after = (await app.packetQueue.getQueuedPackets())[0];
  expect(after.packetId).toBe(pid);
  expect(after.retryCount).toBe(1);
  expect(after.data.packetId).toBe(pid);

  // Network availability alone is never treated as acknowledgement:
  // the entry only leaves the queue when a PUT actually succeeds.
  uploadBehavior.fail = false;
  after.nextAttemptAt = null; // bypass backoff for the test
  mockStore[QUEUE_KEY] = JSON.stringify([after]);
  const second = await app.packetQueue.flushQueue();
  expect(second.sent).toBe(1);
  expect(rawQueue()).toHaveLength(0);
  expect(uploadCalls.filter(c => c.packetId === pid)).toHaveLength(1);
});

test('3. remote success + cleanup interruption replays the SAME id only (no unsafe duplicate identity)', async () => {
  let app = bootApp();
  mockOnline.value = false;
  const res = await app.packetQueue.smartUploadTankPacket({ ...PULL });
  const pid = res.packetId as string;
  mockOnline.value = true;

  // PUT succeeds, then the app dies during queue-removal persistence.
  failNextQueueWrite.value = true;
  await expect(app.packetQueue.flushQueue()).rejects.toThrow('simulated crash');
  expect(uploadCalls.filter(c => c.packetId === pid)).toHaveLength(1); // landed server-side
  expect(rawQueue()).toHaveLength(1); // cleanup never committed

  // Restart + reflush: the replay carries the IDENTICAL stable id — the
  // server's exact-ID idempotency makes the duplicate harmless (proven
  // server-side by the dashboard's idempotentReplay suite).
  app = bootApp();
  const second = await app.packetQueue.flushQueue();
  expect(second.sent).toBe(1);
  const attempts = uploadCalls.filter(c => c.packetId === pid);
  expect(attempts).toHaveLength(2);
  expect(new Set(uploadCalls.map(c => c.packetId)).size).toBe(1); // never a fresh identity
  expect(rawQueue()).toHaveLength(0); // cleanup committed this time
});

test('4. a day-later replay reuses the PERSISTED id — never a re-mint', async () => {
  let app = bootApp();
  mockOnline.value = false;
  const res = await app.packetQueue.smartUploadTankPacket({ ...PULL });
  const pid = res.packetId as string;
  const mintedBefore = mockMint.counter;

  // Overnight: nothing happens. Next-day launch flushes the queue.
  app = bootApp();
  mockOnline.value = true;
  const flush = await app.packetQueue.flushQueue();
  expect(flush.sent).toBe(1);
  expect(uploadCalls[0].packetId).toBe(pid);
  expect(mockMint.counter).toBe(mintedBefore); // no new identity was minted
});

test('5. "Delivered" announces only AFTER the durable status commit, and never twice for one packet', async () => {
  const app = bootApp();
  const pid = '20260723_225008_TestWell_saaove';
  await app.pullHistory.addPullToHistory(PULL.wellName, PULL.dateTime, PULL.tankLevelFeet, PULL.bblsTaken, false, pid.slice(0, 15), pid, 'submitted');
  mockStore['@wellbuilt_submitted_payloads'] = JSON.stringify({ [pid]: { data: { ...PULL, packetId: pid }, submittedAt: Date.now() } });

  const announcements: any[] = [];
  const committedAtAnnounce: any[] = [];
  app.deliveryStatus.onReconcileResult((r: any) => {
    announcements.push(r);
    // Snapshot the DURABLE state visible at announcement time.
    committedAtAnnounce.push({
      history: mockStore['@wellbuilt_pull_history'] ?? Object.entries(mockStore).find(([k]) => k.includes('history'))?.[1] ?? '',
      payloads: mockStore['@wellbuilt_submitted_payloads'] ?? '',
    });
  });

  // Field race: the Cloud Function hasn't finished — no announcement fires.
  const miss = await app.deliveryStatus.reconcileSubmittedPulls(makeFetch({}));
  expect(miss.stillUnknown).toBe(1);
  expect(announcements.filter(a => a.confirmedSent > 0)).toHaveLength(0);
  expect((await app.pullHistory.getPullHistory())[0].syncStatus).toBe('submitted'); // preserved, not lost

  // Server outcome lands: exactly one confirmed announcement, and at that
  // moment the durable 'sent' status + payload cleanup are ALREADY committed.
  const hit = await app.deliveryStatus.reconcileSubmittedPulls(
    makeFetch({ [`packets/processed/${pid}`]: { packetId: pid, processedAt: '2026-07-24T03:51:48.031Z' } }),
  );
  expect(hit.confirmedSent).toBe(1);
  const confirmed = announcements.filter(a => a.confirmedSent > 0);
  expect(confirmed).toHaveLength(1);
  const snapshot = committedAtAnnounce[announcements.indexOf(confirmed[0])];
  expect(snapshot.history).toContain('"sent"');
  expect(snapshot.payloads === '' || !snapshot.payloads.includes(pid)).toBe(true);

  // A third pass (any later trigger) must NOT announce it again.
  const again = await app.deliveryStatus.reconcileSubmittedPulls(
    makeFetch({ [`packets/processed/${pid}`]: { packetId: pid, processedAt: '2026-07-24T03:51:48.031Z' } }),
  );
  expect(again.confirmedSent).toBe(0);
  expect(announcements.filter(a => a.confirmedSent > 0)).toHaveLength(1);
});
