# Hub navigation replacement — 2026-10-26

Replaced More-menu Switcher with Back to WB S. This opens the existing Suite shell without changing shift state or embedding credentials. Existing task-specific job/JSA/DVIR handoffs remain intact.

Only Tickets home More includes WB eQuipment / breakdown. It uses the supported Equipment app-start PKCE bridge and requires protected local equipment access, rechecked on tap. No equipment shortcut was added to job screens or the other apps. Retired mounted app-grid overlays; JSA legacy switcher route returns through Suite.

All four Android Metro exports pass. JSA full TypeScript passes; Tickets, Mobile and Equipment retain unrelated diagnostics, none in changed files. Equipment launch regression covers the credential-free secure entry route, denied/unknown access and missing app. Canonical Tickets entry test passes. The older ssoOutbound source-wiring test has four assertions expecting blocked JSA entry; these predate the live governed JSA flow and concern untouched source.

Builds and S24 device verification pending. ZFold installation deferred at user request.

## Device findings and corrected builds

M112 and JSA99 installed with data retained, signatures matched prior APKs, and actual More-menu return links opened Suite on S24. Tickets269 home/job menu display and Suite return passed, but its equipment app-open shortcut hit an unmatched route. Tickets270 uses Equipment's existing app-start PKCE bridge instead, with no owner hints or credentials in the URL. T269 is superseded and must not be promoted to ZFold.

Equipment93 opened correctly through app-start, but its tab bar overlapped the Android system navigation row. Equipment94 includes the bottom safe-area inset in tab height/padding. E93 is superseded. The E94 Android bundle export passes. Final T270/E94 installations and device acceptance are pending; ZFold installs remain deferred.

## Final builds and S24 acceptance

All four final APKs finished, replacement-installed on S24 with app data retained, and package-manager versions verified: Tickets270, Mobile112, JSA99, Equipment94. Each signing certificate matches its prior installed release. Suite98 was retained.

Actual UI checks: Mobile tank More → Suite; JSA More → Suite; Tickets home More → Suite; Tickets270 home More → Equipment94 via supported PKCE entry; Equipment94 More → Suite. Equipment home tabs now sit above the Android navigation row (More bounds y2060–2194 instead of y2186–2320 on the 1080×2340 S24). Tickets job-screen More was checked on T269; its identical final T270 menu source offers Back to WB S without the breakdown shortcut. Existing in-progress job was retained. No load or shift lifecycle actions were submitted. Independent server read confirms exact shift-authority state unchanged before/after these checks.

| APK | EAS build | Exact source | SHA256 |
|---|---|---|---|
| hub-t270 | 868b17a1-1f18-4690-9135-379387017b40 | 2944afa7acf5e3cb33502926b3e5dbac86be99f7 | 008F22E5BD0DE37C6121C3C7932EC44B5FE4F1754D17EFC2DD07E09B98562888 |
| hub-m112 | a4921919-4a66-4ee2-8b81-ac057d2270f2 | 0fca6ac2b81d9a3f19491470e501883acb21c61d | DA810953F99A0B21A59D9699ED9A2A478A665A2A94D577C664875CFB58216F45 |
| hub-jsa99 | 26a730a9-55d7-4f0f-89d2-bb61ab34a850 | be31c0dfa1267cecc8e3e9af0cc275e76d07652c | 2B8C58CB609E3C7A2F05355D4AC772A4BC29B553889057ABA5CE7414B93114A2 |
| hub-e94 | 3b1e06f1-7bb8-4ab8-8337-a485b76610d3 | 9a23e7c2421812eb7193d259eb1fbf84dbab32c8 | 077CC96D8875B87C6477F2894A0E92556132F7587BDF363027A064E9B2468911 |

ZFold installation remains explicitly deferred. Do not install superseded T269/E93 there. Private screenshots and UI evidence remain outside Git under C:/dev/tmp/hub-*. The user subsequently reported one Equipment screen with a partially overlapping bottom button; exact screen/device is awaiting clarification. Home tabs are verified fixed in E94; separate screen footers are being audited without changing DVIR workflow or submitting records.


## ZFold installation completed

At the user's request, replacement-installed the exact S24-tested APKs on ZFold: Tickets270, Mobile112, JSA99, Equipment95 and Suite99. Each APK's download checksum, package/version metadata and expected signing certificate was verified before installation. All five installs returned Success; package-manager readback confirms all five versions. No app data was cleared. TicketTime137 and ETC121 were already current and were retained. No shift, job, load, signature or logout action was taken. Suite was launched; further on-device inspection stopped when Chrome became foreground, to leave the user's phone use uninterrupted. S24 acceptance remains the functional release gate already recorded above; this ZFold check establishes installation/version, not a fresh full workflow test.
