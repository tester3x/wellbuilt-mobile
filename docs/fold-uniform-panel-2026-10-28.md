# Unfolded Fold proportional panel - source checkpoint

Active source: codex/wbm-stale-level-20261005. Replaces the failed M132 Fold sizing approach; source only, no new APK/version/install.

The previous Fold layout shrank the tank to whatever height remained after independently sized text/control sections. This produced tiny tanks with large text. The unfolded Fold now lays out one complete logical phone panel (412dp wide, 700dp body, plus an 80dp header allowance in landscape), centered inside its actual pager column. One transform applies min(1, availableWidth/412, availableHeight/panelHeight) to the entire subtree: header, tank, statistics, last load, Next Load, slider and hint. Extra width stays outside the panel. The tank retains its nominal phone height inside the logical panel and cannot independently yield space to the text. Shared bottom actions remain outside the per-well panels.

Cover-screen geometry and non-Fold phone/tablet paths retain their existing sizing. Hardware hinge capability plus unfolded window/card mode selects this fitting; no Samsung model strings or launch-orientation guesses. The same mounted component tree persists across portrait/landscape. A panel is hidden until its first actual viewport measurement instead of painting an unfitted initial frame.

The slider normalizes native drag deltas by panel scale before applying its existing precision gain. That preserves travel relative to the scaled track. Idle unlocked sliders still do not claim pager ownership; only real drags do. Water raster resolution receives the final combined scene/panel scale. Fold tank badge and number use matching logical dimensions so launch posture does not make the number tiny.

Validation: 44 focused tests in 6 suites pass; TypeScript noEmit and retirement guard pass. Tests exercise the actual panel component across repeated viewport changes with stable child mounts, complete subtree membership, bounds, unchanged cover/tablet selection and installed slider responder math at four scales. Existing header hydration, shared action/focus and gesture tests pass.

Native Fold visual/gesture verification remains outstanding. These host-renderer/math tests do not prove Yoga content bounds, smooth rotation, physical hit testing or final appearance. Next authorized WB M build must check cover, centered unfolded portrait and both landscape panels; all metadata, slider/hint and expanded Next Load state must fit without scrolling or clipping. Check both slider drags and paging with zero/one/two unlocked sliders. Do not call this installed or visually approved. No load, tank configuration, history or AFR mutation occurred.


## M133 native findings and viewport correction

M133 source34dd9d7 built locally and installed on S24 then ZFold. S24 startup/locked and peek spacing/paging passed. A settled Fold landscape capture and native XML show both complete proportional panels, all headers, metadata, sliders and hints within the pager without scrolling. However initial unfolding/resume retained cover-width cells and an early rotation frame clipped header/hint before settling. This is not a complete native transition pass.

The follow-up measures the actual Fold root during loading/splash and content, instead of waiting for Android's window dimension event. Pager card fitting uses one native width/height measurement together. Cover/tablet behavior continues using the existing reported-window path. New regressions execute the root callback against stale cover dimensions and native panel fitting against a measured resize. Final native retest remains required.

## M134 rotation failure and native measurement host

M134 source29fdf95 is installed with matching APK hashes on both phones. Landscape fits, but rotating into portrait leaves the two-column card geometry in place (native XML has1092px card spacing inside a1968px-wide portrait pager). This is a failed rotation check. Move the resize callback from GestureHandlerRootView to an ordinary non-collapsible View inside it; retain the same mounted pager and uniform panel transform. Startup loading roots already use ordinary Views. This change does not change tablet sizing, data, AFR or submissions. Native retest required after the local corrective build.
