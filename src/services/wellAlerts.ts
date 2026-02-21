// src/services/wellAlerts.ts
// Well level alert system - IN-APP notifications only (no OS push notifications)
//
// How it works:
// - Driver sets a threshold (e.g., 12') for when they want to be alerted
// - When response packets come in with level + flow rate, we CALCULATE
//   the exact date/time the well will hit that level
// - Store this info locally - UI shows red dot on bell icon when ready
// - No expo-notifications dependency - works in Expo Go
//
// Settings are stored locally on each driver's device, not centralized

import AsyncStorage from "@react-native-async-storage/async-storage";

const ALERT_SETTINGS_KEY = "@wellbuilt_well_alerts_v2";
const SCHEDULED_ALERTS_KEY = "@wellbuilt_scheduled_alerts";
const READY_WELLS_KEY = "@wellbuilt_ready_wells";

export interface WellAlertSettings {
  enabled: boolean;
  defaultThreshold: number; // feet - alert when level REACHES this
  perWellThresholds: { [wellName: string]: number };
  perWellEnabled: { [wellName: string]: boolean }; // per-well enable/disable
}

// Track scheduled alerts so we can show them in-app
interface ScheduledAlert {
  wellName: string;
  scheduledTime: number; // ms since epoch
  threshold: number;
}

interface ScheduledAlertsMap {
  [wellName: string]: ScheduledAlert;
}

// Track wells that are ready (at or above threshold)
interface ReadyWells {
  [wellName: string]: {
    readySince: number; // ms since epoch
    currentLevel: number;
    threshold: number;
    acknowledged: boolean;
  };
}

// Default settings
const DEFAULT_SETTINGS: WellAlertSettings = {
  enabled: true,
  defaultThreshold: 12, // Alert when level reaches 12' (ready to pull)
  perWellThresholds: {},
  perWellEnabled: {},
};

let cachedSettings: WellAlertSettings | null = null;
let cachedScheduledAlerts: ScheduledAlertsMap = {};
let cachedReadyWells: ReadyWells = {};

// Listeners for UI updates
type AlertListener = () => void;
const alertListeners = new Set<AlertListener>();

const notifyListeners = () => {
  alertListeners.forEach(listener => listener());
};

/**
 * Subscribe to alert state changes (for UI updates)
 */
export function onAlertStateChange(listener: AlertListener): () => void {
  alertListeners.add(listener);
  return () => alertListeners.delete(listener);
}

/**
 * Get count of unacknowledged ready wells (for badge display)
 */
export async function getReadyWellsCount(): Promise<number> {
  await loadReadyWells();
  return Object.values(cachedReadyWells).filter(w => !w.acknowledged).length;
}

/**
 * Get all ready wells (for modal display)
 */
export async function getReadyWells(): Promise<ReadyWells> {
  await loadReadyWells();
  return { ...cachedReadyWells };
}

/**
 * Acknowledge a ready well (dismiss the alert)
 */
export async function acknowledgeWell(wellName: string): Promise<void> {
  await loadReadyWells();
  if (cachedReadyWells[wellName]) {
    cachedReadyWells[wellName].acknowledged = true;
    await saveReadyWells();
    notifyListeners();
  }
}

/**
 * Acknowledge all ready wells
 */
export async function acknowledgeAllWells(): Promise<void> {
  await loadReadyWells();
  for (const wellName of Object.keys(cachedReadyWells)) {
    cachedReadyWells[wellName].acknowledged = true;
  }
  await saveReadyWells();
  notifyListeners();
}

// Load/save ready wells
async function loadReadyWells(): Promise<ReadyWells> {
  if (Object.keys(cachedReadyWells).length > 0) return cachedReadyWells;

  try {
    const stored = await AsyncStorage.getItem(READY_WELLS_KEY);
    cachedReadyWells = stored ? JSON.parse(stored) : {};
    return cachedReadyWells;
  } catch (error) {
    console.error("[WellAlerts] Error loading ready wells:", error);
    cachedReadyWells = {};
    return cachedReadyWells;
  }
}

async function saveReadyWells(): Promise<void> {
  try {
    await AsyncStorage.setItem(READY_WELLS_KEY, JSON.stringify(cachedReadyWells));
  } catch (error) {
    console.error("[WellAlerts] Error saving ready wells:", error);
  }
}

// Request permission - no-op now (no OS notifications)
export async function requestNotificationPermission(): Promise<boolean> {
  return true; // Always "granted" for in-app alerts
}

