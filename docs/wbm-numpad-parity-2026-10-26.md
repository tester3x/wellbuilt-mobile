# WB M custom numpad parity — 2026-10-26

Carries the WB T keypad arrangement into WB M: Next upper right, Delete below it, cursor keys on the third row, decimal and gold close chevron on the bottom row. Preserves WB M's native blocked-key touch protection, keypad touch fence, selection handling, feet/inch parsing and Next handoff.

Android navigation is hidden only while a measurement session owns it. Serialized native calls prevent a late hide from winning after close; foreground refresh respects active owners. Close, blank-area dismissal, hardware Back and provider unmount restore normal navigation. Android keypad geometry no longer reserves the pre-hide navigation inset; iOS home-indicator clearance remains.

WB M previously used Done to submit a new pull. The close chevron instead commits the field without calling the workflow completion handler. Record Load now exposes its existing Submit control for new pulls after the keypad closes, retaining form validation and duplicate-submit protection. Save Edit and edit cancellation remain explicit. The shared close operation commits once rather than flushing and then committing the same draft a second time.

Validation before build:
- 83 focused tests pass, including actual provider close/no-submit behavior, invalid draft close, Back dismissal, Next handoff ownership, visibility races and native-call failure recovery.
- Changed-file lint: zero errors, ten pre-existing warnings.
- Full Jest run: 105 suites pass; seven service/security suites have 15 failures. Running those same seven against an isolated unchanged HEAD reproduces all 15 failures (69 other tests in those suites pass).
- Project TypeScript still reports existing unrelated errors; none reference changed app/keypad/navigation files.
- No backend, dependency, runtime, tank calibration or pull data changes.

Build and physical acceptance pending.
