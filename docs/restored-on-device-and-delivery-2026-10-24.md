# Restored ON display and automatic delivery acceptance

Physical ZFold acceptance on installed Mobile build 101 confirms restored ON
values on four wells across three routes, including gaps of roughly two, three
and five days. Each displayed daily value matches its live outgoing projection.
The continuous-hauling AFR-only screen is unchanged. Private screenshots and
real well details remain outside Git. No new APK was needed.

The deployed backend refresh helper generated synthetic response fixtures for a
multi-day first pull, a later same-day pull, the next day's first pull and another
multi-day gap. Their ON sequence is 160, 160, 250 and 81. No cloud loads or shifts
were created. `overnightAutomaticDelivery.test.ts` exercises the actual Mobile
background-sync callbacks, snapshot persistence and UI notifications with these
responses. It also covers rejection of an older normal response, foreground
recovery after detachment, and revision-token fallback after a missed direct
child event. A callback is injected in tests; this is not a claim that a new live
production pull was submitted through the phone.

All 16 focused delivery, withdrawal and snapshot-recovery checks pass. Synthetic
fixture and test additions require no product rebuild or deployment. Existing
backend source `008428df` and installed Mobile source `dde5205` supply the tested
runtime behavior. The phone is left on a restored well with ON enabled.
