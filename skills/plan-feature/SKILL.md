---
name: plan-feature
description: Turn a shaped product slice into a frozen, executable feature contract backed by Loopbreaker. Use when scope is agreed and a builder needs concrete behavior children, verification at the right layer, implementation work units, dependencies, non-goals, and an imported review substrate before coding begins.
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
7. Import the contract with `review_import_contract`. Read it back with
   `review_substrate` and confirm `enforced_by_default: true` before implementation.

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
  ]
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
