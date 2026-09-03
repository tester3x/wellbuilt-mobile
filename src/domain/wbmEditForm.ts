/**
 * WB-M Edit-Pull DOMAIN — the single source of truth for the edit form's math,
 * normalization, changed-only field mask, Well-Down authority, and the immutable
 * finalize/snapshot the Save button consumes.
 *
 * WHY THIS EXISTS
 * The live bottom-level preview, the saved local operation, the wire payload, the
 * server apply, and the History card must all agree EXACTLY. Historically the
 * bottom-level formula was triplicated (recordLoadHints, record.tsx ×2,
 * history.tsx) and `editedFields` was a hardcoded always-on mask that never
 * diffed against the original. This module replaces both with ONE pure calc and
 * ONE changed-only diff, mirroring the server's canonical formulas
 * (functions/src/tankFormulas.ts + chronoRecompute.computeBottomInches):
 *
 *   tankTopInches   = tankLevelFeet * 12
 *   bblsInInches    = (bbls > 0 && bblPerFoot > 0) ? (bbls / bblPerFoot) * 12 : 0
 *   bottomInches    = tankTopInches - bblsInInches          // total-bank bblPerFoot, NEVER ÷ tanks
 *
 * PURE: no React, no storage, no clock, no crypto. `finalizeEdit` returns a
 * deterministic result (including a canonical string the caller hashes for the
 * op digest) so Save can act on the returned value directly and never read a
 * stale closure.
 */

// ---------------------------------------------------------------------------
// Canonical shared calc (mirror of server tankFormulas.ts) — inches canonical.
// ---------------------------------------------------------------------------

/** feet + inches (0..12) → decimal feet, the canonical wire top-level value. */
export function feetInchesToFeet(feet: number, inches: number): number {
  const f = Number.isFinite(feet) ? feet : 0;
  const i = Number.isFinite(inches) ? inches : 0;
  return f + i / 12;
}

/** decimal feet → canonical tankTopInches (server: tankLevelFeet * 12). */
export function tankTopInchesFromFeet(tankLevelFeet: number): number {
  return (Number.isFinite(tankLevelFeet) ? tankLevelFeet : 0) * 12;
}

/** server computeBblsInInches — 0 when no pull (handles literal-zero bbls). */
export function bblsInInches(bblsTaken: number, bblPerFoot: number): number {
  return bblsTaken > 0 && bblPerFoot > 0 ? (bblsTaken / bblPerFoot) * 12 : 0;
}

/** THE shared derived-bottom calc, in inches. Not clamped (matches server row). */
export function deriveBottomInches(tankTopInches: number, bblsTaken: number, bblPerFoot: number): number {
  return tankTopInches - bblsInInches(bblsTaken, bblPerFoot);
}

/** Convenience: derived bottom straight from feet+inches+bbls. */
export function deriveBottomInchesFromFeet(tankLevelFeet: number, bblsTaken: number, bblPerFoot: number): number {
  return deriveBottomInches(tankTopInchesFromFeet(tankLevelFeet), bblsTaken, bblPerFoot);
}

/** Display formatter: N" → `F'I"`, clamped at 0 for presentation only. */
export function formatInchesToFeetInches(totalInches: number): string {
  const clamped = Math.max(Number.isFinite(totalInches) ? totalInches : 0, 0);
  let feet = Math.floor(clamped / 12);
  let inches = Math.round(clamped - feet * 12);
  if (inches === 12) { feet += 1; inches = 0; } // rounding carry
  return `${feet}'${inches}"`;
}

// ---------------------------------------------------------------------------
// Normalization + immutable original snapshot.
// ---------------------------------------------------------------------------

/** The immutable original, captured when the edit form opens. */
export interface OriginalSnapshot {
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  /** Canonical pull-effective instant. */
  dateTimeUTC: string;
  /** Local display string mirror (kept for the wire; not a diff dimension). */
  dateTime?: string | null;
}

