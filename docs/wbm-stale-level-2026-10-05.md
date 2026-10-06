# WB M stale level correction — 2026-10-05

Branch: codex/wbm-stale-level-20261005.
Base: 6c04949, origin/release/wbm-vc60-zombie-recovery-20260926.
Original dirty mobile checkout preserved unchanged.

Initial load applied growth only to snapshots younger than seven days; navigation and periodic refresh disagreed. All four screen projection paths now share estimatedSnapshotLevel. Old active snapshots keep growing to the 20-foot display cap; down wells stay at their bottom. Invalid/future timestamps and invalid rates do not grow.

Validation: four focused suites, 22 tests passed; git diff --check passed. Full TypeScript check reports errors in unchanged manager, WhatsNew, auth credentials, and contracts transport sources/dependencies; no errors in changed files. No Firebase measurement changes.

Source checkpoint only: not built, installed, or verified on phone. Next: build from this branch with required private build configuration, install, verify AddedTest/Test Well immediately on entry and after repeated swipes, and verify down-well freeze. A new pull is not required to repair the display.
