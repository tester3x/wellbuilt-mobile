# Estimated overnight clock display

Source `dde5205` produced Android build 101 through EAS build
`ef1793d4-c441-4469-bcea-e869bf4ab030`. The same package and signer, ARM64 support
and protected native storage were verified before installing on the ZFold with
existing data retained. APK SHA256:
`b6deeefb5392e1a92751ab59e4d5e7bc6347ea4b26fc648c37bf6273d373ab15`.

Physical acceptance confirms an inferred-clock ON response displays `ON ≈`.
Continuous-hauling wells still display AFR without an ON label even when the
global ON preference is enabled. Original loads, gauge levels, shift data and
tank calibration are unchanged. Private screenshots and live readbacks remain
outside Git.

Thirteen response/snapshot regression checks pass, covering local retention,
authoritative withdrawal and estimated-clock metadata replacement. Typecheck
comparison reports the same 20 existing diagnostics as the parent and no new
diagnostics. Backend source `26aa6f9c` carries the outgoing metadata through
normal ingestion, deletion rebuild and edit refresh paths.
