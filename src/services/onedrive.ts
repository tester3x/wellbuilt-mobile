// src/services/onedrive.ts
// Graph API version — app talks directly to OneDrive
// Writes to Incoming, reads from Outgoing, no ngrok, no Node server.

import { ensureAccessToken, getExistingToken } from "./auth";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

// Folder paths under your OneDrive root
// This is the SAME path Excel/WellBuilt uses via sync.
const DRIVE_INCOMING_PATH = "WellBuilt/Incoming";
const DRIVE_OUTGOING_PATH = "WellBuilt/Outgoing";

export interface TankPacket {
  packetId: string;
  wellName: string;
  dateTime: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown?: boolean;
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
  errorMessage?: string;
  lastPullDateTime?: string;
  lastPullBbls?: string;
  lastPullTopLevel?: string;     // Tank level before pull (from VBA column C)
  lastPullBottomLevel?: string;  // Tank level after pull (from VBA column E)
  wellDown?: boolean;
}

// --- helpers --------------------------------------------------------

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

// Build a Graph URL to upload/download a file by path
const buildDriveItemContentUrl = (drivePath: string, fileName: string) => {
  // Encode path but keep slashes
  const fullPath = `${drivePath}/${fileName}`;
  const encoded = encodeURI(fullPath); // encodes spaces, etc., but not '/'
  return `${GRAPH_BASE_URL}/me/drive/root:/${encoded}:/content`;
};

// --- PUSH: uploadTankPacket -----------------------------------------
// Called by HomeScreen & RecordScreen
// IMPORTANT: This uses ensureAccessToken which WILL prompt for sign-in.
// Only call this from user-initiated actions (button taps)!

export const uploadTankPacket = async (params: {
  wellName: string;
  dateTime: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown?: boolean;
}) => {
  const { wellName, dateTime, tankLevelFeet, bblsTaken, wellDown } = params;

  const now = new Date();
  const timestamp = buildTimestamp(now);

  const wellNameClean = wellName.replace(/\s+/g, "");
  const packetId = `${timestamp}_${wellNameClean}_${randomSuffix()}`;

  const packet: TankPacket = {
    packetId,
    wellName,
    dateTime,
    tankLevelFeet,
    bblsTaken,
    wellDown: wellDown || false,
  };

  // ✅ Get a real token via interactive/refresh flow
  const accessToken = await ensureAccessToken();

  const fileName = `pull_${timestamp}_${wellNameClean}.json`;
  const uploadUrl = buildDriveItemContentUrl(DRIVE_INCOMING_PATH, fileName);

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(packet, null, 2),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Graph upload failed (${response.status}): ${text || response.statusText}`
    );
  }

  // We don't really care about the returned metadata — just ensure it worked
  // and return the info HomeScreen/RecordScreen expect.
  return {
    fileName,
    packet,
    packetTimestamp: timestamp, // matches VBA's ExtractTimestampFromFilename
    packetId,                   // full unique ID (timestamp_wellName_randomSuffix) for edit lookup
    wellName: packet.wellName,
  };
};

export const uploadDefaultPacket = uploadTankPacket;

// --- PULL: fetchTankResponse + waitForTankResponse ------------------

/**
 * Fetch tank response - WILL prompt for sign-in if not logged in.
 * Use fetchTankResponseSilent for background operations.
 */
export const fetchTankResponse = async (
  wellName: string,
  packetTimestamp: string
): Promise<TankResponse | null> => {
  const accessToken = await ensureAccessToken();

  // VBA CreateResponseFile uses: response_<timestamp>_<wellName>.json
  const fileName = `response_${packetTimestamp}_${wellName}.json`;
  const downloadUrl = buildDriveItemContentUrl(DRIVE_OUTGOING_PATH, fileName);

  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    // Not there yet — Excel hasn't written the response
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Graph download failed (${response.status}): ${
        text || response.statusText
      }`
    );
  }

  const json = (await response.json()) as TankResponse;
  return json;
};

/**
 * Fetch tank response SILENTLY - does NOT prompt for sign-in.
 * Returns null if not logged in. Use this for background operations
 * that run on app startup or in intervals.
 * 
 * iOS blocks OAuth prompts that aren't triggered by user gesture,
 * so background operations must use this version.
 */
