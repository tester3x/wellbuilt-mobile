# Stable route ordering and picker selection

User saw a brief global alphabetic order after opening the well-name picker,
followed by the usual alphabetic-per-route order. No sort control exists in that
modal. Available phone logs did not retain an error proving the exact trigger.

Code audit found route sorting existed only inside the successful load path;
recovery and hide-well publication could bypass it. Missing route metadata could
also cause the old comparator to collapse all wells into Unknown and sort globally.
Every final loaded/recovered publication now uses one immutable route-order helper.
Incomplete route metadata retains prior visible order, filtered by current
eligibility; hidden/ineligible wells are never restored. A complete refresh
reapplies saved route precedence and alphabetic order within each route.

The open picker takes its own well-name snapshot. Background catalogue replacement
cannot shift its rows. Confirmation resolves the selected name against current
eligible wells instead of reusing an old numeric index. A removed well cannot be
selected through the old snapshot. Search remains limited to this selected list.

Checks: TypeScript; all 145 Jest suites / 1440 tests; 19 release/retirement gate
tests. No selection eligibility, assignment, well/pull history or live configuration
was changed. M146 remains a preserved, verified local artifact only; its existing
pipeline display support remains in the next source, but no pipeline configuration
or backend activation is authorized/performed in this release.

Native S24-first validation pending M147 local build. Original intermittent trigger
is plausible from these paths, not claimed conclusively reproduced.
