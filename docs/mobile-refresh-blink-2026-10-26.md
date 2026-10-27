# WB M refresh continuity — 2026-10-26

Owner reports a quick screen blink after the busy indicator finishes on app open or focus, present for several days. This report came after a real ZFold M110 pull successfully used the updated Done behavior.

A definite same-well display defect exists in the WellView refresh effect: after background sync stops its header spinner and bumps refreshTrigger, the effect synchronously clears lastPullInfo before its awaited configuration/snapshot reads. The rendered Last pull row disappears and returns, collapsing/re-expanding the layout. Refresh, activation and focus paths reuse this effect.

The correction keeps accepted same-well details visible while fetching, replacing them after the new read. Switching well still clears immediately. Accepted unavailable or missing last-pull data clears stale details, and cancelled reads cannot overwrite them. No account gate, authentication, account switching, rate calculation, reading, load submission or background delivery behavior changed.

Validation: six tests execute the actual screen effect with deferred storage reads. Five fail against the unchanged source, and all six pass after the correction. Together with existing presentation-gate and well-selection tests, 28 tests pass. Project TypeScript diagnostics do not include the changed source/test. The main screen retains existing unrelated lint diagnostics.

Initial physical screen recording was delayed: both phones disconnected during the Olson setup; after the owner reconnected S24, Windows reports the Samsung ADB interface but adb devices remains empty, including after restarting the local ADB server. A reconnect request is pending. The row-collapse defect is proven, but it has not yet been established that it explains every part of the reported whole-screen blink. No new APK built or installed for this correction yet. Do not describe this as a verified account-gate fix or a phone-verified blink resolution.


## Connected S24 recording and header correction

After both phones were reconnected, S24 M110 warm-return and cold-start recordings were captured. The cold recording shows the cached well appearing without route/operator rows, followed by both rows being inserted as the catalogue hydrates; the tank/metrics area shifts immediately afterward. Across the 30-fps cold-start recording, no entirely blank header frames appeared after the main screen was visible. This proves a visible metadata-layout jump; it does not exclude every possible timing-dependent full-screen flash.

The main header now reserves its route/operator text rows while metadata is pending, then fills the existing rows with the actual catalogue strings. No operator or route is fabricated and no account gate is bypassed. An actual-header render regression checks pending versus hydrated structure. Together with refresh, selection and presentation-gate tests, 29 tests pass. Building the client for S24 verification before installing on ZFold.

## M111 build and physical acceptance

EAS build cd95e384-99ac-4057-b18f-01e2245c1279 completed from product source 030dbd3019a0988948d8558a8ccf4f1a0bc18745. APK package com.wellbuiltmobile.app, versionCode 111, ARM64. Signing certificate SHA-256 matched 4c4f7b4de36380e6326ed5f9296907203b3283061f41b7b0f67ef496d64c814b. APK SHA-256: A9E54F950EF44F3A45E1D61F2EA9CCAD9DE6A3A9834A0D04CE16D79C19F2C9D9.

Final focused validation passed 112 tests across 11 suites, including seven continuity/header tests and existing keypad Done/submission, geometry, menu/navigation, selection and presentation-gate checks. Project TypeScript reports no errors in the changed files. Index lint retains the baseline one unrelated error and 20 warnings; neither full-project TypeScript nor lint is claimed clean.

Installed with data-preserving replacement on S24 first, then recorded a 20-second cold start at 30 fps and a 15-second foreground return. At the same extracted resolution, the M110 title changed from y57 to y70 as metadata appeared; M111 starts at y70 from the first main-screen title frame and remains there. In both M111 recordings the accepted last-pull row stays present through spinner completion and the header remains stable. Normal refreshed level/ETA changes and animated liquid movement remain visible. No synthetic load or tank edit was submitted. These observations verify the two corrected layout defects; they do not rule out every possible intermittent flash on every device.

After S24 acceptance, the identical signed APK was installed on ZFold. Both device package managers report versionCode 111. Existing app data was retained. Private recordings, extracted frames and APK remain outside Git.
