// src/services/pendingResponse.ts
// Stores pending response checks so they survive navigation/app restart
//
// IMPORTANT: Uses fetchTankResponseSilent which does NOT trigger sign-in.
// If user is not logged in, checks silently skip. This is intentional because
// iOS blocks OAuth prompts that aren't triggered by user gesture.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchTankResponseSilent, TankResponse } from "./firebase";

const STORAGE_KEY = "@wellbuilt_pending_responses";

export interface PendingResponse {
  wellName: string;
  packetTimestamp: string;
  createdAt: number;
  lastCheck: number;
}

// Get all pending responses
export async function getPendingResponses(): Promise<PendingResponse[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Add a pending response to check later
export async function addPendingResponse(wellName: string, packetTimestamp: string): Promise<void> {
  const pending = await getPendingResponses();
  
  // Don't add duplicates
  const exists = pending.some(p => p.packetTimestamp === packetTimestamp);
  if (exists) return;
  
  pending.push({
    wellName,
    packetTimestamp,
    createdAt: Date.now(),
    lastCheck: Date.now(),
  });
  
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  console.log("[PendingResponse] Added:", wellName, packetTimestamp);
}

// Remove a pending response (got the response or gave up)
export async function removePendingResponse(packetTimestamp: string): Promise<void> {
  const pending = await getPendingResponses();
  const filtered = pending.filter(p => p.packetTimestamp !== packetTimestamp);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  console.log("[PendingResponse] Removed:", packetTimestamp);
}

// Check all pending responses, return any that succeeded
// NOTE: Uses fetchTankResponseSilent - will NOT prompt for sign-in if not logged in
export async function checkPendingResponses(): Promise<{ pending: PendingResponse; response: TankResponse }[]> {
  const pending = await getPendingResponses();
  const results: { pending: PendingResponse; response: TankResponse }[] = [];
  const stillPending: PendingResponse[] = [];
  
  for (const p of pending) {
    // Skip if checked less than 5 mins ago
    if (Date.now() - p.lastCheck < 5 * 60 * 1000) {
      stillPending.push(p);
      continue;
    }
    
    // Skip if older than 24 hours - give up
    if (Date.now() - p.createdAt > 24 * 60 * 60 * 1000) {
      console.log("[PendingResponse] Expired, removing:", p.packetTimestamp);
      continue;
    }
    
    try {
      // Use silent version - won't trigger sign-in prompt
      const response = await fetchTankResponseSilent(p.wellName, p.packetTimestamp);
      if (response) {
        console.log("[PendingResponse] Got response for:", p.wellName);
        results.push({ pending: p, response });
      } else {
        // Still waiting (or not logged in), update lastCheck
        stillPending.push({ ...p, lastCheck: Date.now() });
      }
    } catch (err) {
      console.log("[PendingResponse] Error checking:", p.wellName, err);
      stillPending.push({ ...p, lastCheck: Date.now() });
    }
  }
  
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stillPending));
  return results;
}

// Clear all pending (for testing/reset)
export async function clearPendingResponses(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
