// Issue B (2026-08-25): the pull-edit path targets the not-yet-deployed
// ingestWbmEdit callable, which returns HTTP 404. Before this fix a 404 was
// classified retryable/unclassified, so the edit burned EDIT_FAILED_THRESHOLD
// retries and went SILENTLY edit_failed (non-attention). It must instead PARK
// honestly (dependency_blocked → edit_blocked/edit_unsupported): no retry, no
// silent failure, no false success, identity preserved. This does NOT deliver
// or unpark the edit — the backend remains a named, undeployed dependency.
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
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })), addEventListener: jest.fn(() => () => undefined) },
}));
const mockedUploadEdit = jest.fn();
jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: (...args: unknown[]) => mockedUploadEdit(...args),
  mintPacketId: jest.fn(() => 'pid_mock'),
}));
jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => 'driver-a'),
  getDriverName: jest.fn(async () => 'Driver A'),
}));
jest.mock('../secureOperationalApi', () => ({
  getFieldCommandStatus: async () => { throw new Error('no_receipt'); },
}));

import { diagnoseThrown } from '../connectionDiagnosis';
import {
  submitPullEdit, processEditOperations, getEditOperations, shouldAutoAttemptEdit,
} from '../editDelivery';
import { buildDeliveryItems, selectDeliveryItems } from '../deliveryStatus';
import { addPullToHistory, clearPullHistory, setPullSyncStatus, getPullHistory } from '../pullHistory';

const PID = '20260823_112300_Gabriel2_abc123';
const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const editParams = (bbls = 140) => ({
  originalPacketTimestamp: PID.slice(0, 15), originalPacketId: PID, wellName: 'Gabriel 2',
  dateTime: '', dateTimeUTC: '', tankLevelFeet: 10.5, bblsTaken: bbls, wellDown: false,
});
const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    return { ok: true, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as any;
  }) as unknown as typeof fetch;

beforeEach(async () => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  mockedUploadEdit.mockReset();
  await clearPullHistory();
  await addPullToHistory('Gabriel 2', '8/23/2026 11:23 AM', 10.5, 160, false, PID.slice(0, 15), PID);
  await setPullSyncStatus(PID, 'sent');
});

describe('missing edit endpoint (404) classification', () => {
  it('a missing Cloud callable (404) is dependency_blocked, not retryable', () => {
    const d = diagnoseThrown(new Error('Callable ingestWbmEdit failed (404)'));
    expect(d.kind).toBe('dependency_blocked');
    expect(d.retryable).toBe(false);
    // A bare HTTP 404 too.
    expect(diagnoseThrown(new Error('HTTP 404 Not Found')).kind).toBe('dependency_blocked');
  });
  it('does not disturb other classifications', () => {
    expect(diagnoseThrown(new Error('unsupported_field_command:edit')).kind).toBe('dependency_blocked');
    expect(diagnoseThrown(new Error('HTTP 503')).kind).toBe('server');
    expect(diagnoseThrown(new Error('HTTP 503')).retryable).toBe(true);
    expect(diagnoseThrown(new Error('permission_denied')).kind).toBe('permission');
  });
});

describe('edit parks (does not silently fail) when ingestWbmEdit returns 404', () => {
  it('parks on the FIRST 404 as edit_blocked/edit_unsupported — no retry burn', async () => {
    // The endpoint is down BEFORE the first attempt (submitPullEdit uploads
    // internally once the original is processed).
    mockedUploadEdit.mockRejectedValue(new Error('Callable ingestWbmEdit failed (404)'));
    await submitPullEdit(editParams(), makeFetch({ [`packets/processed/${PID}`]: { editable: true } }));
    const op1 = JSON.parse(mockStore[EDIT_OPS_KEY])[0];
    expect(op1.state).toBe('edit_blocked');
    expect(op1.blockedCode).toBe('edit_unsupported');
    // Parked → never auto-attempted again (no burning toward edit_failed).
    expect(shouldAutoAttemptEdit(op1, Date.now() + 1e9)).toBe(false);
    // A later pass leaves it parked and does not re-upload.
    const before = mockedUploadEdit.mock.calls.length;
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: {} }));
    const op2 = JSON.parse(mockStore[EDIT_OPS_KEY])[0];
    expect(op2.state).toBe('edit_blocked');
    expect(mockedUploadEdit.mock.calls.length).toBe(before);
  });

  it('the parked edit is NOT counted as driver attention and shows no Retry, no raw 404', async () => {
    mockedUploadEdit.mockRejectedValue(new Error("Callable ingestWbmEdit failed (404)"));
    await submitPullEdit(editParams(), makeFetch({ [`packets/processed/${PID}`]: { editable: true } }));
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: {} }));
    const items = buildDeliveryItems([], await getPullHistory(), await getEditOperations(), Date.now());
    const row = items.find((i) => i.type === 'edit');
    expect(row).toBeTruthy();
    expect(row!.errorKind).toBe('dependency_blocked');
    expect(row!.needsAttention).toBe(false);
    expect(row!.action).toBeNull();               // no Retry button
    expect(selectDeliveryItems(items, 'attention')).toHaveLength(0);
    expect(JSON.stringify(row)).not.toMatch(/\b404\b/); // no raw coding string surfaced
  });

  it('never marks the edit applied/edited without a receipt (no false success)', async () => {
    mockedUploadEdit.mockRejectedValue(new Error("Callable ingestWbmEdit failed (404)"));
    await submitPullEdit(editParams(), makeFetch({ [`packets/processed/${PID}`]: { editable: true } }));
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: {} }));
    const op = JSON.parse(mockStore[EDIT_OPS_KEY])[0];
    expect(op.state).not.toBe('edited');
    // Original packet identity preserved (never reminted); one deterministic op.
    expect(op.originalPacketId).toBe(PID);
    expect(op.opId).toBe(`editop_${PID}`);
  });
});
