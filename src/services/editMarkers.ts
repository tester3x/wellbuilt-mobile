/**
 * Canonical + legacy Edit badge helpers for WB-M.
 * Aligns with Dashboard/functions editHistory contract.
 */

export type EditSource = 'wbm' | 'dashboard' | 'legacy' | 'unknown';

export interface FieldChange {
  field: string;
  previous: string | number | boolean | null;
  next: string | number | boolean | null;
}

export interface EditHistoryEvent {
  eventId: string;
  packetId: string;
  sequence: number;
  editedAt: string;
  source: EditSource | string;
  fields: FieldChange[];
  originalSubmissionAt?: string | null;
  resolutionPath?: string;
}

/** Shared badge predicate for processed / history row shapes. */
export function packetShowsEditBadge(p: {
  editCount?: number;
  editedAt?: string | null;
  isEdit?: boolean;
  requestType?: string;
  status?: string;
} | null | undefined): boolean {
  if (!p) return false;
  if (typeof p.editCount === 'number' && p.editCount > 0) return true;
  if (typeof p.editedAt === 'string' && p.editedAt.length > 0) return true;
  if (p.isEdit === true) return true;
  if (p.requestType === 'edit') return true;
  if (p.status === 'edited') return true;
  return false;
}

export function formatEditSourceLabel(source: string | undefined | null): string {
  switch (source) {
    case 'wbm':
      return 'WB-M';
    case 'dashboard':
      return 'Dashboard';
    case 'legacy':
      return 'Legacy';
    default:
      return source ? String(source) : 'Unknown';
  }
}

/** 24h window for client-side gating (server is authoritative). */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinEditWindow(
  originalSubmissionAt: string | number | Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (originalSubmissionAt == null || originalSubmissionAt === '') return true;
  const originMs =
    typeof originalSubmissionAt === 'number'
      ? originalSubmissionAt
      : new Date(originalSubmissionAt).getTime();
  if (!Number.isFinite(originMs)) return true;
  return nowMs - originMs <= EDIT_WINDOW_MS;
}
