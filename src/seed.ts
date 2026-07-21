import type { LoopbreakerDb } from "./db.js";
import { substrate } from "./domain.js";

export const DEMO_ISSUE = "DEMO-1";

export function seedDemo(db: LoopbreakerDb) {
  db.transaction(() => {
    db.raw.prepare(`
      INSERT INTO issues (id, title, description)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(
      DEMO_ISSUE,
      "Warm follow-up survives acceptance failures",
      "A synthetic cutover distilled from a real review loop: review can converge while shipping remains held by one unverified behavior.",
    );

    const behavior = db.raw.prepare(`
      INSERT INTO behaviors (id, issue_id, title, status, enforced, ordinal)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    behavior.run("DEMO-B1", DEMO_ISSUE, "Reuse a live successor after warm handoff", "verified", 1, 1);
    behavior.run("DEMO-B2", DEMO_ISSUE, "Persist acceptance before the external SDK effect", "verified", 1, 2);
    behavior.run("DEMO-B3", DEMO_ISSUE, "Redelivery produces the external effect exactly once", "pending", 1, 3);
    behavior.run("DEMO-B4", DEMO_ISSUE, "Expose operator timing diagnostics", "pending", 0, 4);

    const evidence = db.raw.prepare(`
      INSERT INTO evidence (id, issue_id, behavior_id, tier, verdict, summary, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    evidence.run("DEMO-E1", DEMO_ISSUE, "DEMO-B1", "live", "pass", "A live local run reused the same successor session.", "demo://live-successor");
    evidence.run("DEMO-E2", DEMO_ISSUE, "DEMO-B2", "wired", "pass", "The wired boundary records acceptance before invoking the SDK.", "demo://acceptance-order");
    evidence.run("DEMO-E3", DEMO_ISSUE, "DEMO-B3", "unit", "pass", "A unit retry test passes, but no wired redelivery proof exists yet.", "demo://unit-redelivery");

    db.raw.prepare(`
      INSERT INTO review_passes (id, issue_id, pass_number, kind, verdict, summary, legacy_pass_count)
      VALUES (?, ?, 1, 'comprehensive', 'fail', ?, 13)
      ON CONFLICT(issue_id, pass_number) DO NOTHING
    `).run(
      "DEMO-P1",
      DEMO_ISSUE,
      "Imported thirteen historical review iterations into one comprehensive pass. One reachable exact-once risk remains.",
    );

    db.raw.prepare(`
      INSERT INTO findings (
        id, issue_id, review_pass_id, behavior_id, severity, status, title,
        blocker_reachability, blocker_impact, blocker_rollback, smallest_fix
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    );
  });
  return substrate(db, DEMO_ISSUE);
}
