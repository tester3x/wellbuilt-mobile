// src/services/pullHistory.ts
// Stores history of pull packets sent by driver for reference/timesheet/edit
// Configurable retention period, auto-prunes on load
// Falls back to Firebase packets/processed if local data is missing (e.g. after reinstall)

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getDriverId, getDriverName } from "./driverAuth";
import { packetShowsEditBadge } from "./editMarkers";
import { normalizeTrustedHistoryIds, pullBelongsToDriver } from "./trustedHistoryKeys";

const STORAGE_KEY = "@wellbuilt_pull_history";
const SETTINGS_KEY = "@wellbuilt_pull_history_days";
const BACKFILLED_DAYS_KEY = "@wellbuilt_pull_history_backfilled_days";
const DEFAULT_HISTORY_DAYS = 7;

// Firebase config (same as firebase.ts)
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

let historyDays = DEFAULT_HISTORY_DAYS;
let backfillAttempted = false; // Only kick off the once-per-session backfill once

/**
 * PRODUCTION STARTUP-HANG FIX (packets/processed company-scan).
 *
 * The company-wide `packets/processed.json?orderBy="companyId"&equalTo=…` scan
 * is large and, on a cold start, used to be `await`ed on the very path a screen
 * needs for its first render (loadPullHistory → backfillAndMerge → backfillFrom
 * Firebase → bare `await fetch(url)` with NO timeout). That hung Pull History and
 * any startup caller for minutes.
 *
 * The rules now:
 *  1. loadPullHistory()/getPullHistory() return LOCAL (pruned) history WITHOUT
 *     waiting on the network backfill. The backfill is fire-and-forget.
 *  2. The fetch has a bounded AbortController timeout; a timeout NEVER throws into
 *     the caller and NEVER loses local history.
 *  3. Single-flight: a module-level in-flight promise means only one company scan
 *     runs at a time — concurrent callers share it (or skip via backfillAttempted).
 *  4. Failure modes are classified DISTINCTLY (offline / auth / permission /
 *     timeout / server / error) and bounded-backoff retried (retryable ones only);
 *     local history is preserved on every one of them.
 */
export type BackfillStatus =
  | 'idle'        // never attempted this session
  | 'ok'          // scan completed (merged if any new/updated)
  | 'offline'     // device reported no connectivity — scan not attempted
  | 'auth'        // no/expired session token, missing companyId, or HTTP 401
  | 'permission'  // HTTP 403 — server refused the read
  | 'timeout'     // AbortController fired before the scan returned
  | 'server'      // HTTP 5xx
  | 'error';      // other network/transport error (retryable)

interface BackfillResult {
  status: BackfillStatus;
  entries: PullHistoryEntry[]; // only meaningful when status === 'ok'
}

// Bounded timeout for the company-wide processed scan (abortable, never blocks render).
let BACKFILL_TIMEOUT_MS = 12000; // 12s — inside the 10–15s band
// Bounded backoff for RETRYABLE failures. NEVER a busy loop; empty = no retry.
let BACKFILL_BACKOFF_MS = [3000, 8000, 15000];
const RETRYABLE: BackfillStatus[] = ['offline', 'timeout', 'server', 'error'];

let lastBackfillStatus: BackfillStatus = 'idle';
// SINGLE-FLIGHT guard: the one in-flight company scan, shared by all callers.
let backfillInFlight: Promise<BackfillStatus> | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => {
  // unref so a pending backoff sleep never keeps the process/Jest worker alive.
  (setTimeout(resolve, ms) as { unref?: () => void }).unref?.();
});

/** The latest applied correction's editEventId on a processed pull, from its
 *  editCorrections map (keyed by editEventId; `e` = server-applied instant).
 *  Returns undefined when the pull carries no correction. */
function latestEditEventId(p: unknown): string | undefined {
  const corr = (p as { editCorrections?: unknown })?.editCorrections;
  if (!corr || typeof corr !== 'object') return undefined;
  let best: string | undefined;
  let bestT = -Infinity;
  for (const [id, v] of Object.entries(corr as Record<string, unknown>)) {
    const t = Date.parse(String((v as { e?: unknown })?.e ?? (v as { t?: unknown })?.t ?? ''));
    const ms = Number.isFinite(t) ? t : 0;
    if (ms >= bestT) { bestT = ms; best = id; }
  }
  return best;
}

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as any).name === 'AbortError';
}

