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
a source checkpoint, with actual finger feel remaining to be tested on device.

The user subsequently authorized a build and ZFold installation. Mobile97 build
`1159b52d-f466-4f87-a6da-e47057a2ec60` finished from source
`62fa99cd334c95c3ed7b7a8c6925cdcbeae5f587`. Source/profile/project,
package/version, ARM64 ABI, shared-account provider and cryptographic signature
were verified. APK SHA256:
`e5ac1a2465bfbcf9537201b098851a40fdb12ca193c42ec9b13801146c46bcb7`.
The first artifact download timed out; retry succeeded. After the ZFold was
reconnected, in-place installation succeeded and Package Manager confirms
versionCode 97. No app data was cleared. Actual finger feel remains a user test.
