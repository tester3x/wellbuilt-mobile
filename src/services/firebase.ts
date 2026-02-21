// src/services/firebase.ts
// Firebase Realtime Database version - replaces OneDrive/Graph API
// Much simpler: no OAuth, no access tokens, just HTTP calls to Firebase

import { getDriverId, getDriverName } from './driverAuth';
import { loadWellConfig, WellConfigMap } from './wellConfig';

// *** FIREBASE PROJECT CONFIG ***
// WellBuilt Sync - Firebase Realtime Database
const FIREBASE_PROJECT_ID = "wellbuilt-sync";
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

// Collection paths (equivalent to OneDrive folders)
const COLL_INCOMING = "packets/incoming";
const COLL_OUTGOING = "packets/outgoing";
const INCOMING_VERSION_PATH = "packets/incoming_version";

// Reuse existing interfaces from onedrive.ts
export interface TankPacket {
  packetId: string;
  wellName: string;
  dateTimeUTC: string;        // ISO 8601 UTC timestamp for calculations (e.g., "2025-12-21T23:36:42.000Z")
  dateTime: string;           // Local display string for legacy/display (e.g., "12/21/2025 5:36 PM")
  timezone: string;           // IANA timezone where recorded (e.g., "America/Chicago")
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown?: boolean;
  driverId?: string;          // UUID of the driver who recorded this pull
  driverName?: string;        // Display name of the driver (for quick reference)
  predictedLevelInches?: number;  // What driver saw on pull form card - for performance tracking
}

export interface TankResponse {
  wellName: string;
  currentLevel: string;
  timeTillPull: string;
  nextPullTime: string;
  flowRate: string;
  bbls24hrs: string;
  status: string;
  timestamp: string;
  timestampUTC?: string;  // ISO 8601 UTC timestamp for calculations
  errorMessage?: string;
  lastPullDateTime?: string;
  lastPullDateTimeUTC?: string;
  lastPullBbls?: string;
  lastPullTopLevel?: string;
  lastPullBottomLevel?: string;
  wellDown?: boolean;
}

export interface EditPacket {
  packetId: string;
  requestType: "edit";
  wellName: string;
  dateTimeUTC: string;        // ISO 8601 UTC timestamp for calculations
  dateTime: string;           // Local display string for legacy/display
  timezone: string;           // IANA timezone where recorded
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  driverId?: string;          // UUID of the driver who submitted the edit
  driverName?: string;        // Display name of the driver
}

// --- Helpers --------------------------------------------------------

const pad = (n: number) => n.toString().padStart(2, "0");

const buildTimestamp = (date: Date) => {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
};

const randomSuffix = () => Math.random().toString(36).slice(2, 8);

// Build Firebase REST URL
const buildFirebaseUrl = (path: string, includeAuth = true) => {
  let url = `${FIREBASE_DATABASE_URL}/${path}.json`;
  if (includeAuth && FIREBASE_API_KEY) {
    url += `?auth=${FIREBASE_API_KEY}`;
  }
  return url;
};

// --- Firebase HTTP helpers -------------------------------------------

const firebaseGet = async (path: string): Promise<any> => {
  const url = buildFirebaseUrl(path);

  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Firebase GET failed (${response.status})`);
  }

  return response.json();
};

const firebasePut = async (path: string, data: any): Promise<void> => {
  const url = buildFirebaseUrl(path);

  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Firebase PUT failed (${response.status}): ${text}`);
  }
};

