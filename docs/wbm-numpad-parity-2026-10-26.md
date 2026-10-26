# WB M custom numpad parity — 2026-10-26

Carries the WB T keypad arrangement into WB M: Next upper right, Delete below it, cursor keys on the third row, decimal and gold close chevron on the bottom row. Preserves WB M's native blocked-key touch protection, keypad touch fence, selection handling, feet/inch parsing and Next handoff.

Android navigation is hidden only while a measurement session owns it. Serialized native calls prevent a late hide from winning after close; foreground refresh respects active owners. Close, blank-area dismissal, hardware Back and provider unmount restore normal navigation. Android keypad geometry no longer reserves the pre-hide navigation inset; iOS home-indicator clearance remains.

WB M keeps its existing Done behavior: commit the current field, close the keypad and submit a complete new pull. Done stays labeled Done, is gold at bottom right and retains whole-form validation gating. Edit mode Done finishes entry without submitting, preserving Save Edit/Cancel. Unlike WB T, WB M does not use a close-only chevron or a separate new-pull Submit footer. Owner clarified this after the first M109 device check; M110 restores the required behavior.

The shared non-workflow close operation (Back/other input dismissal) commits once rather than flushing and then committing the same draft twice.

Validation before build:
- 83 focused tests pass, including actual provider close/no-submit behavior, invalid draft close, Back dismissal, Next handoff ownership, visibility races and native-call failure recovery.
- Changed-file lint: zero errors, ten pre-existing warnings.
- Full Jest run: 105 suites pass; seven service/security suites have 15 failures. Running those same seven against an isolated unchanged HEAD reproduces all 15 failures (69 other tests in those suites pass).
- Project TypeScript still reports existing unrelated errors; none reference changed app/keypad/navigation files.
- No backend, dependency, runtime, tank calibration or pull data changes.

M109 was built and installed on S24 with a close-only chevron; superseded by the owner clarification above. Corrected build and acceptance pending.
