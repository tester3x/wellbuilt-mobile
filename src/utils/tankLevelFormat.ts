/**
 * Normalize tank-level display on commit (blur / Done).
 * Matches TicketFieldRenderer + TicketForm formatLevel behavior — does not
 * change parseLevelToFeet / storage semantics.
 */

export type MeasurementValidationResult =
  | { valid: true }
  | {
      valid: false;
      reason: 'inches_out_of_range';
      invalidStart: number;
      invalidEnd: number;
    };

function parseInchesComponent(s: string): number | null {
  if (!s.length) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate a keypad draft for feet-and-inches inch range (0–11).
 * Returns structured result with invalid substring range for inline display.
 * Partial drafts remain editable; only clearly parsed inches > 11 are rejected.
 */
export function validateMeasurementDraft(draft: string): MeasurementValidationResult {
  if (!draft) return { valid: true };

  // Decimal feet — digits after the dot are not inches.
  if (/^\d+\.\d*$/.test(draft) && !draft.includes("'")) {
    return { valid: true };
  }

  // Apostrophe feet'inches with optional trailing quote.
  const aposMatch = draft.match(/^(\d+)'(\d+(?:\.\d+)?)("?)$/);
  if (aposMatch) {
    const inchStr = aposMatch[2];
    const inches = parseInchesComponent(inchStr);
    if (inches !== null && inches > 11) {
      const invalidStart = aposMatch[1].length + 1;
      return {
        valid: false,
        reason: 'inches_out_of_range',
        invalidStart,
        invalidEnd: invalidStart + inchStr.length,
      };
    }
    return { valid: true };
  }

  // Feet'inches digits in progress (no trailing quote yet).
  const aposPartial = draft.match(/^(\d+)'(\d+)$/);
  if (aposPartial) {
    const inchStr = aposPartial[2];
    const inches = parseInchesComponent(inchStr);
    if (inches !== null && inches > 11) {
      const invalidStart = aposPartial[1].length + 1;
      return {
        valid: false,
        reason: 'inches_out_of_range',
        invalidStart,
        invalidEnd: invalidStart + inchStr.length,
      };
    }
    return { valid: true };
  }

  // Feet with apostrophe only — partial entry.
  if (/^\d+'$/.test(draft)) return { valid: true };

  // Space-separated feet and inches.
  const spaceMatch = draft.match(/^(\d+)(\s+)(\d+(?:\.\d+)?)$/);
  if (spaceMatch) {
    const inchStr = spaceMatch[3];
    const inches = parseInchesComponent(inchStr);
    if (inches !== null && inches > 11) {
      const invalidStart = spaceMatch[1].length + spaceMatch[2].length;
      return {
        valid: false,
        reason: 'inches_out_of_range',
        invalidStart,
        invalidEnd: invalidStart + inchStr.length,
      };
    }
    return { valid: true };
  }

  // Feet with trailing space — partial entry.
  if (/^\d+\s+$/.test(draft)) return { valid: true };

  // Inches-only with quote (no feet/apostrophe).
  if (!draft.includes("'")) {
    const inchOnly = draft.match(/^(\d+)(")$/);
    if (inchOnly) {
      const inches = parseInchesComponent(inchOnly[1]);
      if (inches !== null && inches > 11) {
        return {
          valid: false,
          reason: 'inches_out_of_range',
          invalidStart: 0,
          invalidEnd: inchOnly[1].length,
        };
      }
      return { valid: true };
    }
  }

  // Plain integer feet.
  if (/^\d+$/.test(draft)) return { valid: true };

  // Unrecognized partial pattern — remain editable without blocking.
  return { valid: true };
}

/** Whether Done/Next may commit the current draft. */
export function canCommitMeasurementDraft(draft: string): boolean {
  return validateMeasurementDraft(draft).valid;
}

/** Numeric keypad (BBLs) — digits/decimal only. Empty/zero allowed; symbols blocked. */
export function canCommitNumericDraft(draft: string): boolean {
  const trimmed = draft.trim();
  if (!trimmed) return true;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) && n >= 0;
}

export function formatNumericOnCommit(draft: string): string {
  return draft.trim();
}

export function formatLevelOnCommit(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  // Already feet'inches" — preserve as typed
  if (trimmed.includes("'") || trimmed.includes('"')) {
    return trimmed;
  }

  const stripped = trimmed.replace(/[^\d.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return trimmed;

  // Feet AND inches (space-separated): "11 7" → "11'7""
  const parts = stripped.match(/^(\d+)\s+(\d+(?:\.\d+)?)$/);
  if (parts) {
    return `${parts[1]}'${parts[2]}"`;
  }

  // Feet only (plain integer or decimal): "10" → "10'0"", "10.5" → "10'6""
  const feetOnly = stripped.match(/^(\d+)(?:\.(\d+))?$/);
  if (feetOnly) {
    const ft = feetOnly[1];
    const decPart = feetOnly[2] ? parseFloat(`0.${feetOnly[2]}`) : 0;
    const inches = Math.round(decPart * 12);
    return `${ft}'${inches}"`;
  }

  return trimmed;
}