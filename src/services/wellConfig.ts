// src/services/wellConfig.ts
// Loads and caches well configuration from Firebase

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { diagnoseThrown } from "./connectionDiagnosis";
import {
  EligibilityStatus,
  EligibilityVerdict,
  evaluateAuthoritativeAssignedRoutes,
  normalizeRouteList,
  resolveEligibility,
  unknownVerdict,
  verdictFromAuthoritative,
} from "./eligibility";
import {
  aliasesFromEnvelope,
  envelopeExactMatch,
  envelopeMatchesRevision,
  envelopeMatchesSession,
  parseBootstrapEnvelope,
  snapshotToEnvelope,
  WBM_BOOTSTRAP_SCHEMA,
  WBM_ENVELOPE_KEY,
  type WbmBootstrapEnvelope,
  type WbmBootstrapSnapshot,
} from './wbmBootstrapCache';
import {
  bootstrapResponseAdmissible,
  captureBootstrapTicket,
  claimSessionGeneration,
  getSessionGeneration,
  registerWbmCatalogClear,
  resetSessionGenerationForTests,
  runEnvelopeOp,
  runEnvelopeRemovePauseForTests,
  sessionFenceHolds,
  type BootstrapTicket,
} from './wbmSessionFence';

export {
  envelopeExactMatch,
  envelopeMatchesRevision,
  envelopeMatchesSession,
  parseBootstrapEnvelope,
  WBM_BOOTSTRAP_SCHEMA,
  WBM_ENVELOPE_KEY,
};
export {
  bumpSessionGeneration,
  claimSessionGeneration,
  getSessionGeneration,
  resetSessionGenerationForTests,
  setEnvelopeRemovePauseForTests,
  beginLoginTransition,
} from './wbmSessionFence';

const STORAGE_KEY = "@wellbuilt_well_config";
const LAST_FETCH_KEY = "@wellbuilt_config_last_fetch";
const ASSIGNED_ROUTES_KEY = "@wellbuilt_assigned_routes";
const ASSIGNED_WELLS_KEY = "@wellbuilt_assigned_wells";
const ELIGIBILITY_STATUS_KEY = "@wellbuilt_eligibility_status";
const CACHE_BINDER_KEY = "@wellbuilt_well_config_binder";

// Firebase config
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";

export interface WellConfig {
  allowedBottom: number;
  numTanks: number;
  loadLine: number;
  avgFlowRate?: string;
  avgFlowRateMinutes?: number;
  route?: string;
  isDown?: boolean;
}

export interface WellConfigMap {
  [wellName: string]: WellConfig;
}

const DEFAULT_CONFIG: WellConfig = {
  allowedBottom: 3,
  numTanks: 1,
  loadLine: 1.33,
};

let cachedConfig: WellConfigMap | null = null;
let cachedEnvelope: WbmBootstrapEnvelope | null = null;
let cachedAssignedRoutes: string[] | null = null;
let cachedAssignedWells: string[] | null = null;

export class WellConfigUnavailableError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`well_config_unavailable:${reason}`);
    this.name = 'WellConfigUnavailableError';
    this.reason = reason;
  }
}

export let lastWellConfigError: string | null = null;

export function wellConfigFailureReason(error: unknown): string {
  if (error instanceof WellConfigUnavailableError) return error.reason;
  const msg = error instanceof Error ? error.message : String(error || '');
  const known = [
    'scope_missing',
    'scope_malformed',
    'scope_empty',
    'scope_unrouted_only',
    'driver_inactive',
    'company_required',
    'profile_missing',
  ];
  return known.find((c) => msg.includes(c)) || 'fetch_failed';
}

let authSessionProbe: (() => boolean) | null = null;

export function setHasAuthSessionForTests(fn: (() => boolean) | null): void {
  authSessionProbe = fn;
}

async function hasAuthSession(): Promise<boolean> {
  if (authSessionProbe) return authSessionProbe();
  try {
    const { getFirebaseAuth } = await import('./firebaseAuthSession');
    return !!getFirebaseAuth().currentUser;
  } catch {
    return false;
  }
}

function clearWbmMemoryFields(): void {
  cachedConfig = null;
  cachedEnvelope = null;
  cachedAssignedRoutes = null;
  cachedAssignedWells = null;
  lastWellConfigError = null;
}