const firebaseDelete = async (path: string): Promise<void> => {
  const url = buildFirebaseUrl(path);

  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Firebase DELETE failed (${response.status})`);
  }
};

// VBA heartbeat timeout (2 minutes) - must match Cloud Function
const VBA_HEARTBEAT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Check if VBA/Excel is online by checking heartbeat timestamp
 * Returns true if online, false if offline or unknown
 */
export const isVbaOnline = async (): Promise<boolean> => {
  try {
    const heartbeat = await firebaseGet("status/excel_heartbeat");

    if (!heartbeat || !heartbeat.timestamp) {
      console.log("[VBA Status] No heartbeat found - VBA is offline");
      return false;
    }

    const heartbeatTime = new Date(heartbeat.timestamp).getTime();
    const now = Date.now();
    const age = now - heartbeatTime;

    const isOnline = age < VBA_HEARTBEAT_TIMEOUT_MS;
    console.log(`[VBA Status] Heartbeat age: ${Math.round(age / 1000)}s - ${isOnline ? "ONLINE" : "OFFLINE"}`);

    return isOnline;
  } catch (error) {
    console.error("[VBA Status] Error checking heartbeat:", error);
    return false;
  }
};

/**
 * Increment the incoming version counter
 * VBA polls this tiny number instead of the full incoming folder
 * Only when version changes does VBA fetch the actual packets
 * This reduces VBA's bandwidth by ~90% when idle
 */
const incrementIncomingVersion = async (): Promise<void> => {
  try {
    // Read current version
    const current = await firebaseGet(INCOMING_VERSION_PATH);
    const currentVersion = current ? parseInt(current, 10) : 0;

    // Write incremented version
    await firebasePut(INCOMING_VERSION_PATH, (currentVersion + 1).toString());
  } catch (error) {
    // Non-fatal - VBA will still work, just slightly less efficient
    console.log("[Firebase] Failed to increment incoming version:", error);
  }
};

// --- PUSH: uploadTankPacket -----------------------------------------
// Called by HomeScreen & RecordScreen
// NO AUTH PROMPT - Firebase uses API key, not OAuth!

export const uploadTankPacket = async (params: {
  wellName: string;
  dateTime: string;          // Local display string (legacy)
  dateTimeUTC: string;       // ISO 8601 UTC timestamp
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown?: boolean;
  predictedLevelInches?: number;  // What driver saw on pull form card - for performance tracking
}) => {
  const { wellName, dateTime, dateTimeUTC, tankLevelFeet, bblsTaken, wellDown, predictedLevelInches } = params;

  const now = new Date();
  const timestamp = buildTimestamp(now);

  const wellNameClean = wellName.replace(/\s+/g, "");
  const packetId = `${timestamp}_${wellNameClean}_${randomSuffix()}`;

  // Get device timezone (IANA format like "America/Chicago")
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get current driver info for "your pull" tracking
  const driverId = await getDriverId();
  const driverName = await getDriverName();

  const packet: TankPacket = {
    packetId,
    wellName,
    dateTimeUTC,              // ISO 8601 UTC - use for ALL calculations
    dateTime,                 // Local display string - for legacy/display only
    timezone,                 // Where the driver was when recording
    tankLevelFeet,
    bblsTaken,
    wellDown: wellDown || false,
    driverId: driverId || undefined,
    driverName: driverName || undefined,
    predictedLevelInches: predictedLevelInches ?? undefined, // What was displayed on pull form card
  };

  // Write to Firebase incoming collection
  // Use packetId as the key (like a filename)
  const uploadStart = Date.now();
  console.log(`[Packet] 🚀 UPLOADING at ${new Date().toLocaleTimeString()}:`, packetId);

  await firebasePut(`${COLL_INCOMING}/${packetId}`, packet);

  const uploadMs = Date.now() - uploadStart;
  console.log(`[Packet] ✅ UPLOADED in ${uploadMs}ms at ${new Date().toLocaleTimeString()}:`, packetId);

  // Increment version so VBA knows there's a new packet to process
  await incrementIncomingVersion();

  console.log("[Packet] Uploaded:", packetId, "by driver:", driverName || "unknown");

  return {
    fileName: `pull_${timestamp}_${wellNameClean}.json`, // For compatibility
    packet,
    packetTimestamp: timestamp,
    packetId,
    wellName: packet.wellName,
  };
};

// Alias for compatibility
export const uploadDefaultPacket = uploadTankPacket;

// --- PULL: fetchTankResponse ----------------------------------------

/**
 * Fetch tank response from Firebase
 * NO AUTH PROMPT - just direct HTTP call
 * Both Excel and Cloud Function fallback use the same format: response_<timestamp>_<wellName>
 */
export const fetchTankResponse = async (
  wellName: string,
  packetTimestamp: string,
  _packetId?: string  // No longer needed - Cloud Function uses same format as Excel
): Promise<TankResponse | null> => {
  try {
    const wellNameClean = wellName.replace(/\s+/g, "");

    // Both Excel and Cloud Function use same format: response_<timestamp>_<wellName>
    const responseId = `response_${packetTimestamp}_${wellNameClean}`;
    const data = await firebaseGet(`${COLL_OUTGOING}/${responseId}`);

    if (data) {
      console.log("[Packet] Response found:", responseId);
      return data as TankResponse;
    }

    return null;
  } catch (error) {
    console.log("[Firebase] fetchTankResponse error:", error);
    return null;
  }
};

/**
 * Silent version - same as regular since Firebase doesn't need OAuth
 */
export const fetchTankResponseSilent = fetchTankResponse;

/**
 * Fetch the MOST RECENT response for a well
 * Important: There may be multiple responses per well (from edits), we need the newest
 */
export const fetchAnyResponseForWell = async (
  wellName: string
): Promise<TankResponse | null> => {
  try {
    // Get all outgoing responses
    const data = await firebaseGet(COLL_OUTGOING);

    if (!data) {
      console.log("[Firebase] fetchAnyResponseForWell: No data in outgoing");
      return null;
    }

    const wellNameClean = wellName.replace(/\s+/g, "").toLowerCase();
    const wellNameLower = wellName.toLowerCase();

    console.log(`[Firebase] Searching for well "${wellName}" (clean: "${wellNameClean}")`);
    console.log(`[Firebase] Total keys in outgoing: ${Object.keys(data).length}`);

    // Find ALL responses for this well, then pick the most recent
    let mostRecentKey: string | null = null;
    let mostRecentTimestamp = 0;

    for (const key of Object.keys(data)) {
      const keyLower = key.toLowerCase();
      if (
        keyLower.includes(wellNameLower) ||
        keyLower.includes(wellNameClean)
      ) {
        console.log(`[Firebase] Found matching key: ${key}`);
        // Extract timestamp from key: response_YYYYMMDD_HHMMSS_WellName
        // Response IDs always start with "response_"
        const parts = key.split("_");
        if (parts.length >= 3) {
          // Expected format: response_YYYYMMDD_HHMMSS_WellName
          // parts[0] = "response", parts[1] = YYYYMMDD, parts[2] = HHMMSS
          const timestampStr = parts[1] + parts[2];
          const timestamp = parseInt(timestampStr, 10);
          // Only use if we got a valid number (not NaN)
          if (!isNaN(timestamp) && timestamp > mostRecentTimestamp) {
            mostRecentTimestamp = timestamp;
            mostRecentKey = key;
          } else if (!mostRecentKey) {
            // Invalid timestamp format but it's for our well, use as fallback
            mostRecentKey = key;
          }
        } else if (!mostRecentKey) {
          // Fallback if key format is unexpected
          mostRecentKey = key;
        }
      }
    }

    if (mostRecentKey) {
      console.log("[Firebase] Found most recent response:", mostRecentKey);
      const response = data[mostRecentKey] as TankResponse;
      console.log("[Firebase] Response wellName:", response.wellName, "level:", response.currentLevel);
      return response;
    }

    console.log(`[Firebase] No response found for well "${wellName}"`);
    console.log("[Firebase] Available keys:", Object.keys(data).slice(0, 20).join(", "));
    return null;
  } catch (error) {
    console.log("[Firebase] fetchAnyResponseForWell error:", error);
    return null;
  }
};

/**
 * Wait for Excel to process the packet and write a response
 * Polling is MUCH faster with Firebase (no sync delay)
 */
export const waitForTankResponse = async (
  wellName: string,
  packetTimestamp: string,
  maxWaitMs: number = 30000,
  pollIntervalMs: number = 1000 // Faster polling since Firebase is instant
): Promise<TankResponse | null> => {
  const startTime = Date.now();
  let fallbackAttempted = false;

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetchTankResponse(wellName, packetTimestamp);
    if (response) {
      return response;
    }

    // After half the wait time, try fallback
    if (!fallbackAttempted && Date.now() - startTime > maxWaitMs / 2) {
      const fallbackResponse = await fetchAnyResponseForWell(wellName);
      if (fallbackResponse) {
        return fallbackResponse;
      }
      fallbackAttempted = true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return await fetchAnyResponseForWell(wellName);
};

// --- EDIT: uploadEditPacket -----------------------------------------

export const uploadEditPacket = async (params: {
  originalPacketTimestamp: string;
  originalPacketId: string;
  wellName: string;
  dateTime: string;          // Local display string (legacy)
  dateTimeUTC: string;       // ISO 8601 UTC timestamp
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
}) => {
  const {
    originalPacketTimestamp,
    originalPacketId,
    wellName,
    dateTime,
    dateTimeUTC,
    tankLevelFeet,
    bblsTaken,
    wellDown,
  } = params;

  // Get device timezone (IANA format like "America/Chicago")
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get current driver info for tracking who made the edit
  const driverId = await getDriverId();
  const driverName = await getDriverName();

  const packet: EditPacket = {
    packetId: originalPacketId,
    requestType: "edit",
    wellName,
    dateTimeUTC,              // ISO 8601 UTC - use for ALL calculations
    dateTime,                 // Local display string - for legacy/display only
    timezone,                 // Where the driver was when recording
    tankLevelFeet,
    bblsTaken,
    wellDown,
    driverId: driverId || undefined,
    driverName: driverName || undefined,
  };

  // Edit packets use a different ID format
  const wellNameClean = wellName.replace(/\s+/g, "");
  const editId = `edit_${originalPacketTimestamp}_${wellNameClean}`;

  await firebasePut(`${COLL_INCOMING}/${editId}`, packet);

  // NOTE: Do NOT increment incoming_version here for edits.
  // The Cloud Function (processPacket) increments it AFTER writing the response.
  // If we increment here, the app's version watcher fires a sync before the
  // Cloud Function has processed the edit, causing a race condition where the
  // app syncs old data and misses the update.

  return {
    fileName: `${editId}.json`,
    packet,
    packetTimestamp: originalPacketTimestamp,
    wellName: packet.wellName,
  };
};

// --- Real-time listener (optional, for instant updates) -------------

/**
 * Subscribe to responses for a specific well
 * Uses Firebase REST streaming (Server-Sent Events)
 *
 * Note: This is optional - polling works fine and is simpler.
 * Use this if you want truly instant updates without polling.
 */
export const subscribeToWellResponses = (
  wellName: string,
  onResponse: (response: TankResponse) => void
): (() => void) => {
  const wellNameClean = wellName.replace(/\s+/g, "");

  // Firebase REST streaming URL
  const url = `${FIREBASE_DATABASE_URL}/${COLL_OUTGOING}.json?orderBy="wellName"&equalTo="${wellName}"`;

  // Note: React Native's fetch doesn't support SSE natively
  // You'd need to use a library like react-native-sse or
  // the Firebase SDK for true real-time. For now, this is a placeholder.
  // For MVP, stick with polling via waitForTankResponse

  return () => {};
};

// --- Fetch all outgoing responses ----------------------------------

/**
 * Fetch all response packets from Firebase outgoing folder
 * Used by manual refresh to get latest data for all wells
 */
export const fetchAllOutgoingResponses = async (): Promise<TankResponse[]> => {
  try {
    const data = await firebaseGet(COLL_OUTGOING);
    if (!data) return [];

    const responses: TankResponse[] = [];
    for (const key of Object.keys(data)) {
      if (key.startsWith("response_")) {
        responses.push(data[key] as TankResponse);
      }
    }

    return responses;
  } catch (error) {
    console.error("[Firebase] fetchAllOutgoingResponses error:", error);
    return [];
  }
};

// --- WELL HISTORY: Request historical data from Excel -------------

export interface WellHistoryRow {
  dateTime: string;
  dateTimeUTC: string;
  packetId: string;
  topLevel: string;           // Column C: Tank Top Level
  bbls: string;               // Column D: BBLs Taken
  bottomLevel: string;        // Column E: Tank After Feet
  timeDif: string;            // Column F: Time Dif (H:M) - time since last pull
  recoveryInches: string;     // Column G: Recovery Inches
  flowRate: string;           // Column H: 1' Flow Rate (H:M:S)
  bbls24hrs: string;          // BBLs produced in 24 hours (calculated from flow rate)
  recoveryNeeded: string;     // Column I: Recovery Needed Inches
  pulledBy: string;           // From Column B: Driver Name
  timeTillPull: string;       // Column J: Estimated Time to Full Pull
  nextPullTime: string;       // Column K: Estimated Date/Time for Full Pull
  // Edit tracking
  isEdit?: boolean;           // True if this row is an edit of another packet
  originalPacketId?: string;  // The packet this edit replaced
  originalData?: {            // Original values before edit (for comparison)
    topLevel?: string;
    bbls?: string;
    bottomLevel?: string;
    dateTime?: string;
  };
}

export interface WellHistoryResponse {
  wellName: string;
  rowCount: number;
  totalRows: number;            // Total rows available in the sheet (for enabling/disabling 35/50 buttons)
  rows: WellHistoryRow[];
  status: "success" | "error";
  errorMessage?: string;
  timestamp: string;
  timestampUTC: string;
}

/**
 * Request well history data directly from Firebase packets/processed
 * NO VBA DEPENDENCY - reads processed packets directly
 *
 * This replaces the old VBA-dependent version. History data comes from
 * packets that have been processed by the Cloud Function.
 *
 * Calculates derived fields (like Excel did):
 * - timeDif: time since previous pull
 * - recoveryInches: level rise since previous pull
 * - flowRate: time per foot of rise
 */
export const requestWellHistory = async (
  wellName: string,
  limit: number = 20
): Promise<WellHistoryResponse | null> => {
  console.log(`[WellHistory] Fetching history for ${wellName} from Firebase (limit: ${limit})`);

  try {
    // Fetch all processed packets AND well config for tank count
    const [processedData, wellConfig] = await Promise.all([
      firebaseGet("packets/processed"),
      firebaseGet(`well_config/${wellName}`)
    ]);

    if (!processedData) {
      console.log("[WellHistory] No processed packets found");
      return {
        wellName,
        rows: [],
        rowCount: 0,
        totalRows: 0,
        status: "success",
        errorMessage: undefined,
        timestamp: new Date().toLocaleString(),
        timestampUTC: new Date().toISOString(),
      };
    }

    // Get bblPerFoot from well config (tanks * 20)
    const numTanks = (wellConfig as any)?.numTanks || (wellConfig as any)?.tanks || 1;
    const bblPerFoot = numTanks * 20;
    const pullBbls = (wellConfig as any)?.pullBbls || 140;
    const allowedBottom = (wellConfig as any)?.allowedBottom || 3; // feet

    // Filter packets for this well and build raw data
    const wellNameLower = wellName.toLowerCase().replace(/\s+/g, "");
    interface RawPullData {
      dateTimeUTC: string;
      dateTime: string;
      packetId: string;
      levelFeet: number;
      bblsTaken: number;
      driverName: string;
      isEdit?: boolean;
      originalPacketId?: string;
      originalData?: {
        topLevel?: string;
        bbls?: string;
        bottomLevel?: string;
        dateTime?: string;
      };
    }
    const rawPulls: RawPullData[] = [];

    // Helper to format level
    const formatLevelStr = (feet: number): string => {
      const f = Math.floor(feet);
      const i = Math.round((feet - f) * 12);
      return `${f}'${i}"`;
    };

    for (const [packetId, packet] of Object.entries(processedData)) {
      const p = packet as any;

      // Skip non-pull packets (history requests, edits that were superseded, etc.)
      if (p.requestType === "wellHistory" || p.requestType === "performanceReport") continue;
      if (p.wasEdited === true) continue; // Skip original packets that were edited

      // Match well name (case-insensitive, ignore spaces)
      const packetWellName = (p.wellName || "").toLowerCase().replace(/\s+/g, "");
      if (packetWellName !== wellNameLower) continue;

      // Check if this is an edit and get original data
      // isEdit is set by Cloud Function; also check requestType for older packets
      const isEditPacket = p.isEdit === true || p.requestType === "edit";
      let originalData: RawPullData["originalData"] = undefined;
      if (isEditPacket && (p.originalPacketId || p.packetId)) {
        const origKey = p.originalPacketId || p.packetId;
        const origPacket = (processedData as any)[origKey];
        if (origPacket) {
          const origLevelFeet = origPacket.tankLevelFeet || 0;
          const origBbls = origPacket.bblsTaken || 0;
          const origBottomFeet = Math.max(origLevelFeet - (origBbls / bblPerFoot), 0);
          originalData = {
            topLevel: formatLevelStr(origLevelFeet),
            bbls: String(origBbls),
            bottomLevel: formatLevelStr(origBottomFeet),
            dateTime: origPacket.dateTime || origPacket.dateTimeUTC || "",
          };
        }
      }

      rawPulls.push({
        dateTimeUTC: p.dateTimeUTC || p.dateTime || "",
        dateTime: p.dateTime || p.dateTimeUTC || "",
        packetId,
        levelFeet: p.tankLevelFeet || 0,
        bblsTaken: p.bblsTaken || 0,
        driverName: p.driverName || "",
        isEdit: isEditPacket,
        originalPacketId: p.originalPacketId || (isEditPacket ? p.packetId : undefined),
        originalData,
      });
    }

    // Sort by date descending (newest first)
    rawPulls.sort((a, b) => {
      const dateA = new Date(a.dateTimeUTC).getTime();
      const dateB = new Date(b.dateTimeUTC).getTime();
      return dateB - dateA;
    });

    // Helper: format feet to feet'inches"
    const formatLevel = (feet: number): string => {
      const f = Math.floor(feet);
      const i = Math.round((feet - f) * 12);
      return `${f}'${i}"`;
    };

    // Helper: format days to H:M
    const formatTimeDif = (days: number): string => {
      if (days <= 0 || !isFinite(days)) return "-";
      const totalMinutes = Math.floor(days * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      return `${hours}:${mins.toString().padStart(2, "0")}`;
    };

    // Helper: format days-per-foot to H:M:S flow rate
    const formatFlowRate = (daysPerFoot: number): string => {
      if (daysPerFoot <= 0 || !isFinite(daysPerFoot)) return "-";
      const totalSeconds = Math.floor(daysPerFoot * 24 * 60 * 60);
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // Helper: Get the 6am-6am window end for a given timestamp
    // If timestamp is before 6am, window ends at 6am same day
    // If timestamp is 6am or after, window ends at 6am next day
    const getWindowEnd = (timestampMs: number): number => {
      const date = new Date(timestampMs);
      const hour = date.getHours();
      // Create 6am on the same day
      const sixAm = new Date(date);
      sixAm.setHours(6, 0, 0, 0);
      // If before 6am, window ends at 6am today; otherwise 6am tomorrow
      if (hour < 6) {
        return sixAm.getTime();
      } else {
        return sixAm.getTime() + 24 * 60 * 60 * 1000;
      }
    };

    // FIRST PASS: Calculate per-row flow rates (days per foot)
    interface RowWithFlowRate {
      index: number;
      dateTimeMs: number;
      windowEnd: number;
      flowRateDays: number; // days per foot, 0 if not calculable
      topLevelFeet: number;
      bottomLevelFeet: number;
      timeDif: string;
      recoveryInches: string;
      flowRate: string;
      recoveryNeeded: string;
    }
    const rowsWithFlow: RowWithFlowRate[] = [];

    for (let i = 0; i < rawPulls.length; i++) {
      const current = rawPulls[i];
      const previous = rawPulls[i + 1]; // older row (since sorted newest first)

      const currentTimeMs = new Date(current.dateTimeUTC).getTime();
      const topLevelFeet = current.levelFeet;
      const bottomLevelFeet = Math.max(topLevelFeet - (current.bblsTaken / bblPerFoot), 0);

      let timeDif = "-";
      let recoveryInches = "-";
      let flowRate = "-";
      let flowRateDays = 0;

      if (previous) {
        const previousTimeMs = new Date(previous.dateTimeUTC).getTime();

        if (!isNaN(currentTimeMs) && !isNaN(previousTimeMs) && currentTimeMs > previousTimeMs) {
          const timeDifDaysVal = (currentTimeMs - previousTimeMs) / (1000 * 60 * 60 * 24);
          timeDif = formatTimeDif(timeDifDaysVal);

          const prevBottomFeet = Math.max(previous.levelFeet - (previous.bblsTaken / bblPerFoot), 0);
          const recoveryFeet = topLevelFeet - prevBottomFeet;
          const recoveryInchesNum = recoveryFeet * 12;

          if (recoveryInchesNum > 0) {
            recoveryInches = Math.round(recoveryInchesNum).toString();
            flowRateDays = timeDifDaysVal / recoveryFeet;
            if (flowRateDays > 0 && flowRateDays < 365) {
              flowRate = formatFlowRate(flowRateDays);
            } else {
              flowRateDays = 0;
            }
          }
        }
      }

      const targetLevel = allowedBottom + (pullBbls / numTanks / 20);
      const recoveryNeededFeet = Math.max(targetLevel - bottomLevelFeet, 0);
      const recoveryNeeded = recoveryNeededFeet > 0 ? Math.round(recoveryNeededFeet * 12).toString() : "-";

      rowsWithFlow.push({
        index: i,
        dateTimeMs: currentTimeMs,
        windowEnd: isNaN(currentTimeMs) ? 0 : getWindowEnd(currentTimeMs),
        flowRateDays,
        topLevelFeet,
        bottomLevelFeet,
        timeDif,
        recoveryInches,
        flowRate,
        recoveryNeeded,
      });
    }

    // SECOND PASS: Group by 6am window and calculate average flow rate per window
    const windowFlowRates: Map<number, number[]> = new Map();
    for (const row of rowsWithFlow) {
      if (row.flowRateDays > 0) {
        const existing = windowFlowRates.get(row.windowEnd) || [];
        existing.push(row.flowRateDays);
        windowFlowRates.set(row.windowEnd, existing);
      }
    }

    // Calculate average flow rate per window -> BBLs/24hr
    const windowBbls24: Map<number, string> = new Map();
    for (const [windowEnd, flowRates] of windowFlowRates.entries()) {
      if (flowRates.length > 0) {
        const avgFlowRateDays = flowRates.reduce((a, b) => a + b, 0) / flowRates.length;
        const feetPer24hrs = 1 / avgFlowRateDays;
        const bbls24 = Math.round(feetPer24hrs * bblPerFoot);
        windowBbls24.set(windowEnd, bbls24.toString());
      }
    }

    // THIRD PASS: Build final rows with window-averaged BBLs/24hr
    const rows: WellHistoryRow[] = [];

    for (let i = 0; i < rawPulls.length; i++) {
      const current = rawPulls[i];
      const rowData = rowsWithFlow[i];

      // Get BBLs/24hr from window average (same for all rows in same window)
      const bbls24hrs = windowBbls24.get(rowData.windowEnd) || "-";

      rows.push({
        dateTime: current.dateTime,
        dateTimeUTC: current.dateTimeUTC,
        packetId: current.packetId,
        topLevel: formatLevel(rowData.topLevelFeet),
        bbls: String(current.bblsTaken),
        bottomLevel: formatLevel(rowData.bottomLevelFeet),
        timeDif: rowData.timeDif,
        recoveryInches: rowData.recoveryInches,
        flowRate: rowData.flowRate,
        bbls24hrs,
        recoveryNeeded: rowData.recoveryNeeded,
        pulledBy: current.driverName,
        timeTillPull: "-",  // Would need AFR calculation
        nextPullTime: "-",  // Would need AFR calculation
        // Edit tracking
        isEdit: current.isEdit,
        originalPacketId: current.originalPacketId,
        originalData: current.originalData,
      });
    }

    // Apply limit
    const limitedRows = rows.slice(0, limit);

    console.log(`[WellHistory] Found ${rows.length} total rows, returning ${limitedRows.length}`);

    return {
      wellName,
      rows: limitedRows,
      rowCount: limitedRows.length,
      totalRows: rows.length,
      status: "success",
      errorMessage: undefined,
      timestamp: new Date().toLocaleString(),
      timestampUTC: new Date().toISOString(),
    };
  } catch (error) {
    console.error("[WellHistory] Error fetching from Firebase:", error);
    return {
      wellName,
      rows: [],
      rowCount: 0,
      totalRows: 0,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Failed to fetch history",
      timestamp: new Date().toLocaleString(),
      timestampUTC: new Date().toISOString(),
    };
  }
};

