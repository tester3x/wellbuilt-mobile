# Level/time slider sensitivity only

Branch: `codex/wbm-stale-level-20261005`, starting checkpoint `62eb12b`.

The user requested an easier-to-position slider without any other change.
The level/time screen now uses a thin subclass of the installed slider. Only
gesture displacement is scaled to 35% before the existing gesture-to-value
calculation. One level step therefore takes about 2.86 times the finger travel.
Both moving and releasing use that same calculation. The slider's existing
rendering, callbacks, track taps, bounds, 3-inch snapping, lock/peek timing,
prediction math and persistence remain unchanged. Further drags still reach
the full existing range. No dependency files or versions were changed.

`node tools/test-levelTimeSlider.cjs` passes against the installed dependency's
actual gesture calculation, covering no-motion touch, both directions, bounds,
unchanged props and live screen wiring. TypeScript reports errors in untouched
manager, WhatsNew, auth and hook files; none name the changed modules. This is
a source checkpoint queued for the next Mobile build, not an installed update.
The user previously requested batching minor changes instead of another build
for each adjustment. Actual finger feel remains to be tested on device.