/** Last classified outcome of the async backfill (for diagnostics/tests). */
export function getLastBackfillStatus(): BackfillStatus {
  return lastBackfillStatus;
}

/** Test-only knobs so retry/timeout stay deterministic and fast under jest. */
export function __setBackfillTimingForTests(opts: { timeoutMs?: number; backoffMs?: number[] }): void {
  if (typeof opts.timeoutMs === 'number') BACKFILL_TIMEOUT_MS = opts.timeoutMs;
  if (Array.isArray(opts.backoffMs)) BACKFILL_BACKOFF_MS = opts.backoffMs;
}

/** Test-only reset of the module-level session/in-flight state. */
export function __resetBackfillStateForTests(): void {
  backfillAttempted = false;
  backfillInFlight = null;
  lastBackfillStatus = 'idle';
}

/** Fetch with a bounded AbortController timeout. Throws AbortError on timeout. */
async function timedFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKFILL_TIMEOUT_MS);
  (timer as { unref?: () => void }).unref?.(); // never keep the process/Jest worker alive
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** TRUTHFUL server-delivery lifecycle of an entry (GS3):
 *  pending_sync — still local/queued; nothing reached Firebase yet;
 *  submitted   — PUT to packets/incoming succeeded; server outcome UNKNOWN
 *                (a successful upload is NOT proof of processing — the GS3
 *                stale guard consumed five successfully-uploaded packets);
 *  sent        — packets/processed/<packetId> confirmed to exist;
 *  sync_failed — SYNC_FAILED_THRESHOLD transport failures; ATTENTION
 *                REQUIRED, but the packet remains queued and retrying;
 *  rejected    — server quarantine confirmed via packets/rejected/<id>;
 *                the reason is preserved and it is NEVER auto-retried.
 *  Legacy entries have no syncStatus (undefined = created before tracking). */
export type PullSyncStatus = 'pending_sync' | 'submitted' | 'sent' | 'sync_failed' | 'rejected';

/** TRUTHFUL edit lifecycle — DISTINCT from the pull's own delivery status:
 *  edit_pending   — driver saved an edit locally; not sent (original may
 *                   still be queued/submitted, or blocked for attention);
 *  edit_submitted — edit uploaded to incoming; server outcome unknown;
 *  edited         — server CONFIRMED the edit applied (only now does the
 *                   legacy '(edited)' marker appear);
 *  edit_failed    — transport failures; the edit is retained and retried;
 *  edit_rejected  — server quarantined the edit; reason preserved. */
export type PullEditStatus = 'edit_pending' | 'edit_submitted' | 'edited' | 'edit_failed' | 'edit_rejected';

