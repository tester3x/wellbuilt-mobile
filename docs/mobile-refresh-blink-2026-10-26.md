# WB M refresh continuity — 2026-10-26

Owner reports a quick screen blink after the busy indicator finishes on app open or focus, present for several days. This report came after a real ZFold M110 pull successfully used the updated Done behavior.

A definite same-well display defect exists in the WellView refresh effect: after background sync stops its header spinner and bumps refreshTrigger, the effect synchronously clears lastPullInfo before its awaited configuration/snapshot reads. The rendered Last pull row disappears and returns, collapsing/re-expanding the layout. Refresh, activation and focus paths reuse this effect.

The correction keeps accepted same-well details visible while fetching, replacing them after the new read. Switching well still clears immediately. Accepted unavailable or missing last-pull data clears stale details, and cancelled reads cannot overwrite them. No account gate, authentication, account switching, rate calculation, reading, load submission or background delivery behavior changed.

Validation: six tests execute the actual screen effect with deferred storage reads. Five fail against the unchanged source, and all six pass after the correction. Together with existing presentation-gate and well-selection tests, 28 tests pass. Project TypeScript diagnostics do not include the changed source/test. The main screen retains existing unrelated lint diagnostics.

Initial physical screen recording was delayed: both phones disconnected during the Olson setup; after the owner reconnected S24, Windows reports the Samsung ADB interface but adb devices remains empty, including after restarting the local ADB server. A reconnect request is pending. The row-collapse defect is proven, but it has not yet been established that it explains every part of the reported whole-screen blink. No new APK built or installed for this correction yet. Do not describe this as a verified account-gate fix or a phone-verified blink resolution.


## Connected S24 recording and header correction

After both phones were reconnected, S24 M110 warm-return and cold-start recordings were captured. The cold recording shows the cached well appearing without route/operator rows, followed by both rows being inserted as the catalogue hydrates; the tank/metrics area shifts immediately afterward. Across the 30-fps cold-start recording, no entirely blank header frames appeared after the main screen was visible. This proves a visible metadata-layout jump; it does not exclude every possible timing-dependent full-screen flash.

The main header now reserves its route/operator text rows while metadata is pending, then fills the existing rows with the actual catalogue strings. No operator or route is fabricated and no account gate is bypassed. An actual-header render regression checks pending versus hydrated structure. Together with refresh, selection and presentation-gate tests, 29 tests pass. Building the client for S24 verification before installing on ZFold.
