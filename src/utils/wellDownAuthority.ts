// Authoritative Well Down resolution for a WB-M Record Load submit.
//
// THE DEFECTS this guards against:
//   1. A stale React closure — the keypad's Done handler was captured when the
//      measurement field was ACTIVATED (before the driver toggled the box), so
//      handleSubmit read a pre-toggle `wellDown`. The screen fixes this by
//      reading the live value from a ref and passing it here.
//   2. Truthiness presence checks (`if (wellDown)`) that silently drop `false`.
//      This module treats `false` as a first-class explicit value.
//   3. An UNTOUCHED checkbox asserting authority. The checkbox is seeded from
//      canonical status for DISPLAY only. If the driver never touches it, this
//      pull must NOT command a status change — because the canonical status may
//      have changed (e.g. an admin marked the well down) while the form was open,
//      and re-asserting the stale seeded value would overwrite that newer status.
//
// CONTRACT (server processIncomingPull + wbmPullAuthorize):
//   const authoritative =
//     data.wellDownIsAuthoritative === true && typeof data.wellDown === 'boolean';
//   const nextIsDown = authoritative ? data.wellDown : existingIsDown;
//   `wellDownIsAuthoritative` is an OPTIONAL boolean; false or omitted ⇒ the
//   server PRESERVES its current canonical status. A missing/non-boolean
//   wellDown fails CLOSED (status preserved) even when authoritative is true.
//
// THEREFORE:
//   • Untouched box → wellDownIsAuthoritative:false (seeded wellDown is display
//     only; the server keeps canonical status, immune to a concurrent change).
//   • Explicit toggle → the driver's own boolean (incl. false) with
//     wellDownIsAuthoritative:true (the intended transition).

export interface WellDownResolution {
  /** Explicit final-state boolean to place on the packet. Never undefined. For
   *  an untouched box this is the seeded canonical value carried for display; the
   *  server ignores it because wellDownIsAuthoritative is false. */
  wellDown: boolean;
  /** Whether THIS pull asserts well-status authority. True ONLY when the driver
   *  explicitly touched the checkbox. Initial seeding is never authority. */
  wellDownIsAuthoritative: boolean;
}

export interface WellDownResolutionInput {
  /** Canonical well status at form open (snapshot.isDown). Carried for display
   *  on an untouched submit; never commands a change. */
  canonicalIsDown: boolean;
  /** Current checkbox visual state (the driver's toggled value when touched). */
  checkboxWellDown: boolean;
  /** True only when the driver explicitly tapped the Well Down checkbox.
   *  Initial seeding from canonical status is NOT a touch. */
  touched: boolean;
}

/**
 * Resolve the explicit wellDown boolean + authority flag for a submit.
 *
 * - Touched   → the driver's toggled value, ASSERTED (authoritative:true).
 * - Untouched → display-only seed, NOT asserted (authoritative:false) so the
 *   server preserves whatever canonical status it currently holds — immune to
 *   both the async-seed race and a concurrent server-side status change.
 *
 * Presence is checked explicitly against booleans — `false` is a valid,
 * load-bearing value on both fields.
 */
export function resolveWellDownForSubmit(input: WellDownResolutionInput): WellDownResolution {
  if (input.touched === true) {
    return { wellDown: input.checkboxWellDown === true, wellDownIsAuthoritative: true };
  }
  // Untouched: carry the canonical value for display, assert NO authority.
  return { wellDown: input.canonicalIsDown === true, wellDownIsAuthoritative: false };
}

/**
 * Faithful mirror of the server's status-flip decision (see CONTRACT above).
 * Used in tests to prove a resolved packet produces the intended transition (or,
 * for an untouched box, PRESERVES canonical status regardless of a concurrent
 * change), and that a missing/non-boolean wellDown fails closed.
 *
 * Deliberately loose on input types — it reasons about malformed wire shapes
 * (undefined / string / number) exactly as the server does.
 */
export function backendNextIsDown(input: {
  existingIsDown: boolean;
  packetWellDown: unknown;
  packetWellDownIsAuthoritative: unknown;
}): boolean {
  const authoritative =
    input.packetWellDownIsAuthoritative === true &&
    typeof input.packetWellDown === 'boolean';
  return authoritative ? (input.packetWellDown as boolean) : input.existingIsDown === true;
}
