// src/services/pullHistory.ts
// Stores history of pull packets sent by driver for reference/timesheet/edit
// Configurable retention period, auto-prunes on load
// Falls back to Firebase packets/processed if local data is missing (e.g. after reinstall)

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDriverId, getDriverName } from "./driverAuth";

const STORAGE_KEY = "@wellbuilt_pull_history";
const SETTINGS_KEY = "@wellbuilt_pull_history_days";
const BACKFILLED_DAYS_KEY = "@wellbuilt_pull_history_backfilled_days";
const DEFAULT_HISTORY_DAYS = 7;

// Firebase config (same as firebase.ts)
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

let historyDays = DEFAULT_HISTORY_DAYS;
let backfillAttempted = false; // Only try empty-history backfill once per session

export interface PullHistoryEntry {
  id: string;                    // full packetId (timestamp_wellName_randomSuffix) - unique identifier
  wellName: string;
  dateTime: string;              // "12/13/2025 5:30 PM" - what driver entered
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  sentAt: number;                // ms timestamp when submitted
  packetTimestamp: string;       // "20251213_173045" for filename matching
  packetId: string;              // full unique ID (timestamp_wellName_randomSuffix) - stored in Excel column B
  status: 'sent' | 'edited';     // for future edit tracking
}

let cachedHistory: PullHistoryEntry[] = [];

/**
 * Load the retention days setting
 */
export async function loadHistoryDaysSetting(): Promise<number> {
  try {
    const saved = await AsyncStorage.getItem(SETTINGS_KEY);
    if (saved) {
      historyDays = parseInt(saved, 10);
    } else {
      historyDays = DEFAULT_HISTORY_DAYS;
    }
  } catch {
    historyDays = DEFAULT_HISTORY_DAYS;
  }
  return historyDays;
}

/**
 * Set the retention days, backfill if expanding, re-prune if shrinking
 */
export async function setHistoryDays(days: number): Promise<void> {
  const previousDays = historyDays;
  historyDays = days;
  await AsyncStorage.setItem(SETTINGS_KEY, String(days));

  if (days > previousDays) {
    // Expanding window — fetch older pulls from Firebase that we don't have locally
    console.log(`[PullHistory] Retention expanded ${previousDays} → ${days} days, backfilling from Firebase`);
    backfillAttempted = false; // Allow backfill since window expanded
    await loadPullHistory(); // Will detect expanded window and backfill
  } else {
    // Shrinking or same — just re-prune
    await loadPullHistory();
  }
}

/**
 * Get current retention days setting
 */
export function getHistoryDays(): number {
  return historyDays;
}

/**
 * Backfill pull history from packets/processed using driverId index.
 * Uses server-side orderBy("driverId") query — already indexed in RTDB.
 * Falls back to driverName query for older packets without driverId.
 */
