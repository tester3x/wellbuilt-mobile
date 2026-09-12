jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));

describe('real readings replace unavailable placeholders', () => {
  beforeEach(() => { jest.resetModules(); });

  async function save(service: typeof import('../wellHistory'), utc: string, feet = 8) {
    await service.saveLevelSnapshot('Kahuna 2', feet, '2026-09-12T02:50:00Z', false,
      undefined, 165, undefined, undefined, '1:00:00', 60, utc);
  }

  test('first historical reading replaces a newly unavailable well', async () => {
    const service = await import('../wellHistory');
    await service.markLevelUnavailable('Kahuna 2');
    expect((await service.getLevelSnapshot('Kahuna 2'))?.timestamp).toBe(0);
    await save(service, '2026-08-30T06:10:24Z');
    expect(await service.getLevelSnapshot('Kahuna 2')).toMatchObject({ unavailable: false, levelFeet: 8 });
  });

  test('repairs persisted old-build unavailable placeholder with a newer fake timestamp', async () => {
    const storage = (await import('@react-native-async-storage/async-storage')).default;
    (storage.getItem as jest.Mock).mockResolvedValue(JSON.stringify({ 'Kahuna 2': {
      unavailable: true, timestamp: Date.parse('2026-09-12T02:00:00Z'), levelFeet: 0,
    } }));
    const service = await import('../wellHistory');
    await save(service, '2026-09-12T01:41:23Z');
    expect(await service.getLevelSnapshot('Kahuna 2')).toMatchObject({ unavailable: false, levelFeet: 8 });
  });

  test('still protects an existing real reading from older responses', async () => {
    const service = await import('../wellHistory');
    await save(service, '2026-09-12T01:41:23Z', 10);
    await save(service, '2026-09-01T01:00:00Z', 2);
    expect((await service.getLevelSnapshot('Kahuna 2'))?.levelFeet).toBe(10);
    await service.markLevelUnavailable('Kahuna 2');
    await save(service, '2026-09-01T01:00:00Z', 2);
    expect((await service.getLevelSnapshot('Kahuna 2'))?.levelFeet).toBe(10);
    await save(service, '2026-09-12T01:41:23Z', 10);
    expect((await service.getLevelSnapshot('Kahuna 2'))?.unavailable).toBe(false);
  });
});
