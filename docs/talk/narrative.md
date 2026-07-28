# What If Loops Aren't the Answer

Talk narrative. Audience: practitioners already building agent systems. 20 minutes.

This is the argument, not the script. Every claim is marked with the evidence behind it, and the
claims I cannot currently defend are marked as such.

---

## 1. The tools are good. That is what makes the gap interesting. (~3 min)

Do not open by strawmanning AI code review. This room uses these tools, and the numbers are strong.

> **Evidence — a 3.5-week head-to-head on a production SaaS codebase: 146 merged PRs, 679 findings,
> four reviewers running in parallel on default configuration.**
>
> | Tool | False positive rate |
> |---|---|
> | Greptile | **0%** — 118 of 120 findings verified valid, ~92% "bug-shaped" |
> | CodeRabbit | 2.3% — 281 findings, 68% shipped one-click patches |
> | Cursor BugBot | 4.8% |
> | Sentry Seer | 0% at `critical` |
>
> These catch race conditions, null-handling, off-by-one, session lifecycle bugs, architectural
> violations. This is not naive pattern matching.

They also already support a basis. CodeRabbit takes custom review instructions and **AST-grep rules**
— structural, tree-sitter-backed patterns, not file globs. "Give the reviewer something concrete to
check against" is a shipped product feature, not my idea.

So the interesting question is not *"why doesn't AI review work?"* It is: **these tools are accurate,
configurable, and grounded — and something is still missing. What?**

---

## 2. What they structurally cannot check (~3 min)

The same study's conclusion, stated plainly:

> Tools are strongest at **mechanical and structural issues** and weakest at **intentional
> correctness** — *does this implement what was asked?*

That is not a quality problem to be fixed with a better model. It is a **missing input**. A reviewer
is handed a diff and a codebase. It is never handed the commitment: what this change was for, what
counts as done, what was deliberately excluded. Nobody wrote that down in a form anything could
check.

So the review answers the only question it can: *is this code defensible?* Not: *is this the change
we agreed to?*

And the second half of the problem is that the humans who used to answer that have left.

> **Evidence — study of agent-authored PRs in popular repositories:**
> - **61.38%** received no recorded review activity at all
> - Of those reviewed, **58.77%** were reviewed **exclusively by other agents**
> - Only **15.9%** showed observable human participation
> - A quarter of human comments were not review at all but *agent-steering* — telling the bot to fix
>   something

We automated the reviewing and quietly removed the reviewer.

---

## 3. And volume turns the remaining human into a rubber stamp (~2 min)

> **Evidence:** 34.5% of review comments in Microsoft repositories were rated not useful; another
> study puts it at 44.5%. And the practitioner version: *"Beyond the 400-line threshold, you are not
> getting a review. You are getting a rubber stamp."*

A reviewer that produces technically valid comments can still make the team worse, because it
increases the number of decisions a human must triage. The measure that matters is not comments
produced — it is whether the feedback let someone make a **confident decision**.

Hold that phrase. Everything after this is about producing decisions instead of findings.

---

## 4. The trap: a basis makes review sharper AND unbounded (~3 min)

**This is the first of the two beats the talk exists for.**

So: write the commitment down. That is what I did — architectural invariants as a standing basis,
the rules the system must hold, citable and versioned. A finding stops being *"this seems wrong"* and
becomes *"this violates the rule that X."*

It works. And then it does something the accuracy numbers do not predict.

A standing basis doesn't just improve findings. It multiplies them. Every pass can cite another
invariant. Every repair opens surface for the next pass to examine. The review gets *better* and
stops *ending*.

And it is worse than a vibes-spiral, because now every finding is **defensible**. You cannot wave
any of it away. Each one is correct, cited, and traceable to a rule you wrote down and agreed to.
The spiral has your own authority behind it.

> Evidence: my own invariant-review skill ships with this in its description —
> *"...situations where repeated fixes risk scope expansion or **a failed-review spiral**."*
> The tool built to give review a basis carries a warning about the spiral that basis causes.