async function backfillFromFirebase(): Promise<PullHistoryEntry[]> {
  try {
    const driverId = await getDriverId();
    if (!driverId) {
      console.log("[PullHistory] No driverId — can't backfill");
      return [];
    }

    console.log("[PullHistory] Backfilling from packets/processed for driver:", driverId.slice(0, 8) + "...");

    const cutoff = Date.now() - (historyDays * 24 * 60 * 60 * 1000);
    const entries: PullHistoryEntry[] = [];

    // Query packets/processed by driverId (server-side indexed)
    const url = `${FIREBASE_DATABASE_URL}/packets/processed.json?auth=${FIREBASE_API_KEY}&orderBy="driverId"&equalTo="${driverId}"`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      const data = await response.json();
      if (data && typeof data === "object") {
        for (const [packetId, packet] of Object.entries(data)) {
          const p = packet as any;
          if (p.requestType === "wellHistory" || p.requestType === "performanceReport") continue;
          if (p.wasEdited === true) continue;

          let sentAt = 0;
          if (p.dateTimeUTC) {
            const parsed = new Date(p.dateTimeUTC);
            if (!isNaN(parsed.getTime())) sentAt = parsed.getTime();
          }
          if (sentAt === 0 && p.dateTime) {
            const parsed = new Date(p.dateTime);
            if (!isNaN(parsed.getTime())) sentAt = parsed.getTime();
          }
          if (sentAt === 0) sentAt = Date.now();
          if (sentAt < cutoff) continue;

          const timestampMatch = packetId.match(/^(\d{8}_\d{6})/);
          const packetTimestamp = timestampMatch ? timestampMatch[1] : packetId;

          entries.push({
            id: packetId,
            wellName: p.wellName || "Unknown",
            dateTime: p.dateTime || new Date(sentAt).toLocaleString(),
            tankLevelFeet: typeof p.tankLevelFeet === "number" ? p.tankLevelFeet : 0,
            bblsTaken: typeof p.bblsTaken === "number" ? p.bblsTaken : 0,
            wellDown: p.wellDown === true,
            sentAt,
            packetTimestamp,
            packetId,
            status: p.requestType === "edit" ? "edited" : "sent",
          });
        }
      }
    }

    // Fallback: try driverName for older packets without driverId (e.g. WB T packets)
    if (entries.length === 0) {
      const driverName = await getDriverName();
      if (driverName) {
        console.log("[PullHistory] No driverId matches, trying driverName fallback:", driverName);
        const nameUrl = `${FIREBASE_DATABASE_URL}/packets/processed.json?auth=${FIREBASE_API_KEY}&orderBy="driverName"&equalTo="${encodeURIComponent(driverName)}"`;
        const nameResponse = await fetch(nameUrl, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (nameResponse.ok) {
          const nameData = await nameResponse.json();
          if (nameData && typeof nameData === "object") {
            for (const [packetId, packet] of Object.entries(nameData)) {
              const p = packet as any;
              if (p.requestType === "wellHistory" || p.requestType === "performanceReport") continue;
              if (p.wasEdited === true) continue;

              let sentAt = 0;
              if (p.dateTimeUTC) {
                const parsed = new Date(p.dateTimeUTC);
                if (!isNaN(parsed.getTime())) sentAt = parsed.getTime();
              }
              if (sentAt === 0) sentAt = Date.now();
              if (sentAt < cutoff) continue;

              const timestampMatch = packetId.match(/^(\d{8}_\d{6})/);
              const packetTimestamp = timestampMatch ? timestampMatch[1] : packetId;

              entries.push({
                id: packetId,
                wellName: p.wellName || "Unknown",
                dateTime: p.dateTime || new Date(sentAt).toLocaleString(),
                tankLevelFeet: typeof p.tankLevelFeet === "number" ? p.tankLevelFeet : 0,
                bblsTaken: typeof p.bblsTaken === "number" ? p.bblsTaken : 0,
                wellDown: p.wellDown === true,
                sentAt,
                packetTimestamp,
                packetId,
                status: "sent",
              });
            }
          }
        }
      }
    }

    // Sort newest first
    entries.sort((a, b) => b.sentAt - a.sentAt);

    console.log(`[PullHistory] Backfilled ${entries.length} pulls from Firebase (within ${historyDays} days)`);
    return entries;
  } catch (error) {
    console.error("[PullHistory] Backfill error:", error);
    return [];
  }
}

/**
 * Backfill from Firebase and merge with existing local history.
 * Deduplicates by packetId so we never get double entries.
 * Used when: (1) local history is empty, (2) retention window expanded.
 */
