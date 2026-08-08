# WB-M English/Spanish compliance (full active UI — correction gate)

Local audit + fixes. **Not pushed/built/deployed.**

Hold branch `hold/edit-trail-secure-lifecycle` remains at `9344b46` (untouched).

## Architecture

| Item | Value |
|---|---|
| Library | `i18next` + `react-i18next` |
| Locales | `src/i18n/locales/en.json`, `es.json` |
| Fallback | `en` |
| Codes | `en`, `es` |
| Selection | Settings + Welcome |
| Persistence | `@wellbuilt_language` AsyncStorage |
| Display format | `src/i18n/format.ts` — **app language**, not device locale |
| Safe errors | `src/i18n/userFacingError.ts` |

## Reachable active screens

| Screen | Route / entry | Status |
|---|---|---|
| Tabs home | `/(tabs)` | translated (pre-existing + plurals) |
| Summary | `/summary` | pre-existing t() |
| Settings | `/settings` | pre-existing t() |
| Record | `/record` | pre-existing t() |
| History | `/history` | badge + fallback + format |
| Well-data | `/well-data` | pre-existing + numbers |
| Sync status | `/sync-status` | migrated |
| Manager (admin) | `/manager` from settings | **migrated this gate** |
| Performance | `/performance` from manager/tabs | **migrated** |
| Performance detail | `/performance-detail` | **migrated** |
| Login/SSO/logout/no-access | deep links | migrated |
| Debug logs | settings/debug path | migrated |
| Welcome/about | entry | pre-existing |

No dead-route exclusions for manager/performance — both are navigation-reachable for admins.

## Pluralization census (active)

| Pattern | EN keys | ES keys | Zero/1/2+ |
|---|---|---|---|
| Ready loads | `well.readyWithLoads_one/_other` | carga/cargas | 0→other, 1→one, 2+→other |
| History pull count | `history.pullsCount_one/_other` | extracción/extracciones | same |
| Manager more history | `manager.moreHistory` + `{{count}}` | same | count-only string |
| Cleanup deleted | `manager.cleanupDeleted` + `{{count}}` | same | count-only |
| Deleted logs | `manager.deletedLogsMessage` + `{{count}}` | same | count-only |
| Performance filters | `myRoutes`/`allWells` + `{{count}}` | same | count in parens |

## Error paths

| Source | UI presentation | Notes |
|---|---|---|
| Firebase GET/PUT throw `Firebase … failed (status)` | Mapped via `userFacingErrorMessage` on performance screens | Raw remains in `throw`/console only |
| Network/timeout | `errors.network` / `errors.timeout` | |
| Manager alerts | Localized `manager.error*` keys | No raw status codes in alerts |
| SSO login | `loginExtra.*` | |

## App language vs device locale

Before: many `toLocaleString()` / `toLocaleString('en-US')` followed **device** or forced EN.  
After: history/sync/manager display times and BBL counts use `formatApp*` tied to **selected WB-M language** (`en-US` / `es-US`). Stored values unchanged.

## Remaining device-only verification

- Real device EN/ES switch on Android + iOS (layout/truncation under large fonts)
- Full visual pass of manager production/logs tabs on phone

## Key totals

646 EN / 646 ES keys; placeholder parity OK (`scripts/i18n-parity.mjs`).
