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
4. **Escalate one-way doors; decide the rest.** Discovery settled the premise,
   but planning discovers choices the founder could not have anticipated. Record
   them in `decisions`, each marked `reversible` or `one_way`:

   ```json
   "decisions": [
     { "decision": "Bake the SHA at build time rather than reading git at runtime.",
       "reversibility": "reversible" },
     { "decision": "Drop the legacy column in the users migration.",
       "reversibility": "one_way",
       "founder_answer": "Asked 2026-07-27: drop it, unread for two releases." }
   ]
   ```

   A `one_way` decision with no `founder_answer` blocks planning by name. Ask,
   then record what they said. Reversible decisions are yours to make — do not
   manufacture escalations for them, and omit `decisions` entirely when planning
   genuinely faced no such choice.

   One-way means expensive or impossible to unwind: schema migrations that drop
   or rewrite data, public API or URL shape, anything destructive, anything that
   commits an external contract. **Trading away proof strength is also a product
   decision** — demoting an enforced behavior's proof tier to fit an appetite is
   a choice about how much rigor to give up, not a technical detail.

5. Require one real wired or live capability proof for each enforced behavior.
   A planned proof must be **executable** — name the command or driver that will
   run it, because implementation registers it as a harness and loopbreaker runs
   it. "Manual verification" and "reviewer confirms" are not proofs: nothing can
   execute them, so the behavior can never be verified. If the repository has no
   test tooling, say so in the plan — standing it up is work the plan must own.
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
9. After the issue exists, persist the incoming shape packet with `shape_record`.
   Preserve its author's disposition; do not silently convert `spike`, `park`, or
   `reject` into `proceed`.
10. Read `review_substrate` and confirm `enforced_by_default: true` plus the persisted
   planning score. Hand the frozen artifact to a separate `$review-planning`
   agent — a cross-vendor CLI reviewer, or a subagent with fresh context that
   reads the substrate itself rather than your summary of it. You cannot approve
   your own plan, and "reviewed by me, flagged non-independent" is not a
   substitute.
   Plan authoring does not approve implementation.

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

## State authority

See [state authority](../shared/state-authority.md). Report `planning_health` and
`review_substrate` results exactly as persisted — the score, the five dimensions,
and `ready: true`/`false` — never as a forecast of what review will decide. Freezing
and importing the contract does not itself admit implementation.

## Output

Lead with the frozen contract and include:

1. Behavior table: ID, trigger, expected, proof, enforced/advisory.
2. Work units: files/areas, behavior IDs, dependency, done condition.
3. Production wiring and migration notes.
4. Non-goals and explicit deferrals.
5. Literal verification commands or UI actions.
6. The `review_substrate` result confirming the imported contract.
7. The `planning_health` score, five dimensions, zero blockers, and `ready: true`.
8. The explicit handoff to `$review-planning`; implementation remains held until its
   persisted approval.
