# Compact tank information follow-up

Branch: `codex/wbm-stale-level-20261005`, based on the installed M105 checkpoint.

The modal now starts with the full NDIC well name, followed by API number,
operator and route, then operational tank details. The short display name,
primary-driver list and connected-tank count row are omitted. Existing permission
checks and stored connected-tank calibration are preserved. No config migrations
or customer-data writes are part of this change.

View mode uses compact label/value rows and reduced spacing to fit ordinary tank
records on a phone screen. Scrolling remains available for long notes, large
accessibility fonts and the edit form rather than clipping information. The info
badge and its existing independent 44-point target move up 12 points together;
performance and long-press handlers are unchanged.

Validation: changed modal lint passed; 12 existing tank draft, delivery and gesture
tests passed. TypeScript checking has existing errors in unrelated files; no
diagnostics in the changed modal or tank-screen file. Diff whitespace check passed.

Source only: no new APK built or installed for this follow-up. Both phones retain
M105. Physical fit and badge placement should be checked on the next APK.
