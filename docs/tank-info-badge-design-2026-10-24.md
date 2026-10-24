# Tank information badge: agreed design

Design discussion only; not implemented in Mobile102. The Mobile102 APK was already
building with automatic route-well selection while these details were discussed.

- Blue circular information badge at the top right of the tank. Keep the left-side
  graphics clear and leave the existing tank-count badge in its current position.
- Single tap on the badge opens the information modal. Its touch target must be
  independent of the tank performance double-tap and other tank gestures.
- All drivers can view. Only the primary route driver and admins see Edit. Enforce
  that permission on the server too; route assignment alone does not establish
  primary-driver authority.
- Display tank height, diameter, nominal capacity, BBL/ft, H2S information and tank
  count. Clearly distinguish total tanks from tanks connected to the gauge, and
  per-tank BBL/ft from the connected bank's combined BBL/ft.
- An admin can enter the initial setup; the primary route driver can correct it
  on site. H2S information and the number of tanks in use can change. The primary
  driver should also be able to correct initially inaccurate dimensions/setup.

Suggested supporting details: plaque photo, load-line height, minimum pull level,
route notes, and who last verified the setup and when. Preserve unknown values
as unknown. Use audited, validated updates and the existing offline delivery rule:
retain a pending edit until server acknowledgement. Connected-tank changes must
reach the calculation configuration used by WB M and Watchdog, not just this modal.

Before implementation, verify the canonical primary-route-driver mapping and the
backend write path. Do not infer primary ownership from the current login, proximity,
or a general list of assigned routes. Keep existing AFR/ON behavior and tank gestures
covered by regression checks.
