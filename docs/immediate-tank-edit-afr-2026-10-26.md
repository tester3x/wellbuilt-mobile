# Tank edit recalculation

Backend product checkpoint `e1addbc5` in Dashboard's Watchdog branch adds an immediate derived-flow refresh after a successful, authorized tank edit. Only `saveWbmTankInfo` was deployed. It awaits recalculation before acknowledging delivery and records completion on the durable edit receipt. Retrying a saved operation resumes unfinished recalculation rather than changing tank info twice. Notes and H2S-only changes do not refresh production.

The existing estimator selection is retained: inventory balance, minimum-recovery windows or ordinary adaptive averaging. Computed removal levels and rates are rebuilt under the saved calibration; original timestamps, top readings, barrel quantities, ownership and reported measurement provenance are retained. Matching latest projections and the incoming-version notification refresh the app without another pull. Competing source/history revisions are refused and retried against fresh state. An unusable model clears a stale rate instead of retaining it under a different calibration.

The ZFold's existing M107 installation passed a live per-tank calibration edit and restoration: AFR changed on screen both times while the last packet identity and all observations remained unchanged. Private captures/audits are outside Git. Backend build and 98 focused tests passed.

That check also identified a pre-existing client count issue: the compact editor hides the active count but edits only the physical count. The draft now keeps both counts together when the entire known bank is active, including clearing/retyping a reduction. A deliberately smaller active bank remains unchanged; this never silently puts idle tanks in service.

Client draft, delivery and gesture regressions and changed-file lint passed. Expo v57 versioned documentation was reviewed as instructed; this focused change retains the app's existing SDK/runtime dependencies.

M108 build `6cbf72a4-a0b1-47c1-9a3a-37dcc0cdbffe` finished from exact client product commit `297c7844497af2992deaf33cb7cae16fbc898cd5`. APK SHA-256: `1828266998C36E888A1018F303D6DA1A57633C5158E7253790CC2F2E970B15B3`. Package/version/ARM64 architecture and signing continuity with M107 were verified. Installed on the ZFold using data-preserving replacement; package manager confirms versionCode 108.

Physical acceptance: the visible count was reduced and saved, both stored counts and the tank badge changed, the existing-load model recalculated and the main-card AFR updated without another load or restart. The count was then restored through the same app editor, restoring the correct calibration and daily rate. All original packet IDs, timestamps, top readings, barrel quantities and historical import provenance were verified unchanged; both operations have completed recalculation receipts. Device captures and reconciliation evidence remain outside Git. The S24 was not connected for this installation.

Existing display precision note: the main card derives its whole-barrel daily display from rounded rate text, so an integer-boundary difference of one BBL/day from the precise server value was observed during the temporary count test. The restored setup agrees on both surfaces. This change addresses automatic recalculation and does not replace the existing main-card formatting policy.

## S24 follow-up

On the owner's subsequent request to update all apps, M108 was installed on S24 using data-preserving replacement and its package version verified. Electronic Timecard was also behind and was updated from 120 to the previously verified completed 121 artifact. Fresh Expo completed-build checks confirmed Tickets 268, JSA 98, Suite 97, Equipment 92 and TicketTime 137 were already current on that device. All seven final installed package versions matched the completed release artifacts. The S24 was locked, so this follow-up verifies installations and package versions rather than claiming visual launch/workflow acceptance. No device data was cleared and no shifts or jobs were manipulated.
