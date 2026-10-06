# FLIP tank integration — 2026-10-05

Branch: codex/wbm-stale-level-20261005. Includes bacb279 old-snapshot level correction on top of authoritative vc60 release source 6c04949; original dirty checkout preserved.

Restored only the pure particle/grid FLIP/PIC prototype from a183537 and its math tests. New focused water component uses animated shared canonical fill with local FLIP offsets; old decorative repeating ripple is replaced. Existing fish, duck, pelican, tap actions, level text, drain and level animation remain. Duck follows its local fluid surface. No aquarium screen restore, fisherman restore, operational volume/rate mutation, or Firebase deployment.

Improvements: bounded surface projection conserves mean fill even under tilt at near-empty/full boundaries; one accelerometer listener and 24 Hz timer only for active foreground tank, stopped under reduced motion/blur/unmount. Late availability result cannot subscribe after disposal. Sensor unavailable/web fallback is upright FLIP. SDK54-compatible expo-sensors ~15.0.8 added, no SDK upgrade.

Validation: 84 focused fluid/wildlife/recovery/old-snapshot tests plus 3 runtime timer/sensor lifecycle tests passed. Android Hermes export succeeded. Full type check still fails in unchanged manager/WhatsNew/auth files; no changed-file errors. No native visual verification yet.

Build: flip-preview inherits internal APK preview, increments remote Android version. Build and installation status must be recorded after completion. No USB devices were connected when packaging began. Follow-up: verify tilt response, returning upright, empty/full, pull drain, swipe old wells, screen sleep/return, reduced motion, and tank responsiveness on the Fold before broad release.

Long-duration validation caught instability in the inherited prototype before native installation. Build 1afc6f46-8b55-4981-802b-fc13313236cc (vc61, source550202f) was canceled. Replaced pressure projection with direct MAC divergence correction, added particle overlap separation, removed velocity injection from mean correction, and added viscous damping. Upright/tilt/return-upright regression now passes; final focused total88 tests in6 suites, corrected Hermes export passed. Replacement APK uses next remote version.

Checked bundled Expo sensor native implementations: Android support-acceleration signs differ from iOS gravity signs. Added tested platform conversion so upright is tank-down and matching tilt matches on both. Build af154a76-a2ee-4169-a882-f2e114d43caf (vc62) canceled before installation to include this fix. Total focused coverage now91 tests; vc63 planned from next checkpoint.