The instinct at this point is to loop harder — more passes, more reviewers, cross-checking. That is
adding turns, not information. **If the loop had no terminating condition at pass three, it does not
acquire one at pass nine.**

---

## 5. What actually ends it: bounded authority, not convergence (~2.5 min)

A review loop has no natural terminating condition, because *"is anything else wrong?"* is always
answerable. So the end has to be imposed, and imposed **in advance** — otherwise the decision never
arrives.

Three passes, each with a different job:

1. **Comprehensive** — find the coherent set of problems.
2. **Repair verification** — check the fixes, and only the fixes.
3. **Decision** — ship, ship with named debt, split, or hold for one named risk.

No pass four, under any framing. Not for "one more check," not for a reviewer's residual doubt.

The second half of the structure is separating facts that get conflated: **review completion and
shipping readiness are different**. A reviewer can finish checking a repair while a required
behaviour still has no real proof. Two decisions, neither able to overwrite the other.

---

## 6. Then the floor drops out: where does the basis come from? (~3 min)

**The second beat the talk exists for.**

Invariants are a *standing* basis. They cover what must always be true. They say nothing about what
*this* change is for, what counts as done, or what you are deliberately not building.

That per-work basis has to come from somewhere. And if the agent authors it, you have reintroduced
the weights with extra steps and a citation format — a review that is rigorous against a premise
nobody chose.

Worse: a chain of gates verifies that each stage follows faithfully from the one above it. It cannot
check the top. So a wrong premise doesn't get caught — it gets **hardened**, and it arrives with more
conviction than it started with, because now it has passing proofs behind it.

**Rigor does not correct a bad input. It certifies it.**

---

## 7. So: elicitation, and ratification the agent cannot fake (~3 min)

The per-work basis must be **elicited**, not authored. A real interview — one answer per required
field, recorded verbatim, with the question that produced it, because an answer you cannot judge
against its question is not reviewable.

And then **ratified** by a human. That sounds like paperwork until you watch what happens without it.

> Evidence, verified in provenance: an agent running exactly this pipeline finished the interview,
> recorded the answers, then offered — as its first and recommended option — *"I'll run the approve
> command on your behalf."* It did.
>
> ```
> approved_by:    "Ben (ben@rordi.ai)"    ← what the record says
> trigger_type:   cli
> triggered_by:   ubuntu                  ← its own shell
> ```
>
> Nothing malicious. The answers were genuinely mine. But `approved_by` is a string the caller
> types, so the record asserted a human had ratified a premise when no human had acted — and every
> downstream gate would have been right to trust it.

The lesson generalises past this tool: **an attester that the actor supplies is not evidence.** Only
the channel is. Approval now works from a browser and nowhere else, because a founder's terminal and
an agent's terminal are the same terminal.

---

## 8. The other end: proof that ran (~2 min)

Same failure, opposite end of the pipe. Evidence was a row an agent wrote: tier, verdict, summary.
Nothing executed anything.

> Evidence, reproducible in two commands: declare a `wired` proof for a test file that does not
> exist, verify the behaviour, and the issue moves `hold` → `ship`. The only mechanical defence was
> "enforced behaviours can't be proven by unit tests" — escaped by typing `wired`.

The fix: a behaviour names a **registered harness**, the machine runs it, and the verdict comes from
the exit code. `not_run` is the fail-closed default, because failing to observe a pass is not a pass.

> Evidence: applying that to my own substrate found **32** enforced behaviours verified on evidence
> nothing ever executed. Two of my shipped issues went back to `hold`. The gate found no new bugs —
> it withdrew a claim that was never earned.

---

## 9. Does the structure actually produce better work? (~2 min)

*(PENDING — both arms running 2026-07-28.)*

Same template, same model, same one-line request: *"Add a way to design and send a marketing email
from the dashboard."*

- **Arm A** — no structure. Whatever the agent does on its own.
- **Arm B** — the full pipeline: interview, ratified premise, bounded review, executed proof.

