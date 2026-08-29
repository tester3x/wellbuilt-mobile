// clientBuildMeta.ts — governed build metadata for ingest observability
// (Phase 4). Sent OUTSIDE the packet as the callable envelope's clientMeta,
// so server refusal logs can attribute a request to an app build.
//
// Privacy contract: version/build/platform/channel only. NEVER advertising
// ids, hardware serials, IMEI, phone numbers, or any fingerprinting — a
// device-generated installation id was considered and deliberately omitted.

export interface ClientBuildMeta {
  appVersion?: string;
  versionCode?: string;
  channel?: string;
  platform?: string;
}

function bounded(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() && v.length <= 64 ? v.trim() : undefined;
}

/** Defensive: every source is optional; a bare object is a valid answer. */
export async function governedClientBuildMeta(): Promise<ClientBuildMeta | undefined> {
  const meta: ClientBuildMeta = {};
  try {
    const { Platform } = await import('react-native');
    meta.platform = bounded(Platform?.OS);
  } catch { /* non-RN test env */ }
  try {
    const Constants = (await import('expo-constants')).default as {
      expoConfig?: { version?: unknown } | null;
      nativeAppVersion?: unknown;
      nativeBuildVersion?: unknown;
    };
    meta.appVersion = bounded(Constants?.expoConfig?.version) ?? bounded(Constants?.nativeAppVersion);
    const build = Constants?.nativeBuildVersion;
    meta.versionCode = bounded(typeof build === 'number' ? String(build) : build);
  } catch { /* expo-constants unavailable */ }
  try {
    // expo-updates is optional (not a declared dependency); when present the
    // channel identifies the EAS track. Non-literal specifier keeps TS from
    // requiring the module to exist.
    const updatesModule = 'expo-updates';
    const Updates = await import(updatesModule) as { channel?: unknown };
    meta.channel = bounded(Updates?.channel);
  } catch { /* not installed — fine */ }

  const any = meta.appVersion || meta.versionCode || meta.channel || meta.platform;
  return any ? meta : undefined;
}
