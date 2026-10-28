# Mobile TypeScript cleanup, October 27

User authorized correcting the 20 remaining TypeScript errors and checking Watchdog, explicitly no build. Started from combined desktop/laptop source 68d009e; fresh fetch found no divergent active branch.

Resolved the causes rather than suppressing diagnostics or restoring obsolete access:

- Seventeen diagnostics came from unreachable legacy manager code consuming the deliberately blocked `Promise<never>` RTDB helpers. The route always rendered ManagerUnavailable because MANAGER_AVAILABLE was false. Removed the dead inner manager, obsolete helper aliases and unused imports/styles. Preserved the existing unavailable view, translations, back action and visual styles. Administration is still through the authenticated Dashboard; no old read/write path was enabled.
- Removed the orphaned OneDrive/Graph modules auth.ts, onedrive.ts and graphStorage.ts. Repository-wide caller checks found no live consumers outside that old module group. The Firebase packet interfaces were already defined independently. This removes the missing private credential-file import without adding credentials, new auth or an alternate delivery path. Git retains the historical implementation.
- Changelog hashing now uses the actual ChangeItem.descriptionKey field. Distinct localized message keys no longer collapse to the same undefined hash input.
- What's New Android Back and the explicit dismiss button share a handler that passes the actual boolean checkbox value and resets it. The native close event is never passed as the don't-show-again value. Tests execute the actual handler with a native event and both checkbox states, and verify a changed changelog key invalidates the prior hash.

Validation: `npx tsc --noEmit` exits 0 with no diagnostics. `npx jest --runInBand --silent --detectOpenHandles --json ...` exits 0: **122 suites / 1303 tests passed**, no open handles or teardown imports. `git diff --check` passes. Detailed local logs are outside Git. The manager feature-gate test now verifies the retained unavailable route has no legacy backend helpers/services.

This supersedes the 20-diagnostic limitation in the earlier test recovery checkpoint. No dependency/SDK/version changes, version reservations, APK builds, installs or backend deployments. Native S24 acceptance remains pending the next explicitly authorized local build. Preserve cross-computer source reconciliation before that build; unpushed other-machine work remains undiscoverable.