/**
 * Wait for well history response from VBA
 */
const waitForWellHistoryResponse = async (
  wellName: string,
  maxWaitMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<WellHistoryResponse | null> => {
  const startTime = Date.now();
  const wellNameClean = wellName.replace(/\s+/g, "").toLowerCase();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Get all outgoing responses and look for history_* for this well
      const data = await firebaseGet(COLL_OUTGOING);

      if (data) {
        for (const key of Object.keys(data)) {
          if (key.startsWith("history_") && key.toLowerCase().includes(wellNameClean)) {
            const response = data[key] as WellHistoryResponse;
            console.log("[WellHistory] Response found:", key, `(${response.rowCount} rows)`);

            // Delete the response after reading (cleanup)
            await firebaseDelete(`${COLL_OUTGOING}/${key}`).catch(() => {});

            return response;
          }
        }
      }
    } catch (error) {
      console.log("[WellHistory] Poll error:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log("[WellHistory] Timeout waiting for response");
  return null;
};

// --- PERFORMANCE DATA: Derived from packets/processed (same source as well history) ---
// No separate cache — reads processed packets directly and extracts performance metrics.
// Each processed packet has: tankLevelFeet (actual), predictedLevelInches (what driver saw),
// dateTimeUTC, wellName. That's all we need to calculate accuracy.

// Raw row data - short keys: d=date, a=actual(inches), p=predicted(inches)
export interface RawPullData {
  d: string;      // date "yyyy-mm-dd"
  a: number;      // actual level in inches (what driver found)
  p: number;      // predicted level in inches (what driver saw on screen)
}

// Raw well data (built in-memory from packets/processed)
export interface RawWellData {
  wellName: string;
  totalPulls?: number;
  updated: string;
  rows: RawPullData[];
}

// Calculated pull with accuracy (computed client-side)
export interface PerformanceRow {
  date: string;           // "yyyy-mm-dd"
  dateObj: Date;          // For filtering
  actualInches: number;   // What driver found
  predictedInches: number; // Calculated from prevBottom + growth
  accuracy: number;       // 100 - abs((predicted - actual) / actual * 100)
  isAnomaly?: boolean;    // True if excluded from average calculation
}

// Calculated well stats (computed client-side from filtered rows)
export interface WellPerformance {
  wellName: string;
  totalPulls: number;     // Total pulls in Firebase
  filteredPulls: number;  // Pulls after date filter
  avgAccuracy: number;
  bestAccuracy: number;
  worstAccuracy: number;
  bestPullIndex: number;  // Index in rows array
  worstPullIndex: number; // Index in rows array
  trend: "improving" | "stable" | "declining";
  firstDate: string;
  lastDate: string;
  updated?: string;
  rows: PerformanceRow[];
  route?: string;         // Route name from well_config (for filtering Test Route etc.)
  anomalyCount?: number;  // Number of anomalous rows excluded from average
}

export interface PerformanceResponse {
  wellCount: number;
  wells: WellPerformance[];
  status: "success" | "error";
  errorMessage?: string;
  lastUpdated?: string;
}

// --- Helper functions for accuracy calculation ---

/**
 * Calculate accuracy as percentage of actual
 * Returns predicted/actual * 100
 * - 100% = perfect prediction
 * - >100% = over-predicted (e.g., 150% means predicted 50% too high)
 * - <100% = under-predicted (e.g., 98% means predicted 2% too low)
 */
const calculateAccuracy = (predictedInches: number, actualInches: number): number => {
  if (actualInches <= 0) return 0;
  return (predictedInches / actualInches) * 100;
};

/**
 * Normalize rows to array format
 * Handles arrays and objects (shouldn't happen anymore, but safe)
 */
const normalizeRows = (rows: RawPullData[] | Record<string, RawPullData> | undefined): RawPullData[] => {
  if (!rows) return [];
  if (Array.isArray(rows)) {
    return rows.filter((r): r is RawPullData => r != null);
  }
  return Object.values(rows).filter((r): r is RawPullData => r != null);
};

/**
 * Convert raw pull data to performance rows
 * predicted level is what the driver saw on screen (single source of truth)
 */
const processRawPulls = (rawRows: RawPullData[]): PerformanceRow[] => {
  // Filter: need date, actual > 0, and predicted > 0
  const filtered = rawRows.filter(row => row && row.d && row.a > 0 && row.p > 0);

  // Sort by date (oldest first) for consistent ordering
  const sorted = [...filtered].sort((a, b) => new Date(a.d).getTime() - new Date(b.d).getTime());

  return sorted.map((row) => {
    const accuracy = calculateAccuracy(row.p, row.a);

    // Parse date as LOCAL time (not UTC) to avoid timezone shift issues
    const [year, month, day] = row.d.split('-').map(Number);
    const localDate = new Date(year, month - 1, day); // month is 0-indexed

    return {
      date: row.d,
      dateObj: localDate,
      actualInches: row.a,
      predictedInches: row.p,
      accuracy: Math.round(accuracy * 10) / 10,
    };
  });
};

/**
 * Filter rows by date range
 * Note: toDate is treated as END of that day (inclusive)
 */
export const filterRowsByDate = (
  rows: PerformanceRow[],
  fromDate?: Date,
  toDate?: Date
): PerformanceRow[] => {
  // Normalize dates to start/end of day to avoid timezone issues
  // fromDate: start of day (00:00:00.000) - include the whole day
  // toDate: end of day (23:59:59.999) - include the whole day
  let fromDateStartOfDay: Date | undefined;
  let toDateEndOfDay: Date | undefined;

  if (fromDate) {
    fromDateStartOfDay = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0);
  }
  if (toDate) {
    toDateEndOfDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999);
  }

  return rows.filter(row => {
    if (fromDateStartOfDay && row.dateObj < fromDateStartOfDay) return false;
    if (toDateEndOfDay && row.dateObj > toDateEndOfDay) return false;
    return true;
  });
};