export interface PullHistoryEntry {
  id: string;                    // full packetId (timestamp_wellName_randomSuffix) - unique identifier
  wellName: string;
  dateTime: string;              // "12/13/2025 5:30 PM" - what driver entered (LOCAL display)
  /** Canonical absolute instant (ISO). The chronological authority: sort order,
   *  Today/Week/Month buckets, and the day-group header must all agree with THIS
   *  (via sentAt = Date.parse(dateTimeUTC)). Set on create/backfill and re-set on
   *  a TIME edit so an edited pull's dateTime, sort key, and bucket never diverge. */
  dateTimeUTC?: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  sentAt: number;                // ms of the pull's canonical instant (dateTimeUTC) — the sort/bucket key
  packetTimestamp: string;       // "20251213_173045" for filename matching
  packetId: string;              // full unique ID (timestamp_wellName_randomSuffix) - stored in Excel column B
  status: 'sent' | 'edited';     // for future edit tracking
  /** Server editedAt when known (backfill) — enables badge + historical fallback UI. */
  editedAt?: string;
  editCount?: number;
  /** Latest applied correction's editEventId (from the processed pull's
   *  editCorrections). Lets the History card fetch the governed before→after
   *  display via getWbmEditStatus. */
  editEventId?: string;
  syncStatus?: PullSyncStatus;   // server-delivery lifecycle (absent on legacy entries)
  sentConfirmedAt?: number;      // ms timestamp when packets/processed existence was CONFIRMED
  submittedAt?: number;          // ms timestamp of the successful PUT to incoming
  rejectionReason?: string;      // stable reason code + readable text from packets/rejected
  editStatus?: PullEditStatus;   // edit lifecycle (absent when never edited via new flow)
  editStatusReason?: string;     // rejection/blocked reason for the edit
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
    // Expanding window — fetch older pulls from Firebase that we don't have locally.
    console.log(`[PullHistory] Retention expanded ${previousDays} → ${days} days, backfilling from Firebase`);
    backfillAttempted = false; // Allow the once-per-session backfill to run again
    await loadPullHistory();   // Returns local immediately AND kicks off the scan
    // This is a deliberate settings action (not startup), so it's fine to WAIT for
    // the expand scan to land before the settings screen refreshes. Shares the same
    // single-flight promise; never throws (local history is preserved on failure).
    await refreshFromServer();
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
async function backfillFromFirebase(): Promise<BackfillResult> {
  let driverId: string | null = null;
  try {
    driverId = await getDriverId();
  } catch {
    driverId = null;
  }
  if (!driverId) {
    // No identity yet — nothing to scan for. NOT an error; local history stands.
    console.log("[PullHistory] No driverId — skipping backfill");
    return { status: 'ok', entries: [] };
  }

  // OFFLINE pre-check: never even open the large company scan while disconnected.
  try {
    const NetInfo = (await import('@react-native-community/netinfo')).default;
    const net = await NetInfo.fetch();
    if (net && net.isConnected === false) {
      console.log('[PullHistory] Offline — backfill deferred');
      return { status: 'offline', entries: [] };
    }
  } catch {
    // NetInfo unavailable — proceed and let fetch/abort classify.
  }

  console.log("[PullHistory] Backfilling from packets/processed for driver:", driverId.slice(0, 8) + "...");

  const cutoff = Date.now() - (historyDays * 24 * 60 * 60 * 1000);
  const entries: PullHistoryEntry[] = [];

  // AUTH: a missing/revoked session token or absent companyId is an auth-session
  // failure, DISTINCT from offline/permission/server. Never throws into the caller.
  let token: string;
  let session: { companyId?: string } | null;
  try {
    const { getValidIdToken } = await import('./firebaseAuthSession');
    token = await getValidIdToken();
    session = await import('./driverAuth').then((m) => m.getDriverSession());
  } catch (e) {
    console.log('[PullHistory] Auth-session unavailable for backfill:', (e as any)?.message || e);
    return { status: 'auth', entries: [] };
  }
  if (!session?.companyId) {
    console.log('[PullHistory] No companyId in session — cannot scan');
    return { status: 'auth', entries: [] };
  }

  try {
    // Query packets/processed by companyId (server-side indexed), BOUNDED by timeout.
    const url = `${FIREBASE_DATABASE_URL}/packets/processed.json?auth=${encodeURIComponent(token)}&orderBy=${encodeURIComponent('"companyId"')}&equalTo=${encodeURIComponent(`"${session.companyId}"`)}`;
    let response: Response;
    try {
      response = await timedFetch(url);
    } catch (e) {
      if (isAbortError(e)) {
        console.log('[PullHistory] Backfill scan timed out (aborted) — local history preserved');
        return { status: 'timeout', entries: [] };
      }
      console.log('[PullHistory] Backfill network error — local history preserved:', (e as any)?.message || e);
      return { status: 'error', entries: [] };
    }

    if (!response.ok) {
      if (response.status === 401) return { status: 'auth', entries: [] };
      if (response.status === 403) return { status: 'permission', entries: [] };
      if (response.status >= 500) return { status: 'server', entries: [] };
      return { status: 'error', entries: [] };
    }

    {
      const data = await response.json();
      if (data && typeof data === "object") {
        const { getTrustedHistoryDriverIds } = await import("./wellConfig");
        const trustedIds = normalizeTrustedHistoryIds(driverId, getTrustedHistoryDriverIds(driverId));
        for (const [packetId, packet] of Object.entries(data)) {
          const p = packet as any;
          if (!pullBelongsToDriver(p, trustedIds)) continue;
          if (p.requestType === "wellHistory" || p.requestType === "performanceReport") continue;
          if (p.deleted === true) continue;

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

          const edited = packetShowsEditBadge({
            editedAt: p.editedAt,
            editCount: p.editCount,
            isEdit: p.isEdit,
            requestType: p.requestType,
          });
          entries.push({
            id: packetId,
            wellName: p.wellName || "Unknown",
            dateTime: p.dateTime || new Date(sentAt).toLocaleString(),
            dateTimeUTC: typeof p.dateTimeUTC === "string" ? p.dateTimeUTC : undefined,
            tankLevelFeet: typeof p.tankLevelFeet === "number" ? p.tankLevelFeet : 0,
            bblsTaken: typeof p.bblsTaken === "number" ? p.bblsTaken : 0,
            wellDown: p.wellDown === true,
            sentAt,
            packetTimestamp,
            packetId,
            status: edited ? "edited" : "sent",
            editedAt: typeof p.editedAt === "string" ? p.editedAt : undefined,
            editCount: typeof p.editCount === "number" ? p.editCount : undefined,
            editEventId: latestEditEventId(p),
          });
        }
      }
    }

    if (entries.length === 0) {
      const driverName = await getDriverName();
      if (driverName) {
        console.log("[PullHistory] No driverId matches, trying nameless-packet fallback:", driverName);
        const nameUrl = `${FIREBASE_DATABASE_URL}/packets/processed.json?auth=${encodeURIComponent(token)}&orderBy=${encodeURIComponent('"companyId"')}&equalTo=${encodeURIComponent(`"${session.companyId}"`)}`;
        const nameResponse = await timedFetch(nameUrl);

        if (nameResponse.ok) {
          const nameData = await nameResponse.json();
          if (nameData && typeof nameData === "object") {
            const { getTrustedHistoryDriverIds } = await import("./wellConfig");
        const trustedIds = normalizeTrustedHistoryIds(driverId, getTrustedHistoryDriverIds(driverId));
            for (const [packetId, packet] of Object.entries(nameData)) {
              const p = packet as any;
              if (!pullBelongsToDriver(p, trustedIds, driverName)) continue;
              if (p.requestType === "wellHistory" || p.requestType === "performanceReport") continue;
              if (p.deleted === true) continue;

              let sentAt = 0;
              if (p.dateTimeUTC) {
                const parsed = new Date(p.dateTimeUTC);
                if (!isNaN(parsed.getTime())) sentAt = parsed.getTime();
              }
              if (sentAt === 0) sentAt = Date.now();
              if (sentAt < cutoff) continue;

              const timestampMatch = packetId.match(/^(\d{8}_\d{6})/);
              const packetTimestamp = timestampMatch ? timestampMatch[1] : packetId;

              const edited = packetShowsEditBadge({
                editedAt: p.editedAt,
                editCount: p.editCount,
                isEdit: p.isEdit,
                requestType: p.requestType,
              });
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
                status: edited ? "edited" : "sent",
                editedAt: typeof p.editedAt === "string" ? p.editedAt : undefined,
                editCount: typeof p.editCount === "number" ? p.editCount : undefined,
                editEventId: latestEditEventId(p),
              });
            }
          }
        }
      }
    }

