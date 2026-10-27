# Hub navigation replacement — 2026-10-26

Replaced More-menu Switcher with Back to WB S. This opens the existing Suite shell without changing shift state or embedding credentials. Existing task-specific job/JSA/DVIR handoffs remain intact.

Only Tickets home More includes WB eQuipment / breakdown. It uses the existing governed app-open contract and requires protected local equipment access, rechecked on tap. No equipment shortcut was added to job screens or the other apps. Retired mounted app-grid overlays; JSA legacy switcher route returns through Suite.

All four Android Metro exports pass. JSA full TypeScript passes; Tickets, Mobile and Equipment retain unrelated diagnostics, none in changed files. Equipment launch regression covers the governed owner hint route, denied/unknown access and missing app. Canonical Tickets entry test passes. The older ssoOutbound source-wiring test has four assertions expecting blocked JSA entry; these predate the live governed JSA flow and concern untouched source.

Builds and S24 device verification pending. ZFold installation deferred at user request.
