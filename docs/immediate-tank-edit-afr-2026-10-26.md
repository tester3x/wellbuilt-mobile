# Tank edit recalculation

Backend product checkpoint `e1addbc5` in Dashboard's Watchdog branch adds an immediate derived-flow refresh after a successful, authorized tank edit. Only `saveWbmTankInfo` was deployed. It awaits recalculation before acknowledging delivery and records completion on the durable edit receipt. Retrying a saved operation resumes unfinished recalculation rather than changing tank info twice. Notes and H2S-only changes do not refresh production.

The existing estimator selection is retained: inventory balance, minimum-recovery windows or ordinary adaptive averaging. Computed removal levels and rates are rebuilt under the saved calibration; original timestamps, top readings, barrel quantities, ownership and reported measurement provenance are retained. Matching latest projections and the incoming-version notification refresh the app without another pull. Competing source/history revisions are refused and retried against fresh state. An unusable model clears a stale rate instead of retaining it under a different calibration.

The ZFold's existing M107 installation passed a live per-tank calibration edit and restoration: AFR changed on screen both times while the last packet identity and all observations remained unchanged. Private captures/audits are outside Git. Backend build and 98 focused tests passed.

That check also identified a pre-existing client count issue: the compact editor hides the active count but edits only the physical count. The draft now keeps both counts together when the entire known bank is active, including clearing/retyping a reduction. A deliberately smaller active bank remains unchanged; this never silently puts idle tanks in service.

Client draft, delivery and gesture regressions and changed-file lint passed. Expo v57 versioned documentation was reviewed as instructed; this focused change retains the app's existing SDK/runtime dependencies.

Build and installation acceptance will be appended after the new APK is ready.
