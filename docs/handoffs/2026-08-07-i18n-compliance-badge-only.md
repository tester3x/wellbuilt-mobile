# WB-M English/Spanish compliance (badge-only branch)

Local audit + fixes before badge build. **Not pushed/built/deployed.**

## Architecture

| Item | Value |
|---|---|
| Library | `i18next` + `react-i18next` |
| Locales | `src/i18n/locales/en.json`, `es.json` |
| Namespace | single `translation` |
| Fallback | `en` |
| Codes | `en`, `es` (device `es-*` → `es`) |
| Selection | Settings + Welcome toggle |
| Persistence | `@wellbuilt_language` AsyncStorage (restored this pass) |
| Formatting | `toLocaleString()` for display times; units via `units.*` keys |

## Checkpoint

- Locales introduced in initial source import (`b3a202c`); no later dedicated bilingual audit found.
- Audited range: badge-only commits `4dbb8d7`…`HEAD` plus driver-facing screens on current branch.

## Badge-only wording (EN / ES)

| Key | EN | ES |
|---|---|---|
| `history.edited` | (edited) | (editado) |
| `wellData.edited` | Edited | Editado |
| `history.editedDetailWithTime` | This packet was edited ({{when}}). Detailed before/after values are unavailable for older records. | Este paquete fue editado ({{when}}). Los valores detallados de antes y después no están disponibles en registros antiguos. |
| `history.editedDetailNoTime` | This packet was edited. Detailed before/after values are unavailable for older records. | Este paquete fue editado. Los valores detallados de antes y después no están disponibles en registros antiguos. |

Does **not** claim a secure field-level trail exists.

## Known remaining debt (manager / performance admin)

`app/manager.tsx` and performance admin screens still contain substantial hardcoded English (role labels, device admin). Out of driver badge path; track for a follow-up i18n pass.

## Terminology (dominant)

| EN | ES (established in locales) |
|---|---|
| Pull History | Historial de Extracciones |
| pull / pulls | extracción / extracciones |
| well | pozo |
| BBLs | BBLs (kept) |
| edited | editado / Editado |
| route | ruta |

## Hold branch

Full secure trail remains on `hold/edit-trail-secure-lifecycle` — not modified.
