/**
 * Badge-only helpers for WB-M (independently safe tranche).
 *
 * Recognizes modern processed markers (editedAt / editCount) and legacy
 * isEdit / requestType:'edit' / local status:'edited'.
 *
 * Does NOT read packets/editHistory or depend on undeployed Functions.
 */

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

/** True when we only know "was edited" without field-level trail data. */
export function hasEditedMarkerWithoutDetail(p: {
  editedAt?: string | null;
  editCount?: number;
  isEdit?: boolean;
  requestType?: string;
  status?: string;
} | null | undefined): boolean {
  return packetShowsEditBadge(p);
}
