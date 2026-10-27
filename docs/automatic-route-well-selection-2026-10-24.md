# Automatic wells on assigned routes

Branch: `codex/wbm-stale-level-20261005`. Implementation checkpoint: `dbda689`.
Mobile102 has now been built and installed on the ZFold at the user's request.

The main screen and My Routes now share owner-scoped exclusions rather than treating
the saved selection as a permanent allowlist. A new eligible well appears by default.
Existing unchecked wells migrate as exclusions at upgrade and remain hidden, including
after catalogue refresh, process restart, removal and reassignment. Newly assigned routes
also include their wells by default. Unchecking a whole route hides its current wells;
future new wells on an assigned route still appear automatically.

Preferences belong to the driver and company. Serialized preference operations reject
old session generations. Only the first migrating owner can inherit the legacy global
selection. Summary and performance retain a derived compatibility selection list.
An intentionally empty selection no longer triggers the old reset-to-all recovery.
Catalogue recovery applies assignment and selection filters too.

The main screen reloads the server-first assigned catalogue on focus/foreground and
every 60 seconds while visible and active, with the existing durable offline fallback.
Late loads are cancelled when the screen loses focus or the session changes. Preserve
the visible well by name when insertion changes its index. These are catalogue updates;
existing pull delivery, AFR/ON calculations and tank configuration are unchanged.

Validation:

- 77 tests across selection, eligibility, bootstrap fencing, platform entry, automatic
  AFR/ON delivery, level estimation and response recovery passed.
- Ten new selection tests cover additions, exclusions, empty selections, reassignment,
  concurrent refresh/hide, restart, driver/company isolation, stale sessions, corruption
  recovery and compatibility-list updates. All fixtures are synthetic; no cloud writes.
- ESLint passes for the new service and tests; `git diff --check` passes.
- Repository TypeScript check still reports existing errors in manager, WhatsNewModal,
  use-whats-new and missing local credentials. No errors in changed screens/service/tests.
  Screen ESLint retains three existing unescaped-text errors outside changed lines.

Remaining device acceptance: use Mobile102 with a dedicated test account and
assigned test route, add a synthetic well from the server, and verify it appears without
opening My Routes while an intentionally hidden existing well stays hidden. Remove the
test catalogue additions afterward. That live catalogue-addition test has not been run.

## Mobile102 installation and smoke check

- EAS build `c3c6d55d-e5b7-4d7b-9812-53e5761adb19`, account-device-test profile,
  runtime source `dbda6895517775d6fd465ea29629d37cae8801ec`, finished successfully.
- Android versionCode 102, versionName 2.1.0. APK 39,838,659 bytes; SHA256
  `A06E732BE7BDB40DC7EF8596F915E14A42D9B8F745216A28D08432092627033F`.
- Installed using `adb install -r` on the ZFold without uninstalling or clearing
  data. Verified package version102 and successful launch (950 ms).
- Existing login and 74 selected wells retained. No My Routes interaction was
  needed. Read-only navigation returned to the previously viewed well.
- Device logs confirm a second server-first catalogue load at the 60-second
  cadence, with the same filtered selection. The visible well remained stable
  across that refresh. No matching startup fatal/TypeError/ReferenceError found
  in the process-scoped logs inspected.
- Re-ran all 77 targeted tests before building; passed. New-well inclusion and
  hidden-well preservation are covered there. A live synthetic catalogue-addition
  acceptance test remains separate; no real or test wells were created by this
  installation/smoke check.
- Screenshot, build metadata and device logs stay outside Git under the private
  workspace evidence directory. The proposed tank information badge is recorded
  separately and is not part of Mobile102.
