# Summary and History cached presentation

Branch: `codex/wbm-stale-level-20261005`. Starting checkpoint: `b59195c`, fetched and matched origin before editing.

Summary previously awaited two serial bootstrap calls (configuration, then assignment) before rendering saved levels. History awaited configuration before displaying local pull history. Both now read one versioned, owner-fenced bootstrap envelope first. The presentation helper additionally checks the SDK user, stored auth UID and session generation. It never reads the old unscoped well catalog and never interprets unknown/empty eligibility as permission.

A same-owner cached view renders without waiting for Firebase. A coalesced background bootstrap refreshes its source; later focus/explicit refresh sees the updated envelope. Pull to refresh still requests a fresh server result. A cold/missing cache still requires a verified bootstrap. Screen request/generation fences reject late updates after navigation or account changes. Operational mutation and authorization APIs are unchanged.

Validation: 71 tests across 8 suites passed, including real helper/cache fixtures for stalled refresh, forced refresh, account/generation changes, SDK mismatch, absent Auth, unscoped/unknown caches and ineligible assignment. Existing bootstrap isolation, recovery, history startup, route-color, summary selection and callable-client tests passed. No TypeScript errors in the changed files. No build, installation, backend deployment or new device timing was performed for this checkpoint.

## Well-detail history follow-up

The well-data screen also awaited a company packet read on every mount. It now saves only the exact successful authenticated 50-row response, under SDK UID, driver, company, assignment revision/digest and literal well identity. Reopening the same authorized view presents that saved response first and refreshes in the background, with a small saved/refreshing status. Concurrent requests share one read per current session generation and SDK user object. An explicit refresh still awaits a server read. Failed refreshes preserve the original saved view; missing/corrupt/expired (30-day) caches fall back to the existing authenticated query. No records are synthesized and no cached read grants operation permissions.

Follow-up validation: 45 tests across 6 targeted suites passed. The 9 new fixtures execute the actual cache module and extracted screen callback with deferred reads, verify saved rows appear before refresh resolves, and reject late updates across navigation, SDK user, generation, company, assignment and well changes. They also cover forced refresh, corrupt/mismatched responses and offline refresh failure. No new device timing is claimed. This follow-up is separate from the five-file checkpoint used by Mobile92.

Known remaining limit: a cold well-history read still downloads company packets and filters to the well locally (`firebase.ts` requestWellHistory). Its underlying REST helper also has no fetch/body timeout. This patch reduces repeated warm presentation waits, not that first company-sized query. A narrower authorized backend read/projection is a separate change. Earlier main-screen cached-entry work remains intact.
