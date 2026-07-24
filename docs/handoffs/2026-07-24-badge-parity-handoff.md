# WB-M Badge Parity Handoff — 2026-07-24

Desktop → laptop closeout for the sync-badge/Sync-Status parity fix.

## Fix commit / build

- Repo: `tester3x/wellbuilt-mobile`, branch **master**
- Fix commit: **`3bdfc8b`** — badge and Sync Status derive from one canonical actionable
  selector (`buildDeliveryItems` in `src/services/deliveryStatus.ts`; per-row `needsAttention`;
  `computeDeliveryCounts` derives from it; 'edited' terminal ops can no longer produce
  phantom attention counts). 148 jest tests incl. `syncBadgeParity.test.ts` (7).
- Delivery build (clean worktree `D:\dev\WB-M-delivery` at exactly `3bdfc8b`):
  - Build ID: `4e09f4fc-7387-48d0-9988-e636c299ea65`
  - Package `com.wellbuiltmobile.app`, v2.1.0, versionCode 5, preview/internal
  - APK: <https://expo.dev/artifacts/eas/PgytaLhOOF5hwWXlHTnADjyEC1qt4IWsbxcaEpBeLWo.apk>

## Real offline field-test observations

- The phantom "N need attention" badge with an empty Sync Status screen is **repaired**.
- Offline packets survived durably and replayed successfully on reconnect.
- **Badge count lagged during the offline test**: the first queued packet showed no badge,
  the second showed 1, and the count only caught up to 2 after navigation/refocus.
  The data path was durable; the UI was one operation behind.
- The build ultimately opened and remained stable in the field run.

## ⚠ Remaining problem — delayed live badge (NOT resolved)

The parity fix corrected *what* is counted, not *when* the count refreshes. WB-M still updates
the badge on focus/navigation rather than on durable enqueue/dequeue events. Do not describe
the live badge as fully resolved. The proven fix pattern now exists in WB-T
(`utils/outboxEvents.ts` emitter + `usePendingOutbox` recompute-on-event — see WB-T commit
`8c5a571`); porting that pattern to WB-M's packetQueue/editDelivery saves is the open work item.

Separate known issue (other session's scope): build `4e09f4fc` (3bdfc8b + wildlife commits)
crashed at WellView on the S24; the phone was rolled back to build `ae069a67`
(`997c7b5`, versionCode 5, same key). **No new WB-M build until the WellView wildlife crash
is fixed** — the badge fix itself is exonerated (stack + background-launch evidence).

## Tester distribution status

- The S24 currently runs the **rollback** build `ae069a67` (997c7b5), not the badge-fix build.
- The badge-fix APK `4e09f4fc` is built and linked above but is **not field-distributed**
  because of the WellView wildlife crash in that binary.

## Dirty-WIP checkpoint

- Branch: **`wip/wb-m-security-2026-07-24`** = `9c840ef` (pushed; base `3bdfc8b`).
  Contents committed exactly as found: `app/manager.tsx` rework, `src/services/driverAuth.ts`
  trim, new `src/services/rtdbSecurityApi.ts` (registration/approval callables; public web
  client key only — no secrets). **Do not merge or deploy.**
- `D:\dev\WB-M` working tree is now clean on master at `3bdfc8b`.

## Laptop resume

```bash
git clone https://github.com/tester3x/wellbuilt-mobile.git
cd wellbuilt-mobile
git checkout master      # 3bdfc8b + this handoff
npm install              # ts-jest etc.
npx jest                 # 148 tests
# WIP review only:
git checkout wip/wb-m-security-2026-07-24
```
