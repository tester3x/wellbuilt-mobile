jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));
jest.mock('../firebaseListener', () => ({}));
jest.mock('../wellAlerts', () => ({ scheduleWellAlert: jest.fn(async () => {}) }));

describe('authoritative production estimate withdrawal', () => {
  beforeEach(() => jest.resetModules());

  async function fixture() {
    const history = await import('../wellHistory');
    const sync = await import('../backgroundSync');
    const packet = { wellName: 'Test Well', currentLevel: "8'", flowRate: '1:00:00',
      timeTillPull: '', nextPullTime: '', bbls24hrs: '480', status: 'success',
      timestamp: '2026-10-20T12:00:00Z', lastPullDateTimeUTC: '2026-10-20T12:00:00Z' };
    await sync.processResponsePacket({ ...packet, windowBblsDay: '520', overnightBblsDay: '900' });
    expect(history.getLevelSnapshotSync('Test Well')?.overnightBblsDay).toBe(900);
    return { history, sync, packet };
  }

  test.each([undefined, null, '', '0', '-1', 'not-a-number', '950garbage'])('withdraws missing/invalid estimate %s through real response processing', async value => {
    const { history, sync, packet } = await fixture();
    await sync.processResponsePacket({ ...packet, windowBblsDay: value, overnightBblsDay: value });
    expect(history.getLevelSnapshotSync('Test Well')).toMatchObject({ levelFeet: 8, flowRateMinutes: 60 });
    expect(history.getLevelSnapshotSync('Test Well')?.overnightBblsDay).toBeUndefined();
    expect(history.getLevelSnapshotSync('Test Well')?.windowBblsDay).toBeUndefined();
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    const saved = (storage.setItem as jest.Mock).mock.calls.filter(([key]) => key === '@wellbuilt_level_snapshots').at(-1);
    expect(saved).toBeDefined();
    expect(JSON.parse(saved![1])['Test Well'].overnightBblsDay).toBeUndefined();
  });

  test('local level updates preserve estimates; a later valid response replaces them', async () => {
    const { history, sync, packet } = await fixture();
    await history.saveLevelSnapshot('Test Well', 9, packet.timestamp, false);
    expect(history.getLevelSnapshotSync('Test Well')?.overnightBblsDay).toBe(900);
    await sync.processResponsePacket({ ...packet, windowBblsDay: '510', overnightBblsDay: '600' });
    expect(history.getLevelSnapshotSync('Test Well')?.overnightBblsDay).toBe(600);
  });

  test('older responses cannot withdraw a newer proven reading or its estimates', async () => {
    const { history, sync, packet } = await fixture();
    await sync.processResponsePacket({ ...packet, timestamp: '2026-10-19T12:00:00Z', lastPullDateTimeUTC: '2026-10-19T12:00:00Z' });
    expect(history.getLevelSnapshotSync('Test Well')?.overnightBblsDay).toBe(900);
  });

  test('estimated ON clock metadata persists locally, then clears with exact or withdrawn ON', async()=>{
    const {history,sync,packet}=await fixture();
    await sync.processResponsePacket({...packet,overnightBblsDay:'644',overnightEstimatedTime:true});
    expect(history.getLevelSnapshotSync('Test Well')).toMatchObject({overnightBblsDay:644,overnightEstimatedTime:true});
    await history.saveLevelSnapshot('Test Well',9,packet.timestamp,false);
    expect(history.getLevelSnapshotSync('Test Well')?.overnightEstimatedTime).toBe(true);
    await sync.processResponsePacket({...packet,overnightBblsDay:'650',overnightEstimatedTime:false});
    expect(history.getLevelSnapshotSync('Test Well')).toMatchObject({overnightBblsDay:650,overnightEstimatedTime:false});
    await sync.processResponsePacket({...packet,overnightBblsDay:null,overnightEstimatedTime:true});
    expect(history.getLevelSnapshotSync('Test Well')?.overnightBblsDay).toBeUndefined();
    expect(history.getLevelSnapshotSync('Test Well')?.overnightEstimatedTime).toBe(false);
  });
});
