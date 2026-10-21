# Summary and History cached presentation

Branch: `codex/wbm-stale-level-20261005`. Starting checkpoint: `b59195c`, fetched and matched origin before editing.

Summary previously awaited two serial bootstrap calls (configuration, then assignment) before rendering saved levels. History awaited configuration before displaying local pull history. Both now read one versioned, owner-fenced bootstrap envelope first. The presentation helper additionally checks the SDK user, stored auth UID and session generation. It never reads the old unscoped well catalog and never interprets unknown/empty eligibility as permission.

A same-owner cached view renders without waiting for Firebase. A coalesced background bootstrap refreshes its source; later focus/explicit refresh sees the updated envelope. Pull to refresh still requests a fresh server result. A cold/missing cache still requires a verified bootstrap. Screen request/generation fences reject late updates after navigation or account changes. Operational mutation and authorization APIs are unchanged.

Validation: 71 tests across 8 suites passed, including real helper/cache fixtures for stalled refresh, forced refresh, account/generation changes, SDK mismatch, absent Auth, unscoped/unknown caches and ineligible assignment. Existing bootstrap isolation, recovery, history startup, route-color, summary selection and callable-client tests passed. No TypeScript errors in the changed files. No build, installation, backend deployment or new device timing was performed for this checkpoint.

Known separate findings: well-data still downloads company packets for each new detail mount and filters to the well locally; this change does not claim to optimize that query. Earlier main-screen cached-entry work remains intact.