    // Sort newest first
    entries.sort((a, b) => b.sentAt - a.sentAt);

    console.log(`[PullHistory] Backfilled ${entries.length} pulls from Firebase (within ${historyDays} days)`);
    return { status: 'ok', entries };
  } catch (error) {
    // A parse/abort during the fallback scan must never lose local history.
    if (isAbortError(error)) return { status: 'timeout', entries: [] };
    console.error("[PullHistory] Backfill error:", error);
    return { status: 'error', entries: [] };
  }
}

/**
 * Backfill from Firebase and merge with existing local history.
 * Deduplicates by packetId so we never get double entries.
 * Used when: (1) local history is empty, (2) retention window expanded.
 */
async function backfillAndMerge(): Promise<BackfillStatus> {
  const result = await backfillFromFirebase();
  // On ANY non-ok classification (offline/auth/permission/timeout/server/error)
  // the local history is left completely intact — the scan simply didn't land.
  if (result.status !== 'ok') return result.status;

  const backfilled = result.entries;
  if (backfilled.length === 0) {
    // Successful scan, nothing new to merge — still record the window we covered.
    await AsyncStorage.setItem(BACKFILLED_DAYS_KEY, String(historyDays));
    return 'ok';
  }

  // Merge: existing local entries are the base. Add any Firebase entries we don't
  // have AND reconcile mutable fields of entries we DO have, so a stale local value
  // (e.g. an old WB M-local edit superseded by a later cross-app edit) self-heals on
  // the next session backfill. PRESERVE the original dateTime / sentAt / packetId
  // (ordering + original pull time stay local-authoritative); only the canonical
  // measurement fields are overwritten. Never downgrade an 'edited' status.
  const byId = new Map<string, PullHistoryEntry>();
  for (const e of cachedHistory) byId.set(e.packetId || e.id, e);
  let addedCount = 0;
  let updatedCount = 0;

  for (const entry of backfilled) {
    const existing = byId.get(entry.packetId);
    if (!existing) {
      cachedHistory.push(entry);
      byId.set(entry.packetId, entry);
      addedCount++;
      continue;
    }
    let changed = false;
    if (Number.isFinite(entry.bblsTaken) && entry.bblsTaken !== existing.bblsTaken) { existing.bblsTaken = entry.bblsTaken; changed = true; }
    if (Number.isFinite(entry.tankLevelFeet) && entry.tankLevelFeet > 0 && entry.tankLevelFeet !== existing.tankLevelFeet) { existing.tankLevelFeet = entry.tankLevelFeet; changed = true; }
    if (typeof entry.wellDown === "boolean" && entry.wellDown !== existing.wellDown) { existing.wellDown = entry.wellDown; changed = true; }
    if (entry.status === "edited" && existing.status !== "edited") { existing.status = "edited"; changed = true; }
    if (entry.editedAt && entry.editedAt !== existing.editedAt) { existing.editedAt = entry.editedAt; changed = true; }
    if (entry.editEventId && entry.editEventId !== existing.editEventId) { existing.editEventId = entry.editEventId; changed = true; }
    if (typeof entry.editCount === "number" && entry.editCount !== existing.editCount) {
      existing.editCount = entry.editCount;
      changed = true;
    }
    if (changed) {
      updatedCount++;
      console.log("[pullHistory.backfill.updatedExisting]", entry.packetId, "bbls→", existing.bblsTaken, "(dateTime preserved:", existing.dateTime + ")");
    }
  }

  if (addedCount > 0 || updatedCount > 0) {
    // Re-sort newest first
    cachedHistory.sort((a, b) => b.sentAt - a.sentAt);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    console.log(`[PullHistory] Merged ${addedCount} new + reconciled ${updatedCount} existing from Firebase (total: ${cachedHistory.length})`);
  }

  // Track what we've backfilled so we know if it needs expanding later
  await AsyncStorage.setItem(BACKFILLED_DAYS_KEY, String(historyDays));
  return 'ok';
}