async function backfillAndMerge(): Promise<void> {
  const backfilled = await backfillFromFirebase();
  if (backfilled.length === 0) return;

  // Merge: use existing local entries as the base, add any Firebase entries we don't have
  const existingIds = new Set(cachedHistory.map(e => e.packetId || e.id));
  let addedCount = 0;

  for (const entry of backfilled) {
    if (!existingIds.has(entry.packetId)) {
      cachedHistory.push(entry);
      existingIds.add(entry.packetId);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    // Re-sort newest first
    cachedHistory.sort((a, b) => b.sentAt - a.sentAt);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    console.log(`[PullHistory] Merged ${addedCount} new pulls from Firebase (total: ${cachedHistory.length})`);
  }

  // Track what we've backfilled so we know if it needs expanding later
  await AsyncStorage.setItem(BACKFILLED_DAYS_KEY, String(historyDays));
}

/**
 * Load history from storage, prune entries older than configured days.
 * If local history is empty or retention window expanded, backfills from Firebase.
 */
export async function loadPullHistory(): Promise<PullHistoryEntry[]> {
  try {
    // Load retention setting if not loaded
    if (historyDays === DEFAULT_HISTORY_DAYS) {
      await loadHistoryDaysSetting();
    }

    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        cachedHistory = JSON.parse(stored);
      } catch (e) {
        console.log("[PullHistory] Corrupted JSON in storage, clearing");
        cachedHistory = [];
      }
    } else {
      cachedHistory = [];
    }

    // Prune entries older than configured days
    const cutoff = Date.now() - (historyDays * 24 * 60 * 60 * 1000);
    const beforeCount = cachedHistory.length;
    cachedHistory = cachedHistory.filter(entry => entry.sentAt >= cutoff);

    if (cachedHistory.length < beforeCount) {
      console.log(`[PullHistory] Pruned ${beforeCount - cachedHistory.length} old entries (>${historyDays} days)`);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    }

    // BACKFILL: Merge from Firebase every session to pick up cross-app pulls (WB T → WB M).
    // Deduplicates by packetId so safe to run every time. Once per session to avoid hammering Firebase.
    if (!backfillAttempted) {
      backfillAttempted = true;
      await backfillAndMerge();
    }

    return cachedHistory;
  } catch (error) {
    console.error("[PullHistory] Error loading:", error);
    cachedHistory = [];
    return cachedHistory;
  }
}

/**
 * Add a new pull to history (called after successful upload)
 */
export async function addPullToHistory(
  wellName: string,
  dateTime: string,
  tankLevelFeet: number,
  bblsTaken: number,
  wellDown: boolean,
  packetTimestamp: string,
  packetId: string
): Promise<void> {
  try {
    if (cachedHistory.length === 0) {
      await loadPullHistory();
    }

    const entry: PullHistoryEntry = {
      id: packetId,              // Use full packetId as unique identifier
      wellName,
      dateTime,
      tankLevelFeet,
      bblsTaken,
      wellDown,
      sentAt: Date.now(),
      packetTimestamp,
      packetId,                  // Store full packetId for edit lookup
      status: 'sent',
    };

    // Add to front (newest first)
    cachedHistory.unshift(entry);

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    console.log("[PullHistory] Added:", wellName, dateTime, "packetId:", packetId);
  } catch (error) {
    console.error("[PullHistory] Error adding:", error);
  }
}

/**
 * Add a pull to history only if not already present (dedup by packetId).
 * Used by backgroundSync to capture cross-app pulls (e.g. WB T pulls appearing in WB M).
 */
export async function addPullToHistoryIfNew(
  wellName: string,
  dateTime: string,
  tankLevelFeet: number,
  bblsTaken: number,
  wellDown: boolean,
  packetTimestamp: string,
  packetId: string
): Promise<void> {
  try {
    if (cachedHistory.length === 0) {
      await loadPullHistory();
    }

    // Already have this pull? Skip.
    if (cachedHistory.some(e => e.packetId === packetId || e.id === packetId)) return;

    await addPullToHistory(wellName, dateTime, tankLevelFeet, bblsTaken, wellDown, packetTimestamp, packetId);
    console.log("[PullHistory] Cross-app pull captured:", wellName, packetId);
  } catch (error) {
    console.error("[PullHistory] Error adding cross-app pull:", error);
  }
}

/**
 * Get history entries, optionally filtered by date range
 */
export async function getPullHistory(daysBack?: number): Promise<PullHistoryEntry[]> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }
  
  if (daysBack === undefined) {
    return cachedHistory;
  }
  
  const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
  return cachedHistory.filter(entry => entry.sentAt >= cutoff);
}

