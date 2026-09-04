# WellBuilt Canonical Busy-State Contract — V1

_Shared visual + behavioral contract for "the app is working" feedback. Authored
for WB-M; designed to be duplicated across WB-T, WellBuilt ETC, TicketTime, and
the Dashboard/Suite web apps. This packet implements **WB-M only.**_

## Why

After the security/session update, sending a new pull and saving an edit could
sit on the form long enough that the static, dimmed screen looked frozen. The fix
is two-fold: (1) remove avoidable blocking latency, and (2) give every actionable
async flow a consistent, honest, non-frozen busy state.

**Non-negotiable:** never weaken authentication, session persistence, idempotency,
offline durability, or exactly-once behavior for perceived speed.

---

## Three presentation modes

### 1. Blocking (transactional) — `WellBuiltBusyOverlay`
For an operation that must complete before the form is usable again (submit pull,
save edit, delete pull, login).
- Disable repeated submission **immediately** (synchronous one-op-per-tap guard).
- Immediate pressed/disabled feedback on the control.
- If the operation is still pending after **~200 ms**, dim the form and show a
  **centered large** `ActivityIndicator` with stable localized action text
  beneath it ("Sending pull…", "Saving edit…", "Deleting pull…").
- **No flash:** fast operations (< 200 ms) never paint the overlay.
- **No artificial minimum:** when the op finishes, clear immediately.
- After **~5 s** continuous display, swap the label to an accurate "Still …"
  message ("Still sending…", "Still saving…"). Punctuation is never animated.
- Never show fake percentage progress.