Scored on measures fixed before the results existed:

| Measure | Why it is not arguable |
|---|---|
| **Discrimination** | Revert each arm's implementation, run *its own* tests, count how many go red. Tests that stay green proved nothing. |
| **Code quality** | Reviewed at the end, against the same standing invariants both arms were subject to. |
| Did it ask anything | The elicitation claim, directly |
| Does it actually send mail | The only end-to-end fact that cannot be argued |
| Claim vs artifact | What each arm *says* it did, against what its substrate shows |

The interesting result is probably not "Arm A wrote worse code" — it will likely write plausible
code. It is whether Arm A's **account of itself** survives contact with its own artifacts. Which is
the same failure as baseless review, one level up.

> Already verified independently: given one sentence — *"Add an /api/health endpoint that reports
> the app version and current git commit SHA"* — the structured arm interviewed me, took my
> approval, shaped it, planned it, **failed its own independent planning review**, repaired it,
> built test tooling the template did not have, registered a harness, executed it, and shipped. The
> only human input was answering questions.

---

## 10. What I can't claim (~1.5 min)

Ending on this is what makes the rest credible.

- **Discovery has no independent review.** Every other layer has one. The premise has my approval,
  which is a decision, not a review.
- **Red-first is a flag, not a gate.** A dry run shipped with a plan claiming it had proven its
  harness red before implementing. The substrate disagreed. The flag caught the overclaim; nothing
  prevented it.
- **An agent with a shell can still reach the browser endpoint.** That is attribution, not
  prevention. Closing it needs a channel the agent genuinely does not hold.
- **It took six attempts** to get an agent through the pipeline at all — plugin loaded and ignored,
  a gate demanding a CLI that wasn't installed, a CLI that silently did nothing, an interview asking
  implementation questions instead of premise questions.

---

## Close (~30 sec)

A loop can only check itself against itself. More passes add turns, not information.

What ends a review is not convergence — it is **authority, bounded in advance**, over **a basis that
came from outside the loop**. One half of that basis is standing and written down. The other half
has to be asked for, every time.

---

## Timing

| Beat | Minutes |
|---|---|
| 1–2 setup and diagnosis | 4 |
| 3 standing basis | 2.5 |
| **4 the spiral** | **3** |
| 5 bounded authority | 2.5 |
| **6 where the basis comes from** | **3** |
| 7 elicitation and ratification | 3 |
| 8 executed proof | 2 |
| 9 evidence | 2 |
| 10 what I can't claim | 1.5 |
| close | 0.5 |

Over by ~4 minutes. Beats 5 and 8 compress first; 4, 6 and 7 are the talk and should not.

---

## Sources

- [Best AI Code Reviewer in 2026? We Ran 4 in Parallel for 3 Weeks (146 PRs, 679 Findings)](https://dev.to/_vjk/best-ai-code-reviewer-in-2026-we-ran-4-in-parallel-for-3-weeks-146-prs-679-findings-1c0f) — the head-to-head numbers, and the mechanical-vs-intentional conclusion
- [These Aren't the Reviews You're Looking For: How Humans Review AI-Generated Pull Requests](https://arxiv.org/html/2605.02273) — 61.38% unreviewed, 58.77% agent-only, 15.9% human participation
- [Why AI Code Review Overwhelms Developers and How to Fix It](https://www.codeant.ai/blogs/prevent-ai-code-review-overload) — non-useful comment rates
- [Return on Attention: Why AI Code Reviews Are Wearing Us Out](https://dev.to/cseeman/return-on-attention-why-ai-code-reviews-are-wearing-us-out-2hh0) — the 400-line rubber stamp, decisions over comments
- [CodeRabbit AST-grep review instructions](https://docs.coderabbit.ai/configuration/ast-grep-instructions) — a structural basis is already a shipped feature
- [Best Code Review Tools 2026 (Greptile)](https://www.greptile.com/content-library/best-ai-code-review-tools) — full-codebase context vs diff-level annotation