registerWbmCatalogClear(clearWbmMemoryFields);

export function resetWellConfigCacheForTests(): void {
  clearWbmMemoryFields();
  resetSessionGenerationForTests();
  authSessionProbe = () => true;
}

export function clearWbmMemoryCatalog(): void {
  clearWbmMemoryFields();
}

export function invalidateWbmMemoryCache(): void {
  claimSessionGeneration();
}

export function seedWellConfigCacheForTests(env: WbmBootstrapEnvelope): void {
  cachedEnvelope = env;
  cachedConfig = env.wells as unknown as WellConfigMap;
  lastWellConfigError = null;
}

export function peekWellConfigCacheForTests(): {
  config: WellConfigMap | null;
  envelope: WbmBootstrapEnvelope | null;
} {
  return { config: cachedConfig, envelope: cachedEnvelope };
}

async function sessionIdentity(): Promise<{ driverId: string | null; companyId: string | null }> {
  return {
    driverId: await SecureStore.getItemAsync("driverId"),
    companyId: await SecureStore.getItemAsync("companyId"),
  };
}

export async function loadWellConfig(
  forceRefresh: boolean = false
): Promise<WellConfigMap | null> {
  const ident = await sessionIdentity();
  const ticket = captureBootstrapTicket(ident);
  try {
    const live = await fetchBootstrapFromServer();
    const installed = await installBootstrapSnapshot(live, ticket);
    if (!installed) {
      throw new WellConfigUnavailableError('stale_bootstrap');
    }
    lastWellConfigError = null;
    return installed.wells as unknown as WellConfigMap;
  } catch (error) {
    const reason = wellConfigFailureReason(error);
    lastWellConfigError = reason;
    console.error("[WellConfig] Error loading config:", error);
    if (reason === 'stale_bootstrap') {
      // Never last-known fallback with the identity captured before the switch.
      throw new WellConfigUnavailableError('stale_bootstrap');
    }
    if (!forceRefresh) {
      const fallback = await readFencedDurableEnvelope();
      if (fallback && fallback.eligibility.status !== 'unknown') {
        return fallback.wells as unknown as WellConfigMap;
      }
    }
    const identNow = await sessionIdentity();
    const stillSameSession =
      ticket.generation === getSessionGeneration()
      && identNow.driverId === ident.driverId
      && (identNow.companyId || '') === (ident.companyId || '');
    if (stillSameSession) {
      cachedConfig = null;
      cachedEnvelope = null;
    }
    throw new WellConfigUnavailableError(reason);
  }
}

async function fetchBootstrapFromServer(): Promise<WbmBootstrapSnapshot> {
  const { authorizedCallable } = await import("./firebaseAuthSession");
  const res = await authorizedCallable<WbmBootstrapSnapshot>("bootstrapWbmSession", {});
  if (!res || res.ok !== true || typeof res.driverId !== 'string' || typeof res.assignmentDigest !== 'string') {
    throw new WellConfigUnavailableError('malformed_response');
  }
  if (!res.wells || typeof res.wells !== 'object' || Array.isArray(res.wells)) {
    throw new WellConfigUnavailableError('malformed_response');
  }
  return res;
}

function snapshotIdentity(snap: { driverId: string; companyId: string }) {
  return { driverId: snap.driverId, companyId: snap.companyId };
}

async function fenceHolds(
  ticket: BootstrapTicket,
  snap: { driverId: string; companyId: string },
): Promise<boolean> {
  const ident = await sessionIdentity();
  return bootstrapResponseAdmissible({
    ticket,
    snapshot: snapshotIdentity(snap),
    current: ident,
    hasAuthSession: await hasAuthSession(),
  });
}

export function getTrustedHistoryDriverIds(expectedDriverId?: string | null): string[] {
  return aliasesFromEnvelope(cachedEnvelope, expectedDriverId || cachedEnvelope?.driverId || null);
}

function installEnvelopeMemory(env: WbmBootstrapEnvelope): void {
  cachedEnvelope = env;
  cachedConfig = env.wells as unknown as WellConfigMap;
  cachedAssignedRoutes = env.eligibility.routes;
  cachedAssignedWells = env.eligibility.wells;
}

