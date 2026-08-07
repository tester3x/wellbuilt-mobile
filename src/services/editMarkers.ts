/**
 * Canonical + legacy Edit badge helpers for WB-M.
 * Aligns with Dashboard/functions editHistory contract.
 *
 * Product boundary:
 * - WB-M route/flow corrections have NO 24-hour deadline.
 * - WB-T ticket editing (separate app) has its own 24h ticket limit.
 * - Do not gate WB-M edits on sentAt/editedAt age.
 */

export type EditSource = 'wbm' | 'dashboard' | 'legacy' | 'unknown';

/** Policy pin — must stay false so products are not conflated. */
export const WBM_HAS_EDIT_DEADLINE = false as const;
/** WB-T ticket policy (documentation only; enforced in WB-T, not here). */
export const WBT_TICKET_EDIT_WINDOW_HOURS = 24 as const;

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
  originAppContext?: string | null;
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
    case 'wbt':
      return 'WB-T';
    default:
      return source ? String(source) : 'Unknown';
  }
}

export function formatFieldLabel(field: string): string {
  switch (field) {
    case 'bblsTaken':
      return 'BBLs';
    case 'tankTopInches':
      return 'Top level (in)';
    case 'tankLevelFeet':
      return 'Top level (ft)';
    case 'dateTimeUTC':
      return 'Time (UTC)';
    case 'dateTime':
      return 'Time';
    case 'wellDown':
      return 'Well down';
    default:
      return field;
  }
}

export function formatChangeValue(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
