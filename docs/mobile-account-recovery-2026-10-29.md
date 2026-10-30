# WB M shared-account sign-in recovery

Registered existing laptop home: `C:/dev/wbm-stale-level-20261005`; remote `https://github.com/tester3x/wellbuilt-mobile.git`; active branch `codex/wbm-stale-level-20261005`; owner session `01a139b5-d3f7-7401-bdf0-3443ec841c28`. Mike explicitly authorized registration and this repair. Clean accepted starting source `8d189a0fd898eddf04dd94c57d47b25ab9eb0a14` contains the installed M135 source `91b6cc21835579e59c8b63d21d63174cfff77c2b`. Fresh origin branch matched before editing. Existing other homes and all work were preserved. No new checkout, reset, force push or generated-client edit.

Use `C:/dev/workspace-control/POLICY.md`, local registry and actual-session guard before development. Desktop D: controls map to C: here. The active branch and retirement policy remain unchanged. The legacy CLAUDE references to absent `.claude` files cannot be read in this checkout; this document records the current task instead.

## Findings and implementation

M135 repeatedly displayed `platform/signed-out` while login was open. Its common AccountGate set ready after the Sign in action, but subsequent foreground/account/connectivity checks restored the signed-out overlay. Ported the reviewed current Suite110 recovery behavior: a distinct interactive sign-in phase, revision checks against late async results, actual Mobile bootstrap readiness, and no futile signed-out Retry. Real access-denied failures still block, and app/data authorization remains separate from local startup readiness. No tank screen, layout, load history or flow calculation changed.

An independent field recovery failure was verified in Suite: `platformIssueDeviceAccount` returned HTTP 200 after **18.254820293 seconds**, longer than the app wrapper's **15-second deadline**. The server created a grant, but the timeout discarded its response before native publication. Both Suite and Mobile wrappers now allow 60 seconds and use one bounded, owner-fenced transport retry for explicit verified sign-in only. Background restoration cannot use that retry to undo a device sign-out. Permission refusals are never retried. Diagnostics contain bounded event/code values only. The generated device-account protocol is untouched.

## Validation and state

- `npm run test:account-recovery`: 10 passed (3 actual-gate/bootstrap behaviors, 7 publication/retry/wiring behaviors).
- Mobile presentation gate/session, entry, logout and switcher regressions: 27 passed across 5 Jest suites.
- TypeScript `--noEmit`, retired-code guard and whitespace checks passed.
- Tests exercise foreground/account/reconnect events while entering credentials, late stale failures, actual `app/index.tsx` startup routing to driver-login without fabricating a user, bounded retry and account switches during retry.
- No new Mobile APK built or installed. ZFold still had M135 during investigation. Existing S24-tested Suite110 was installed with explicit approval; its package, version, approved signer and APK hash were independently rechecked. The real login restored the existing open shift, but its first device-grant publication timed out; a same-account warm retry remains a separate device acceptance step.
- The old server grant was marked revoked and had not expired. Available records lack a revocation timestamp/caller-app trail; the originating sign-out trigger remains unproven. Do not attribute it to a user action without evidence.

Source repairs must be committed/pushed before releasing this claim. A new APK build/install requires Mike's current explicit instruction and normal reconciliation, reservation and S24-first checks. This source-only repair is not evidence of an installed fix.
