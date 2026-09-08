/**
 * Regression guard for the retirement of the packets/incoming_version backup
 * listener (2026-09-08).
 *
 * The company-scoped packets/outgoing realtime path (onChildAdded /
 * onChildChanged) is the primary refresh trigger and MUST keep updating the
 * affected well with no dependency on any version key. These tests prove the
 * apply path (captureAndApplyOutgoingStatus, the shared coalesced runner's
 * core) persists outgoing responses even when BOTH the legacy incoming_version
 * fetch AND the incoming_revision_v2 fetch return null.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  captureAndApplyOutgoingStatus,
  resetAppliedIncomingVersionForTests,
  type OutgoingStatusSyncIo,
} from '../incomingVersion';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

type Resp = { wellName: string; currentLevel?: string };

/**
 * An IO whose version-key fetches both return null — i.e. neither
 * packets/incoming_version nor packets/incoming_revision_v2 signals anything.
 * The only source of truth is fetchOutgoingStatus (the packets/outgoing read).
 */
function ioWithoutVersionKeys(responses: Resp[]) {
  const saved: Resp[][] = [];
  const marks: string[] = [];
  const io: OutgoingStatusSyncIo<Resp> = {
    fetchIncomingVersion: async () => null,   // no incoming_version
    fetchRevisionV2: async () => null,        // no incoming_revision_v2
    fetchOutgoingStatus: async () => ({ driverId: 'driver-a', responses, unavailableWells: [] }),
    saveResponses: async (r) => { saved.push(r); },
    saveUnavailable: async () => undefined,
    markApplied: async () => { marks.push('version'); return true; },
    markRevisionV2Applied: async () => { marks.push('v2'); return true; },
  };
  return { io, saved, marks };
}

describe('packets/outgoing updates the well without any version key', () => {
  beforeEach(() => {
    resetAppliedIncomingVersionForTests();
  });

  it('an outgoing response is applied when both version fetches return null', async () => {
    const { io, saved, marks } = ioWithoutVersionKeys([{ wellName: 'Gabriel 1', currentLevel: `48"` }]);
    const out = await captureAndApplyOutgoingStatus(io);

    // The well update was persisted purely from the outgoing payload.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual([{ wellName: 'Gabriel 1', currentLevel: `48"` }]);
    expect(out.count).toBe(1);
    expect(out.fetched).toBe(true);

    // Nothing was gated on a version key: none was present, none was marked.
    expect(out.markedVersion).toBeNull();
    expect(out.markedRevisionV2).toBeNull();
    expect(marks).toEqual([]); // markApplied / markRevisionV2Applied never invoked
  });

  it('a subsequent changed response (onChildChanged) still applies with no version key', async () => {
    // First delivery.
    const first = ioWithoutVersionKeys([{ wellName: 'Gabriel 1', currentLevel: `48"` }]);
    await captureAndApplyOutgoingStatus(first.io);
    expect(first.saved[0]).toEqual([{ wellName: 'Gabriel 1', currentLevel: `48"` }]);

    // A later change to the same well arrives on the realtime path.
    const second = ioWithoutVersionKeys([{ wellName: 'Gabriel 1', currentLevel: `60"` }]);
    const out = await captureAndApplyOutgoingStatus(second.io);
    expect(second.saved[0]).toEqual([{ wellName: 'Gabriel 1', currentLevel: `60"` }]);
    expect(out.count).toBe(1);
    expect(out.markedVersion).toBeNull();
  });

  it('multiple wells in one outgoing snapshot all apply without a version key', async () => {
    const { io, saved } = ioWithoutVersionKeys([
      { wellName: 'Gabriel 1', currentLevel: `10"` },
      { wellName: 'Gabriel 7', currentLevel: `20"` },
    ]);
    const out = await captureAndApplyOutgoingStatus(io);
    expect(saved[0]).toHaveLength(2);
    expect(out.count).toBe(2);
  });
});

describe('source wiring: outgoing realtime path preserved, incoming_version listener retired', () => {
  const listener = src('src/services/firebaseListener.ts');
  const sync = src('src/services/backgroundSync.ts');

  it('subscribeToOutgoing keeps the company-scoped onChildAdded/onChildChanged path', () => {
    expect(listener).toMatch(/export function subscribeToOutgoing/);
    expect(listener).toMatch(/orderByChild\('companyId'\)/);
    expect(listener).toMatch(/onChildAdded/);
    expect(listener).toMatch(/onChildChanged/);
  });

  it('backgroundSync METHOD 1 drives processResponsePacket from the outgoing listener', () => {
    expect(sync).toMatch(/subscribeToOutgoing\(/);
    expect(sync).toMatch(/processResponsePacket\(/);
  });

  it('the incoming_version backup listener is gone', () => {
    expect(listener).not.toMatch(/export function watchIncomingVersion/);
    expect(sync).not.toMatch(/watchIncomingVersion\(/);
    expect(sync).not.toMatch(/incoming_version changed - fetching updated responses/);
  });
});
