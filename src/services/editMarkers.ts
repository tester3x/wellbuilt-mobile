/**
 * Badge-only helpers for WB-M (independently safe tranche).
 *
 * packetShowsEditBadge recognizes historical processed markers
 * (editedAt / editCount / wasEdited) and legacy isEdit /
 * requestType:'edit' / local status:'edited'. Those may badge
 * HISTORICAL rows only — they must never confirm a new secure edit.
 *
 * New secure-edit confirmation is confirmNewSecureEdit() only.
 *
 * Does NOT read packets/editHistory or depend on undeployed Functions.
 */

/** Proof shapes accepted for a NEW secure edit. Legacy markers are ignored. */
export type NewSecureEditProof = {
  committed?: unknown;
  status?: unknown;
  editCommitted?: unknown;
  editCommittedReceiptKey?: unknown;
} | null | undefined;

/**
 * Confirm a new secure edit. Accepts ONLY:
 *   - callable response `{ committed: true }`
 *   - getFieldCommandStatus receipt `{ status: 'committed' }`
 *   - exact server marker: editCommitted === true AND a non-empty editCommittedReceiptKey
 *
 * Legacy editedAt / wasEdited / editedByPacketId / isEdit / requestType:'edit'
 * must NOT confirm.
 */
export function confirmNewSecureEdit(p: NewSecureEditProof): boolean {
  if (!p || typeof p !== 'object') return false;
  if (p.committed === true) return true;
  if (p.status === 'committed') return true;
  const receiptKey = p.editCommittedReceiptKey;
  const hasReceiptKey = typeof receiptKey === 'string' && receiptKey.length > 0;
  if (p.editCommitted === true && hasReceiptKey) return true;
  return false;
}

/** Shared badge predicate for processed / history row shapes. */
export function packetShowsEditBadge(p: {
  editCount?: number;
  editedAt?: string | number | null;
  isEdit?: boolean;
  wasEdited?: boolean;
  requestType?: string;
  status?: string;
  editCommitted?: boolean;
  editCommittedReceiptKey?: string | null;
} | null | undefined): boolean {
  if (!p) return false;
  if (confirmNewSecureEdit(p)) return true;
  // Historical records only. New secure edits must not rely on these.
  if (p.wasEdited === true) return true;
  if (typeof p.editCount === 'number' && p.editCount > 0) return true;
  if (typeof p.editedAt === 'string' && p.editedAt.length > 0) return true;
  if (typeof p.editedAt === 'number' && p.editedAt > 0) return true;
  if (p.isEdit === true) return true;
  if (p.requestType === 'edit') return true;
  if (p.status === 'edited') return true;
  return false;
}

/** Visible history rows after pull/edit/delete. Edited originals stay. */
export function selectVisibleHistoryPackets(
  processed: Record<string, Record<string, unknown>>,
): Array<{ packetId: string; data: Record<string, unknown>; edited: boolean }> {
  const out: Array<{ packetId: string; data: Record<string, unknown>; edited: boolean }> = [];
  for (const [packetId, p] of Object.entries(processed)) {
    if (!p) continue;
    if (p.requestType === 'wellHistory' || p.requestType === 'performanceReport') continue;
    if (p.deleted === true) continue;
    out.push({ packetId, data: p, edited: packetShowsEditBadge(p) });
  }
  return out;
}

/** Job History presentation. Pending/failed must never look like Edited. */
export type HistoryEditPresentation = 'edited' | 'pending' | 'failed' | 'rejected' | 'none';

export function historyEditPresentation(entry: {
  editStatus?: string | null;
  status?: string;
  editedAt?: string | number | null;
  editCount?: number;
  wasEdited?: boolean;
  isEdit?: boolean;
  requestType?: string;
  editCommitted?: boolean;
  editCommittedReceiptKey?: string | null;
} | null | undefined): HistoryEditPresentation {
  if (!entry) return 'none';
  if (entry.editStatus === 'edit_rejected') return 'rejected';
  if (entry.editStatus === 'edit_failed') return 'failed';
  if (entry.editStatus === 'edit_pending' || entry.editStatus === 'edit_submitted') return 'pending';
  if (packetShowsEditBadge(entry)) return 'edited';
  return 'none';
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
