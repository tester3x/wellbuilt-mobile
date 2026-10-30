## Build authorization - user amendment October 30, 2026

- Local Android APK builds and rebuilds have Mike's standing authorization for user-authorized development, fixes and validation. Use the laptop Android SDK, JDK and project Gradle wrapper; do not ask for separate permission to build locally.
- Batch meaningful changes. Standing local-build permission does not authorize unrelated features, cosmetic-only releases, unrequested installations or live-data changes. Carry forward installation/testing authorization already given for the task.
- Any Expo.dev/EAS cloud build, cloud retry, submission or upload requires Mike's explicit permission in the current work. Local-build authorization never grants cloud authorization. Never fall back to cloud automatically when a local build fails.
- Preserve ownership guards, registered existing homes, fresh cross-computer source reconciliation, exact committed clean build source, immutable remote version reservations, existing package ID/release signer, required checks and durable source/version/APK/signing receipts. Keep signing credentials and APKs outside Git. Test on S24 before a ZFold rollout.
- Build in the registered home under the current workspace policy; do not create a separate source/build checkout. The registered-home runner and current app instructions override historical source-copy examples.
- This amendment supersedes older instructions requiring a fresh request or separate approval for a local APK build. Historical release receipts remain historical evidence. Expo/EAS cloud approval remains explicit.

## Cross-computer source checkpoint before every build

- Commit and push intended changes before switching computers or handing work off. Preserve unrelated local work separately; never sweep credentials, logs or generated builds into a commit.
- Before any build, fetch GitHub and compare the active laptop branch, the active desktop branch, and the last installed source checkpoint for that app. Review and integrate relevant changes from both computers before taking the exact committed build snapshot. A commit existing on another branch does not put it into an APK.
- Preserve both histories and resolve conflicts deliberately. Never reset or force-push over the other computer. Record the merged source commit in the build receipt and handoff note.
- If another computer pushes changes while an APK is already building, that immutable snapshot does not contain them. Fetch and integrate before the next authorized build; never describe the in-progress APK as containing later commits.

## Mandatory cross-computer reconciliation

Before every Android build on either desktop or laptop, follow [docs/android-release-reconciliation.md](docs/android-release-reconciliation.md) and run the local release gate. Commit/push, freshly fetch every GitHub branch, reconcile relevant other-machine work, check expected ancestry/full delta and combined-source tests, reserve the version remotely, and recheck movement immediately before building. Unpushed other-machine work is undiscoverable. Existing APKs are not evidence of full reconciliation. The current user-authorized workspace policy overrides older checkout/build notes. This policy change authorizes local APK builds within user-authorized work; it does not authorize unrelated app features or cloud builds.


## Retired branches and code - mandatory before editing, merging or building

- Read RETIRED_CODE.md and retirement-policy.json first where present. A notice saying **NEVER USE THIS BRANCH AGAIN** is a hard stop: do not develop, build, merge wholesale, copy its screen implementations or use it as a release source. Use the named active branch instead.
- **NEVER RESTORE THIS CODE** applies to every registered retired UI/implementation, including a fallback or compatibility path that makes the retired screen reachable. Keep the approved replacement as the only implementation.
- Git history and archive branches are reference/recovery material, never an alternate source of current features. Review isolated historical patches against current behavior; do not restore an old file to fix an unrelated issue.
- Run `node scripts/retired-code-guard.cjs` where installed before release work. The local release gate runs it automatically and must stop on a retirement violation. Do not delete/disable a marker, remove a registered pattern, relabel a branch or weaken the guard to get a build through. Retirement changes require Mike's explicit instruction.
- When retiring a path, remove its live callers/exports and duplicate renderer, record its replacement and a regression that fails if it becomes reachable again. Preserve domain/data compatibility separately; do not restore retired UI to read old records.
- Keep instructions, branch notices and retirement registries committed/pushed so both computers see them. Never rewrite history or force-push to add a warning.
