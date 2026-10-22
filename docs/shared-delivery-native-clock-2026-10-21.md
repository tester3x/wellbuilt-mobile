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
