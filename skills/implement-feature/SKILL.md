---
name: implement-feature
description: Implement a feature from a planning-ready, frozen Loopbreaker behavior contract. Use when coding should begin, continue, or be repaired against named behaviors and work units, with minimal scope, production wiring, repository-native verification, and evidence recorded without allowing implementation to redefine acceptance.
---

# Implement Feature

Make the frozen behavior contract true. Implementation may choose the design inside
that boundary; it may not silently change the boundary.

## Preflight

1. Call `planning_health`. If `ready` is false, stop implementation and return the
   named blockers; a high score alone is not readiness.
2. Call `review_substrate` for the issue.
3. Confirm the requested work maps to named behavior IDs and planning work units.
4. Read repository instructions and the production construction path.
5. Inspect current status and preserve unrelated worktree changes.

If there is no imported contract or planning profile, stop and use `$plan-feature`.
If the requested change would add acceptance requirements, report the scope change
instead of coding it as an incidental improvement.

## Execution

1. Work in dependency order; parallelize only independent work units when the host
   supports safe delegation.
2. Keep changes minimal and trace each material edit to a behavior ID.
3. Wire the real production path, not only a class, adapter, mock, or test seam.
4. Follow repository-native checks and add the smallest verification delta that
   proves the new capability.
5. For each passing proof, call `review_record_evidence` with the behavior ID,
   `wired` or `live` tier when it is intended to verify an enforced behavior, the
   exact observation, and a source such as a command, log, trace, or artifact path.
6. Call `review_verify_behavior` only with attached passing wired/live evidence.
7. Read `review_ship_status` after all work; report its result without overriding it.

Unit tests are useful regression or fault-injection evidence, but unit evidence alone
must not verify an enforced behavior. Do not create waivers. Do not record review
passes. `$review-invariants` owns review disposition and a human owns accepted debt.

## Repair mode

When repairing an admitted finding:

- Fix the named root cause and its required wiring.
- Run the finding's closing proof plus nearby repair-regression checks.
- Do not refactor unrelated architecture or chase newly imagined invariants.
- If two repairs have failed, stop implementation expansion and hand the current
  state to the review decision packet.

## Output

Return changed paths, behavior-to-change mapping, verification performed, evidence
IDs recorded, unresolved contract items, rollback notes, and the authoritative ship
status, including the planning gate. Never claim done solely because tests pass or
review converged.