/**
 * Convert raw accuracy (predicted/actual*100) to "real" accuracy (how close to 100%)
 * - 100% raw → 100% real (perfect)
 * - 104% raw → 96% real (4% off - over-predicted)
 * - 96% raw → 96% real (4% off - under-predicted)
 * Both over and under predictions are treated equally as "off by X%"
 */
const getRealAccuracy = (rawAccuracy: number): number => {
  return 100 - Math.abs(100 - rawAccuracy);
};

// Anomaly threshold for performance calculation
// Rows with accuracy deviation > this % from median are excluded from average
const PERF_ANOMALY_THRESHOLD = 30; // 30% off = likely test/edit anomaly

/**
 * Filter out anomalous rows from performance calculation
 * Similar to AFR anomaly filtering - removes extreme outliers that would skew averages
 * Returns { filtered rows, anomaly count }
 */
/**
 * Mark anomalous rows and return valid rows for average calculation
 * Mutates the rows array to set isAnomaly flag on each row
 * Returns the non-anomalous rows for stats calculation
 */
const filterPerformanceAnomalies = (rows: PerformanceRow[]): {
  validRows: PerformanceRow[];
  anomalyCount: number;
} => {
  if (rows.length < 3) {
    // Not enough data to detect anomalies - mark all as valid
    rows.forEach(row => { row.isAnomaly = false; });
    return { validRows: rows, anomalyCount: 0 };
  }

  // Calculate median deviation from 100%
  const deviations = rows.map(r => Math.abs(100 - r.accuracy));
  const sortedDeviations = [...deviations].sort((a, b) => a - b);
  const medianDeviation = sortedDeviations[Math.floor(sortedDeviations.length / 2)];

  // Filter out rows where deviation is > ANOMALY_THRESHOLD% more than median
  // e.g., if median deviation is 5%, and threshold is 30%, filter out rows with >35% deviation
  const maxAllowedDeviation = medianDeviation + PERF_ANOMALY_THRESHOLD;

  const validRows: PerformanceRow[] = [];
  let anomalyCount = 0;

  rows.forEach(row => {
    const deviation = Math.abs(100 - row.accuracy);
    if (deviation <= maxAllowedDeviation) {
      row.isAnomaly = false;
      validRows.push(row);
    } else {
      row.isAnomaly = true;
      anomalyCount++;
    }
  });

  return { validRows, anomalyCount };
};

