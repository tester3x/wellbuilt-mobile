import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureWellSelectionOwner, loadSelectedWells, saveSelectedWells } from '../wellSelection';
import { bumpSessionGeneration, resetSessionGenerationForTests } from '../wbmSessionFence';

const mockStore: Record<string, string> = {};
let mockDriver = 'driver-a';
let mockCompany = 'company-a';
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true, default: {
    getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => key === 'driverId' ? mockDriver : mockCompany),
}));


beforeEach(() => {
  Object.keys(mockStore).forEach(key => delete mockStore[key]);
  mockDriver = 'driver-a'; mockCompany = 'company-a';
  resetSessionGenerationForTests(); jest.clearAllMocks();
});

test('route additions appear automatically while legacy unchecked wells stay hidden', async () => {
  mockStore.wellbuilt_selected_wells = JSON.stringify(['Selected']);
  const owner = await captureWellSelectionOwner();
  expect(await loadSelectedWells(owner, ['Selected', 'Hidden'])).toEqual(['Selected']);
  expect(await loadSelectedWells(owner, ['Selected', 'Hidden', 'New route well']))
    .toEqual(['Selected', 'New route well']);
  expect(JSON.parse(mockStore.wellbuilt_selected_wells)).toEqual(['Selected', 'New route well']);
});

test('new accounts default to all assigned wells; catalogue removals never leak saved wells', async () => {
  const owner = await captureWellSelectionOwner();
  expect(await loadSelectedWells(owner, ['A', 'B'])).toEqual(['A', 'B']);
  expect(await loadSelectedWells(owner, ['B', 'C'])).toEqual(['B', 'C']);
  expect(await loadSelectedWells(owner, [])).toEqual([]);
});

test('hiding the whole route stays hidden, without suppressing future new wells', async () => {
  const owner = await captureWellSelectionOwner();
  await loadSelectedWells(owner, ['A', 'B']);
  await saveSelectedWells(owner, ['A', 'B'], []);
  expect(await loadSelectedWells(owner, ['A', 'B'])).toEqual([]);
  expect(await loadSelectedWells(owner, ['A', 'B', 'C'])).toEqual(['C']);
  await saveSelectedWells(owner, ['A', 'B', 'C'], ['A', 'B', 'C']);
  expect(await loadSelectedWells(owner, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
});

test('a hidden well stays hidden after removal and reassignment', async () => {
  const owner = await captureWellSelectionOwner();
  await loadSelectedWells(owner, ['A', 'B']);
  await saveSelectedWells(owner, ['A', 'B'], ['A']);
  await loadSelectedWells(owner, ['A']);
  expect(await loadSelectedWells(owner, ['A', 'B', 'C'])).toEqual(['A', 'C']);
});

test('long-press hide and simultaneous catalogue refresh serialize without losing new wells', async () => {
  const owner = await captureWellSelectionOwner();
  await loadSelectedWells(owner, ['A', 'B']);
  await Promise.all([
    saveSelectedWells(owner, ['A', 'B'], ['B']),
    loadSelectedWells(owner, ['A', 'B', 'New']),
  ]);
  expect(await loadSelectedWells(owner, ['A', 'B', 'New'])).toEqual(['B', 'New']);
  expect(JSON.parse(mockStore.wellbuilt_selected_wells)).toEqual(['B', 'New']);
});

test('preferences survive process restart', async () => {
  const owner = await captureWellSelectionOwner();
  await loadSelectedWells(owner, ['A', 'B']);
  await saveSelectedWells(owner, ['A', 'B'], ['B']);
  resetSessionGenerationForTests();
  expect(await loadSelectedWells(await captureWellSelectionOwner(), ['A', 'B', 'C'])).toEqual(['B', 'C']);
});

test('driver and company preferences are isolated and legacy selections migrate only once', async () => {
  mockStore.wellbuilt_selected_wells = '["A"]';
  const first = await captureWellSelectionOwner();
  await loadSelectedWells(first, ['A', 'B']);
  mockDriver = 'driver-b'; bumpSessionGeneration();
  expect(await loadSelectedWells(await captureWellSelectionOwner(), ['A', 'B'])).toEqual(['A', 'B']);
  mockDriver = 'driver-a'; mockCompany = 'company-b'; bumpSessionGeneration();
  expect(await loadSelectedWells(await captureWellSelectionOwner(), ['A', 'B'])).toEqual(['A', 'B']);
  mockCompany = 'company-a'; bumpSessionGeneration();
  expect(await loadSelectedWells(await captureWellSelectionOwner(), ['A', 'B'])).toEqual(['A']);
});

test('old session cannot reconcile or change preferences after account switch', async () => {
  const old = await captureWellSelectionOwner();
  mockDriver = 'driver-b'; bumpSessionGeneration();
  await expect(loadSelectedWells(old, ['A'])).rejects.toThrow('selection_session_changed');
  await expect(saveSelectedWells(old, ['A'], [])).rejects.toThrow('selection_session_changed');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('session switch during a pending storage read cannot save old catalogue', async () => {
  const owner = await captureWellSelectionOwner();
  const originalRead = AsyncStorage.getItem as jest.Mock;
  originalRead.mockImplementationOnce(async () => {
    mockDriver = 'driver-b'; bumpSessionGeneration(); return null;
  });
  await expect(loadSelectedWells(owner, ['A'])).rejects.toThrow('selection_session_changed');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('malformed legacy selection recovers to assigned catalogue only', async () => {
  mockStore.wellbuilt_selected_wells = '{broken';
  expect(await loadSelectedWells(await captureWellSelectionOwner(), ['Assigned']))
    .toEqual(['Assigned']);
});