/**
 * ASYNC, single-flight, bounded-retry company scan. This is the ONLY place the
 * network backfill is driven from. It is fire-and-forget from the render path:
 *  - SINGLE-FLIGHT: while one scan is in flight, every caller shares that same
 *    promise; a second scan is never started concurrently (so the large
 *    packets/processed company scan runs at most once at a time).
 *  - BOUNDED BACKOFF: retryable failures (offline/timeout/server/error) retry on
 *    a fixed, finite schedule — never a busy loop. auth/permission never retry.
 *  - LOCAL-SAFE: nothing here can throw into a caller, and a failure NEVER
 *    mutates or drops local history.
 */
export function refreshFromServer(): Promise<BackfillStatus> {
  if (backfillInFlight) return backfillInFlight; // share the in-flight scan
  const run = (async (): Promise<BackfillStatus> => {
    let status: BackfillStatus = 'idle';
    const maxAttempts = 1 + BACKFILL_BACKOFF_MS.length;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        status = await backfillAndMerge();
      } catch (e) {
        // backfillAndMerge is written not to throw; this is a last-resort guard so
        // an unexpected throw can never turn into lost local history.
        console.warn('[PullHistory] backfill threw (non-fatal, local history kept):', e);
        status = 'error';
      }
      lastBackfillStatus = status;
      if (!RETRYABLE.includes(status)) break; // ok / auth / permission — done
      const delay = BACKFILL_BACKOFF_MS[attempt];
      if (delay === undefined) break; // bounded retries exhausted
      console.log(`[PullHistory] backfill ${status}; retry in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})`);
      await sleep(delay);
    }
    return status;
  })();
  backfillInFlight = run;
  // Clear the in-flight slot when done (success or failure) so a later session/
  // expand can scan again. Identity-guarded against a racing reassignment.
  void run.finally(() => { if (backfillInFlight === run) backfillInFlight = null; });
  return run;
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

    // BACKFILL: pick up cross-app pulls (WB T → WB M) from Firebase. This is
    // FIRE-AND-FORGET — we NEVER await it here, so returning local history is not
    // gated on the large packets/processed company scan (the startup-hang fix).
    // Once per session (backfillAttempted) + single-flight inside refreshFromServer
    // keeps us from hammering Firebase. When it lands, it merges and persists; a
    // subsequent open/subscription tick renders the reconciled cache.
    if (!backfillAttempted) {
      backfillAttempted = true;
      void refreshFromServer();
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
  packetId: string,
  syncStatus: PullSyncStatus = 'sent'
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
      syncStatus,
      ...(syncStatus === 'sent' ? { sentConfirmedAt: Date.now() } : {}),
      ...(syncStatus === 'submitted' ? { submittedAt: Date.now() } : {}),
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
  wellDown: boolean,
  opts?: {
    /** GS3 truthfulness: '(edited)' must only appear once the SERVER
     *  confirmed the edit. The new edit flow passes false and lets
     *  setPullEditStatus('edited') flip the marker on confirmation.
     *  Defaults to true for legacy/server-confirmed callers. */
    markEdited?: boolean;
    /** The NEW canonical instant (ISO) when the TIME changed. When provided and
     *  parseable, the entry's dateTimeUTC is stored AND its sentAt (the sort +
     *  Today/Week/Month bucket key) is re-derived from it, so the edited pull's
     *  local dateTime, chronological position, bucket placement, and day-group
     *  header ALL follow the one edited instant — never a stale submission clock.
     *  Omit (or pass unchanged) for non-time edits so ordering is untouched. */
    dateTimeUTC?: string;
  }
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
    // TIMESTAMP CONSISTENCY (Hard Blocker 1): when the TIME changed, re-anchor the
    // chronological key to the edited instant so sort + buckets + day header agree.
    if (opts?.dateTimeUTC) {
      const ms = Date.parse(opts.dateTimeUTC);
      if (!Number.isNaN(ms)) {
        entry.dateTimeUTC = opts.dateTimeUTC;
        entry.sentAt = ms;
      }
    }
    if (opts?.markEdited !== false) {
      entry.status = 'edited';
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    console.log("[PullHistory] Updated entry:", id, "bbls:", bblsTaken, "sentAt:", entry.sentAt);
  } else {
    console.warn("[PullHistory] Entry not found for update:", id);
  }
}

