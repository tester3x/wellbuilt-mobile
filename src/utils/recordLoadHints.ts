/**
 * Pure hint math for the Record Load (pull) form.
 *
 * Extracted verbatim from app/record.tsx so the live-draft hint derivation is
 * unit-testable: while a measurement field is active in the custom keypad, its
 * visible value is the keypad DRAFT, not the committed form state — hints must
 * derive from the draft to update key-by-key. The math itself is unchanged.
 */

import { deriveBottomInches } from '../domain/wbmEditForm';

// Parse level input - handles multiple formats:
// "6.4" → 6.4 feet (decimal feet - for quick entry)
// "6 4" → 6' 4" (space separated, integer inches)
// "6 4.5" → 6' 4.5" (space separated, fractional inches for precision)
// "6'4" or "6'4\"" → 6' 4"
// "6'4.5" → 6' 4.5" (fractional inches)
// "6" → 6' 0"
export const parseLevel = (input: string): number | null => {
  // Keep ONLY digits, dots, and spaces. Everything else (quotes, backticks, primes,
  // smart quotes, unicode symbols, whatever iOS/OneUI invents next) becomes a space.
  // This makes parsing immune to any keyboard symbol variation.
  const stripped = input
    .replace(/[^\d.\s]/g, ' ')  // anything that isn't a digit, dot, or space → space
    .replace(/\s+/g, ' ')       // collapse multiple spaces
    .trim();

  if (!stripped) return null;

  // Check for space-separated feet and inches: "10 4" or "10 4.5"
  const spaceMatch = stripped.match(/^(\d+)\s+(\d+(?:\.\d+)?)$/);
  if (spaceMatch) {
    const ft = parseInt(spaceMatch[1], 10);
    const inch = parseFloat(spaceMatch[2]);
    return ft + inch / 12;
  }

  // Check for pure decimal with no space: 6.4 means 6.4 feet (decimal feet)
  // This is different from "6 4" which means 6 feet 4 inches
  if (stripped.includes('.') && !stripped.includes(' ')) {
    const val = parseFloat(stripped);
    return isNaN(val) ? null : val;
  }

  // Plain number - treat as feet only: 6 → 6' 0"
  const val = parseInt(stripped, 10);
  return isNaN(val) ? null : val;
};

// Format level for display - floors to whole inches
// Always floor so timestamp backdating math works correctly
// Driver sees conservative level, math uses precise timestamp adjustment
export const formatLevelDisplay = (feet: number): string => {
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
};

// Format hint based on current input - shows floored display value
// Driver sees what they'll see everywhere else in the app
export const getLevelHint = (input: string, defaultHint: string, invalidHint: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return defaultHint;

  const parsed = parseLevel(trimmed);
  if (parsed === null) return invalidHint;

  // Show the floored display value (what they'll see everywhere)
  return `= ${formatLevelDisplay(parsed)}`;
};

// Format feet to display string (alias for consistency)
export const formatFeetInches = formatLevelDisplay;

// Format level as input string (feet inches with space)
// Always floor to match display everywhere
export const formatLevelForInput = (feet: number): string => {
  // Add small epsilon to handle floating point precision (e.g., 23.9999... → 24)
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft} ${inches}`;
};

// Bottom level after pull: bottom = tankLevel - (bblsTaken / bblPerFoot).
// Returns null (blank hint) for empty/invalid/zero input — unchanged behavior.
export const computeBottomLevelHint = (
  levelInput: string,
  barrelsInput: string,
  bblPerFoot: number,
): string | null => {
  const tankLevel = parseLevel(levelInput);
  const bblsTaken = parseFloat(barrelsInput);
  if (tankLevel === null || isNaN(bblsTaken) || bblsTaken <= 0) return null;

  // THE shared domain calc (mirrors the server): work in canonical inches, then
  // to feet, clamped for display. Identical result to the historical
  // tankLevel - bbls/bblPerFoot, now single-sourced.
  const bottomInches = deriveBottomInches(tankLevel * 12, bblsTaken, bblPerFoot);
  const bottomLevel = Math.max(bottomInches / 12, 0);
  return formatFeetInches(bottomLevel);
};

export type RecordLoadBlockReason = 'no_well' | 'missing_level' | 'missing_barrels';

/**
 * THE Record Load required-field validation authority. Extracted verbatim
 * from handleSubmit's pre-flight checks (app/record.tsx) and now called by
 * BOTH the submit path (to pick the rejection alert) and the keypad's Done
 * gate (to dim Done until the form is complete) — one source, no drift.
 *
 * Existing rules, unchanged:
 *  - no well selected → 'no_well'
 *  - level unparseable AND well not down → 'missing_level'
 *  - well not down AND barrels empty/non-numeric → 'missing_barrels'
 *  - well down alone is a valid submission (level/barrels optional there)
 * The future-time guard is NOT here: it stays a submit-time check with its
 * interactive "Use current time" recovery dialog.
 */
export const getRecordLoadBlockReason = (form: {
  wellName: string;
  level: string;
  barrels: string;
  wellDown: boolean;
}): RecordLoadBlockReason | null => {
  if (!form.wellName) return 'no_well';
  if (parseLevel(form.level) === null && !form.wellDown) return 'missing_level';
  if (!form.wellDown && (!form.barrels || !/^\d+(\.\d+)?$/.test(form.barrels.trim()))) {
    return 'missing_barrels';
  }
  return null;
};

/** Done-gate predicate: the whole Record Load form would pass submit's
 *  required-field validation right now. */
export const isRecordLoadSubmitReady = (form: {
  wellName: string;
  level: string;
  barrels: string;
  wellDown: boolean;
}): boolean => getRecordLoadBlockReason(form) === null;

/**
 * The value a measurement field is showing RIGHT NOW: the custom-keypad draft
 * while that field owns the active keypad session, else the committed form
 * state. Hints derived from this update on every keypad key press.
 */
export const liveMeasurementValue = (
  fieldKey: string,
  committedValue: string,
  activeFieldKey: string | null,
  draft: string,
): string => (activeFieldKey === fieldKey ? draft : committedValue);