function uninstallEnvelopeMemoryIfExact(env: WbmBootstrapEnvelope): void {
  if (cachedEnvelope && envelopeExactMatch(cachedEnvelope, env)) {
    cachedEnvelope = null;
    cachedConfig = null;
    cachedAssignedRoutes = null;
    cachedAssignedWells = null;
  }
}

async function readEnvelopeInsideGate(): Promise<WbmBootstrapEnvelope | null> {
  try {
    const raw = await AsyncStorage.getItem(WBM_ENVELOPE_KEY);
    return parseBootstrapEnvelope(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}

async function removeExactInsideGate(expected: WbmBootstrapEnvelope): Promise<void> {
  const current = await readEnvelopeInsideGate();
  if (!envelopeExactMatch(current, expected)) return;
  await runEnvelopeRemovePauseForTests();
  await AsyncStorage.removeItem(WBM_ENVELOPE_KEY);
}

/** Test-only durable seed. Goes through the cache-operation gate; not a ticketed production install. */
export async function persistBootstrapEnvelopeForTests(snap: WbmBootstrapSnapshot): Promise<WbmBootstrapEnvelope> {
  return runEnvelopeOp(async () => {
    const env = snapshotToEnvelope(snap);
    await AsyncStorage.setItem(WBM_ENVELOPE_KEY, JSON.stringify(env));
    installEnvelopeMemory(env);
    return env;
  });
}

export async function removeEnvelopeIfExact(expected: WbmBootstrapEnvelope): Promise<void> {
  return runEnvelopeOp(async () => {
    await removeExactInsideGate(expected);
  });
}

export async function installBootstrapSnapshot(
  snap: WbmBootstrapSnapshot,
  ticket: BootstrapTicket,
): Promise<WbmBootstrapEnvelope | null> {
  if (!(await fenceHolds(ticket, snap))) return null;
  return runEnvelopeOp(async () => {
    if (!(await fenceHolds(ticket, snap))) return null;
    const env = snapshotToEnvelope(snap);
    await AsyncStorage.setItem(WBM_ENVELOPE_KEY, JSON.stringify(env));
    if (!(await fenceHolds(ticket, snap))) {
      await removeExactInsideGate(env);
      return null;
    }
    installEnvelopeMemory(env);
    if (!(await fenceHolds(ticket, snap))) {
      uninstallEnvelopeMemoryIfExact(env);
      await removeExactInsideGate(env);
      return null;
    }
    return env;
  });
}

export async function readMatchingEnvelope(
  driverId: string | null,
  companyId: string | null,
): Promise<WbmBootstrapEnvelope | null> {
  if (cachedEnvelope && envelopeMatchesSession(cachedEnvelope, driverId, companyId)) {
    return cachedEnvelope;
  }
  return runEnvelopeOp(async () => {
    const env = await readEnvelopeInsideGate();
    if (envelopeMatchesSession(env, driverId, companyId)) return env;
    return null;
  });
}

/**
 * Generation-, identity-, and Auth-fenced durable read. Installs memory only
 * after the post-await fence still holds.
 */
export async function readFencedDurableEnvelope(): Promise<WbmBootstrapEnvelope | null> {
  const identBefore = await sessionIdentity();
  const ticket = captureBootstrapTicket(identBefore);
  if (!identBefore.driverId) return null;
  if (!sessionFenceHolds({
    ticket,
    current: identBefore,
    hasAuthSession: await hasAuthSession(),
  })) {
    return null;
  }

  if (cachedEnvelope && envelopeMatchesSession(cachedEnvelope, identBefore.driverId, identBefore.companyId)) {
    const mem = cachedEnvelope;
    if (await fenceHolds(ticket, mem)) return mem;
  }

  return runEnvelopeOp(async () => {
    const identNow = await sessionIdentity();
    if (!sessionFenceHolds({
      ticket,
      current: identNow,
      hasAuthSession: await hasAuthSession(),
    })) {
      return null;
    }
    const env = await readEnvelopeInsideGate();
    if (!env) return null;
    const identAfter = await sessionIdentity();
    if (!envelopeMatchesSession(env, identAfter.driverId, identAfter.companyId)) return null;
    if (!(await fenceHolds(ticket, env))) return null;
    installEnvelopeMemory(env);
    if (!(await fenceHolds(ticket, env))) {
      uninstallEnvelopeMemoryIfExact(env);
      return null;
    }
    return env;
  });
}

export async function getWellConfig(wellName: string): Promise<WellConfig> {
  if (!cachedConfig) {
    await loadWellConfig();
  }

  if (cachedConfig && cachedConfig[wellName]) {
    return cachedConfig[wellName];
  }

  console.warn(`[WellConfig] No config for "${wellName}", using defaults`);
  return DEFAULT_CONFIG;
}

export async function getBblPerFoot(wellName: string): Promise<number> {
  const config = await getWellConfig(wellName);
  // Use stored bblPerFoot from Dashboard if available, else derive from legacy formula
  return (config as any).bblPerFoot || 20 * config.numTanks;
}

export function getWellConfigSync(wellName: string): WellConfig {
  if (cachedConfig && cachedConfig[wellName]) {
    return cachedConfig[wellName];
  }
  return DEFAULT_CONFIG;
}

export function getBblPerFootSync(wellName: string): number {
  const config = getWellConfigSync(wellName);
  // Use stored bblPerFoot from Dashboard if available, else derive from legacy formula
  return (config as any).bblPerFoot || 20 * config.numTanks;
}

export async function forceRefreshWellConfig(): Promise<boolean> {
  const config = await loadWellConfig(true);
  return config !== null;
}

export async function wipeDurableWellConfigCache(): Promise<void> {
  return runEnvelopeOp(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(LAST_FETCH_KEY);
    await AsyncStorage.removeItem(CACHE_BINDER_KEY);
    await AsyncStorage.removeItem(ASSIGNED_ROUTES_KEY);
    await AsyncStorage.removeItem(ASSIGNED_WELLS_KEY);
    await AsyncStorage.removeItem(ELIGIBILITY_STATUS_KEY);
    await AsyncStorage.removeItem(WBM_ENVELOPE_KEY);
  });
}

export async function clearWellConfigCache(): Promise<void> {
  invalidateWbmMemoryCache();
  await wipeDurableWellConfigCache();
}

export async function getAllWellNames(): Promise<string[]> {
  if (!cachedConfig) {
    await loadWellConfig();
  }
  if (!cachedConfig) {
    throw new WellConfigUnavailableError(lastWellConfigError || 'well_config_unavailable');
  }
  return Object.keys(cachedConfig).sort();
}

// ── Driver Route Assignment ──

export async function readDurableEligibility(): Promise<EligibilityVerdict | null> {
  const env = await readFencedDurableEnvelope();
  if (!env) return null;
  return env.eligibility;
}

export async function persistDurableEligibility(v: EligibilityVerdict): Promise<void> {
  // Bare verdict persistence is no longer authoritative. Live bootstrap envelope
  // is the only durable grant. Keep this as a no-op writer for old call sites
  // that only have a verdict — they must not create an unbound cache.
  if (v.status === 'unknown') return;
  cachedAssignedRoutes = v.routes;
  cachedAssignedWells = v.wells;
}

export async function fetchAssignmentClassified(
  bootstrapFn?: () => Promise<WbmBootstrapSnapshot>,
): Promise<EligibilityVerdict> {
  try {
    const driverId = await SecureStore.getItemAsync("driverId");
    if (!driverId) {
      return unknownVerdict('missing_driver_id', true);
    }
    const ident = await sessionIdentity();
    const ticket = captureBootstrapTicket(ident);
    const snap = bootstrapFn
      ? await bootstrapFn()
      : await fetchBootstrapFromServer();
    const env = await installBootstrapSnapshot(snap, ticket);
    if (!env) return unknownVerdict('stale_bootstrap', true);
    return env.eligibility;
  } catch (error) {
    const d = diagnoseThrown(error);
    return unknownVerdict(d.code || wellConfigFailureReason(error), d.retryable);
  }
}

/**
 * Resolve current eligibility: classified fetch + durable last-known + session.
 * Unknown never becomes ineligible.
 */
export async function resolveCurrentEligibility(): Promise<EligibilityVerdict> {
  const companyId = await SecureStore.getItemAsync("companyId");
  const sessionRoutesRaw = await SecureStore.getItemAsync("assignedRoutes");
  let sessionRoutes: unknown = null;
  try { sessionRoutes = sessionRoutesRaw ? JSON.parse(sessionRoutesRaw) : null; } catch { sessionRoutes = null; }
  const fetch = await fetchAssignmentClassified();
  const durable = await readDurableEligibility();
  return resolveEligibility({
    hasCompanyId: !!companyId,
    fetch,
    durable,
    sessionRoutes,
  });
}

/**
 * Fetch driver's assignedRoutes and assignedWells.
 * Failed/unknown lookups do NOT collapse to [] (that was the false-denial).
 * Callers that need a filter list should use verdict.routes when status is eligible.
 */
export async function fetchDriverRouteAssignment(): Promise<{
  routes: string[];
  wells: string[];
  status: EligibilityStatus;
  reason: string;
  authoritative: boolean;
}> {
  const verdict = await resolveCurrentEligibility();
  return {
    routes: verdict.routes || [],
    wells: verdict.wells || [],
    status: verdict.status,
    reason: verdict.reason,
    authoritative: verdict.source === 'authoritative',
  };
}

/**
 * Get cached route assignment (synchronous, from memory or AsyncStorage).
 */
export async function getDriverRouteAssignment(): Promise<{ routes: string[]; wells: string[] }> {
  if (cachedAssignedRoutes !== null) {
    return { routes: cachedAssignedRoutes, wells: cachedAssignedWells || [] };
  }

  try {
    const storedRoutes = await AsyncStorage.getItem(ASSIGNED_ROUTES_KEY);
    const storedWells = await AsyncStorage.getItem(ASSIGNED_WELLS_KEY);
    cachedAssignedRoutes = storedRoutes ? JSON.parse(storedRoutes) : [];
    cachedAssignedWells = storedWells ? JSON.parse(storedWells) : [];
    return { routes: cachedAssignedRoutes || [], wells: cachedAssignedWells || [] };
  } catch {
    return { routes: [], wells: [] };
  }
}

/**
 * Filter well_config to wells matching assigned routes/wells.
 * Empty arrays are NOT "see everything" — that was the [] contradiction.
 * Pass unrestricted:true only for no-company admin sessions.
 */
export function scopedWellsForDisplay(
  config: WellConfigMap,
  assignment: {
    routes: string[];
    wells: string[];
    status: EligibilityStatus;
    reason?: string;
  },
): WellConfigMap {
  if (assignment.reason === 'no_company_admin') return config;
  if (assignment.status !== 'eligible') return {};
  return filterWellConfigByAssignment(config, assignment.routes, assignment.wells);
}

export function filterWellConfigByAssignment(
  config: WellConfigMap,
  assignedRoutes: string[],
  assignedWells: string[],
  opts?: { unrestricted?: boolean },
): WellConfigMap {
  if (opts?.unrestricted) {
    return config;
  }
  if (assignedRoutes.length === 0 && assignedWells.length === 0) {
    return {};
  }

  const filtered: WellConfigMap = {};
  for (const [wellName, wellConfig] of Object.entries(config)) {
    const wellRoute = wellConfig.route || '';
    const routeMatch = assignedRoutes.some(assignedRoute => {
      // "Unrouted" matches "Unrouted", "Unrouted 2", "Unrouted 3", etc.
      if (assignedRoute === 'Unrouted') return wellRoute.startsWith('Unrouted');
      return assignedRoute === wellRoute;
    });
    const wellMatch = assignedWells.includes(wellName);
    if (routeMatch || wellMatch) {
      filtered[wellName] = wellConfig;
    }
  }

  console.log(`[WellConfig] Filtered: ${Object.keys(filtered).length}/${Object.keys(config).length} wells`);
  return filtered;
}

/**
 * Authoritative-array helper only. Do NOT pass failed-lookup leftovers.
 * Missing field → not a boolean denial (returns true for legacy "field absent"
 * only when the caller already proved the fetch succeeded AND the field was
 * omitted — prefer evaluateAuthoritativeAssignedRoutes).
 */
export function driverHasRealRoutes(assignedRoutes: string[] | undefined | null): boolean {
  return evaluateAuthoritativeAssignedRoutes(assignedRoutes) === 'eligible';
}
