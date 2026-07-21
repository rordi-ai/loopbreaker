---
name: shape-strategy
description: Shape a product idea, initiative, or epic into a bounded strategic bet before feature planning. Use when a request is still an idea, the outcome or appetite is unclear, multiple slices compete, scope needs cutting, reversibility matters, or a builder needs to decide shape, spike, park, or proceed.
---

# Shape Strategy

Frame the bet before decomposing implementation. Produce a small decision packet,
not a feature spec and not a backlog.

## Workflow

1. Inspect existing repository and product context before asking factual questions.
2. State the proposed problem/opportunity in one sentence: who changes behavior,
   what changes, and why now.
3. Separate appetite from estimate:
   - Appetite is how much time the outcome is worth.
   - Estimate is how long the current shape may take.
   - Cut scope to appetite; do not inflate appetite to fit a solution.
4. Identify hidden one-way doors: migrations, public APIs, destructive data changes,
   security boundaries, pricing, or external commitments.
5. Propose the smallest slice that tests the bet and explicitly name non-goals.
6. Define a measurable success signal that is stronger than “it shipped.”
7. Recommend exactly one disposition: `shape`, `spike`, `park`, or `reject`.

Ask only for product judgment that cannot be learned from available context. Batch
at most four independent questions. Lead with a recommendation and concrete
trade-offs. Do not conduct an exhaustive interview for a broad initiative; confirm
the framing and reserve detailed decisions for the first executable slice.

## Spike rule

Recommend `spike` when the central technical or demand assumption is too uncertain
to define an honest acceptance contract. Give the spike a timebox, one question,
and a decision it will unlock. Do not disguise implementation as a spike.

## Output

Return this packet:

```text
Disposition:
Problem / opportunity:
Why now:
Appetite:
Reversibility:
Smallest valuable slice:
Non-goals:
Success signal:
Critical assumptions:
Proposed child slices:
Decisions still requiring a human:
```

Each child slice must be independently valuable or unlock the next one. Do not
write behavior contracts or implementation tasks; `$plan-feature` owns that work.