/**
 * Set the DISTINCT edit lifecycle on an entry (matched by stable id).
 * 'edited' is the ONLY state that also flips the legacy status marker —
 * i.e. '(edited)' appears exclusively on server confirmation. The pull's
 * own delivery syncStatus is never touched here.
 */
export async function setPullEditStatus(
  packetId: string,
  editStatus: PullEditStatus,
  reason?: string,
  editEventId?: string,
): Promise<boolean> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }
  const entry = cachedHistory.find(e => e.packetId === packetId || e.id === packetId);
  if (!entry) return false;
  entry.editStatus = editStatus;
  if (reason !== undefined) entry.editStatusReason = reason;
  // Carry the correction's editEventId onto the marker at confirmation time so
  // the History card can fetch the governed before→after IMMEDIATELY, without
  // waiting for the next packets/processed backfill (which is the only other
  // source of the marker's editEventId).
  if (editEventId) entry.editEventId = editEventId;
  if (editStatus === 'edited') {
    entry.status = 'edited'; // server-confirmed — legacy marker may appear
    if (!entry.editedAt) entry.editedAt = new Date().toISOString();
    entry.editCount = (entry.editCount ?? 0) + 1; // bump so the before→after cache re-fetches
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
  console.log('[PullHistory] editStatus:', packetId, '→', editStatus);
  return true;
}

