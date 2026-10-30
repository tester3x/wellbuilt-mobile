# Missing well panels and uneven water transitions

Registered home C:/dev/wbm-stale-level-20261005; remote
https://github.com/tester3x/wellbuilt-mobile.git; active branch
codex/wbm-stale-level-20261005; real session
01a139b5-d3f7-7401-bdf0-3443ec841c28. Clean starting HEAD95ffb9d matched the fresh
origin fetch. Accepted8d189a0 ancestry retained. Read current laptop policy,
AGENTS/CLAUDE and retirement registry; retired implementations are not restored.
CLAUDE's historical project-summary/barrel-list files are absent; current source
and feature notes were inspected instead. No additional checkout was created.

## Report and baseline evidence

Mike reports the same random whole-panel absence and uneven grow/shrink on
S24 with a small well list and ZFold with a larger one. Attached Thor1 images
show21of21 with no body and8of21 with the body rendered. This is evidence of a
list-position change, not proof of the exact native failure or orientation cause.
S24 installed package com.wellbuiltmobile.app reads135. Read-only swipe recording
and screenshots remain outside Git. Eight rapid swipes from the selected test
well reached the last well with its body present. Later automation could not
obtain idle XML while animations ran; it does not prove blank-panel reproduction.

One installed-M135 Android gfxinfo sample during the recorded swipe run reports
335frames,25janky(7.46%; legacy metric31.04%),95th32ms,99th40ms. These are baseline
Android frame timings, not post-fix measurements or a smoothness acceptance test.
No load, calibration, history, level or rate was saved by the investigation.

## Code findings and repair

Selection relied on60%-visibility callbacks, while momentum completion merely
disabled interaction tracking. A missed/late visibility callback could therefore
leave header/active card selection inconsistent with the final native offset.
Catalogue reordering retained the well by name but delayed native alignment100ms;
that callback could fire after a newer gesture. Geometry offset was also captured
only when width/columns changed. These code paths fit the report but the exact
blank state still requires physical reproduction/acceptance.

The instant-cache check also captured wells.length from the focus effect's
initial render. A periodic rerun could still see that old empty list after the
live catalogue was populated, reinstalling a parsed cache array mid-session.
It now checks the current catalogue ref instead of that stale closure.

End-drag and momentum events now reconcile bounded selection from actual native
offset. Committed catalogue changes, geometry and explicit picker jumps carry
matching contentOffset and layout-phase alignment. Ordinary visibility updates
do not trigger programmatic snapping. Delayed main-pager jumps are removed;
portrait/landscape and stable per-well keys remain. The resize bridge buffer is
preserved because prior native tests required it; memory safety is not traded
for a smaller window without evidence.

Every water column previously animated height/top, causing64 layout-changing
updates per tank per frame. Full React cards also re-rendered for every shared
fill update, including offscreen seed changes, recreating their water subtree.
Columns now retain fixed height and translate within the same clipped scene,
preserving visible upright/inverted depth and raster overlap. Memoization keeps
column worklets stable during label renders. The visible, foreground label sampler
is a memoized UI frame callback with at most30Hz React updates; the final exact
fraction is delivered after timing finishes. Water itself remains driven at UI
frame cadence. Swipe seeds read the departing shared value once per gesture,
independent of label sampling; stale registrations cannot remove newer owners.

No measurement/forecast/pay/flow calculation, pending-pull drain owner, sensor or
orientation preference is changed. Existing tank heights, down/unavailable paths,
wildlife and Fold/tablet geometry remain. A changed visual implementation is not
claimed installed or natively accepted.

Primary guidance reviewed: [Reanimated performance](https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/)
recommends non-layout transforms and memoized frame callbacks. The installed4.1.1
hook implementation was also inspected. Expo54 version URL redirected to latest;
no SDK/runtime upgrade or inferred latest-version API was introduced.

## Verification and next device acceptance

New/updated regressions exercise actual pager callbacks with missed visibility,
last-card/overscroll bounds and resize fences; catalogue layout alignment;
drawn shared-value seed capture; fixed-height clipped water geometry and memoized
column worklets; visible-label cadence/final fraction and listener cleanup;
existing height/dual-card wiring, pending drain and interrupted entry behavior.
Final full Jest run with --runInBand --silent --detectOpenHandles passes:
137suites / 1,386tests, no open-handle warning. TypeScript --noEmit passes.
Changed-runtime-file ESLint exits0 with0errors and22warnings; no clean-lint
claim. Retirement guard and git diff --check pass. Earlier test-harness failures
were updated to exercise the replacement label hook/alignment callbacks; none
remain in the final full run. No APK/native performance result is implied.

Next explicitly authorized local build must first verify S24 repeated settled and
interrupted swipes, first/last wells, changed list order during refresh, picker
selection and idle returns, with no blank bodies or incorrect header/tank pairing.
Compare native frame recordings/timing under the same conditions, then test Fold
cover/unfolded portrait/landscape, both sliders and pending-drain continuity.
Do not submit a real load to test animation. User-requested new APK authorization
and normal source/signing/version reconciliation are still required.

## M136 native rejection and queued label correction

M136 was built locally from c49f7e60e0ff746f09b6ce364002de2bb1b15739,
reserved as android-release-v136, and installed in place on S24 R5CX15HEGQB.
The installed base APK hash matches the recorded artifact. The ZFold remains135.

Native acceptance FAILED: the user observed at least seven incoming wells briefly
show0ft, then catch up to the correct level while their water was already drawn.
The recording independently reproduces this, including nonzero water with0ft,
0BBL and a temporary incorrect forecast. No stored levels were changed. Across
38 settled swipe attempts,39 sampled bodies rendered, but this does not excuse
the label failure or prove the original intermittent blank issue fixed.

The label sampler initialized React state to0 and only sampled active cards.
Offscreen neighbours were staged with the departing water fraction but kept
their old/zero label until activation and the asynchronous frame-to-JS callback.
They are visible during the drag before the60percent active threshold. The
queued correction seeds the initial label from the entry fraction, synchronizes
staged neighbours in the layout phase on seed changes and activation, and rejects
queued samples from a previous staging generation. Frame sampling remains
bounded to visible/foreground cards; water/drain authority is unchanged.

Regression tests cover first paint without a frame callback, an offscreen staged
neighbour before activation, height changes, re-entry and delayed old samples.
This correction is source-only until another explicitly authorized APK. M136 is
not approved for ZFold rollout. One fast S24 trace had57/280 janky frames20.36percent,
95th61ms; its start differed from the earlier baseline, so it is not a controlled
before/after comparison or evidence of improved smoothness.