### 2. Contained (button) — `WellBuiltAsyncButton`
For an action where the rest of the screen can stay usable (a single row's retry).
- Small **inline** `ActivityIndicator`; screen stays interactive.
- Button width is **locked** while busy so text/controls don't jump.
- Disable only the controls that would create an unsafe duplicate action.

### 3. Background — existing status/toast surfaces
For sync, retry, hydration, deep-link app launch.
- Small non-blocking indicator in the relevant status area or toast
  (`SyncToast`, sync-status list, `RefreshControl`). Never cover the whole screen
  while the user can safely keep working.

### Completion (all modes)
- **Success** clears the indicator and continues normal success navigation.
- **Failure** always clears the indicator and exposes the existing error/retry path.
- Cancellation, unmount, navigation, backgrounding, and thrown exceptions must
  **never** leave a stuck overlay (guaranteed by a `finally` + unmount guard).
- Existing idempotency remains authoritative even though duplicate taps are
  disabled.

### Accessibility & localization
- Use the WellBuilt action accent **`#2563EB`** (not a new color) + built-in
  `ActivityIndicator` (no animation dependency).
- Provide an accessible progress label (`accessibilityRole="progressbar"`,
  `accessibilityState={{ busy: true }}`); announce the operation **once**
  (`AccessibilityInfo.announceForAccessibility`) — never re-announce a changing
  label. Respect reduced-motion (the spinner is the platform control; no extra
  motion is added).
- English + Spanish with exact key parity. Canonical labels use the **real
  ellipsis glyph `…`** (legacy strings that used `...` are being migrated).

---

## Components & primitives (this repo)

| File | Role |
|---|---|
| `src/components/WellBuiltBusyOverlay.tsx` | Blocking overlay. Props: `visible`, `label`, `longLabel?`, `delayMs?` (200), `longRunningMs?` (5000), `size?` (large), `accessibilityLabel?`, `testID?`. |
| `src/components/WellBuiltAsyncButton.tsx` | Contained async button. Props: `onPress`, `label`, `busyLabel?`, `busy?` (controlled), `disabled?`, `spinnerColor?`, `style?`, `textStyle?`, `testID?`, `accessibilityLabel?`. |
| `src/components/busyDisplay.ts` | Pure threshold spec: `busyDisplayState(visible, elapsed, delay, long)` → `hidden`/`shown`/`shownLong`; `busyLabelFor(phase, label, longLabel?)`. |
| `src/utils/singleFlight.ts` | `createSingleFlight()` — exactly one op per guard; clears on resolve OR reject. |
| `src/telemetry/submitTiming.ts` | Privacy-safe phase timing (below). |

The React glue is source-wired in tests; the timing/threshold/guard **logic** is
unit-tested deterministically (no RN render harness in this project).

---

## Latency diagnosis (task 1)

**Did the security/session update add avoidable blocking latency? No.** Evidence
(call-graph audit + `git log` of the session-persistence commits):

- `revalidateDriverSessionClassified` is **not** on the submit/edit path — it runs
  only in startup/route guards (`app/index.tsx`, `driver-login.tsx`,
  `session-verify.tsx`). No synchronous revalidation was added to submit.
- The identity-mirror fallback (`cd53d06`) in `getDriverId`/`getDriverName` adds an
  AsyncStorage read **only when SecureStore is empty** (post-restart). On the warm
  path (app running, form open) it is byte-identical to the pre-security single
  SecureStore read.
- The session commits never touched `firebase.ts`, `firebaseAuthSession.ts`,
  `packetQueue.ts`, or `editDelivery.ts` (verified by `git log -- <files>`).

**Root-cause ranking for the intermittent "sometimes slow" delay:**
1. **Pre-existing** `getValidIdToken → getIdToken(false)` in the secure-callable
   upload path: instant from cache, but a **network token refresh** near the
   ~1 h expiry (or a cold `onAuthStateChanged` on the first submit) adds hundreds
   of ms–seconds. This is the classic warm-vs-cold "sometimes instant" mechanism.
2. **Online navigation waits on the remote Cloud Function ack** rather than on the
   durable local write (see product-contract note below).
3. **Two dead `SecureStore` reads** (`getDriverId()` + `getDriverName()` in
   `uploadTankPacket`) whose results were discarded (`void`). **Fixed** — removed
   as dead, blocking latency; equivalence proven (the wire packet never carried
   driver identity; the server stamps it; `idempotencyKey === packetId`).

**Implemented latency fix:** #3 only (provably identical security behavior). #1/#2
are pre-existing and either untouched or reported below.

**Reported, NOT implemented (product-contract change):** navigating away after the
**durable local write** instead of the remote ack would remove the network RTT
from perceived latency (the offline path already does exactly this). It changes
*when the UI considers a pull "safely submitted,"* so per the packet it is reported
as an option, not implemented. Pre-warming/refreshing the ID token off the submit
path is the other lever for #1.

### Phase timing (privacy-safe)
`SubmitTrace` (`submitTiming.ts`) records, per operation, a monotonic-clock
breakdown of the 10 phases (tap → validation → durableWrite → sessionRetrieval →
authReadiness → revalidation → requestBegin → serverAck → reconcile → navigate).
record.tsx marks the boundary phases it can observe (tap, validation, requestBegin,
serverAck, durableWrite, reconcile, navigate); `serverAck − requestBegin` isolates
the session+auth+network cost (phases 4–8, decomposed in the audit). **Only
operational metadata** is kept (op create/edit, per-phase ms, online/offline,
outcome success/queued/timeout/failure, warm/cold auth hint) — never passcodes,
tokens, driver identity, well names, pull values, or payloads. Traces stay in a
local in-memory ring; no network egress.

---

## WB-M async-action inventory + chosen presentation

| Action | Class | Presentation | Status |
|---|---|---|---|
| **New pull submit** (keypad Done → handleSubmit) | Blocking | `WellBuiltBusyOverlay` "Sending pull…" + one-op guard | **Done** |
| **Save edit** (Save Edit → handleSubmit) | Blocking | `WellBuiltBusyOverlay` "Saving edit…" + one-op guard | **Done** |
| Settings: Save recipient | Blocking | single-flight guard (no dup recipient) | **Done** |
| Settings: Save template | Blocking | single-flight guard | **Done** |
| Settings: Clear history / Delete recipient | Blocking | modal-gated confirm (adequate) | existing |
| Driver login / register / upgrade / complete | Blocking | full-screen `mode='verifying'` spinner (already canonical) | existing |
| Session-verify: Retry | Blocking | `busy` + `disabled` + try/finally (already canonical) | existing |
| Sync-status: Retry / Recover / Retry Edit | Contained | per-row "working" + global `retryingId` guard + try/finally | existing |
| Well-data: fetch / retry | Contained | screen-scoped `ActivityIndicator` | existing |
| Pull-to-refresh (history/summary/well-data/sync/index) | Background | `RefreshControl` | existing |
| Settings: Routes refresh | Contained | `isLoadingRoutes` disable + "…" | existing |
| Dispatch banner: Send / Skip / Cancel | Background | opens SMS/WhatsApp; queue advances | recommend guard (fast-follow) |
| AppSwitcher: launch app / hub | Background | grid closes on tap (implicit guard) | recommend guard (fast-follow) |
| Index empty-state / well-data Retry | Contained | spinner shown | recommend `disabled` (fast-follow) |

**Fast-follow** items are low-risk duplicate-guard additions deferred only because
on-device visual verification is currently blocked (device reserved). They do not
affect the two flows named in the field report.

---

## Cross-app reuse (WB-T / ETC / TicketTime / Dashboard-Suite)

- **React Native apps (WB-T, ETC, TicketTime):** copy `WellBuiltBusyOverlay`,
  `WellBuiltAsyncButton`, `busyDisplay`, `singleFlight` verbatim; they depend only
  on `react-native` built-ins. Keep the 200 ms / 5 s thresholds, the `#2563EB`
  accent, the announce-once accessibility, and the "…" label convention. Provide
  each app's own localized labels with EN/ES parity. **Do not** touch WB-T's camera
  branch when integrating.
- **Web (Dashboard/Suite):** reimplement the same *contract* (200 ms delayed
  spinner, no flash, no artificial minimum, 5 s "Still…" relabel, one-op guard,
  announce-once via `aria-live`, `#2563EB` accent). `busyDisplay.ts` and
  `singleFlight.ts` are framework-agnostic TypeScript and port directly.
