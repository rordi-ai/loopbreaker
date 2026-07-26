import type { LoopbreakerDb } from "./db.js";
import { substrate } from "./domain.js";

export const DEMO_ISSUE = "DEMO-1";

export function seedDemo(db: LoopbreakerDb) {
  // LB-21: seed writes are privileged fixture writes that deliberately
  // fabricate a state the gated domain writers cannot legally produce
  // (pre-verified behaviors, legacy_pass_count, ungated passes). They still
  // inherit the opening ingress rather than going unattributed.
  const provenance = db.provenanceValues();
  db.transaction(() => {
    db.raw.prepare(`
      INSERT INTO issues (id, title, description, trigger_type, triggered_by, trigger_data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description
    `).run(
      DEMO_ISSUE,
      "Warm follow-up survives acceptance failures",
      "A synthetic cutover distilled from a real review loop: review can converge while shipping remains held by one unverified behavior.",
      ...provenance,
    );

    const behavior = db.raw.prepare(`
      INSERT INTO behaviors (id, issue_id, title, trigger, expected, verify, status, enforced, ordinal, harness_ref, trigger_type, triggered_by, trigger_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        trigger = excluded.trigger,
        expected = excluded.expected,
        verify = excluded.verify,
        enforced = excluded.enforced,
        ordinal = excluded.ordinal,
        harness_ref = excluded.harness_ref
    `);
    behavior.run("DEMO-B1", DEMO_ISSUE, "Reuse a live successor after warm handoff", "A follow-up arrives while the successor is live.", "The existing successor handles the follow-up.", "Run a live handoff and observe the same successor session ID.", "verified", 1, 1, null, ...provenance);
    behavior.run("DEMO-B2", DEMO_ISSUE, "Persist acceptance before the external SDK effect", "A worker accepts an external-effect request.", "Acceptance is durable before the SDK invocation starts.", "Trace the wired boundary and observe persistence preceding the SDK call.", "verified", 1, 2, null, ...provenance);
    behavior.run("DEMO-B3", DEMO_ISSUE, "Redelivery produces the external effect exactly once", "Delivery is replayed after acceptance.", "The external effect occurs exactly once.", "Replay twice through the wired worker and observe one external effect.", "pending", 1, 3, "demo-b3-replay", ...provenance);
    behavior.run("DEMO-B4", DEMO_ISSUE, "Expose operator timing diagnostics", "An operator inspects a retry.", "Timing fields are visible in diagnostics.", "Inspect one structured retry log.", "pending", 0, 4, null, ...provenance);

    db.setPlanningProfile(DEMO_ISSUE, {
      outcome: "A warm follow-up remains correct across acceptance and replay boundaries.",
      appetite: "One bounded exact-once repair slice.",
      non_goals: ["Redesigning the external SDK"],
      work_units: [{
        id: "exact-once-boundary",
        title: "Wire durable acceptance and replay protection",
        behavior_ids: ["DEMO-B1", "DEMO-B2", "DEMO-B3", "DEMO-B4"],
        done_when: "Warm reuse is live, acceptance precedes effects, and replay is exact once.",
      }],
      proofs: [
        { behavior_id: "DEMO-B1", tier: "live", method: "Observe one live successor reuse." },
        { behavior_id: "DEMO-B2", tier: "wired", method: "Trace persistence before SDK invocation." },
        { behavior_id: "DEMO-B3", tier: "wired", method: "Replay twice and observe one external effect." },
      ],
      production_wiring: "The worker persistence boundary and SDK adapter carry the exact-once key.",
      rollback: "Disable warm reuse and return to the cold path.",
      migration: "No data migration; add the idempotency key on new deliveries.",
      decision_owner: "Demo operator",
      risks: [{ risk: "The SDK may ignore idempotency.", mitigation: "Retain the cold-path rollback." }],
    });
    db.setShapeProfile(DEMO_ISSUE, {
      problem: "Warm handoff can accept a retry without proving the external effect remains exact once.",
      appetite: "One bounded exact-once repair slice.",
      smallest_slice: "Persist acceptance and carry one idempotency key through the wired SDK boundary.",
      non_goals: ["Redesigning the external SDK"],
      success_signal: "A wired redelivery creates one external effect.",
      reversibility: "Disable warm reuse and return to the cold path.",
      decision_owner: "Demo operator",
      risks: [{ risk: "The SDK may ignore idempotency.", mitigation: "Retain the cold-path rollback." }],
      disposition: "proceed",
    });

    db.raw.prepare(`
      INSERT INTO planning_review_passes (id, issue_id, pass_number, kind, verdict, summary, trigger_type, triggered_by, trigger_data)
      VALUES (?, ?, 1, 'comprehensive', 'approved', ?, ?, ?, ?)
      ON CONFLICT(issue_id, pass_number) DO NOTHING
    `).run("DEMO-PP1", DEMO_ISSUE, "Shape and plan form a bounded, traceable, reversible implementation contract.", ...provenance);

    const evidence = db.raw.prepare(`
      INSERT INTO evidence (id, issue_id, behavior_id, tier, verdict, summary, source, trigger_type, triggered_by, trigger_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    evidence.run("DEMO-E1", DEMO_ISSUE, "DEMO-B1", "live", "pass", "A live local run reused the same successor session.", "demo://live-successor", ...provenance);
    evidence.run("DEMO-E2", DEMO_ISSUE, "DEMO-B2", "wired", "pass", "The wired boundary records acceptance before invoking the SDK.", "demo://acceptance-order", ...provenance);
    evidence.run("DEMO-E3", DEMO_ISSUE, "DEMO-B3", "unit", "pass", "A unit retry test passes, but no wired redelivery proof exists yet.", "demo://unit-redelivery", ...provenance);

    db.raw.prepare(`
      INSERT INTO review_passes (id, issue_id, pass_number, kind, verdict, summary, legacy_pass_count, trigger_type, triggered_by, trigger_data)
      VALUES (?, ?, 1, 'comprehensive', 'fail', ?, 13, ?, ?, ?)
      ON CONFLICT(issue_id, pass_number) DO NOTHING
    `).run(
      "DEMO-P1",
      DEMO_ISSUE,
      "Imported thirteen historical review iterations into one comprehensive pass. One reachable exact-once risk remains.",
      ...provenance,
    );

    db.raw.prepare(`
      INSERT INTO findings (
        id, issue_id, review_pass_id, behavior_id, severity, status, title,
        blocker_reachability, blocker_impact, blocker_rollback, smallest_fix,
        trigger_type, triggered_by, trigger_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      "DEMO-F1",
      DEMO_ISSUE,
      "DEMO-P1",
      "DEMO-B3",
      "P1",
      "open",
      "A retry after acceptance can duplicate the SDK effect",
      "The worker may restart after persistence and before acknowledging delivery.",
      "A duplicate external side effect can be user-visible and irreversible.",
      "Disable warm reuse and fall back to the cold path.",
      "Add an idempotency key at the wired SDK boundary and prove one replay.",
      ...provenance,
    );
  });
  return substrate(db, DEMO_ISSUE);
}
