import type { WellConfig } from './wellConfig';
import { getLevelSnapshot, getPendingPull, getSliderPosition, getWellPull } from './wellHistory';

/** Prepare one coherent card input before publishing React state. In particular,
 * pending-pull ownership must be known before a snapshot starts live animation. */
export async function readWellDisplayData(wellName: string, config: WellConfig) {
  const [snapshot, pending, pull, slider] = await Promise.all([
    getLevelSnapshot(wellName, config), getPendingPull(wellName),
    getWellPull(wellName), getSliderPosition(wellName),
  ]);
  return { snapshot, pending, pull, slider };
}
