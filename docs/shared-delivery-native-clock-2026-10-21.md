# Shared native delivery deadline checkpoint

Shared source 2969460 adds cancellable Android Handler deadlines to the existing
canonical queue scheduler, independent of display-frame JS timers. The clock
changes no payload, queue eligibility, acknowledgement rule, permission or wake
lock. Existing native clients retain the JS fallback. Four canonical clock tests
pass; the native module compiles successfully in the WB T integration.

These three native/shared files were copied only after verifying their prior
contents against the canonical parent. No other app/account files were replaced.
This is source integration, not a new build or installed-device sleep acceptance.
WB T's separate bounded service integration does not prove this app has an OS
background service, force-stop recovery or arbitrary-outage delivery.

Native-response follow-up: shared source 6d67c35 installs the Android Expo native
fetch adapter for Firebase Functions and authentication POSTs. This removes the
older RN fallback's setTimeout(0) response-completion dependency. SDK headers,
body, authentication and response validation remain unchanged; other requests
keep their original transport. Five canonical adapter tests pass. This is a
source checkpoint, not a new build or physical background acceptance for this app.

Installed-device checkpoint, October 22: Mobile99 built from 4fe444673b145d62131c2676a64a70e0fe3267c2,
EAS d5ca8a07-f74e-4681-9394-32eb29216eb6; APK SHA256 f5162b9a88f8df6a013fc9e7fd0264921128ecb9684d303bdaa693441f231c4f.
Package/version and matching existing signing identity verified before a
preserving update on the dedicated S24. ZFold unchanged. Normal opening and
reopening with both device networks disabled retained the established account:
cached well and level view. Networks restored afterward; no shift, signed JSA,
inspection, pull or document was created. This is an entry/offline smoke check,
not this app's actual-payload background-delivery acceptance. WB T's separate
screen-off operational fixture passed receipt retirement, but its native service
cleanup required another follow-up and is not evidence for this app's service.