/**
 * Calculate stats from filtered rows
 * Note: avgAccuracy uses "real" accuracy (deviation from 100%)
 * Best/worst use raw accuracy but are determined by smallest/largest deviation
 *
 * ANOMALY FILTERING: Rows with extreme accuracy deviations are excluded from
 * average calculation (but still shown in detail view). This prevents test pulls
 * or edited packets from skewing the overall accuracy picture.
 */
const calculateStats = (rows: PerformanceRow[]): {
  avgAccuracy: number;
  bestAccuracy: number;
  worstAccuracy: number;
  bestPullIndex: number;
  worstPullIndex: number;
  trend: "improving" | "stable" | "declining";
  anomalyCount: number;
} => {
  if (rows.length === 0) {
    return {
      avgAccuracy: 0,
      bestAccuracy: 0,
      worstAccuracy: 0,
      bestPullIndex: -1,
      worstPullIndex: -1,
      trend: "stable",
      anomalyCount: 0,
    };
  }

  // Filter out anomalies for average calculation
  const { validRows, anomalyCount } = filterPerformanceAnomalies(rows);

  // Calculate average from non-anomalous rows only
  let totalRealAccuracy = 0;
  validRows.forEach((row) => {
    totalRealAccuracy += getRealAccuracy(row.accuracy);
  });
  const avgAccuracy = validRows.length > 0
    ? Math.round((totalRealAccuracy / validRows.length) * 10) / 10
    : 0;

  // Best/worst still use ALL rows (so user can see the full range)
  let smallestDeviation = Infinity;
  let largestDeviation = -1;
  let bestPullIndex = 0;
  let worstPullIndex = 0;

  rows.forEach((row, index) => {
    const deviation = Math.abs(100 - row.accuracy);

    if (deviation < smallestDeviation) {
      smallestDeviation = deviation;
      bestPullIndex = index;
    }
    if (deviation > largestDeviation) {
      largestDeviation = deviation;
      worstPullIndex = index;
    }
  });

  // Calculate trend using non-anomalous rows only
  const midpoint = Math.floor(validRows.length / 2);
  let firstHalfTotal = 0;
  let secondHalfTotal = 0;

  validRows.forEach((row, index) => {
    const realAccuracy = getRealAccuracy(row.accuracy);
    if (index < midpoint) {
      firstHalfTotal += realAccuracy;
    } else {
      secondHalfTotal += realAccuracy;
    }
  });

  const firstHalfAvg = midpoint > 0 ? firstHalfTotal / midpoint : 0;
  const secondHalfCount = validRows.length - midpoint;
  const secondHalfAvg = secondHalfCount > 0 ? secondHalfTotal / secondHalfCount : 0;

  let trend: "improving" | "stable" | "declining" = "stable";
  if (secondHalfAvg > firstHalfAvg + 2) {
    trend = "improving";
  } else if (secondHalfAvg < firstHalfAvg - 2) {
    trend = "declining";
  }

  return {
    avgAccuracy,
    bestAccuracy: Math.round(rows[bestPullIndex].accuracy * 10) / 10,
    worstAccuracy: Math.round(rows[worstPullIndex].accuracy * 10) / 10,
    bestPullIndex,
    worstPullIndex,
    trend,
    anomalyCount,
  };
};

