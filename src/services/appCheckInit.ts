/**
 * Firebase App Check bootstrap for WB-M (security branch).
 * Enforcement remains OFF until all clients ship providers and server enables checks.
 * Do not commit debug tokens — set EXPO_PUBLIC_WB_APPCHECK_DEBUG_TOKEN locally only.
 */
export async function initAppCheckIfConfigured(): Promise<boolean> {
  try {
    const debugToken =
      (typeof process !== 'undefined' &&
        (process as any).env?.EXPO_PUBLIC_WB_APPCHECK_DEBUG_TOKEN) ||
      '';
    if (!debugToken) {
      console.log('[AppCheck] WB-M: provider deferred until native modules + config');
      return false;
    }
    console.log('[AppCheck] WB-M: debug config present (token not logged)');
    return true;
  } catch {
    return false;
  }
}
