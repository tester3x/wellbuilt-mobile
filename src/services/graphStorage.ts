// src/services/graphStorage.ts
import { ensureAccessToken } from "./auth";

// Base OneDrive paths for your WellBuilt folders
// These are from the ROOT of your personal OneDrive.
// Adjust if your actual path is slightly different.
const BASE_FOLDER = "Gabriel Tank Levels/Tank Level Update wip";
const INCOMING_FOLDER = `${BASE_FOLDER}/Incoming`;
const OUTGOING_FOLDER = `${BASE_FOLDER}/Outgoing`;

// Helper: encode each path segment but keep the folder structure
function buildDriveItemContentUrl(path: string): string {
  const segments = path.split("/").map(encodeURIComponent).join("/");
  return `https://graph.microsoft.com/v1.0/me/drive/root:/${segments}:/content`;
}

/**
 * Upload a JSON packet into the Incoming folder.
 * fileName should be something like `${packetId}.json`
 */
export async function uploadPacketToIncoming(
  packet: unknown,
  fileName: string
): Promise<void> {
  const accessToken = await ensureAccessToken();

  const json = JSON.stringify(packet, null, 2);
  const path = `${INCOMING_FOLDER}/${fileName}`;
  const url = buildDriveItemContentUrl(path);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: json,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Graph upload failed (${response.status} ${response.statusText}) ${text}`.trim()
    );
  }
}

/**
 * Try to read a JSON response packet from the Outgoing folder.
 * Returns null if the file isn't there yet (404).
 */
export async function tryGetResponseFromOutgoing<T = unknown>(
  fileName: string
): Promise<T | null> {
  const accessToken = await ensureAccessToken();

  const path = `${OUTGOING_FOLDER}/${fileName}`;
  const url = buildDriveItemContentUrl(path);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    // WellBuilt hasn't written the response yet
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Graph download failed (${response.status} ${response.statusText}) ${text}`.trim()
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Outgoing response is not valid JSON.");
  }
}
