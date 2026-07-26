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
   Name each material risk with a mitigation; an empty risk list must be an explicit
   conclusion, not an omitted section.
5. Propose the smallest slice that tests the bet and explicitly name non-goals.
6. Define a measurable success signal that is stronger than “it shipped.”
7. Recommend exactly one disposition: `proceed`, `spike`, `park`, or `reject`.
8. When an issue contract exists, persist the packet with `shape_record`. This
   authoring action does not approve planning; a separate `$review-planning` agent
   owns that decision.

## The premise is not yours to author

`$discovery-interview` runs above this skill and produces a founder-approved
discovery record. Your job is to **project that approved premise into shape
fields**, not to invent one. Every shape field should trace to a recorded answer;
read it with `loopbreaker discovery ISSUE`.

Shape cannot reach `proceed` without that record, so an issue arriving here
without one is not a shaping problem — it is a missing interview.

Ask only for product judgment that cannot be learned from available context or
from the approved record. Batch at most four independent questions. Lead with a
recommendation and concrete trade-offs. Do not conduct an exhaustive interview
for a broad initiative; confirm the framing and reserve detailed decisions for
the first executable slice — the exhaustive walk belongs one stage up, at issue
grain, in `$discovery-interview`.

## Spike rule

Recommend `spike` when the central technical or demand assumption is too uncertain
to define an honest acceptance contract. Give the spike a timebox, one question,
and a decision it will unlock. Do not disguise implementation as a spike.

## State authority

See [state authority](../shared/state-authority.md). This skill authors a proposed
disposition; it does not persist planning or review state. After calling
`shape_record`, report only the disposition actually persisted — never predict how
a downstream `$review-planning` will resolve it.

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
Risks and mitigations:
Proposed child slices:
Decisions still requiring a human:
```

Each child slice must be independently valuable or unlock the next one. Do not
write behavior contracts or implementation tasks; `$plan-feature` owns that work.
