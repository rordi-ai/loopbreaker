---
name: plan-feature
description: Turn a shaped product slice into a frozen, executable feature contract and healthy planning profile backed by Loopbreaker. Use when scope is agreed and a builder needs behavior children, work-unit traceability, proportionate proof plans, production wiring, rollback, deterministic planning health, and an imported substrate before coding begins.
---

# Plan Feature

Convert one shaped slice into the acceptance surface that implementation and review
will share. The durable contract is the issue's behavior children, not narrative
prose, parent strategy, or reviewer preference.

## Inputs

- The shape packet or an equivalently bounded request.
- Repository instructions and relevant existing architecture.
- The issue identifier and title. Create a stable local identifier when none exists.

If the outcome, appetite, or smallest slice is still materially unsettled, stop and
use `$shape-strategy` instead of planning competing interpretations.

## Workflow

1. Inspect the active code paths and analogous features. Reuse facts; ask only for
   unresolved product decisions.
2. Freeze the ship contract as behavior children. One behavior is one observable,
   falsifiable claim with:
   - trigger or starting condition;
   - expected outcome;
   - concrete verification action and expected observation.
3. Treat every behavior as enforced. Set `advisory: true` only for an explicitly
   non-shipping diagnostic or follow-up.
4. Require one real wired or live capability proof for each enforced behavior.
   Add unit-level fault injection only when the real layer cannot safely create the
   failure. Do not demand every test layer for every claim.
5. Derive small work units and genuine dependencies. Map every work unit to one or
   more behavior IDs and every behavior to at least one work unit.
6. Identify production construction/wiring, rollback, and migration work explicitly.
7. Build the planning profile: outcome, appetite, non-goals, behavior-mapped work
   units, one planned proof per enforced behavior, production wiring, rollback,
   migration, decision owner, and risks with mitigations.
8. Import the contract and profile with `review_import_contract`, or update the
   pre-review profile with `planning_record`. Call `planning_health` and repair every
   named blocker. Do not start implementation unless `ready: true`; a score of 80+
   cannot average away a hard blocker.
9. Read `review_substrate` and confirm `enforced_by_default: true` plus the persisted
   planning score before implementation.

Do not add requirements from a parent bet after the behavior surface is frozen.
If a new requirement is real, re-scope explicitly into a new issue or revise the
contract before review begins.

## MCP import shape

Call `review_import_contract` with:

```json
{
  "issue_id": "APP-42",
  "title": "Retry one request without duplicating its effect",
  "description": "The bounded slice and its non-goals.",
  "behaviors": [
    {
      "id": "APP-42-B1",
      "title": "Persist acceptance before the effect",
      "trigger": "A worker accepts an effect request",
      "expected": "Acceptance is durable before invocation",
      "verify": "Trace one wired request and observe persistence before invocation"
    },
    {
      "id": "APP-42-B2",
      "title": "A replay produces one effect",
      "trigger": "The accepted delivery is replayed",
      "expected": "The external effect occurs exactly once",
      "verify": "Replay twice through the wired worker and observe one effect"
    }
  ],
  "planning": {
    "outcome": "One retry produces one effect",
    "appetite": "One focused delivery slice",
    "non_goals": ["Redesign the external SDK"],
    "work_units": [{
      "id": "wired-retry",
      "title": "Wire durable replay protection",
      "behavior_ids": ["APP-42-B1", "APP-42-B2"],
      "done_when": "Both behaviors have wired proof"
    }],
    "proofs": [
      { "behavior_id": "APP-42-B1", "tier": "wired", "method": "Trace persistence before invocation" },
      { "behavior_id": "APP-42-B2", "tier": "live", "method": "Replay twice and observe one effect" }
    ],
    "production_wiring": "Construct through the production worker entry point",
    "rollback": "Disable replay reuse and return to the cold path",
    "migration": "No stored-data migration",
    "decision_owner": "Issue owner",
    "risks": []
  }
}
```

## Output

Lead with the frozen contract and include:

1. Behavior table: ID, trigger, expected, proof, enforced/advisory.
2. Work units: files/areas, behavior IDs, dependency, done condition.
3. Production wiring and migration notes.
4. Non-goals and explicit deferrals.
5. Literal verification commands or UI actions.
6. The `review_substrate` result confirming the imported contract.
7. The `planning_health` score, five dimensions, zero blockers, and `ready: true`.
