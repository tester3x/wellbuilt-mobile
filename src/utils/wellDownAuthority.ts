// Authoritative Well Down resolution for a WB-M Record Load submit.
//
// THE DEFECT this guards against: a driver opens Record Load on a DOWN well
// (checkbox seeded checked from canonical status), explicitly UNCHECKS it
// (down -> online), and taps Done on the custom numeric keypad. The explicit
// false must reach the packet. Two things historically lost it:
//   1. A stale React closure — the keypad's Done handler was captured when the
//      measurement field was ACTIVATED (before the driver toggled the box), so
//      handleSubmit read a pre-toggle `wellDown`. The screen fixes this by
//      reading the live value from a ref and passing it here.
//   2. Truthiness presence checks (`if (wellDown)`) that silently drop `false`.
//      This module treats `false` as a first-class explicit value.
//
// BACKEND CONTRACT (functions/src/index.ts processIncomingPull, 5/8/2026):
//   const incomingHasAuthoritativeWellDown =
//     data.wellDownIsAuthoritative === true && typeof data.wellDown === 'boolean';
//   const nextIsDown = incomingHasAuthoritativeWellDown ? data.wellDown : existingIsDown;
// i.e. the server changes wells/{name}/status/isDown ONLY when the packet
// carries wellDownIsAuthoritative === true AND an explicit boolean wellDown.
// A missing/non-boolean wellDown fails CLOSED (status preserved) even when
// authoritative is true.
//
// WB-M CONTRACT NOTE: buildWbmPullCommand emits wellDownIsAuthoritative:true on
// EVERY pull — that is a cross-repo governed contract, pinned by the golden
// fixture (governedContractFixture.test.ts) and the server's
// EXPECTED_CLIENT_CONTRACT. We do NOT change it here. Instead, an UNTOUCHED
// checkbox submits the CANONICAL wellDown value, so the server computes
// nextIsDown === existingIsDown — a non-transition. An explicit toggle submits
// the driver's value, producing the intended transition. This satisfies "an
// untouched checkbox must not manufacture a transition" without breaking the
// pinned always-authoritative contract.

export interface WellDownResolution {
  /** Explicit final-state boolean to place on the packet. Never undefined. */
  wellDown: boolean;
  /** Whether this pull asserts well-status authority. WB-M pulls are always
   *  authoritative (pinned contract); the non-transition guarantee for an
   *  untouched box comes from `wellDown` matching canonical, not from lowering
   *  this flag. */
  wellDownIsAuthoritative: boolean;
}

export interface WellDownResolutionInput {
  /** Canonical well status at form open (snapshot.isDown). The value an
   *  untouched submit preserves. */
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
 * - Touched  -> the driver's toggled value (the transition they asked for).
 * - Untouched -> the canonical value (a deliberate non-transition; immune to
 *   the async-seed race, since it never depends on the checkbox state having
 *   been seeded yet).
 *
 * `wellDownIsAuthoritative` is always true (WB-M pinned contract). Presence is
 * checked explicitly against booleans — `false` is a valid, load-bearing value.
 */
export function resolveWellDownForSubmit(input: WellDownResolutionInput): WellDownResolution {
  const wellDown = input.touched === true
    ? input.checkboxWellDown === true
    : input.canonicalIsDown === true;
  return { wellDown, wellDownIsAuthoritative: true };
}

/**
 * Faithful mirror of the server's status-flip decision (see BACKEND CONTRACT
 * above). Used in tests to prove that a resolved packet produces the intended
 * transition (or non-transition), and that a missing/non-boolean wellDown fails
 * closed. Kept in the client so the two stay honest about the same rule.
 *
 * Deliberately loose on the input types — it must reason about malformed wire
 * shapes (undefined / string / number) exactly as the server does.
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