// Load alert settings
export async function loadAlertSettings(): Promise<WellAlertSettings> {
  if (cachedSettings) return cachedSettings;

  try {
    const stored = await AsyncStorage.getItem(ALERT_SETTINGS_KEY);
    if (stored) {
      const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      cachedSettings = loaded;
      return loaded;
    } else {
      const defaults = { ...DEFAULT_SETTINGS };
      cachedSettings = defaults;
      return defaults;
    }
  } catch (error) {
    console.error("[WellAlerts] Error loading settings:", error);
    const defaults = { ...DEFAULT_SETTINGS };
    cachedSettings = defaults;
    return defaults;
  }
}

// Save alert settings
export async function saveAlertSettings(settings: WellAlertSettings): Promise<void> {
  try {
    cachedSettings = settings;
    await AsyncStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(settings));
    console.log("[WellAlerts] Saved settings");
  } catch (error) {
    console.error("[WellAlerts] Error saving settings:", error);
  }
}

// Load scheduled alerts tracking
async function loadScheduledAlerts(): Promise<ScheduledAlertsMap> {
  if (Object.keys(cachedScheduledAlerts).length > 0) return cachedScheduledAlerts;

  try {
    const stored = await AsyncStorage.getItem(SCHEDULED_ALERTS_KEY);
    cachedScheduledAlerts = stored ? JSON.parse(stored) : {};

    // Clean up past alerts
    const now = Date.now();
    let changed = false;
    for (const wellName of Object.keys(cachedScheduledAlerts)) {
      if (cachedScheduledAlerts[wellName].scheduledTime < now) {
        delete cachedScheduledAlerts[wellName];
        changed = true;
      }
    }

    if (changed) {
      await saveScheduledAlerts();
    }

    return cachedScheduledAlerts;
  } catch (error) {
    console.error("[WellAlerts] Error loading scheduled alerts:", error);
    cachedScheduledAlerts = {};
    return cachedScheduledAlerts;
  }
}

// Save scheduled alerts tracking
async function saveScheduledAlerts(): Promise<void> {
  try {
    await AsyncStorage.setItem(SCHEDULED_ALERTS_KEY, JSON.stringify(cachedScheduledAlerts));
  } catch (error) {
    console.error("[WellAlerts] Error saving scheduled alerts:", error);
  }
}

// Get threshold for a specific well
export async function getWellThreshold(wellName: string): Promise<number> {
  const settings = await loadAlertSettings();
  return settings.perWellThresholds[wellName] ?? settings.defaultThreshold;
}

// Set threshold for a specific well
export async function setWellThreshold(wellName: string, threshold: number): Promise<void> {
  const settings = await loadAlertSettings();
  settings.perWellThresholds[wellName] = threshold;
  await saveAlertSettings(settings);
}

// Enable/disable alerts for a specific well
export async function setWellAlertEnabled(wellName: string, enabled: boolean): Promise<void> {
  const settings = await loadAlertSettings();
  settings.perWellEnabled[wellName] = enabled;
  await saveAlertSettings(settings);

  // If disabling, remove from ready wells
  if (!enabled) {
    await loadReadyWells();
    delete cachedReadyWells[wellName];
    await saveReadyWells();
    notifyListeners();
  }
}

// Check if alerts are enabled for a well
export async function isWellAlertEnabled(wellName: string): Promise<boolean> {
  const settings = await loadAlertSettings();
  if (!settings.enabled) return false;
  return settings.perWellEnabled[wellName] ?? true; // Default to enabled
}

/**
 * Schedule an alert for when a well will reach the threshold
 * Called from backgroundSync when we get response packets
 * Now stores locally instead of using OS notifications
 */
