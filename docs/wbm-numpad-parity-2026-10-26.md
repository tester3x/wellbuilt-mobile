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

M109 was built and installed on S24 with a close-only chevron; superseded by the owner clarification above.

## Final M110 delivery

- EAS build `ae89ca37-00cf-4ef1-9def-c2041c533055` finished from exact source `378a64ecb715dc2fe2f027560949b0a63b865fd5`.
- APK package `com.wellbuiltmobile.app`, versionCode 110, versionName 2.1.0, ARM64.
- Signature continuity verified: `4c4f7b4de36380e6326ed5f9296907203b3283061f41b7b0f67ef496d64c814b`.
- APK SHA256: `79730CC96EFD75280CE45D0790321AD696AD96CFD833D9DA97D2EB145C81767C`.
- Data-preserving replacement installation succeeded on S24 and ZFold; package-manager version 110 verified on both.
- S24 M110 physical acceptance: new arrangement and bottom-right Done displayed, system navigation hidden with keypad, tapping form-blocked Done kept keypad open without submitting, hardware Back dismissed keypad while staying on Record Load and restored navigation. Second Back returned to main screen.
- Earlier M109 draft-only check exercised valid level-to-barrels Next handoff and close-only semantics before the owner corrected that behavior. Those screenshots do not prove M110 submission; M110 Done submission is covered by the focused provider and Record Load wiring tests. No production pull was submitted during acceptance.
- Temporary M109 values were cleared through Clear Form before final installation. No app data reset, tank edit, backend deployment or dependency change.
- An earlier blank-scroll-space tap did not dismiss the keypad; this existing overlay path was not changed. Hardware Back and explicit completion were the acceptance paths for this update.

83 focused tests pass with final M110 source. Full-suite unrelated failures described above remain outside this change. APKs and device evidence are private files outside Git.

