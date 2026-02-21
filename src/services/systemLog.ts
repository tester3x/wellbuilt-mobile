// src/services/systemLog.ts
// Centralized system logging to Firebase - visible to admins
// Logs events like connectivity issues, errors, etc. from all devices

import * as Device from "expo-device";
import { getDriverName } from "./driverAuth";

// Firebase configuration
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

// Firebase path for system logs
const SYSTEM_LOGS_PATH = "logs/system";

// Log retention - auto-delete after 7 days (handled by cleanup)
const LOG_RETENTION_DAYS = 7;

export type LogLevel = 'info' | 'warn' | 'error';

export interface SystemLogEntry {
  id?: string;
  timestamp: number;
  level: LogLevel;
  event: string;
  details?: string;
  device: string;
  driver: string | null;
}

/**
 * Get device identifier for logs
 */
function getDeviceIdentifier(): string {
  const brand = Device.brand || 'Unknown';
  const model = Device.modelName || Device.modelId || 'Device';
  return `${brand} ${model}`;
}

/**
 * Push a log entry to Firebase
 * Fire-and-forget - doesn't throw on failure
 */
export async function systemLog(
  event: string,
  level: LogLevel = 'info',
  details?: string
): Promise<void> {
  try {
    const driverName = await getDriverName();
    const deviceId = getDeviceIdentifier();

    const entry: SystemLogEntry = {
      timestamp: Date.now(),
      level,
      event,
      details,
      device: deviceId,
      driver: driverName,
    };

    // Push to Firebase (fire-and-forget)
    const url = `${FIREBASE_DATABASE_URL}/${SYSTEM_LOGS_PATH}.json?auth=${FIREBASE_API_KEY}`;

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {
      // Silently fail - we can't log that logging failed
    });
  } catch {
    // Silently fail
  }
}

/**
 * Fetch recent system logs (for admin view)
 * Returns logs from the last N days, sorted newest first
 */
export async function fetchSystemLogs(days: number = 7): Promise<SystemLogEntry[]> {
  try {
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    // Fetch all logs (no orderBy to avoid needing Firebase index)
    const url = `${FIREBASE_DATABASE_URL}/${SYSTEM_LOGS_PATH}.json?auth=${FIREBASE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error('[SystemLog] Failed to fetch logs:', response.status);
      return [];
    }

    const data = await response.json();
    if (!data) return [];

    // Convert object to array with IDs, filter by cutoff time
    const logs: SystemLogEntry[] = Object.entries(data)
      .map(([id, entry]) => ({
        id,
        ...(entry as SystemLogEntry),
      }))
      .filter(log => log.timestamp >= cutoffTime);

    // Sort by timestamp descending (newest first)
    logs.sort((a, b) => b.timestamp - a.timestamp);

    return logs;
  } catch (error) {
    console.error('[SystemLog] Error fetching logs:', error);
    return [];
  }
}

/**
 * Clean up old logs (older than retention period)
 * Should be called periodically by admin
 */
export async function cleanupOldLogs(): Promise<number> {
  try {
    const cutoffTime = Date.now() - (LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    // Fetch all logs (no orderBy to avoid needing Firebase index)
    const url = `${FIREBASE_DATABASE_URL}/${SYSTEM_LOGS_PATH}.json?auth=${FIREBASE_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return 0;

    const data = await response.json();
    if (!data) return 0;

    // Find old logs and delete them
    const oldIds = Object.entries(data)
      .filter(([, entry]) => (entry as SystemLogEntry).timestamp < cutoffTime)
      .map(([id]) => id);

    for (const id of oldIds) {
      const deleteUrl = `${FIREBASE_DATABASE_URL}/${SYSTEM_LOGS_PATH}/${id}.json?auth=${FIREBASE_API_KEY}`;
      await fetch(deleteUrl, { method: 'DELETE' });
    }

    return oldIds.length;
  } catch (error) {
    console.error('[SystemLog] Error cleaning up logs:', error);
    return 0;
  }
}
