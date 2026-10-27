# Tank information and primary-route access

Implemented in source `9fca17134447387466b2030c3367d3179f44a1d2`.

The blue information badge is a separate top-right touch target. Single tap opens
information; entering and leaving it clears the tank double-tap tracker. Tank
double tap continues to open performance. NDIC identity, operator and route are
read-only. Operational setup includes dimensions, capacity, total and connected
tank counts, per-tank calibration, H2S, load-line/minimum-pull levels and notes.
Unknown specifications remain unknown. The combined bank rate is derived from
connected tanks and per-tank calibration. Diameter can calculate the latter while
preserving a deliberate manual calibration override.

Only server-authorized admins and primary route drivers can edit. General route
assignment permits viewing without granting edit access. Primary designation is
managed separately in Dashboard's driver route-assignment dialog; multiple primary
drivers and an explicit all-routes designation are supported. That designation does
not add viewing assignments. Requested real-driver assignments were applied without
changing their existing viewing routes or roles; private before/after evidence is
kept outside Git.

Edits are persisted before delivery, owner-scoped, revision checked and audited.
Only a matching server acknowledgment removes a pending edit. Foreground, restored
connectivity, authentication readiness and a bounded active timer trigger retries.
Rejected edits remain available for explicit review. No NDIC or authority fields
can be written through the tank endpoint.

Backend source `5c49d257` deployed only the four new tank/primary-route callables.
All four were verified ACTIVE, anonymous requests rejected with HTTP 401, and the
deployed source archive matched the isolated release source byte for byte.
Dashboard release `58dc33563e3d8a65f8147f3f868f75747c4eac09` passed its release
preflight and all 362 hosted artifacts matched the release bytes.

Validation: 99 targeted Mobile tests passed, including delivery/ACK/account fencing,
draft validation, gesture boundaries and existing selection/AFR/ON regressions;
37 targeted backend tests passed. Changed Mobile service/modal/draft lint passed.
Dashboard preflight: 470 passed, one skipped. Initial physical ZFold checks on M103
confirmed information viewing, authorized Edit, read-only identity and preserved
double-tap performance. They caught a missing Close translation, fixed in the final
source above. M104 failed before compilation because the cloud worker timed out
downloading Gradle; the same source was resubmitted for M105.

## Final artifact and physical acceptance

M105 build `bcb5f455-cc73-45d3-a2c8-f7629e44e74e` finished successfully from the
exact feature source above. Version 2.1.0, Android versionCode 105, ARM64 APK,
39,868,663 bytes, SHA-256
`EA04D2A5E2D4BCFE9400AB12F28F055E2EE2E485726EC9F123C2526D07BBA64C`.

Installed with data-preserving replacement on ZFold and S24; both package managers
confirmed versionCode 105 and both apps started. The S24 reconnected after its
One UI update. No data clearing or uninstall was performed.

Both phones passed single-tap information opening, server-authorized Edit access,
Cancel, and subsequent tank double-tap opening performance. The Close translation
renders correctly. ZFold Atlas 2 shows total/connected counts 4/4, height 30.25 ft,
diameter 15.5 ft, capacity 1,000 BBL per tank, 33.6 BBL/ft per tank and 134.4 combined.
In edit mode the NDIC name/API, operator and route remain TextViews rather than
inputs. The three requested all-route primary accounts appear in its primary list.
All UI checks were read-only; no customer tank changes were saved. Current-process
logs on both phones had no fatal exception, ReferenceError or TypeError matches.
ZFold was left on Atlas 2's tank screen; S24 was returned to its tank screen.

Tablet installation remains for when that device is connected. Private APK, build
metadata, device screenshots and logs are outside Git.