/**
 * Update an existing history entry's mutable fields BY PACKET ID, preserving the
 * original pull timestamp. Used by backgroundSync to reconcile a cross-app edit
 * (e.g. a WB T History edit) into the Pull History cache: addPullToHistoryIfNew
 * skips existing packetIds, so a stale entry (e.g. a prior WB M-local edit) would
 * never be corrected without this.
 *
 * TIMESTAMP RULE: dateTime / sentAt / packetId / packetTimestamp are the ORIGINAL
 * pull identity + time and are intentionally NEVER touched here. Only the corrected
 * measurement fields (bblsTaken, tankLevelFeet/top, wellDown) + the edited status
 * are updated. The card's bottom level is derived from top + bbls, so it follows.
 *
 * Returns true if a matching entry was found (whether or not a value changed),
 * false if no entry exists for this packetId (caller may then add-new).
 */
export async function updatePullHistoryEntryByPacketId(
  packetId: string,
  fields: { bblsTaken?: number; tankLevelFeet?: number; wellDown?: boolean },
): Promise<boolean> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }
  if (!packetId) {
    console.warn("[PullHistory] updateByPacketId: missing packetId, bailing");
    return false;
  }

  const entry = cachedHistory.find(e => e.packetId === packetId || e.id === packetId);
  if (!entry) return false;

  let changed = false;
  if (typeof fields.bblsTaken === "number" && Number.isFinite(fields.bblsTaken) && fields.bblsTaken !== entry.bblsTaken) {
    entry.bblsTaken = fields.bblsTaken;
    changed = true;
  }
  if (typeof fields.tankLevelFeet === "number" && Number.isFinite(fields.tankLevelFeet) && fields.tankLevelFeet > 0 && fields.tankLevelFeet !== entry.tankLevelFeet) {
    entry.tankLevelFeet = fields.tankLevelFeet;
    changed = true;
  }
  if (typeof fields.wellDown === "boolean" && fields.wellDown !== entry.wellDown) {
    entry.wellDown = fields.wellDown;
    changed = true;
  }

  if (changed) {
    entry.status = "edited";
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
    console.log("[PullHistory] updateByPacketId applied:", packetId, "bbls:", entry.bblsTaken, "(original dateTime preserved:", entry.dateTime + ")");
  }
  return true;
}

/**
 * Reconcile an entry with its server-delivery state, matched by the stable
 * packetId (GS3 identity fix). 'submitted' records the PUT time, 'sent'
 * the confirmed-processed time, 'rejected' preserves the quarantine
 * reason; 'sync_failed' flags attention while the packet stays queued.
 * Evidence is only ever ADDED — nothing is deleted here. Safe no-op when
 * the entry is unknown (e.g. cross-app pulls with no local entry).
 */
export async function setPullSyncStatus(
  packetId: string,
  syncStatus: PullSyncStatus,
  opts?: { sentConfirmedAt?: number; submittedAt?: number; rejectionReason?: string },
): Promise<boolean> {
  if (cachedHistory.length === 0) {
    await loadPullHistory();
  }
  const entry = cachedHistory.find(e => e.packetId === packetId || e.id === packetId);
  if (!entry) return false;
  entry.syncStatus = syncStatus;
  if (syncStatus === 'sent') {
    entry.sentConfirmedAt = opts?.sentConfirmedAt ?? Date.now();
  }
  if (syncStatus === 'submitted') {
    entry.submittedAt = opts?.submittedAt ?? Date.now();
  }
  if (syncStatus === 'rejected' && opts?.rejectionReason) {
    entry.rejectionReason = opts.rejectionReason;
  }
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
  console.log('[PullHistory] syncStatus:', packetId, '→', syncStatus);
  return true;
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
