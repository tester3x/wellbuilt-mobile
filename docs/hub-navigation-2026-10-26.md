# Hub navigation replacement — 2026-10-26

Replaced More-menu Switcher with Back to WB S. This opens the existing Suite shell without changing shift state or embedding credentials. Existing task-specific job/JSA/DVIR handoffs remain intact.

Only Tickets home More includes WB eQuipment / breakdown. It uses the supported Equipment app-start PKCE bridge and requires protected local equipment access, rechecked on tap. No equipment shortcut was added to job screens or the other apps. Retired mounted app-grid overlays; JSA legacy switcher route returns through Suite.

All four Android Metro exports pass. JSA full TypeScript passes; Tickets, Mobile and Equipment retain unrelated diagnostics, none in changed files. Equipment launch regression covers the credential-free secure entry route, denied/unknown access and missing app. Canonical Tickets entry test passes. The older ssoOutbound source-wiring test has four assertions expecting blocked JSA entry; these predate the live governed JSA flow and concern untouched source.

Builds and S24 device verification pending. ZFold installation deferred at user request.

## Device findings and corrected builds

M112 and JSA99 installed with data retained, signatures matched prior APKs, and actual More-menu return links opened Suite on S24. Tickets269 home/job menu display and Suite return passed, but its equipment app-open shortcut hit an unmatched route. Tickets270 uses Equipment's existing app-start PKCE bridge instead, with no owner hints or credentials in the URL. T269 is superseded and must not be promoted to ZFold.

Equipment93 opened correctly through app-start, but its tab bar overlapped the Android system navigation row. Equipment94 includes the bottom safe-area inset in tab height/padding. E93 is superseded. The E94 Android bundle export passes. Final T270/E94 installations and device acceptance are pending; ZFold installs remain deferred.
