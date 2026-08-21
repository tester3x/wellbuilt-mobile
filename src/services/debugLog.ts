// Debug logging service - stores logs in memory for viewing in-app
// Auto-flushes to Firebase when app goes to background

import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_FLUSH_KEY = '@wellbuilt_debug_last_flush';

/** Remote debug flush is gated — proposed rules deny logs/debug writes. */
export const DEBUG_LOG_REMOTE_AVAILABLE = false;

interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error';
  message: string;
}

const MAX_LOGS = 200;
const logs: LogEntry[] = [];

export function debugLog(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const entry: LogEntry = {
    timestamp: new Date(),
    level,
    message,
  };

  logs.unshift(entry); // Add to beginning

  // Keep only last MAX_LOGS
  if (logs.length > MAX_LOGS) {
    logs.pop();
  }

  // Also log to console
  const prefix = `[${entry.timestamp.toLocaleTimeString()}]`;
  if (level === 'error') {
    console.error(prefix, message);
  } else if (level === 'warn') {
    console.warn(prefix, message);
  } else {
    console.log(prefix, message);
  }
}

export function getLogs(): LogEntry[] {
  return [...logs];
}

export function clearLogs() {
  logs.length = 0;
}

export function getLogsAsText(): string {
  return logs.map(l => {
    const time = l.timestamp.toLocaleTimeString();
    const levelTag = l.level === 'error' ? '[ERR]' : l.level === 'warn' ? '[WARN]' : '[INFO]';
    return `${time} ${levelTag} ${l.message}`;
  }).join('\n');
}

/**
 * Flush current in-memory logs to Firebase.
 * Stores at: logs/debug/{driverName}/{yyyy-mm-dd}/{pushId}
 * Only sends if there are warn/error logs (skips if only info).
 * Fire-and-forget — never throws.
 */
export async function flushLogsToFirebase(): Promise<boolean> {
  try {
    if (!DEBUG_LOG_REMOTE_AVAILABLE) {
      debugLog('[DebugLog] Remote flush unavailable', 'info');
      return false;
    }

    if (logs.length === 0) return false;

    // Only send if there's something interesting (warn or error)
    const hasNotableEntries = logs.some(l => l.level === 'warn' || l.level === 'error');
    if (!hasNotableEntries) {
      console.log('[DebugLog] No warn/error entries — skipping flush');
      return false;
    }

    // Governed disable: do not write logs/debug with an API key.
    debugLog('[DebugLog] Remote flush unavailable', 'info');
    return false;
  } catch {
    return false;
  }
}

/**
 * Auto-flush if we haven't flushed today.
 * Called when app goes to background — only sends once per day
 * unless there are new error-level entries.
 */
export async function autoFlushIfNeeded(): Promise<void> {
  try {
    const lastFlush = await AsyncStorage.getItem(LAST_FLUSH_KEY);
    const today = new Date().toISOString().split('T')[0];

    const hasErrors = logs.some(l => l.level === 'error');

    if (lastFlush) {
      const lastFlushDate = lastFlush.split('T')[0];
      // Already flushed today — only re-flush if there are new errors
      if (lastFlushDate === today && !hasErrors) {
        return;
      }
    }

    await flushLogsToFirebase();
  } catch {
    // Silently fail
  }
}