/**
 * Get history for today only
 */
export async function getTodaysPulls(): Promise<PullHistoryEntry[]> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startOfDay = today.getTime();
  
  return cachedHistory.filter(entry => entry.sentAt >= startOfDay);
}

/**
 * Parse dateTime string to Date object
 * Handles format: "12/20/2025 3:10 PM"
 */
function parseDateTimeString(dateTime: string): Date | null {
  try {
    // Try parsing as-is first
    const parsed = new Date(dateTime);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    // Manual parse for "M/D/YYYY H:MM AM/PM" format
    const match = dateTime.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (match) {
      const [, month, day, year, hour, minute, ampm] = match;
      let hours = parseInt(hour, 10);
      if (ampm) {
        if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
        if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
      }
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hours, parseInt(minute));
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get history grouped by day (for display)
 * Groups by the dateTime the driver entered, not when the packet was sent
 */
export async function getPullHistoryByDay(): Promise<{ date: string; pulls: PullHistoryEntry[] }[]> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }

  const grouped: { [key: string]: PullHistoryEntry[] } = {};

  for (const entry of cachedHistory) {
    // Use dateTime (what driver entered) instead of sentAt (when packet was sent)
    const date = parseDateTimeString(entry.dateTime) || new Date(entry.sentAt);
    const dateKey = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(entry);
  }

  // Convert to array, sorted by date (newest first)
  // Sort by parsing the date keys
  const sortedEntries = Object.entries(grouped).sort((a, b) => {
    const dateA = parseDateTimeString(a[1][0]?.dateTime) || new Date(a[1][0]?.sentAt || 0);
    const dateB = parseDateTimeString(b[1][0]?.dateTime) || new Date(b[1][0]?.sentAt || 0);
    return dateB.getTime() - dateA.getTime(); // Newest first
  });

  return sortedEntries.map(([date, pulls]) => ({ date, pulls }));
}

/**
 * Get a specific entry by ID (for future edit screen)
 */
export async function getPullById(id: string): Promise<PullHistoryEntry | null> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }
  
  return cachedHistory.find(entry => entry.id === id) || null;
}

/**
 * Update an entry after edit (updates all editable fields)
 */
export async function updatePullHistoryEntry(
  id: string,
  dateTime: string,
  tankLevelFeet: number,
  bblsTaken: number,
  wellDown: boolean
): Promise<void> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }

  const entry = cachedHistory.find(e => e.id === id || e.packetId === id);
  if (entry) {
    entry.dateTime = dateTime;
    entry.tankLevelFeet = tankLevelFeet;
    entry.bblsTaken = bblsTaken;
    entry.wellDown = wellDown;
    entry.status = 'edited';
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    console.log("[PullHistory] Updated entry:", id, "bbls:", bblsTaken);
  } else {
    console.warn("[PullHistory] Entry not found for update:", id);
  }
}

/**
 * Mark an entry as edited (legacy - use updatePullHistoryEntry instead)
 */
export async function markPullAsEdited(id: string): Promise<void> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }

  const entry = cachedHistory.find(e => e.id === id || e.packetId === id);
  if (entry) {
    entry.status = 'edited';
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
  }
}

/**
 * Clear all history (for testing/debug)
 */
