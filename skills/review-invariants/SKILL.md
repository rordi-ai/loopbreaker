---
name: review-invariants
description: Perform planning-gated, bounded invariant and contract-driven code review using the Loopbreaker substrate. Use for a first review, repair re-review, planning-health preflight, review-finding validation, production-wiring checks, ship decisions, or any review at risk of scope expansion, repeated fixes, pass-four behavior, or conflict between review completion and shipping readiness.
---

# Review Invariants

Determine whether the frozen behavior contract is true in production. Produce one
comprehensive pass, one repair-verification pass when needed, and at most one
decision-only pass. Review evidence supports behavior state; it is not a hidden ship
gate.

## Non-negotiable state authority

See [state authority](../shared/state-authority.md) for the full discipline; it
applies here without exception. This skill's header emits five separate lines:

```text
Shape: <exact persisted disposition and readiness>
Planning review: <exact persisted disposition>
Planning: <exact persisted score and readiness>
Review: <current or proposed review result>
Shipping: <exact persisted disposition> [state unchanged when not persisted]
```

Read [references/decision-rules.md](references/decision-rules.md) completely before
reviewing.

## Preflight

1. Resolve the issue and exact artifact: working diff, commit range, or PR.
2. Call `delivery_readiness`, then `review_substrate`, before reading the change.
   Do not start pass one unless implementation is admitted by shape, planning health,
   and planning-review approval; return the exact active gate instead.
3. Treat behavior children as the frozen acceptance surface. Parent context may
   interpret them but cannot add requirements.
4. Read `review.next_action`; never choose a pass from intuition.

Review is read-only with respect to source code, remote reviews, and waivers unless
the user separately requests changes. Recording review passes, evidence, and
findings in Loopbreaker is part of this skill.

## Pass protocol

### Pass 1 — comprehensive

Trace every enforced behavior through implementation, active production wiring, and
proportionate proof. Enumerate all material root causes now. Collapse symptoms with
the same cause. Check candidate invariants only when their declared scope intersects
the changed or required-wiring paths.

### Pass 2 — repair verification

Check every admitted repair against its named closing proof, then inspect only the
repair delta for regressions caused by that repair. Do not reopen allowed designs or
scan untouched pre-existing code for additional improvements.

### Pass 3 — decision only

Do not conduct another audit. Summarize the decision packet and choose: ship, ship
with named debt, split/re-scope, or hold for a named critical risk. A human must
authorize a waiver. There is no pass 4.

Record the completed pass with `review_record_pass`. Use `review_upsert_finding` for
stable root-cause findings. Preserve the same finding ID on re-review.

A behavior is verified by EXECUTION, never by a reviewer's observation. If a
behavior lacks proof, the repair is to build and register its harness and run
`loopbreaker prove BEHAVIOR` — not to record what you watched happen.
`review_record_evidence` remains available for supporting observations, but such
evidence is marked not-executed and cannot verify an enforced behavior; attempting
it is refused by name.

Check the shape of the proof, not just its presence:

- Does the behavior have a `harness_ref`, and does the registry entry name it back
  in `proves`? A one-sided binding is a finding.
- Is the passing evidence `baselined` — was the harness ever observed failing for
  this behavior? An unbaselined pass may come from a harness that cannot fail.
- Does the harness drive the tier its contract names, or does it import the code
  in-process and call a `wired` proof?

`loopbreaker demote --dry-run` reports every enforced behavior currently verified
without an executed proof. If those mutations are unavailable or were not
authorized, report the current behavior and shipping states unchanged; never predict
that a passing review will move them.

Use state words literally:

- Say `proof observed` when evidence passed but was not persisted.
- Say `verified` only when `review_verify_behavior` succeeded or the loaded
  substrate already says `verified`.

## Output

Use the mandatory three-line state header above even when tools are unavailable.

Then provide the behavior alignment matrix, admitted root-cause findings,
non-blocking debt, exact remaining proof, and next allowed action. End when no
material issue remains; do not manufacture suggestions to appear thorough.
