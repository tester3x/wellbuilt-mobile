// Wiring-order proofs for the future-timestamp hard stop.
//
// These assertions read app/record.tsx as source text and pin the gate's
// position inside handleSubmit: it must run on the FINALIZED dateTimeUTC and
// return BEFORE the edit branch and before every side effect. That is what
// makes the stop hard on all paths:
//  - edit path (smartUploadEditPacket / updatePullHistoryEntry) — a future
//    edit can never be saved;
//  - create path (smartUploadTankPacket / addPullToHistory / saveWellPull /
//    saveLevelSnapshot / savePendingPull) — nothing is uploaded or recorded;
//  - offline path — queueing only ever happens INSIDE smartUpload*, which the
//    gate precedes, and record.tsx never calls queuePacket directly, so
//    offline mode cannot bypass the guard;
//  - dispatch — initiateSendQueue (WhatsApp/SMS) is also downstream.
// If someone reorders handleSubmit or removes the early return, these fail.
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../../app/record.tsx'), 'utf8');
const submitStart = src.indexOf('const handleSubmit');
const handleSubmit = src.slice(submitStart);
const gateIdx = handleSubmit.indexOf('evaluatePullTime(');

describe('record.tsx wiring of the future-time gate', () => {
  test('handleSubmit exists and calls the gate exactly once', () => {
    expect(submitStart).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(handleSubmit.split('evaluatePullTime(').length - 1).toBe(1);
  });

  test('the gate validates the finalized dateTimeUTC value', () => {
    expect(handleSubmit).toContain('evaluatePullTime(dateTimeUTCString, Date.now())');
    // The finalized value must already exist when the gate runs.
    const finalizedIdx = handleSubmit.indexOf('const dateTimeUTCString');
    expect(finalizedIdx).toBeGreaterThan(-1);
    expect(finalizedIdx).toBeLessThan(gateIdx);
  });

  test('a blocked verdict hard-stops with an early return', () => {
    const gateBlock = handleSubmit.slice(gateIdx, gateIdx + 900);
    expect(gateBlock).toContain('if (!timeGate.ok)');
    expect(gateBlock).toContain('return;');
    expect(gateBlock).toContain("'Future time detected'");
    expect(gateBlock).toContain("'Fix date/time'");
    expect(gateBlock).toContain("'Use current time'");
    // "Use current time" only updates the form pickers — no submit call.
    expect(gateBlock).not.toContain('handleSubmit');
    expect(gateBlock).toContain('setDateTime(now)');
  });

  test('the gate precedes the edit branch and every side effect', () => {
    const sideEffects = [
      'if (isEditMode) {',        // edit path — future edit can never save
      'smartUploadEditPacket(',   // remote edit
      'updatePullHistoryEntry(',  // local history edit-marking
      'smartUploadTankPacket(',   // upload (and its internal offline queueing)
      'addPullToHistory(',        // local Pull History insert
      'saveWellPull(',            // local level history
      'saveLevelSnapshot(',       // main-screen snapshot
      'savePendingPull(',         // drain-animation pending state
      'initiateSendQueue(',       // WhatsApp/SMS dispatch
    ];
    for (const effect of sideEffects) {
      const idx = handleSubmit.indexOf(effect);
      // Labelled so a failure names the offending call site.
      expect({ effect, present: idx > -1, afterGate: idx > gateIdx }).toEqual({
        effect,
        present: true,
        afterGate: true,
      });
    }
  });

  test('record.tsx has no direct queue access that could skirt the gate', () => {
    expect(src).not.toContain('queuePacket(');
  });
});

describe('record.tsx stable-identity wiring (GS3 durability)', () => {
  test('15. the future-time gate still precedes identity minting, upload, queue, and history', () => {
    const mintIdx = handleSubmit.indexOf('mintPacketId(wellName)');
    expect(mintIdx).toBeGreaterThan(-1);
    expect(mintIdx).toBeGreaterThan(gateIdx); // blocked pulls never mint/queue/record
  });

  test('the invented queued_* history ids are gone — one stable id feeds history', () => {
    expect(src).not.toContain('queued_${');
    // History receives the minted id plus an honest sync status — an
    // accepted upload is only 'submitted', never optimistically 'sent'.
    expect(handleSubmit).toContain("uploadResult.success ? 'submitted' : 'pending_sync'");
    // The timestamp is derived from the same id, not a second clock read.
    expect(handleSubmit).toContain('packetId.slice(0, 15)');
  });
});
