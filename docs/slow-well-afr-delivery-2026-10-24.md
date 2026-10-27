# Slow-well AFR delivery acceptance

Source checkpoint: runtime remains the installed Mobile 101 source (dde5205).
Only regression tests and this note change; no new APK is required.

The actual backgroundSync paths are exercised with synthetic responses whose AFR
changes from 60 to 120 to 80 to 90 BBL/day for a 60-BBL/ft bank. Initial listener,
successive pull event, foreground REST recovery and revision-triggered REST recovery
all update the durable snapshot and notify the screen. A delayed older response
cannot revert the latest AFR. No production pull is created for this test.

All 17 focused automatic delivery, estimate withdrawal and unavailable snapshot
recovery checks pass. The backend separately audits real stored history and fixes
fractional-inch loss in ordinary AFR ingestion. Device verification uses that
live derived-data correction, rather than fabricated driver work.
