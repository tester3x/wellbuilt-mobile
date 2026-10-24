# Automatic wells on assigned routes

Branch: `codex/wbm-stale-level-20261005`. Implementation checkpoint is the commit
containing this note. No APK built or installed for this change; Mobile101 remains
the installed version. Queue this change for the next Mobile build.

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

Next device acceptance: build the next Mobile APK, use a dedicated test account and
assigned test route, add a synthetic well from the server, and verify it appears without
opening My Routes while an intentionally hidden existing well stays hidden. Remove the
test catalogue additions afterward. This device test has not been run on Mobile101,
which does not contain the new code.
