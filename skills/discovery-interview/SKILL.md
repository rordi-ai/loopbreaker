---
name: discovery-interview
description: Interview the founder until every required shape field traces to a human answer, then record the discovery record for approval. Use before shaping any new issue — shape cannot reach proceed without an approved discovery record. Use when a request arrives as an idea, when a shape field has no human behind it, or when you catch yourself about to infer a premise from a neighbouring project.
---

# Discovery Interview

You are the premise boundary. Everything after this stage — shape, planning,
review, implementation, proof — verifies that each step follows faithfully from
the one above it. **Nothing downstream can check whether the top-level premise
was right.** A correct premise gets hardened into working software; a wrong one
gets hardened into rigorously certified wrong software, carrying more conviction
because it now has passing proofs behind it.

Your job is to make sure every premise came from a human.

## The rule

Never author a shape field from your own head, from a neighbouring project, or
from a pattern you recognise. Every one of these must trace to an answer a human
actually gave:

`problem` · `appetite` · `smallest_slice` · `non_goals` · `success_signal` ·
`reversibility` · `decision_owner` · `risks`

If you cannot cite the human answer behind a field, **interview** — do not infer.

## Why this stage exists

A real incident, preserved because it is the cheapest way to learn this: an agent
modelling a plugin on a neighbouring project imported "served over Tailscale" into
a shape's `success_signal` by pattern-matching, not from any stated need. The
independent planning review then did its job perfectly — it found the contract
did not cover the shape's promise, and required an enforced behavior with a live
proof. The review's rigor *amplified* the invented premise into a mandatory
requirement. When the founder finally asked "tailscale serve for what," there was
no answer, because the premise had never been theirs.

A 100/100 planning health score says the plan is structurally complete. It says
nothing about whether the premise was right. Do not read it as reassurance.

## Workflow

### 1. Research before asking

Read the repository, the linked issues, and any prior discovery records first.
Never spend a founder's answer on something you could have looked up. Questions
that reveal you did not read the code are the fastest way to lose an interview.

Research is for **context, never for constraint.** What the repository happens
to contain today tells you what building this will cost — it never tells you
what the feature is for. "There is no email provider, so should we simulate it?"
is not a discovery question: it lets the current state of the code decide the
premise, which is exactly backwards. Missing infrastructure is a planning input.
Record it as a risk or a work unit; do not let it shrink the bet.

### 2. Interview the premise, not the design

Every question must serve one of the eight required shape fields:

`problem` · `appetite` · `smallest_slice` · `non_goals` · `success_signal` ·
`reversibility` · `decision_owner` · `risks`

If a question does not resolve one of those, it does not belong at this stage.
The test is simple: **would the answer change if the codebase were different?**
If yes, it is an implementation question and belongs to `$plan-feature`.

| Discovery asks | Not |
|---|---|
| Who sends this, and what do they do today instead? | Which email provider should we use? |
| What has to be true for this to be worth building? | Should the composer be a rich-text editor or MJML? |
| What would make you turn it off again? | Where should the service seam live? |
| What are we deliberately not doing in the first slice? | Should we mock it since there is no provider? |

Architecture, libraries, seams and file layout are downstream decisions made
against an approved premise. Deciding them here inverts the pipeline.

### 3. Ask one focused question at a time

Use the host's question tool. For each question:

- Lead with **your recommendation and the reasoning behind it**, then the
  alternatives. Present a judgment, not a menu.
- Options are competing **framings of the bet**, not competing implementations:
  who it serves, how big it is, what counts as success. Not "mock vs real
  provider" but "is this for one operator sending an occasional announcement, or
  for a marketer running scheduled campaigns to a list?" — those are different
  features, and only the founder knows which one this is.
- Surface what the founder has not considered about the *problem*: who else
  touches this, what happens when it goes wrong, what they will wish they had
  scoped out.

**Go deep at issue grain.** The "batch at most four questions" guidance in
`shape-strategy` is an *initiative-grain* rule and is correct there — a broad bet
gets one light touch. It does not apply here. An issue's premise gets the
exhaustive walk, because this is the only stage where a wrong premise is cheap
to catch.

### 4. Record, then hand over for approval

Record one answer per required field, each carrying the question that produced
it:

```sh
loopbreaker discover ISSUE discovery.json
```

```json
{ "answers": [ { "field": "problem", "question": "...", "answer": "..." } ] }
```

Transcribe what the human said. Do not improve it, summarise away its hedges, or
fill a thin answer with your own reasoning — a smoothed answer is an invented
one wearing the founder's name.

The record lands as a **draft**. You cannot approve it:

```sh
loopbreaker discover ISSUE --approve --by NAME    # the human runs this
```

Approval is deliberately absent from the MCP surface. If you find yourself about
to issue it, stop — that is the failure this stage exists to prevent.

Re-recording answers returns an approved record to draft. That is intended: a
premise edited after approval would have the gate vouch for text the approver
never read.

## State authority

See [state authority](../shared/state-authority.md). This skill authors a proposed
premise and records it as a draft; it never approves one. Approval is a human act,
and it is the only gate in the pipeline you are explicitly barred from satisfying
yourself.

## Done when

Every required field traces to a recorded human answer, the record is approved,
and `loopbreaker readiness ISSUE` no longer reports `missing_discovery` or
`unapproved_discovery`.

Then, and only then, hand off to `shape-strategy` — whose job is to *project* the
approved premise into shape fields, not to invent one.
