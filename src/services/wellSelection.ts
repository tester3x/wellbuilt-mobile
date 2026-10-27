import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getSessionGeneration, runEnvelopeOp } from './wbmSessionFence';

const LEGACY_KEY = 'wellbuilt_selected_wells';
const MIGRATION_OWNER_KEY = '@wellbuilt_selection_migration_owner';
const PREFIX = '@wellbuilt_hidden_wells_v1:';

export async function captureWellSelectionOwner() {
  const generation = getSessionGeneration();
  const driverId = await SecureStore.getItemAsync('driverId');
  const companyId = await SecureStore.getItemAsync('companyId');
  if (!driverId || generation !== getSessionGeneration()) throw new Error('selection_session_changed');
  return { generation, driverId, companyId: companyId || '' };
}
type Owner = Awaited<ReturnType<typeof captureWellSelectionOwner>>;

async function assertOwner(owner: Owner) {
  const current = await captureWellSelectionOwner();
  if (current.generation !== owner.generation || current.driverId !== owner.driverId
      || current.companyId !== owner.companyId) throw new Error('selection_session_changed');
}

function names(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.every(v => typeof v === 'string') ? value : null;
  } catch { return null; }
}

/** Store exclusions, not a frozen allowlist. Eligibility always comes from the
 * current assigned catalogue; preferences can never grant access to a well. */
async function updateSelection(owner: Owner, eligible: string[], selected?: string[]) {
  return runEnvelopeOp(async () => {
    await assertOwner(owner);
    const ownerKey = JSON.stringify([owner.companyId, owner.driverId]);
    const key = PREFIX + ownerKey;
    let hidden = names(await AsyncStorage.getItem(key));
    if (hidden === null) {
      const migrationOwner = await AsyncStorage.getItem(MIGRATION_OWNER_KEY);
      const legacy = migrationOwner === null || migrationOwner === ownerKey
        ? names(await AsyncStorage.getItem(LEGACY_KEY)) : null;
      // Preserve existing unchecked wells on upgrade. Only the first owner can
      // inherit the old global list; other accounts start with their own defaults.
      hidden = legacy ? eligible.filter(w => !legacy.includes(w)) : [];
      await assertOwner(owner);
      if (migrationOwner === null) await AsyncStorage.setItem(MIGRATION_OWNER_KEY, ownerKey);
    }
    const exclusions = new Set(hidden);
    if (selected) {
      const included = new Set(selected);
      for (const well of eligible) {
        if (included.has(well)) exclusions.delete(well);
        else exclusions.add(well);
      }
    }
    await assertOwner(owner);
    await AsyncStorage.setItem(key, JSON.stringify([...exclusions]));
    await assertOwner(owner);
    const visible = eligible.filter(w => !exclusions.has(w));
    // Summary and performance screens still read this compatibility projection.
    // It is derived output now, never the authoritative preference after migration.
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(visible));
    await assertOwner(owner);
    return visible;
  });
}

export function loadSelectedWells(owner: Owner, eligible: string[]) {
  return updateSelection(owner, eligible);
}

export function saveSelectedWells(owner: Owner, eligible: string[], selected: string[]) {
  return updateSelection(owner, eligible, selected);
}
