---
name: review-planning
description: Independently review a shaped feature and its planning contract before implementation using Loopbreaker's persisted two-plus-one planning-review gate. Use when shape and planning appear ready, implementation admission must be decided, planning findings need re-review, or planning review risks becoming subjective, self-approved, or unbounded.
---

# Review Planning

Decide whether an authored shape and implementation plan cohere well enough to admit
coding. This is an independent review: inspect and record, but do not edit the shape,
behavior contract, or planning profile while acting as reviewer.

Read [references/decision-rules.md](references/decision-rules.md) completely before
reviewing.

## State authority

See [state authority](../shared/state-authority.md) for the full discipline. This
skill's header emits four lines:

```text
Shape: <exact persisted disposition and readiness>
Planning: <exact persisted score and readiness>
Planning review: <exact persisted disposition and next action>
Implementation: <admitted or held>
```

Call `delivery_readiness`, then `review_substrate` to populate it. If shape is absent,
incomplete, or not `proceed`, stop at the shape gate. If planning health is not ready,
return its named structural blockers. Do not begin a semantic pass until both gates
are ready.

## Review protocol

Use `planning_review.next_action`; never select a pass from intuition.

1. Pass 1, comprehensive: test semantic alignment from problem and smallest slice
   through enforced behaviors, work-unit ownership, proportionate proof, production
   wiring, rollback, migration, and named risks. Enumerate material root causes once.
2. Pass 2, repair verification: inspect only admitted repairs and regressions caused
   by those repairs. Preserve finding IDs. Do not reopen accepted design choices.
3. Pass 3, decision only: conduct no new audit. Choose `approved`, `rescope`, or
   `return_to_shaping` from the decision packet. There is no pass 4.

Record stable concerns with `planning_review_upsert_finding`. Open P0/P1 findings
must include reachability, impact, and smallest fix; they prevent approval. Record the
completed pass with `planning_review_record_pass`. Passes 1 and 2 allow only
`approved` or `changes_required`; pass 3 is terminal and decision-only.

## Boundaries

- The issue's enforced behavior children are the acceptance surface. Narrative
  parents interpret it but cannot add requirements.
- Planning health proves structural completeness; this review judges coherence.
- The authoring agent must not approve its own work. Ask for a separate agent or
  human reviewer when the current context authored the shape or plan.
- Missing desirable scope is a proposal unless an enforced behavior requires it.
- Do not modify source code, planning artifacts, or waivers during review.
- Do not start implementation or code review until `delivery_readiness` reports
  `implementation.admitted: true`.

## Output

After the four-line header, provide the current pass, behavior/work/proof alignment,
stable findings, exact repair or terminal decision, and the next allowed action.
Copy the persisted disposition after mutations; never claim approval before the MCP
record succeeds.
