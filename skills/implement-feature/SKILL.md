---
name: implement-feature
description: Implement a feature from a planning-ready, frozen Loopbreaker behavior contract. Use when coding should begin, continue, or be repaired against named behaviors and work units, with minimal scope, production wiring, repository-native verification, and evidence recorded without allowing implementation to redefine acceptance.
---

# Implement Feature

Make the frozen behavior contract true. Implementation may choose the design inside
that boundary; it may not silently change the boundary.

## Preflight

1. **Bind the active issue first: `loopbreaker link ISSUE`.** The admission hook
   is keyed to that binding — without it the gate is inert and pre-admission
   edits are silently allowed. This is the single easiest way to appear gated
   while being ungated.
2. Call `delivery_readiness`. Stop unless discovery is satisfied, shape is ready,
   planning is ready, and `planning_review.approved` plus
   `implementation.admitted` are true.
3. Call `review_substrate` for the issue and return the exact active gate when held.
4. Confirm the requested work maps to named behavior IDs and planning work units.
5. Read repository instructions and the production construction path.
6. Inspect current status and preserve unrelated worktree changes.

If the issue is held at `discovery`, stop and use `$discovery-interview`; the
premise is not yours to author.
If there is no imported contract or planning profile, stop and use `$plan-feature`.
If planning is structurally ready but not independently approved, use
`$review-planning`; never self-approve from this skill.
If the requested change would add acceptance requirements, report the scope change
instead of coding it as an incidental improvement.

## Execution: harness first, then code

**Evidence is executed, never asserted.** You cannot record a verdict; you can only
run a registered harness and let its exit code decide. `review_record_evidence`
still exists for supporting observations, but evidence recorded that way is marked
not-executed and **will not verify an enforced behavior**.

For each behavior, in this order:

1. **Write its harness before the implementation.** Drive the behavior at the tier
   its contract names — a real CLI/HTTP/subprocess boundary for `wired`, a real
   deployed target for `live`. The repository may have no test tooling at all; if
   so, standing that tooling up is part of the work, not a reason to skip it.
2. **Register it in `harnesses.json`** with `id`, `tier`, `runner`, `target`, and
   a `proves` list naming this behavior. `runner: "script"` executes the target
   directly, so any toolchain works — `bun`, `pytest`, a shell script. The registry
   is a reviewed file; that is what keeps `prove` from being arbitrary execution.
3. **Bind it: `loopbreaker bind BEHAVIOR --harness ID`.** Both directions must
   agree — the behavior names the harness and the entry names the behavior back.
4. **Prove it RED: `loopbreaker prove BEHAVIOR`.** It must fail before the code
   exists. A harness that is green before the work proves nothing, and the red run
   is what records the baseline. If it passes here, the harness is broken — fix
   the harness, not the contract.
5. **Now implement.** Keep changes minimal, trace each edit to a behavior ID, and
   wire the real production path — not a class, adapter, mock, or test seam.
6. **Prove it GREEN.** A `live`-tier harness additionally needs `--live`.
7. `review_verify_behavior` with the executed passing evidence.
8. Read `review_ship_status` after all work; report its result without overriding it.

Beware assertions that cannot fail — `if (rows.length > 0) { expect(...) }` passes
precisely because nothing exists. If a harness cannot be made to fail against the
unbuilt feature, it is not testing the behavior.

Unit-tier proof alone still cannot verify an enforced behavior. Do not create
waivers. Do not record review passes. `$review-invariants` owns review disposition
and a human owns accepted debt.

## Repair mode

When repairing an admitted finding:

- Fix the named root cause and its required wiring.
- Run the finding's closing proof plus nearby repair-regression checks.
- Do not refactor unrelated architecture or chase newly imagined invariants.
- If two repairs have failed, stop implementation expansion and hand the current
  state to the review decision packet.

## State authority

See [state authority](../shared/state-authority.md). Preflight and `review_ship_status`
report exact persisted state; passing local tests or a converged repair does not
itself change admission, review, or shipping disposition. Report only what those
calls returned.

## Output

Return changed paths, behavior-to-change mapping, verification performed, evidence
IDs recorded, unresolved contract items, rollback notes, and the authoritative ship
status, including the planning gate. Never claim done solely because tests pass or
review converged.
