# Overnight estimate withdrawal — 2026-10-23

Authoritative Mobile lane: codex/wbm-stale-level-20261005; installed build99
source4fe4446, preserved laptop checkpointd3436ab. Fetched and matched origin
before editing. The other Mobile checkout has unrelated uncommitted work and
was not changed.

Read-only device evidence confirmed a displayed ON estimate after the current
owned outgoing status had withdrawn the estimate. RTDB omits null-valued keys;
backgroundSync previously converted absent/null values to undefined, and
saveLevelSnapshot interpreted undefined as preserve the existing cached value.

The patch distinguishes full outgoing responses from local partial updates.
Missing/null/invalid/nonpositive full-response estimates clear the stored
window/ON values. A local update that omits these optional arguments preserves
them. Existing timestamp protection still rejects older measurements. AFR,
levels, pending delivery, barrel calibration and slider behavior are unchanged.
No customer levels, load amounts or operational records were rewritten.

Validation:19 focused tests pass, including actual processResponsePacket to
persisted snapshot, missing/null/invalid withdrawal, ordinary local updates,
new estimates, older-response protection, down snapshots and unavailable
recovery. Full TypeScript reports existing manager/modal/changelog/local
credentials diagnostics, with none in the modified files. Source is checkpointed;
no new APK was built or installed for this patch yet.

The server investigation independently reproduced the existing UTC-day boundary
and reconstructed-bottom defects using downloaded live processing source.
Its candidate fix and interval-definition discussion are tracked in the
Watchdog/backend lane. Raw customer evidence, timings, logs and cloud snapshots
remain outside Git. Do not broadly deploy another lane's older Functions index.

## Built and installed

Mobile100 builda946a682-ee92-4b47-8b95-6fff02ab5970 completed from
source2d6219e. Expected package/version, signing certificate, ARM64 and existing
native protected account/delivery bridge were verified against the prior99 APK.
SHA256:a193f4889d29c2cb18992ab50ffb7556df10bc7161f21efe35987b7cb34d4d95.
Data-preserving installation succeeded on S24 and ZFold; package queries confirm
versionCode100 on both. S24 cold startup retained the valid current estimate and
account/well access. The pre-existing legacy revision-listener permission error
also occurs on99; no auth/rules were changed to silence it. No new startup crash
was observed. Actual missing/null withdrawal through processResponsePacket and
persisted storage is covered by the focused tests.

The ZFold was actively in use, so post-install screen controls were stopped.
Do not describe its post-install overnight display as physically verified yet.
Server current projection correction and deployed source verification are
recorded in the backend lane; a new full outgoing refresh withdraws stale ON.


## ZFold acceptance completed

After the user reopened Mobile and authorized continuing, foreground-guarded,
read-only checks confirmed that a previously cached withdrawn ON estimate now
falls back to AFR without an ON label in either toggle position. A second well
with no supported ON estimate also displays AFR without a stale label. A valid
corrected ON estimate remains available and switches correctly to the daily AFR
view. The explicitly configured continuous-hauling well uses AFR in both views,
without an ON label, and received a fresh real pull during verification.
The original well selection and ON toggle state were restored. No operational
job, level, inspection, shift or HOS record was created or edited by these checks.
Screenshots and exact customer values remain outside Git.