// Number of recent pulls to average for rolling flow rate calculation
const FLOW_RATE_WINDOW = 5;

/**
 * Intermediate packet data for prediction calculation.
 * Captures enough info per pull to derive predictions from the sequence.
 */
interface PullPacket {
  dateTimeUTC: string;
  timestampMs: number;
  topLevelFeet: number;
  bblsTaken: number;
  predictedLevelInches?: number; // Present on newer packets (app sends it)
}

/**
 * Extract performance rows from a chronological sequence of pull packets.
 *
 * For packets WITH predictedLevelInches → use it (what driver saw on screen).
 * For packets WITHOUT → calculate predicted level from previous pull's bottom
 * level projected forward using a rolling average flow rate.
 *
 * The first pull is always skipped (no previous data to predict from).
 */
const buildPerformanceRows = (
  pulls: PullPacket[],
  bblPerFoot: number
): RawPullData[] => {
  if (pulls.length < 2) return [];

  const rows: RawPullData[] = [];

  // Rolling flow rate buffer: last N growth rates (feet/day)
  const recentGrowthRates: number[] = [];

  for (let i = 1; i < pulls.length; i++) {
    const prev = pulls[i - 1];
    const curr = pulls[i];

    const actualInches = Math.floor(curr.topLevelFeet * 12);
    if (actualInches <= 0) continue;

    // Date string for this pull
    const pullDate = new Date(curr.timestampMs);
    const dateStr = `${pullDate.getFullYear()}-${String(pullDate.getMonth() + 1).padStart(2, "0")}-${String(pullDate.getDate()).padStart(2, "0")}`;

    // Previous bottom level (after removing BBLs)
    const prevBottomFeet = Math.max(prev.topLevelFeet - (prev.bblsTaken / bblPerFoot), 0);

    // Time between pulls (days)
    const timeDiffDays = (curr.timestampMs - prev.timestampMs) / (1000 * 60 * 60 * 24);

    // Update rolling growth rate from actual data
    if (timeDiffDays > 0) {
      const growthFeet = curr.topLevelFeet - prevBottomFeet;
      if (growthFeet > 0) {
        const feetPerDay = growthFeet / timeDiffDays;
        recentGrowthRates.push(feetPerDay);
        if (recentGrowthRates.length > FLOW_RATE_WINDOW) {
          recentGrowthRates.shift();
        }
      }
    }

    // Determine predicted level
    let predictedInches: number;

    if (curr.predictedLevelInches !== undefined && curr.predictedLevelInches !== null) {
      // New packet — use what the driver actually saw
      predictedInches = Math.floor(Number(curr.predictedLevelInches));
    } else if (recentGrowthRates.length > 0 && timeDiffDays > 0) {
      // Old packet — calculate from previous bottom + rolling flow rate
      const avgFeetPerDay = recentGrowthRates.reduce((s, r) => s + r, 0) / recentGrowthRates.length;
      const predictedGrowthFeet = avgFeetPerDay * timeDiffDays;
      const predictedFeet = prevBottomFeet + predictedGrowthFeet;
      predictedInches = Math.floor(predictedFeet * 12);
    } else {
      // Not enough data yet — skip this pull
      continue;
    }

    if (predictedInches <= 0) continue;

    rows.push({
      d: dateStr,
      a: actualInches,
      p: predictedInches,
    });
  }

  return rows;
};

