// src/services/systemLog.ts
// Remote system logging is gated: proposed RTDB rules deny driver writes
// to logs/system. Do not use API-key or throw-as-disabled paths.

import { debugLog } from "./debugLog";

export const SYSTEM_LOG_REMOTE_AVAILABLE = false;

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
 * Record a log entry locally. Remote push is governed-disabled.
 * Fire-and-forget — never throws, never reports a system outage.
 */
export async function systemLog(
  event: string,
  level: LogLevel = 'info',
  details?: string
): Promise<void> {
  const suffix = details ? `: ${details}` : '';
  debugLog(
    `[SystemLog] ${event}${suffix} (remote unavailable)`,
    level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info',
  );
}

/**
 * Fetch recent system logs. Remote fetch is gated — returns empty, not an outage.
 */
export async function fetchSystemLogs(_days: number = 7): Promise<SystemLogEntry[]> {
  debugLog('[SystemLog] Remote fetch unavailable', 'info');
  return [];
}

/**
 * Clean up old remote logs. Gated no-op — nothing is deleted remotely.
 */
export async function cleanupOldLogs(): Promise<number> {
  debugLog('[SystemLog] Remote cleanup unavailable', 'info');
  return 0;
}
