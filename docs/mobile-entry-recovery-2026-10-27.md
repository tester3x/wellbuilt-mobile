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

TypeScript still reports existing project errors; none identify changed entry files. Device acceptance and exact build identity will be recorded after the S24 update test. ZFold installation is held until that test passes.

Desktop fresh-water work exists separately on `origin/release/wbm-vc60-zombie-recovery-20260926`; this change does not replace or merge that branch.