export async function scheduleWellAlert(
  wellName: string,
  currentLevelFeet: number,
  flowRateMinutes: number,
  snapshotTimestamp: number,
  isDown: boolean = false
): Promise<void> {
  // Skip if well is down
  if (isDown) {
    await loadReadyWells();
    delete cachedReadyWells[wellName];
    await saveReadyWells();
    notifyListeners();
    return;
  }

  // Check if alerts are enabled for this well
  const enabled = await isWellAlertEnabled(wellName);
  if (!enabled) {
    return;
  }

  const threshold = await getWellThreshold(wellName);

  // If already at or above threshold, mark as ready
  if (currentLevelFeet >= threshold) {
    console.log(`[WellAlerts] ${wellName} at ${currentLevelFeet}' (threshold: ${threshold}') - READY`);
    await loadReadyWells();

    // Only update if not already acknowledged at this level
    const existing = cachedReadyWells[wellName];
    if (!existing || !existing.acknowledged || existing.currentLevel !== currentLevelFeet) {
      cachedReadyWells[wellName] = {
        readySince: Date.now(),
        currentLevel: currentLevelFeet,
        threshold,
        acknowledged: existing?.acknowledged || false,
      };
      await saveReadyWells();
      notifyListeners();
    }
    return;
  }

  // Not at threshold yet - remove from ready wells if present
  await loadReadyWells();
  if (cachedReadyWells[wellName]) {
    delete cachedReadyWells[wellName];
    await saveReadyWells();
    notifyListeners();
  }

  // Skip if no valid flow rate
  if (!flowRateMinutes || flowRateMinutes <= 0) {
    return;
  }

  // Calculate when level will reach threshold
  const feetToGo = threshold - currentLevelFeet;
  const minutesToAlert = feetToGo * flowRateMinutes;
  const alertTime = snapshotTimestamp + (minutesToAlert * 60 * 1000);

  // Store scheduled alert
  await loadScheduledAlerts();
  cachedScheduledAlerts[wellName] = {
    wellName,
    scheduledTime: alertTime,
    threshold,
  };
  await saveScheduledAlerts();

  const alertDate = new Date(alertTime);
  console.log(`[WellAlerts] ${wellName} will reach ${threshold}' at ${alertDate.toLocaleString()}`);
}

// Initialize the alert system
export async function initializeWellAlerts(): Promise<void> {
  await loadAlertSettings();
  await loadScheduledAlerts();
  await loadReadyWells();

  // Check if any scheduled alerts are now ready
  const now = Date.now();
  let changed = false;

  for (const [wellName, alert] of Object.entries(cachedScheduledAlerts)) {
    if (alert.scheduledTime <= now) {
      // Time has passed - well should be ready
      cachedReadyWells[wellName] = {
        readySince: alert.scheduledTime,
        currentLevel: alert.threshold,
        threshold: alert.threshold,
        acknowledged: false,
      };
      delete cachedScheduledAlerts[wellName];
      changed = true;
    }
  }

  if (changed) {
    await saveScheduledAlerts();
    await saveReadyWells();
    notifyListeners();
  }

  console.log("[WellAlerts] Initialized (in-app mode)");
}

// Get all settings for display in Settings screen
export async function getAllAlertSettings(): Promise<WellAlertSettings> {
  return await loadAlertSettings();
}

// Update global enable/disable
export async function setAlertsEnabled(enabled: boolean): Promise<void> {
  const settings = await loadAlertSettings();
  settings.enabled = enabled;
  await saveAlertSettings(settings);

  // If disabling, clear all ready wells
  if (!enabled) {
    cachedReadyWells = {};
    await saveReadyWells();
    notifyListeners();
  }
}

// Update default threshold
export async function setDefaultThreshold(threshold: number): Promise<void> {
  const settings = await loadAlertSettings();
  settings.defaultThreshold = threshold;
  await saveAlertSettings(settings);
}

// Clear all per-well thresholds (reset to defaults)
export async function resetAllThresholds(): Promise<void> {
  const settings = await loadAlertSettings();
  settings.perWellThresholds = {};
  settings.perWellEnabled = {};
  await saveAlertSettings(settings);

  cachedReadyWells = {};
  cachedScheduledAlerts = {};
  await saveReadyWells();
  await saveScheduledAlerts();
  notifyListeners();
}

// Get scheduled alert info for a well (for UI display)
export async function getScheduledAlertInfo(wellName: string): Promise<{
  scheduled: boolean;
  scheduledTime?: Date;
  threshold?: number;
} | null> {
  await loadScheduledAlerts();

  const alert = cachedScheduledAlerts[wellName];
  if (!alert || alert.scheduledTime < Date.now()) {
    return { scheduled: false };
  }

  return {
    scheduled: true,
    scheduledTime: new Date(alert.scheduledTime),
    threshold: alert.threshold,
  };
}

// Legacy function for backwards compatibility
export async function checkWellLevel(
  wellName: string,
  currentLevelFeet: number,
  isDown: boolean = false
): Promise<void> {
  // Deprecated - use scheduleWellAlert instead
  console.log("[WellAlerts] checkWellLevel called (deprecated) for", wellName);
}

// Clear alert for a well (call after pull)
export async function clearWellAlert(wellName: string): Promise<void> {
  await loadReadyWells();
  delete cachedReadyWells[wellName];
  await saveReadyWells();

  await loadScheduledAlerts();
  delete cachedScheduledAlerts[wellName];
  await saveScheduledAlerts();

  notifyListeners();
  console.log("[WellAlerts] Cleared alert for", wellName);
}