/**
 * Extract all pull packets from processedData, grouped by well name.
 * Returns sorted arrays of PullPacket per well, plus metadata.
 */
const extractPullsByWell = (processedData: any): {
  wellPulls: Map<string, PullPacket[]>;
  latestProcessedAt: string;
} => {
  const wellPulls = new Map<string, PullPacket[]>();
  let latestProcessedAt = "";

  for (const [, packet] of Object.entries(processedData)) {
    const p = packet as any;

    // Skip non-pull packets
    if (p.requestType === "wellHistory" || p.requestType === "performanceReport") continue;
    if (p.wasEdited === true) continue;
    if (!p.wellName || !p.tankLevelFeet) continue;

    const dateTimeStr = p.dateTimeUTC || p.dateTime || "";
    if (!dateTimeStr) continue;

    const ts = new Date(dateTimeStr).getTime();
    if (isNaN(ts)) continue;

    const wellName = p.wellName as string;

    if (!wellPulls.has(wellName)) {
      wellPulls.set(wellName, []);
    }

    wellPulls.get(wellName)!.push({
      dateTimeUTC: dateTimeStr,
      timestampMs: ts,
      topLevelFeet: parseFloat(p.tankLevelFeet) || 0,
      bblsTaken: parseFloat(p.bblsTaken) || 0,
      predictedLevelInches: p.predictedLevelInches,
    });

    if (p.processedAt && p.processedAt > latestProcessedAt) {
      latestProcessedAt = p.processedAt;
    }
  }

  // Sort each well's pulls chronologically
  for (const pulls of wellPulls.values()) {
    pulls.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  return { wellPulls, latestProcessedAt };
};

/**
 * Get performance data by reading directly from packets/processed
 * Same data source as well history — no separate cache needed.
 *
 * For newer packets: uses predictedLevelInches (what driver saw on screen).
 * For older packets: calculates prediction from previous bottom level + rolling flow rate.
 * Supports all date ranges: 30D, 90D, 1Y, All.
 */
export const getPerformanceData = async (
  fromDate?: Date,
  toDate?: Date
): Promise<PerformanceResponse> => {
  try {
    console.log("[Performance] Reading from packets/processed...");

    // Fetch processed packets AND well config in parallel
    const [processedData, wellConfig] = await Promise.all([
      firebaseGet("packets/processed"),
      loadWellConfig(),
    ]);

    if (!processedData) {
      return {
        wellCount: 0,
        wells: [],
        status: "error",
        errorMessage: "No processed packets found. Pull data will appear here after drivers submit pulls.",
      };
    }

    // Extract and group packets by well
    const { wellPulls, latestProcessedAt } = extractPullsByWell(processedData);

    // Build WellPerformance for each well
    const wells: WellPerformance[] = [];

    for (const [wellName, pulls] of wellPulls) {
      // Get bblPerFoot from well config (tanks * 20)
      const config = wellConfig?.[wellName];
      const numTanks = (config as any)?.numTanks || (config as any)?.tanks || 1;
      const bblPerFoot = numTanks * 20;
      const route = config?.route || undefined;

      // Build performance rows (handles both old and new packets)
      const rawRows = buildPerformanceRows(pulls, bblPerFoot);
      const allRows = processRawPulls(rawRows);

      // Sort by date (oldest first for trend calc)
      allRows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

      // Apply date filter
      const filteredRows = filterRowsByDate(allRows, fromDate, toDate);

      // Skip wells with no data in range
      if (filteredRows.length === 0) continue;

      // Calculate stats from filtered rows
      const stats = calculateStats(filteredRows);

      // Reverse for display (newest first)
      const displayRows = [...filteredRows].reverse();

      wells.push({
        wellName,
        totalPulls: allRows.length,
        filteredPulls: filteredRows.length,
        avgAccuracy: stats.avgAccuracy,
        bestAccuracy: stats.bestAccuracy,
        worstAccuracy: stats.worstAccuracy,
        bestPullIndex: stats.bestPullIndex,
        worstPullIndex: stats.worstPullIndex,
        trend: stats.trend,
        firstDate: filteredRows[0]?.date || "",
        lastDate: filteredRows[filteredRows.length - 1]?.date || "",
        rows: displayRows,
        route,
        anomalyCount: stats.anomalyCount,
      });
    }

    console.log("[Performance] Built from packets/processed:", wells.length, "wells,",
      wells.reduce((sum, w) => sum + w.filteredPulls, 0), "total pulls");

    return {
      wellCount: wells.length,
      wells,
      status: "success",
      lastUpdated: latestProcessedAt,
    };
  } catch (error) {
    console.error("[Performance] Error reading data:", error);
    return {
      wellCount: 0,
      wells: [],
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Failed to read performance data",
    };
  }
};

/**
 * Get raw performance data for a single well
 * Reads from packets/processed, calculates predictions for old packets
 */
export const getRawWellData = async (wellName: string): Promise<RawWellData | null> => {
  try {
    console.log("[Performance] Reading packets/processed for:", wellName);

    const [processedData, wellConfig] = await Promise.all([
      firebaseGet("packets/processed"),
      loadWellConfig(),
    ]);
    if (!processedData) return null;

    const { wellPulls, latestProcessedAt } = extractPullsByWell(processedData);

    // Find this well's pulls (case-insensitive match)
    const wellNameLower = wellName.toLowerCase().replace(/\s+/g, "");
    let pulls: PullPacket[] | undefined;
    let matchedName = wellName;

    for (const [name, p] of wellPulls) {
      if (name.toLowerCase().replace(/\s+/g, "") === wellNameLower) {
        pulls = p;
        matchedName = name;
        break;
      }
    }

    if (!pulls || pulls.length < 2) return null;

    // Get bblPerFoot
    const config = wellConfig?.[matchedName];
    const numTanks = (config as any)?.numTanks || (config as any)?.tanks || 1;
    const bblPerFoot = numTanks * 20;

    const rows = buildPerformanceRows(pulls, bblPerFoot);
    if (rows.length === 0) return null;

    return {
      wellName: matchedName,
      totalPulls: rows.length,
      updated: latestProcessedAt,
      rows,
    };
  } catch (error) {
    console.error("[Performance] Error reading well:", error);
    return null;
  }
};

/**
 * Get processed performance data for a single well with date filtering
 * Reads from packets/processed (same source as history)
 */
export const getWellPerformance = async (
  wellName: string,
  fromDate?: Date,
  toDate?: Date
): Promise<WellPerformance | null> => {
  try {
    const rawWell = await getRawWellData(wellName);
    if (!rawWell) {
      console.log("[Performance] No data for well:", wellName);
      return null;
    }

    const allRows = processRawPulls(normalizeRows(rawWell.rows));
    allRows.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    const filteredRows = filterRowsByDate(allRows, fromDate, toDate);
    if (filteredRows.length === 0) return null;

    const stats = calculateStats(filteredRows);
    const displayRows = [...filteredRows].reverse();

    const wellConfig = await loadWellConfig();
    const config = wellConfig?.[wellName];
    const route = config?.route || undefined;

    return {
      wellName,
      totalPulls: allRows.length,
      filteredPulls: filteredRows.length,
      avgAccuracy: stats.avgAccuracy,
      bestAccuracy: stats.bestAccuracy,
      worstAccuracy: stats.worstAccuracy,
      bestPullIndex: stats.bestPullIndex,
      worstPullIndex: stats.worstPullIndex,
      trend: stats.trend,
      firstDate: filteredRows[0]?.date || "",
      lastDate: filteredRows[filteredRows.length - 1]?.date || "",
      updated: rawWell.updated,
      rows: displayRows,
      route,
      anomalyCount: stats.anomalyCount,
    };
  } catch (error) {
    console.error("[Performance] Error reading well:", error);
    return null;
  }
};

// --- Test connection ------------------------------------------------

export const testFirebaseConnection = async (): Promise<boolean> => {
  try {
    const url = buildFirebaseUrl("");
    const response = await fetch(url);
    return response.ok;
  } catch (error) {
    console.error("[Firebase] Connection test failed:", error);
    return false;
  }
};
