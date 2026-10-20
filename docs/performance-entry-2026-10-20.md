# Mobile cached startup performance

Returning users with an exact SDK-bound bootstrap and prior sync now see cached wells before cloud synchronization. Removed the initial 8-second sync race and mandatory 300-ms delay for that path. Fresh setup retains its initial-data flow. A generation/unmount fence prevents old refresh callbacks; a fixed-name home-content render span records useful readiness.

Validation: focused platform-entry/bootstrap fencing tests 12/12. Full Jest: 1135 passed, 12 failed across five suites. All same 12 failures reproduced on unchanged HEAD 45eaaa5 in a separate detached baseline checkout (59 focused baseline tests, 47 pass/12 fail). Existing failures concern edit ingestion/retry and SSO logout, not the changed screen. Typecheck has prior manager/type diagnostics; no diagnostics remain in changed screen. Build/installation/device comparison pending.
