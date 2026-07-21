# Planning review decision rules

## Ordered authority

Evaluate gates conjunctively and in this order:

1. Shape is complete and its explicit disposition is `proceed`.
2. Deterministic planning health is ready with zero hard blockers.
3. Independent planning review is explicitly approved.
4. Implementation and bounded invariant review may proceed.
5. Shipping additionally requires every enforced behavior verified or durably waived.

A later success cannot average away an earlier failure. A score is evidence, not
semantic approval. A review verdict is evidence, not shipping authority.

## Comprehensive pass

Check only these questions:

- Does the smallest slice solve the stated problem within the appetite and non-goals?
- Do enforced behaviors fully describe that slice without importing parent-level wish
  lists?
- Does every enforced behavior have an owning work unit and one safe wired/live proof?
- Does the plan name the real construction/wiring path, migration, rollback, owner,
  and mitigated material risks?
- Can another builder implement the work without resolving a hidden product decision?

Collapse symptoms sharing one root cause into one stable finding. P0 and P1 findings
block approval and require reachability, impact, and the smallest remaining fix. P2
is non-blocking unless an enforced behavior has no acceptance proof. P3 is debt.

## Repair verification pass

Verify only the prior findings and the revised planning surface directly affected by
their repairs. Check for regressions introduced by those repairs. Do not rescan the
repository, invent new desirable requirements, or reinterpret settled non-goals.

## Decision pass

After two unsuccessful passes, summarize:

- reachability;
- impact;
- reversibility or rollback;
- smallest remaining fix;
- evidence already available.

Then choose exactly one terminal disposition:

- `approved`: implementation is admitted; no blocking finding remains.
- `rescope`: split or reduce the behavior contract into a coherent slice.
- `return_to_shaping`: the problem, appetite, or product choice is unresolved.

Do not run another audit. Do not authorize a fourth pass. A human resolves any
choice that changes the product boundary or accepts debt.

## Tool sequence

1. `delivery_readiness`
2. `review_substrate`
3. Read the exact shape, behaviors, planning profile, and relevant repository paths.
4. `planning_review_upsert_finding` for each stable finding or status transition.
5. `planning_review_record_pass` for the exact next pass.
6. `delivery_readiness` again; copy its state literally.
