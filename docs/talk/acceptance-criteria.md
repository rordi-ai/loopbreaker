# MKTG-EMAIL-1 — held-aside acceptance criteria

**Purpose.** The neutral yardstick both arms are scored against. Written to be *independent of
either arm's implementation* so neither is graded against its own answers.

**Provenance and honesty.** Every criterion below is derived only from the founder premise and the
explicit non-goals — the parts authored *before* either arm ran — phrased as user-facing outcomes.
It does **not** copy Arm B's B1–B9 behaviors. One caveat to state plainly in the talk: these were
formalized *after* the runs, from the pre-existing premise, not pre-registered before them. That is
the honest position; a purist would want them frozen before day one. They are frozen now.

**Founder to confirm:** edit anything that does not match your intent, then treat this file as
frozen. `ben@rordi.ai` owns this list.

---

## The desire (verbatim)

> "Add a way to design and send a marketing email from the dashboard."

## The premise it stands on (founder, pre-run)

Internal operator tool. One operator composes an occasional announcement in the dashboard, sends it
**for real** to real recipients, and the dashboard keeps an **auditable record** of what went out.
First slice caps recipients to an internal allowlist. Compliance (unsubscribe link, suppression
list, physical-address footer) is enforced **server-side before send #1**.

---

## Acceptance criteria

A passing feature does all of the following. Each is a user-facing outcome, gradeable against either
arm without reference to how it was built.

### Core — the literal desire

- **A1 — Compose.** The operator composes an email (subject, body, sender) in the dashboard UI.
- **A2 — Real send.** A composed email is actually delivered to a real recipient through a real
  provider. Real sending is the default path, not an off-by-default flag.
- **A3 — Auditable record.** After a send, the dashboard shows a durable record of what went out —
  recipients and per-recipient outcome — that survives a restart.

### Compliance — enforced server-side before the first send

- **A4 — Unsubscribe.** Every delivered message carries a working unsubscribe mechanism, and
  unsubscribing suppresses future sends to that address.
- **A5 — Suppression.** Addresses on the suppression list are excluded from a send while the rest of
  the send proceeds.
- **A6 — Postal footer.** Every delivered message carries a physical postal address.
- **A7 — Allowlist.** A recipient outside the internal allowlist is rejected *before* the provider
  is called.

### Integrity — "for real" and "auditable" taken seriously

- **A8 — Authorization.** Only the authenticated operator can send, or read the audit history.
- **A9 — Fail loud.** An unconfigured or disabled send path fails visibly on screen, never silently
  reports success.

### Explicitly out of scope (building these earns no credit; inventing them is scope drift)

- Scheduling / send-later.
- Saved lists and segments.
- Open / click analytics.

**In scope:** a template library that gives the operator a compliant starting draft.

---

## Scoring rubric

Two independent axes per criterion. Keep them separate — a feature can *do* the thing yet *prove*
nothing.

| Axis | Question | Credit |
|---|---|---|
| **Present** | Does the finished feature actually do A_n, demonstrated by running it? | yes / partial / no |
| **Proven** | Is A_n backed by a test that was shown able to fail (red→green)? | yes / no |

- "Present but not proven" is the Arm A failure mode: it works when you click it, but nothing guards
  it against regression and nothing shows it was ever capable of failing.
- **Discrimination check (the instrument):** revert the feature implementation, run *that arm's own
  tests*, and count how many stay green. Green-after-revert = vacuous. Arm A has no tests, so its
  proven column is empty by construction; Arm B records a red baseline per behavior, so its
  discrimination rate is ~1.0.
- Scope drift is scored too: any of the three non-goals shipped counts against the arm — it is
  effort spent on what the founder ruled out.

---

## Score sheet (to fill in)

| # | Criterion | Arm A present | Arm A proven | Arm B present | Arm B proven |
|---|---|---|---|---|---|
| A1 | Compose | | | | |
| A2 | Real send (default) | | | | |
| A3 | Auditable record | | | | |
| A4 | Unsubscribe | | | | |
| A5 | Suppression | | | | |
| A6 | Postal footer | | | | |
| A7 | Allowlist | | | | |
| A8 | Authorization | | | | |
| A9 | Fail loud | | | | |
| — | Non-goals shipped? | | | | |
