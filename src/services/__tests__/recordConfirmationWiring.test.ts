import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('post-pull confirmation wiring', () => {
  const record = src('app/record.tsx');
  const queue = src('src/services/packetQueue.ts');
  const sync = src('src/services/backgroundSync.ts');

  it('accepted online pull starts bounded confirmation', () => {
    expect(record).toMatch(/startOutgoingConfirmation\(wellName, uploadResult\.packetId\)/);
    expect(record).toMatch(/saveLevelSnapshot\(/);
    expect(record).toMatch(/savePendingPull\(wellName/);
  });

  it('offline queued pull does not start confirmation at submit time', () => {
    const onlineBlock = record.slice(
      record.indexOf('if (uploadResult.success && uploadResult.packetTimestamp && uploadResult.packetId)'),
      record.indexOf("if (uploadResult.queued)"),
    );
    expect(onlineBlock).toMatch(/startOutgoingConfirmation/);
    const queuedToast = record.slice(record.indexOf("if (uploadResult.queued)"));
    expect(queuedToast).not.toMatch(/startOutgoingConfirmation/);
  });

  it('queued pull enters confirmation after a successful flush', () => {
    expect(queue).toMatch(/startOutgoingConfirmation\(wellName, packet\.packetId\)/);
  });

  it('processResponsePacket loads pending before applying an outgoing response', () => {
    expect(sync).toMatch(/const pending = await getPendingPull\(packet\.wellName\)/);
    expect(sync).toMatch(/shouldApplyOutgoingResponse\(pending, packet\)/);
    const applyIdx = sync.indexOf('shouldApplyOutgoingResponse');
    const saveIdx = sync.indexOf('await saveLevelSnapshot');
    const clearIdx = sync.indexOf('await clearPendingPull');
    expect(applyIdx).toBeGreaterThan(0);
    expect(applyIdx).toBeLessThan(saveIdx);
    expect(applyIdx).toBeLessThan(clearIdx);
  });
});
