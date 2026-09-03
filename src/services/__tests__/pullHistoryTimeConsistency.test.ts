// Hard Blocker 1 — timestamp consistency (client side).
//
// After a TIME edit, an edited pull's LOCAL display (dateTime), its chronological
// SORT key, its Today/Week/Month BUCKET placement, and its day-group HEADER must
// ALL follow the ONE edited instant — never a stale submission clock. Before the
// fix, updatePullHistoryEntry moved `dateTime` (drives the day header) but left
// `sentAt` (drives sort + buckets) frozen, so a boundary-crossing time edit split
// the header away from the buckets. These tests pin the fixed contract.

const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: false, isInternetReachable: false, type: 'none' })) },
}));

jest.mock('../firebaseAuthSession', () => ({
  __esModule: true,
  getValidIdToken: jest.fn(async () => 'tok_ok'),
  AuthSessionError: class AuthSessionError extends Error {},
}));

jest.mock('../driverAuth', () => ({
  __esModule: true,
  getDriverId: jest.fn(async () => 'driver-123'),
  getDriverName: jest.fn(async () => 'Test Driver'),
  getDriverSession: jest.fn(async () => ({ companyId: 'co-1' })),
}));

import {
  addPullToHistory, getPullHistory, updatePullHistoryEntry, clearPullHistory,
  PullHistoryEntry,
} from '../pullHistory';

const STORAGE_KEY = '@wellbuilt_pull_history';
const raw = (): PullHistoryEntry[] => (mockStore[STORAGE_KEY] ? JSON.parse(mockStore[STORAGE_KEY]) : []);
const find = (id: string) => raw().find(e => e.packetId === id || e.id === id)!;

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  await clearPullHistory();
});

const PID = '20260902_175952_TestWell_abcd12';

describe('updatePullHistoryEntry — chronological key follows the edited instant', () => {
  test('a TIME edit re-anchors sentAt + stores dateTimeUTC (sort/bucket move with the header)', async () => {
    // Original: 9/2 5:59 PM CDT. sentAt seeded at submission (same instant here).
    await addPullToHistory('Test Well', '9/2/2026 5:59 PM', 16, 140, false, '20260902_175952', PID, 'sent');
    const before = find(PID);
    const originalSentAt = before.sentAt;

    // Edit the TIME to 6:59 PM (new canonical instant one hour later).
    const newUTC = '2026-09-02T23:59:00.000Z'; // 6:59 PM CDT
    await updatePullHistoryEntry(PID, '9/2/2026 6:59 PM', 16, 140, false, { markEdited: false, dateTimeUTC: newUTC });

    const after = find(PID);
    expect(after.dateTime).toBe('9/2/2026 6:59 PM');       // local display moved
    expect(after.dateTimeUTC).toBe(newUTC);                // canonical stored
    expect(after.sentAt).toBe(Date.parse(newUTC));         // sort/bucket key re-anchored
    expect(after.sentAt).not.toBe(originalSentAt);
  });

  test('a NON-time edit (bbls only) leaves sentAt untouched (ordering intact)', async () => {
    await addPullToHistory('Test Well', '9/2/2026 5:59 PM', 16, 140, false, '20260902_175952', PID, 'sent');
    const originalSentAt = find(PID).sentAt;

    // No dateTimeUTC passed → only value fields change.
    await updatePullHistoryEntry(PID, '9/2/2026 5:59 PM', 16, 155, false, { markEdited: false });

    const after = find(PID);
    expect(after.bblsTaken).toBe(155);
    expect(after.sentAt).toBe(originalSentAt);             // ordering key unchanged
  });

  test('a boundary-crossing TIME edit moves sentAt across the day boundary consistently with dateTime', async () => {
    // Original at 9/2 11:30 PM CDT (2026-09-03T04:30Z).
    await addPullToHistory('Test Well', '9/2/2026 11:30 PM', 16, 140, false, '20260902_233000', PID, 'sent');
    // Edit to 9/3 12:30 AM CDT (2026-09-03T05:30Z) — crosses into the next day.
    const newUTC = '2026-09-03T05:30:00.000Z';
    await updatePullHistoryEntry(PID, '9/3/2026 12:30 AM', 16, 140, false, { markEdited: false, dateTimeUTC: newUTC });

    const after = find(PID);
    // dateTime (day header source) and sentAt (bucket/sort source) now agree on 9/3.
    expect(after.dateTime.startsWith('9/3/2026')).toBe(true);
    expect(new Date(after.sentAt).toISOString()).toBe(newUTC);
    // The local calendar day derived from sentAt matches the day in the dateTime string.
    const dayFromSentAt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'numeric', day: 'numeric', year: 'numeric',
    }).format(new Date(after.sentAt));
    expect(dayFromSentAt).toBe('9/3/2026');
  });

  test('invalid dateTimeUTC does not corrupt sentAt (guard)', async () => {
    await addPullToHistory('Test Well', '9/2/2026 5:59 PM', 16, 140, false, '20260902_175952', PID, 'sent');
    const originalSentAt = find(PID).sentAt;
    await updatePullHistoryEntry(PID, '9/2/2026 5:59 PM', 16, 140, false, { markEdited: false, dateTimeUTC: 'garbage' });
    expect(find(PID).sentAt).toBe(originalSentAt);
    expect(find(PID).dateTimeUTC).toBeUndefined();
  });
});
