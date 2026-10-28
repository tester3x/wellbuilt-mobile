# Mobile test recovery, October 27

Started from combined desktop/laptop checkpoint c682c03 on codex/wbm-stale-level-20261005. Fresh fetch found the desktop release/wbm-vc60-zombie-recovery-20260926 branch at the same checkpoint. User authorized investigation and fixes, explicitly no build.

The baseline reproduced 13 failing suites / 26 failing tests, with 107 suites / 1260 tests passing. The failures were not all application defects.

Runtime corrections:

- Edit delivery had both its existing deadline scheduler and a platform queue registration. Keep the existing receipt/transport scheduler as the sole timer owner while retaining platform connectivity/hold checks. Preserve the 2/8/20/60-second receipt cadence and stable correction identities. Stop now removes flush/connectivity subscriptions. A schedule generation prevents concurrent storage reads from arming multiple timers or resurrecting one after stop. The new concurrency regression reproduced three timers before the fix and one afterward.
- Record submit now acquires its in-flight guard before the fresh-water configuration await. The common finally covers validation returns, errors and both route types. The actual screen handler is executed in tests: two taps during a deferred config lookup queue one delivery, and failure/validation unlock the form for retry.
- Fresh-water queue writes validate their supplied timestamp with the existing future-time guard before minting an ID or writing storage. Invalid and future entries never enter the queue.
- A revision fetch could finish after background sync stopped and recreate a completion-retry timer. Listener generations now invalidate the old callback. A deferred-fetch regression reproduced the late timer before the fix and confirms no timer afterward.

Test corrections retain the current application contracts:

- Recovery fixtures now send packet IDs and return matching explicit server acknowledgements. Login expects routeContractVersion 1. Six negative receipt cases ensure missing/mismatched acknowledgements remain rejected; delivery confirmation was not relaxed.
- Independent edit/refusal scenarios reset shared platform connection evidence. The offline/reconnect scenario explicitly supplies the connectivity event instead of retaining a prior offline state across tests.
- Menu tests expect Back to WB S and its home icon, not the retired Switcher. Standalone record navigation follows actionIndex and still excludes stale job authority.
- Logout assertions distinguish permit-bound Suite logout from explicit device-account removal. Keypad tests retain edit-mode commit-only behavior while recognizing fresh-water form gating.
- Submit wiring parses executable await expressions rather than matching comments. The time-gate test checks actual writes rather than an earlier validation-only edit rejection.
- Local timestamp/automatic-delivery fixtures isolate history backfill authentication and await their background work, avoiding accidental network attempts and teardown imports.

Final validation on these changes:

- `npx jest --runInBand --silent --detectOpenHandles --json ...`: **121 suites, 1300 tests passed; process exit 0**, no open handles or imports after teardown.
- `npm run release:gate:test`: **15 tests passed**. This tests the gate; no version reservation or release build command was run.
- TypeScript still reports **20 existing diagnostics** in app/manager.tsx, components/WhatsNewModal.tsx, hooks/use-whats-new.ts and src/services/auth.ts. An in-memory compiler comparison against the original HEAD versions confirms the diagnostic file/code/message records are identical; no new diagnostics. Do not call this a clean full typecheck.
- `git diff --check` passes. Private detailed logs remain outside Git.

No APK built, installed or distributed, no backend deployed, no customer records changed. The new runtime changes still require an explicitly authorized local build and S24 native acceptance before ZFold rollout. Fetch/reconcile both machine branches again before building; unpushed other-machine work cannot be discovered. Historical failed-suite counts in the earlier source-sync note are superseded by this test run, not erased.
