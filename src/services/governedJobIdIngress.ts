/**
 * Current-line Dashboard dispatch jobId receiving contract.
 *
 * Census of 7d87f17:
 * - Route Me / DDJD wells carry wellName/wellId/companyId/assignmentState only.
 * - Tank-carousel Pull navigates with wellName only.
 * - AppSwitcher remains outbound wellbuilt-tickets://sso-start.
 * - No assigned-job or deep-link path already carries a Dashboard dispatch ID.
 *
 * Therefore the smallest truthful authenticated receiving boundary is the
 * existing Expo Router `/record` route, which is already reachable as
 * `wellbuiltmobile://record?jobId=<Dashboard dispatch document ID>`.
 *
 * jobId is selected by the client and is NOT trusted until
 * resolveExecutionBinding succeeds. wellName is never substituted.
 */
export const GOVERNED_JOB_ID_URL_SCHEME = 'wellbuiltmobile';
export const GOVERNED_JOB_ID_RECORD_PATH = '/record';
export const GOVERNED_JOB_ID_QUERY_KEY = 'jobId';

function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim();
  return '';
}

export function readGovernedJobIdFromRecordParams(params: {
  jobId?: unknown;
  wellName?: unknown;
} | Record<string, unknown> | null | undefined): string {
  if (!params || typeof params !== 'object') return '';
  const jobId = firstString((params as { jobId?: unknown }).jobId);
  const wellName = firstString((params as { wellName?: unknown }).wellName);
  if (!jobId) return '';
  if (wellName && jobId === wellName) return '';
  return jobId;
}

export function governedRecordReceivingHref(jobId: string, wellName?: string): string {
  const id = typeof jobId === 'string' ? jobId.trim() : '';
  if (!id) return '';
  const path = GOVERNED_JOB_ID_RECORD_PATH.replace(/^\//, '');
  const qs = new URLSearchParams();
  qs.set(GOVERNED_JOB_ID_QUERY_KEY, id);
  const well = typeof wellName === 'string' ? wellName.trim() : '';
  if (well && well !== id) qs.set('wellName', well);
  return `${GOVERNED_JOB_ID_URL_SCHEME}://${path}?${qs.toString()}`;
}

export function readGovernedJobIdFromHref(href: string): string {
  if (typeof href !== 'string' || !href.trim()) return '';
  try {
    const u = new URL(href);
    if (u.protocol !== `${GOVERNED_JOB_ID_URL_SCHEME}:`) return '';
    const hostPath = `${u.hostname}${u.pathname}`.replace(/\/+$/, '');
    if (hostPath !== 'record' && hostPath !== '/record') return '';
    return readGovernedJobIdFromRecordParams({
      jobId: u.searchParams.get(GOVERNED_JOB_ID_QUERY_KEY) || '',
      wellName: u.searchParams.get('wellName') || '',
    });
  } catch {
    return '';
  }
}