/** Raw form draft (already flushed from the keypad — no hidden buffer). */
export interface EditFormDraft {
  topFeet: number;
  topInches: number;
  bbls: number;
  /** Effective pull instant chosen in the form (date+time frozen together). */
  dateTimeUTC: string;
  dateTime?: string | null;
  wellDown: boolean;
  /** True only if the driver actually toggled Well-Down in this session. */
  wellDownTouched: boolean;
}

/** The normalized values that go on the wire (server rebuilds the row from these). */
export interface NormalizedEditPayload {
  /** Canonical wire top-level value (decimal feet), full precision. */
  tankLevelFeet: number;
  /** Exact canonical top inches (feet*12 + inches) — used for the derived bottom. */
  tankTopInches: number;
  bblsTaken: number;
  wellDown: boolean;
  dateTimeUTC: string;
  dateTime: string | null;
}

/** Tolerance for treating two measurements as unchanged (well below display res). */
const EPS = 1e-6;
function num(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function normalizeDraft(draft: EditFormDraft): NormalizedEditPayload {
  // Keep tankLevelFeet at full float precision: feet+inches reconstruct exactly
  // the same float the original CREATE stored (both are `feet + inches/12`), so
  // an unchanged top-level is an exact no-op, while the EXACT inches drive the
  // derived bottom with no rounding error (11'10" → 142", not 141.996").
  const topInches = num(draft.topFeet) * 12 + num(draft.topInches);
  return {
    tankLevelFeet: feetInchesToFeet(draft.topFeet, draft.topInches),
    tankTopInches: topInches,
    bblsTaken: num(draft.bbls),
    wellDown: draft.wellDown === true,
    dateTimeUTC: draft.dateTimeUTC,
    dateTime: draft.dateTime ?? null,
  };
}

// ---------------------------------------------------------------------------
// Well-Down authority (edit path).
// ---------------------------------------------------------------------------

export interface WellDownResolution {
  /** Value carried on the wire so the server rebuilds the row correctly. */
  wellDown: boolean;
  /** true only when the driver explicitly changed Well-Down to a NEW value. */
  wellDownIsAuthoritative: boolean;
  /** true when Well-Down should appear in the changed-only mask. */
  changed: boolean;
}

/**
 * Untouched → non-authoritative, carries the canonical value, absent from the
 * mask. Touched-but-restored-to-original → non-authoritative, absent (no edit).
 * Touched to a genuinely NEW value (including explicit false) → authoritative,
 * its own boolean, present in the mask.
 */
export function resolveWellDownForEdit(draft: EditFormDraft, original: OriginalSnapshot): WellDownResolution {
  if (!draft.wellDownTouched) {
    return { wellDown: original.wellDown === true, wellDownIsAuthoritative: false, changed: false };
  }
  const next = draft.wellDown === true;
  if (next === (original.wellDown === true)) {
    // Toggled away and back → no edit for this field.
    return { wellDown: original.wellDown === true, wellDownIsAuthoritative: false, changed: false };
  }
  return { wellDown: next, wellDownIsAuthoritative: true, changed: true };
}

// ---------------------------------------------------------------------------
// Changed-only field mask (canonical wire names, one entry per logical dimension).
// ---------------------------------------------------------------------------

export type EditedField = 'tankLevelFeet' | 'bblsTaken' | 'wellDown' | 'dateTimeUTC';

/** Before/after per changed dimension, for the immutable op snapshot + display. */
export interface EditedFieldChange {
  field: EditedField;
  previous: number | boolean | string;
  next: number | boolean | string;
}

export interface EditDiff {
  editedFields: EditedField[];
  changes: EditedFieldChange[];
}

/**
 * Deterministic changed-only diff. Feet AND/OR inches collapse into the single
 * canonical `tankLevelFeet`. Date AND/OR time collapse into the single canonical
 * `dateTimeUTC`. BBL change (including a valid literal 0) is `bblsTaken`. The
 * derived bottom is NEVER emitted — it is server/domain-derived. A field changed
 * then restored to its original value produces no entry.
 */
export function diffEditedFields(
  normalized: NormalizedEditPayload,
  original: OriginalSnapshot,
  wellDown: WellDownResolution,
): EditDiff {
  const editedFields: EditedField[] = [];
  const changes: EditedFieldChange[] = [];

  const origFeet = num(original.tankLevelFeet);
  if (Math.abs(normalized.tankLevelFeet - origFeet) >= EPS) {
    editedFields.push('tankLevelFeet');
    changes.push({ field: 'tankLevelFeet', previous: origFeet, next: normalized.tankLevelFeet });
  }

  const origBbls = num(original.bblsTaken);
  if (Math.abs(normalized.bblsTaken - origBbls) >= EPS) {
    editedFields.push('bblsTaken');
    changes.push({ field: 'bblsTaken', previous: origBbls, next: normalized.bblsTaken });
  }

  if (normalized.dateTimeUTC !== original.dateTimeUTC) {
    editedFields.push('dateTimeUTC');
    changes.push({ field: 'dateTimeUTC', previous: original.dateTimeUTC, next: normalized.dateTimeUTC });
  }

  if (wellDown.changed) {
    editedFields.push('wellDown');
    changes.push({ field: 'wellDown', previous: original.wellDown === true, next: wellDown.wellDown });
  }

  return { editedFields, changes };
}

// ---------------------------------------------------------------------------
// finalizeEdit — the pure authority Save consumes directly.
// ---------------------------------------------------------------------------

export interface FinalizedEdit {
  hasChanges: boolean;
  normalized: NormalizedEditPayload;
  bottomInches: number;
  editedFields: EditedField[];
  changes: EditedFieldChange[];
  wellDownIsAuthoritative: boolean;
  editEventId: string;
  /** Deterministic canonical string of the applied edit; caller hashes → digest. */
  canonicalString: string;
  original: OriginalSnapshot;
}

/**
 * Finalize the flushed draft against the immutable original with the well's
 * authoritative total-bank bblPerFoot. Returns everything Save needs: the full
 * normalized payload (server rebuilds the row from it), the derived bottom (same
 * calc as the live preview), the changed-only mask, Well-Down authority, and a
 * deterministic canonical string for the op digest. When nothing changed,
 * `hasChanges` is false and Save must create NO op, marker, or request.
 */
export function finalizeEdit(input: {
  draft: EditFormDraft;
  original: OriginalSnapshot;
  bblPerFoot: number;
  editEventId: string;
}): FinalizedEdit {
  const normalized = normalizeDraft(input.draft);
  const wellDownRes = resolveWellDownForEdit(input.draft, input.original);
  // The payload carries the resolved (canonical-when-untouched) Well-Down value.
  normalized.wellDown = wellDownRes.wellDown;

  const { editedFields, changes } = diffEditedFields(normalized, input.original, wellDownRes);
  const bottomInches = deriveBottomInches(
    normalized.tankTopInches, // exact inches — no feet-rounding error
    normalized.bblsTaken,
    input.bblPerFoot,
  );

  // Canonical string: stable key order over the CHANGED payload + mask + id, so a
  // re-Save of the same edit hashes identically (idempotent) and any value change
  // yields a different digest (forcing a fresh editEventId for a genuinely new edit).
  const canonicalString = JSON.stringify({
    editEventId: input.editEventId,
    originalPacketId: undefined, // set by caller-side wire; excluded here to keep this value-only
    editedFields: [...editedFields].sort(),
    values: editedFields.reduce<Record<string, number | boolean | string>>((acc, f) => {
      acc[f] = normalized[f] as number | boolean | string;
      return acc;
    }, {}),
    wellDownIsAuthoritative: wellDownRes.wellDownIsAuthoritative,
  });

  return {
    hasChanges: editedFields.length > 0,
    normalized,
    bottomInches,
    editedFields,
    changes,
    wellDownIsAuthoritative: wellDownRes.wellDownIsAuthoritative,
    editEventId: input.editEventId,
    canonicalString,
    original: input.original,
  };
}