export async function clearPullHistory(): Promise<void> {
  cachedHistory = [];
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * Debug: Get raw history data for inspection
 */
export async function debugGetRawHistory(): Promise<{
  storageKey: string;
  rawData: string | null;
  parsedCount: number;
  cachedCount: number;
  entries: { wellName: string; dateTime: string; sentAt: number }[];
}> {
  const rawData = await AsyncStorage.getItem(STORAGE_KEY);
  let parsed: PullHistoryEntry[] = [];
  try {
    if (rawData) {
      parsed = JSON.parse(rawData);
    }
  } catch (e) {
    // parse error
  }

  return {
    storageKey: STORAGE_KEY,
    rawData: rawData ? `${rawData.length} chars` : null,
    parsedCount: parsed.length,
    cachedCount: cachedHistory.length,
    entries: parsed.map(e => ({
      wellName: e.wellName,
      dateTime: e.dateTime,
      sentAt: e.sentAt,
    })),
  };
}

/**
 * Get total BBLs for today (for stats display)
 */
export async function getTodaysBblTotal(): Promise<number> {
  const todaysPulls = await getTodaysPulls();
  return todaysPulls.reduce((sum, entry) => sum + entry.bblsTaken, 0);
}

/**
 * Get pull count for today
 */
export async function getTodaysPullCount(): Promise<number> {
  const todaysPulls = await getTodaysPulls();
  return todaysPulls.length;
}

/**
 * Get today's stats (pulls and BBLs)
 */
export async function getTodayStats(): Promise<{ pulls: number; bbls: number }> {
  const todaysPulls = await getTodaysPulls();
  return {
    pulls: todaysPulls.length,
    bbls: todaysPulls.reduce((sum, entry) => sum + entry.bblsTaken, 0),
  };
}

/**
 * Get total BBLs and pull count for all history
 */
export async function getAllTimeStats(): Promise<{ pulls: number; bbls: number }> {
  const history = await loadPullHistory();
  return {
    pulls: history.length,
    bbls: history.reduce((sum, entry) => sum + entry.bblsTaken, 0),
  };
}

/**
 * Get stats grouped by day (for daily totals in history view)
 */
export async function getStatsByDay(): Promise<{ [date: string]: { pulls: number; bbls: number } }> {
  const history = await loadPullHistory();
  const statsByDay: { [date: string]: { pulls: number; bbls: number } } = {};

  for (const entry of history) {
    // Extract date from dateTime (format: "12/20/2025 2:17 PM")
    const datePart = entry.dateTime.split(' ')[0];
    if (!statsByDay[datePart]) {
      statsByDay[datePart] = { pulls: 0, bbls: 0 };
    }
    statsByDay[datePart].pulls++;
    statsByDay[datePart].bbls += entry.bblsTaken;
  }

  return statsByDay;
}

/**
 * Get stats for this week (Sunday to Saturday)
 */
export async function getThisWeekStats(): Promise<{ pulls: number; bbls: number }> {
  const history = await loadPullHistory();

  // Get start of this week (Sunday)
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const weekStart = startOfWeek.getTime();

  const weekPulls = history.filter(entry => entry.sentAt >= weekStart);
  return {
    pulls: weekPulls.length,
    bbls: weekPulls.reduce((sum, entry) => sum + entry.bblsTaken, 0),
  };
}

/**
 * Get stats for this month
 */
export async function getThisMonthStats(): Promise<{ pulls: number; bbls: number }> {
  const history = await loadPullHistory();

  // Get start of this month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStart = startOfMonth.getTime();

  const monthPulls = history.filter(entry => entry.sentAt >= monthStart);
  return {
    pulls: monthPulls.length,
    bbls: monthPulls.reduce((sum, entry) => sum + entry.bblsTaken, 0),
  };
}

/**
 * Get top wells by pull count or BBLs
 */
export async function getTopWells(
  limit: number = 5,
  sortBy: 'pulls' | 'bbls' = 'pulls'
): Promise<{ wellName: string; pulls: number; bbls: number; avgBbls: number }[]> {
  const history = await loadPullHistory();

  // Group by well
  const wellStats: { [wellName: string]: { pulls: number; bbls: number } } = {};

  for (const entry of history) {
    if (!wellStats[entry.wellName]) {
      wellStats[entry.wellName] = { pulls: 0, bbls: 0 };
    }
    wellStats[entry.wellName].pulls++;
    wellStats[entry.wellName].bbls += entry.bblsTaken;
  }

  // Convert to array with avgBbls
  const wellArray = Object.entries(wellStats).map(([wellName, stats]) => ({
    wellName,
    pulls: stats.pulls,
    bbls: stats.bbls,
    avgBbls: stats.pulls > 0 ? Math.round(stats.bbls / stats.pulls) : 0,
  }));

  // Sort and limit
  wellArray.sort((a, b) => sortBy === 'pulls' ? b.pulls - a.pulls : b.bbls - a.bbls);
  return wellArray.slice(0, limit);
}

/**
 * Get list of unique wells in history (for filter dropdown)
 */
export async function getUniqueWells(): Promise<string[]> {
  const history = await loadPullHistory();
  const wells = new Set<string>();

  for (const entry of history) {
    wells.add(entry.wellName);
  }

  // Sort alphabetically
  return Array.from(wells).sort();
}

/**
 * Get average BBLs per pull
 */
export async function getAverageBblsPerPull(): Promise<number> {
  const history = await loadPullHistory();
  if (history.length === 0) return 0;

  const totalBbls = history.reduce((sum, entry) => sum + entry.bblsTaken, 0);
  return Math.round(totalBbls / history.length);
}

/**
 * Get filtered history by well name
 */
export async function getPullHistoryByWell(wellName: string): Promise<PullHistoryEntry[]> {
  const history = await loadPullHistory();
  return history.filter(entry => entry.wellName === wellName);
}

/**
 * Get stats for a specific well
 */
export async function getWellStats(wellName: string): Promise<{
  pulls: number;
  bbls: number;
  avgBbls: number;
  avgLevel: number;
  lastPull: PullHistoryEntry | null;
}> {
  const wellPulls = await getPullHistoryByWell(wellName);

  if (wellPulls.length === 0) {
    return { pulls: 0, bbls: 0, avgBbls: 0, avgLevel: 0, lastPull: null };
  }

  const totalBbls = wellPulls.reduce((sum, entry) => sum + entry.bblsTaken, 0);
  const totalLevel = wellPulls.reduce((sum, entry) => sum + entry.tankLevelFeet, 0);

  return {
    pulls: wellPulls.length,
    bbls: totalBbls,
    avgBbls: Math.round(totalBbls / wellPulls.length),
    avgLevel: totalLevel / wellPulls.length,
    lastPull: wellPulls[0] || null, // Already sorted newest first
  };
}

export type DateFilter = 'today' | 'week' | 'month' | 'all';

/**
 * Get filtered history by date range
 */
export async function getFilteredHistory(
  dateFilter: DateFilter,
  wellFilter?: string
): Promise<PullHistoryEntry[]> {
  let history = await loadPullHistory();

  // Apply well filter
  if (wellFilter && wellFilter !== 'all') {
    history = history.filter(entry => entry.wellName === wellFilter);
  }

  // Apply date filter
  const now = new Date();
  let cutoff: number;

  switch (dateFilter) {
    case 'today':
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.getTime();
      break;
    case 'week':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      cutoff = startOfWeek.getTime();
      break;
    case 'month':
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      cutoff = startOfMonth.getTime();
      break;
    case 'all':
    default:
      return history;
  }

  return history.filter(entry => entry.sentAt >= cutoff);
}

/**
 * Get filtered history grouped by day
 */
export async function getFilteredHistoryByDay(
  dateFilter: DateFilter,
  wellFilter?: string
): Promise<{ date: string; pulls: PullHistoryEntry[] }[]> {
  const filtered = await getFilteredHistory(dateFilter, wellFilter);

  const grouped: { [key: string]: PullHistoryEntry[] } = {};

  for (const entry of filtered) {
    const date = parseDateTimeString(entry.dateTime) || new Date(entry.sentAt);
    const dateKey = date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(entry);
  }

  // Sort by date (newest first)
  const sortedEntries = Object.entries(grouped).sort((a, b) => {
    const dateA = parseDateTimeString(a[1][0]?.dateTime) || new Date(a[1][0]?.sentAt || 0);
    const dateB = parseDateTimeString(b[1][0]?.dateTime) || new Date(b[1][0]?.sentAt || 0);
    return dateB.getTime() - dateA.getTime();
  });

  return sortedEntries.map(([date, pulls]) => ({ date, pulls }));
}
