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
