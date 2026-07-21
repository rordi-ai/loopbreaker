# State authority

This is the canonical statement of the state-authority discipline shared by every
Loopbreaker skill. A skill that references this file (via the `../shared/state-authority.md`
marker) must follow every rule below in addition to its own skill-specific protocol.
Do not restate this litany inline in a `SKILL.md`; reference it instead.

## Mandatory state header

Every response must open with a state header reporting the exact persisted delivery
state before any analysis, recommendation, or narrative. The values in that header
come from the composed prime block: `loopbreaker prime` on the CLI, or the
`delivery_prime` MCP tool (`renderPrime` over `composePrime`), plus `delivery_readiness`
and `review_substrate` where a skill's protocol calls for the fuller substrate. A
skill may emit a shorter or longer header than another skill — the exact lines it
emits are part of that skill's own protocol, not this document — but every header,
whatever its shape, must be populated only from persisted state and must appear
first.

## Persisted state is the only authority

- Persisted Loopbreaker state — what `delivery_prime`, `delivery_readiness`, and
  `review_substrate` return — is the only authority for shape, planning, planning
  review, implementation admission, review, and shipping status. Prose, intuition,
  a high health score, or "the code looks right" are not authority.
- Copy dispositions, scores, and statuses verbatim from the persisted record. Do not
  paraphrase, round, or soften them.
- Never predict, imply, or claim a state that was not itself written by a successful
  Loopbreaker MCP mutation (for example `review_verify_behavior`, `review_ship_status`,
  `planning_review_record_pass`). If no mutation call succeeded in this turn, report
  the state exactly as it was before the turn began — even when the work performed
  in this turn deserves a better result. Saying a status "may move," "should move,"
  or "is implied by" the work done is an invalid response.

## There is no pass 4

Planning review and code review are each bounded to a two-plus-one pass budget: one
comprehensive pass, one repair-verification pass, and one decision-only terminal
pass. A passing pass may end review early; two failed repair attempts force the
decision packet rather than expanding the audit. There is no pass 4, under any
framing — not for "just one more check," not for a reviewer's own residual doubt.

## Review completion is not shipping readiness

A review verdict — including `approved` or `ship` — is evidence, not a hidden ship
gate, and it never itself changes shipping disposition. Shipping additionally
requires every enforced behavior to be verified or explicitly waived by a human; a
completed review with unverified enforced behaviors is not ready to ship. Treat
"review is done" and "this is shippable" as two separate, independently persisted
facts, and report them as such.