export const fetchTankResponseSilent = async (
  wellName: string,
  packetTimestamp: string
): Promise<TankResponse | null> => {
  const accessToken = await getExistingToken();
  
  // Not logged in - just return null, don't trigger auth
  if (!accessToken) {
    console.log("[OneDrive] fetchTankResponseSilent: No token, skipping");
    return null;
  }

  // VBA CreateResponseFile uses: response_<timestamp>_<wellName>.json
  const fileName = `response_${packetTimestamp}_${wellName}.json`;
  const downloadUrl = buildDriveItemContentUrl(DRIVE_OUTGOING_PATH, fileName);

  const response = await fetch(downloadUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    // Not there yet — Excel hasn't written the response
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Graph download failed (${response.status}): ${
        text || response.statusText
      }`
    );
  }

  const json = (await response.json()) as TankResponse;
  return json;
};

/**
 * Fetch ANY response file for a well (fallback when specific one is deleted)
 * VBA only keeps 1 response per well, so if a second pull comes before
 * the first response is fetched, the first response file gets deleted.
 */
export const fetchAnyResponseForWell = async (
  wellName: string
): Promise<TankResponse | null> => {
  const accessToken = await getExistingToken();
  if (!accessToken) return null;

  try {
    const listUrl = `${GRAPH_BASE_URL}/me/drive/root:/${encodeURI(DRIVE_OUTGOING_PATH)}:/children?$select=name,id`;
    const listResponse = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listResponse.ok) return null;

    const data = await listResponse.json();
    const files = data.value || [];

    const wellNameClean = wellName.replace(/\s+/g, "");
    const wellNameLower = wellName.toLowerCase();
    const wellNameCleanLower = wellNameClean.toLowerCase();

    const matchingFile = files.find((f: { name: string; id: string }) => {
      const nameLower = f.name.toLowerCase();
      if (!nameLower.startsWith("response_") || !nameLower.endsWith(".json")) {
        return false;
      }
      return nameLower.endsWith(`_${wellNameLower}.json`) ||
             nameLower.endsWith(`_${wellNameCleanLower}.json`);
    });

    if (!matchingFile) return null;

    const downloadUrl = `${GRAPH_BASE_URL}/me/drive/items/${matchingFile.id}/content`;
    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return null;

    return (await response.json()) as TankResponse;
  } catch (error) {
    console.log("[OneDrive] Error fetching any response for well:", error);
    return null;
  }
};

export const waitForTankResponse = async (
  wellName: string,
  packetTimestamp: string,
  maxWaitMs: number = 30000,
  pollIntervalMs: number = 2000
): Promise<TankResponse | null> => {
  const startTime = Date.now();
  let fallbackAttempted = false;

  while (Date.now() - startTime < maxWaitMs) {
    const response = await fetchTankResponse(wellName, packetTimestamp);
    if (response) {
      return response;
    }

    // After half the wait time, try fallback to any response for this well
    if (!fallbackAttempted && Date.now() - startTime > maxWaitMs / 2) {
      console.log("[OneDrive] Specific response not found, trying fallback...");
      const fallbackResponse = await fetchAnyResponseForWell(wellName);
      if (fallbackResponse) {
        console.log("[OneDrive] Found fallback response for well");
        return fallbackResponse;
      }
      fallbackAttempted = true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log("[OneDrive] Timeout reached, final fallback attempt...");
  return await fetchAnyResponseForWell(wellName);
};

// --- EDIT: uploadEditPacket -----------------------------------------
// Sends an edit packet to update an existing row in the Excel DB
// Uses the ORIGINAL packetTimestamp to identify the row to update

export interface EditPacket {
  packetId: string;           // Original packetId from the pull being edited
  requestType: 'edit';
  wellName: string;
  dateTime: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
}

export const uploadEditPacket = async (params: {
  originalPacketTimestamp: string;  // The original packet's timestamp (for finding the row)
  originalPacketId: string;         // The original packet's full ID
  wellName: string;
  dateTime: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
}) => {
  const { originalPacketTimestamp, originalPacketId, wellName, dateTime, tankLevelFeet, bblsTaken, wellDown } = params;

  const packet: EditPacket = {
    packetId: originalPacketId,
    requestType: 'edit',
    wellName,
    dateTime,
    tankLevelFeet,
    bblsTaken,
    wellDown,
  };

  // Get auth token
  const accessToken = await ensureAccessToken();

  // Edit files use "edit_" prefix with original timestamp
  const wellNameClean = wellName.replace(/\s+/g, "");
  const fileName = `edit_${originalPacketTimestamp}_${wellNameClean}.json`;
  const uploadUrl = buildDriveItemContentUrl(DRIVE_INCOMING_PATH, fileName);

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(packet, null, 2),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Graph upload failed (${response.status}): ${text || response.statusText}`
    );
  }

  return {
    fileName,
    packet,
    packetTimestamp: originalPacketTimestamp,
    wellName: packet.wellName,
  };
};
