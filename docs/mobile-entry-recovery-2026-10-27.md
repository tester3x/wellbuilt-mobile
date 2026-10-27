# Mobile post-update entry recovery

Branch: `codex/wbm-stale-level-20261005`. Prior tested APK: M113, tank-height changes included.

## Evidence and limits

The first M113 launch displayed an empty screen with a default small spinner. Process initialization ran, but the well screen never mounted. A process restart restored normal entry. The old trace does not identify the route or awaited operation, so it does not prove an exact root cause.

Three subsequent reinstalls of M113 on S24 reopened successfully, including a Suite-created `app-open` task. The intermittent original failure has not been reproduced reliably.

The app-open/SSO entry implementation had a concrete recovery weakness: a mount-lifetime one-shot ref ignored later focus and owner changes, with an imperative redirect and no deadline. A stranded entry therefore had no automatic recovery path.

## Change

- Wait for account restoration and root navigation readiness.
- React to focus and strict owner-parameter changes; cancel obsolete reads and external opens.
- Render a declarative redirect after the existing fenced established-access check succeeds.
- Recheck established access after eight seconds if still in entry; do not create another PKCE attempt or replay authorization codes.
- Stop the spinner after twenty seconds with in-app Retry and Back to WB S. A timeout never grants access or deletes work.
- Log only fixed entry phase labels, without owner hints, URLs, or credentials.

## Validation

24 focused tests passed: actual entry screen lifecycle, delayed navigator/account readiness, changed owner, focus return, invalid parameters, cancelled/late results, hung reads, delayed handoff recovery, no duplicate PKCE, session fences and tank heights.

TypeScript still reports existing project errors; none identify changed entry files. Additional session/eligibility/security checks: 78 passed, with one previously recorded baseline source-scanner failure in `ssoLogout.test.ts`; the full project suite is not claimed green.

Desktop fresh-water work exists separately on `origin/release/wbm-vc60-zombie-recovery-20260926`; this change does not replace or merge that branch.

## Build and S24 acceptance

EAS build `24a8d652-b89c-468f-b3b8-34ea66c1d378` finished successfully from exact source `c4d2bae2d0d95b4aa1a2d749c5e6bab3007e71bf`. The shared remote counter assigned versionCode **116**, rather than the initially anticipated 114. Package `com.wellbuiltmobile.app`, ARM64, matching established signing certificate. APK SHA-256: `3690a6c3f167414db2245ac1b35b61a395e83a1e94d6c479acb828c483edd583`.

The S24 was verified on 113 with a Suite-created app-open task before installation. Data-preserving replacement installation succeeded, and package-manager readback confirms 116. No force-stop, process kill, data clear or restart was performed after the update. Android automatically restored the activity; a normal launcher intent was delivered to that already running activity. Fixed-label entry logs show checking -> ready in approximately 170 ms. The well screen was visibly rendered in the first capture at 2.43 seconds, remained usable in the 8/20-second captures and retained the authenticated 21-well catalogue. Two subsequent Suite -> Mobile roundtrips returned to that well screen in the same process, without an entry failure.

The old intermittent stall was not reproduced before the change, so this proves successful first-launch/update and recovery regression coverage, not definitive retrospective proof of the original awaited operation. No load, tank edit, shift or authentication bypass was submitted. Private captures/logs and the APK remain outside Git. **ZFold is not installed**; this tested checkpoint is ready for later deliberate integration/installation, preserving the separate desktop fresh-water lane.
