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

Follow-up: M106 build `324e37c4-a72e-413b-ab97-9f8f8d96672a` finished from
`66e1c75177c719bae5abe2d4cd7302836c46f215`. APK SHA-256
`E209A08940783679E64C014907F72FABEF89886CE7E3C99739011C9CA708CFE8`.
Installed with data-preserving replacement on ZFold at the requested truck stop;
package manager confirmed versionCode 106. S24 retains M105. Physical modal fit
and badge placement remain unverified because the user was actively working and
screen control stopped during the JSA investigation.

## Follow-up after M106 field review

Removed the connected-bank BBL/ft row from both modal modes. This is presentation
only; multi-tank bank calibration remains distinct from per-tank calibration in
storage and calculations. Raised the badge and its independent touch target by
another three layout points. Gesture handlers are unchanged.

Numeric values now display at most two decimal places in view and initial edit
fields. Untouched rounded edit fields are omitted from the update patch, keeping
precise stored measurements/calibration during unrelated edits. Feet/inches input
still parses at full precision. A read-only server check confirmed the owner's
`1 4` load-line edit saved correctly as 1 + 4/12 feet, with its revision/update
metadata. No repair or live data change was needed.

Validation: five draft tests and targeted lint pass. Regression coverage includes
rounded view/edit values, exact feet/inches parsing and saving notes without
rounding stored measurements. Existing unrelated full-project TypeScript errors
remain; none refer to the modified files. This follow-up is source only: no new
APK built or installed. ZFold remains M106.
