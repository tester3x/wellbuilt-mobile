# Summary and History cached presentation

Branch: `codex/wbm-stale-level-20261005`. Starting checkpoint: `b59195c`, fetched and matched origin before editing.

Summary previously awaited two serial bootstrap calls (configuration, then assignment) before rendering saved levels. History awaited configuration before displaying local pull history. Both now read one versioned, owner-fenced bootstrap envelope first. The presentation helper additionally checks the SDK user, stored auth UID and session generation. It never reads the old unscoped well catalog and never interprets unknown/empty eligibility as permission.

A same-owner cached view renders without waiting for Firebase. A coalesced background bootstrap refreshes its source; later focus/explicit refresh sees the updated envelope. Pull to refresh still requests a fresh server result. A cold/missing cache still requires a verified bootstrap. Screen request/generation fences reject late updates after navigation or account changes. Operational mutation and authorization APIs are unchanged.

Validation: 71 tests across 8 suites passed, including real helper/cache fixtures for stalled refresh, forced refresh, account/generation changes, SDK mismatch, absent Auth, unscoped/unknown caches and ineligible assignment. Existing bootstrap isolation, recovery, history startup, route-color, summary selection and callable-client tests passed. No TypeScript errors in the changed files. No build, installation, backend deployment or new device timing was performed for this checkpoint.

## Well-detail history follow-up

The well-data screen also awaited a company packet read on every mount. It now saves only the exact successful authenticated 50-row response, under SDK UID, driver, company, assignment revision/digest and literal well identity. Reopening the same authorized view presents that saved response first and refreshes in the background, with a small saved/refreshing status. Concurrent requests share one read per current session generation and SDK user object. An explicit refresh still awaits a server read. Failed refreshes preserve the original saved view; missing/corrupt/expired (30-day) caches fall back to the existing authenticated query. No records are synthesized and no cached read grants operation permissions.

Follow-up validation: 86 tests across 10 targeted suites passed. The 9 new fixtures execute the actual cache module and extracted screen callback with deferred reads, verify saved rows appear before refresh resolves, and reject late updates across navigation, SDK user, generation, company, assignment and well changes. They also cover forced refresh, corrupt/mismatched responses and offline refresh failure. No new device timing is claimed. This follow-up is separate from the five-file checkpoint used by Mobile92.

## Exact-well cold read

The next client checkpoint replaces the company packet download with `getDriverWellHistory`, an SDK-authenticated callable whose only request field is the literal well name. The server derives the canonical driver, company and assigned-well scope from claims. Its response supplies the full original exact-well packet map, including stored child keys and all packet fields; the existing client chronology, row calculations, review markers, edit lineage, valid-row count and display limit remain unchanged. There is no company-wide or public-read fallback.

One 15-second deadline still covers token, fetch, response body and config reads. The HTTP query receives an AbortController signal, SDK-user/session-generation changes reject late results, and early companion-read failure also cancels the outstanding HTTP request. Timeouts, denied access and malformed replies remain errors, never successful empty history. Saved history remains available while refresh fails.

Validation: 94 tests across 11 targeted suites passed, including the real request's row derivation from original packet keys, edit originals, deleted filtering, review flags, full counts before display limit, complete 150-packet transport preservation, exact request allowlist, malformed/cross-well replies, permission errors and stalled read stages. The callable deployment and final build are separate steps; Mobile93 contains the earlier warm-cache/deadline checkpoint only. No new device timing is claimed here.


## Device-discovered session-key correction

The first signed-in Mobile94 detail check rejected the local presentation lease before any request reached the history endpoint. The new helper had read `authUid`, while the actual Mobile session writer persists `wb_auth_uid`; its original unit fixture had repeated the same wrong key. The helper now reads the real key. Summary, History and well-detail share this boundary. A missing local lease is also described as a session-verification error instead of a network timeout.

A new integration fixture executes the production `completeAuthenticatedSession` composition, production SDK-session writer, driver/company persistence, bootstrap installation, presentation helper, history cache and exact-well transport together. Only native SDK/storage edges and network responses are replaced. It manually seeds no owner storage keys. It proves a completed login reaches the exact-well request and returns/caches rows while background bootstrap is stalled, rejects the invented key, and blocks old-owner presentation after SDK change or actual logout. Existing owner/generation/company/assignment/well isolation tests remain. Validation: 125 tests across 14 suites passed; no TypeScript errors in the changed files. Rebuild and signed-in device recheck are required; the earlier successful test count did not establish that Mobile94's real login composition worked.


## Account-gate route lifecycle correction

A direct cold route can mount before SDK/device-account restore: the shared AccountGate deliberately keeps navigation children mounted behind its overlay. Unlike index.tsx, the three presentation screens originally neither waited for useAccountReady nor reran their effects when it changed. Executing the actual Gate and actual well-data effect confirmed one premature load at ready=false and no retry after ready=true. The installed Mobile95 already-ready retry then reached the real history endpoint successfully, distinguishing this startup race from a persistent owner mismatch. That first successful read took about 9 seconds from client request start to row derivation; it does not establish a backend-only duration or warm-cache timing.

Well detail, Summary and History now guard both their loaders and initial/focus effects with the existing readiness flag and depend on that flag. Well-detail driver/admin metadata follows the same readiness lifecycle. No SDK, owner, generation, assignment or cache-validation guard was weakened.

Validation: 135 tests across 15 suites passed, with no touched-file TypeScript errors. Nine fixtures render the actual AccountGate with each actual loader/effect dependency list for current, restored and denied accounts. A further integration mounts actual well-data hooks while SDK restore is pending, then uses the owner/bootstrap written by the real login composition and reaches the actual history/cache/transport after readiness without another tap. Native SDK/storage/network/UI edges are replaced; no owner keys are independently seeded. This source still requires a corrected cold-route device check after rebuild.
