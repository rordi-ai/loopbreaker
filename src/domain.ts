import { randomUUID } from "node:crypto";
import type { LoopbreakerDb } from "./db.js";
import type {
  EvidenceTier,
  FindingSeverity,
  FindingStatus,
  ReviewKind,
  ShipState,
  Substrate,
  Verdict,
} from "./types.js";

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

const REVIEW_KINDS: Record<number, ReviewKind> = {
  1: "comprehensive",
  2: "repair_verification",
  3: "decision",
};

function reviewKind(passNumber: number): ReviewKind {
  const kind = REVIEW_KINDS[passNumber];
  if (!kind) throw new DomainError("invalid_pass", "Review passes are limited to 1, 2, and 3.");
  return kind;
}

export function substrate(db: LoopbreakerDb, issueId: string): Substrate {
  const issue = db.issue(issueId);
  if (!issue) {
    throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Run loopbreaker to list issues.");
  }

  const behaviors = db.behaviors(issueId);
  const evidence = db.evidence(issueId);
  const findings = db.findings(issueId);
  const reviewPasses = db.reviewPasses(issueId);
  const waivers = db.waivers(issueId);
  const waiverByBehavior = new Map(waivers.map((waiver) => [waiver.behavior_id, waiver.id]));

  const enforced = behaviors.filter((behavior) => behavior.enforced === 1);
  const verified = enforced.filter((behavior) => behavior.status === "verified");
  const waived = enforced.filter((behavior) => waiverByBehavior.has(behavior.id));
  const resolved = new Set([...verified, ...waived].map((behavior) => behavior.id));
  const unresolved = enforced.filter((behavior) => !resolved.has(behavior.id));

  let shipping: ShipState;
  if (unresolved.length > 0) {
    shipping = {
      disposition: "hold",
      ready: false,
      reason: `${unresolved.length} enforced behavior${unresolved.length === 1 ? " is" : "s are"} neither verified nor waived.`,
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id),
    };
  } else if (waived.length > 0) {
    shipping = {
      disposition: "ship_with_debt",
      ready: true,
      reason: "Every enforced behavior is verified or covered by an explicit waiver.",
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: waived.length,
      unresolved_behavior_ids: [],
    };
  } else {
    shipping = {
      disposition: "ship",
      ready: true,
      reason: "Every enforced behavior is verified.",
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: 0,
      unresolved_behavior_ids: [],
    };
  }

  const count = reviewPasses.length;
  const latest = reviewPasses.at(-1);
  const complete = count === 3 || latest?.verdict === "pass";
  const nextPass = complete ? null : count + 1;

  return {
    issue,
    contract: {
      frozen_to_behavior_children: true,
      enforced_by_default: true,
    },
    behaviors: behaviors.map((behavior) => ({
      ...behavior,
      evidence_ids: evidence.filter((item) => item.behavior_id === behavior.id).map((item) => item.id),
      waiver_id: waiverByBehavior.get(behavior.id) ?? null,
    })),
    evidence,
    findings,
    review_passes: reviewPasses,
    waivers,
    review: {
      pass_count: count,
      current_pass: latest?.pass_number ?? null,
      next_pass: nextPass,
      next_action: nextPass ? reviewKind(nextPass) : "none",
      automatic_pass_four: false,
      decision_required: count === 2 && latest?.verdict === "fail",
      complete,
    },
    shipping,
  };
}

export function importContract(
  db: LoopbreakerDb,
  input: {
    issueId: string;
    title: string;
    description?: string;
    behaviors: Array<{ id: string; title: string; trigger: string; expected: string; verify: string; advisory?: boolean }>;
  },
): Substrate {
  if (input.behaviors.length === 0) throw new DomainError("empty_contract", "A ship contract requires at least one behavior child.");
  if (new Set(input.behaviors.map((behavior) => behavior.id)).size !== input.behaviors.length) {
    throw new DomainError("duplicate_behavior", "Behavior IDs must be unique within the contract.");
  }
  if (input.behaviors.some((behavior) => [behavior.id, behavior.title, behavior.trigger, behavior.expected, behavior.verify].some((value) => !value.trim()))) {
    throw new DomainError("incomplete_behavior", "Every behavior requires non-empty id, title, trigger, expected, and verify fields.");
  }

  return db.transaction(() => {
    const existing = db.issue(input.issueId);
    if (existing && db.reviewPasses(input.issueId).length > 0) {
      const current = db.behaviors(input.issueId);
      const unchanged = current.length === input.behaviors.length && current.every((behavior, index) => {
        const incoming = input.behaviors[index];
        return incoming
          && behavior.id === incoming.id
          && behavior.title === incoming.title
          && behavior.trigger === incoming.trigger
          && behavior.expected === incoming.expected
          && behavior.verify === incoming.verify
          && behavior.enforced === (incoming.advisory ? 0 : 1);
      });
      if (!unchanged) {
        throw new DomainError(
          "contract_frozen",
          `${input.issueId} already has review passes; its behavior acceptance surface cannot be changed silently.`,
          "Create a new issue or explicitly re-scope before starting another review.",
        );
      }
    }

    db.raw.prepare(`
      INSERT INTO issues (id, title, description) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description
    `).run(input.issueId, input.title, input.description ?? "");

    if (!existing || db.reviewPasses(input.issueId).length === 0) {
      db.raw.prepare("DELETE FROM behaviors WHERE issue_id = ?").run(input.issueId);
      const statement = db.raw.prepare(`
        INSERT INTO behaviors (id, issue_id, title, trigger, expected, verify, status, enforced, ordinal)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `);
      input.behaviors.forEach((behavior, index) => {
        statement.run(
          behavior.id,
          input.issueId,
          behavior.title,
          behavior.trigger,
          behavior.expected,
          behavior.verify,
          behavior.advisory ? 0 : 1,
          index + 1,
        );
      });
    }
    return substrate(db, input.issueId);
  });
}

export function recordPass(
  db: LoopbreakerDb,
  input: { issueId: string; passNumber: number; verdict: Verdict; summary: string },
): Substrate {
  const current = substrate(db, input.issueId);
  if (!Number.isInteger(input.passNumber) || input.passNumber < 1 || input.passNumber > 3) {
    throw new DomainError("invalid_pass", "Review passes are limited to 1, 2, and 3.", "There is no automatic pass 4.");
  }
  const existing = current.review_passes.find((pass) => pass.pass_number === input.passNumber);
  if (existing) {
    if (existing.verdict === input.verdict && existing.summary === input.summary) return current;
    throw new DomainError("pass_conflict", `Pass ${input.passNumber} already has a different result.`);
  }
  if (input.passNumber !== current.review.pass_count + 1) {
    throw new DomainError("pass_out_of_order", `Expected pass ${current.review.pass_count + 1}, received pass ${input.passNumber}.`);
  }
  if (current.review.complete) {
    throw new DomainError("review_complete", "Review is already complete; another pass would expand the review loop.");
  }

  db.raw.prepare(`
    INSERT INTO review_passes (id, issue_id, pass_number, kind, verdict, summary)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.issueId, input.passNumber, reviewKind(input.passNumber), input.verdict, input.summary);
  return substrate(db, input.issueId);
}

export function upsertFinding(
  db: LoopbreakerDb,
  input: {
    issueId: string;
    findingId: string;
    behaviorId?: string;
    reviewPassNumber?: number;
    severity: FindingSeverity;
    status: FindingStatus;
    title: string;
    reachability?: string;
    impact?: string;
    rollback?: string;
    smallestFix?: string;
  },
): Substrate {
  const current = substrate(db, input.issueId);
  if (input.behaviorId && !current.behaviors.some((behavior) => behavior.id === input.behaviorId)) {
    throw new DomainError("behavior_not_found", `Behavior ${input.behaviorId} is not a child of ${input.issueId}.`);
  }
  if (input.severity === "P1" && input.status === "open") {
    const blockerFacts = [input.behaviorId, input.reachability, input.impact, input.rollback, input.smallestFix];
    if (blockerFacts.some((value) => !value?.trim())) {
      throw new DomainError(
        "incomplete_blocker_test",
        "An open P1 requires behavior attribution, reachability, impact, rollback, and smallest fix.",
        "Record an incomplete concern as non-blocking debt or supply the complete four-part blocker test.",
      );
    }
  }
  const existing = db.raw.prepare("SELECT issue_id FROM findings WHERE id = ?").get(input.findingId) as { issue_id: string } | undefined;
  if (existing && existing.issue_id !== input.issueId) {
    throw new DomainError("finding_conflict", `Finding ${input.findingId} already belongs to ${existing.issue_id}.`);
  }
  let reviewPassId: string | null = null;
  if (input.reviewPassNumber !== undefined) {
    const pass = current.review_passes.find((item) => item.pass_number === input.reviewPassNumber);
    if (!pass) throw new DomainError("review_pass_not_found", `Pass ${input.reviewPassNumber} has not been recorded for ${input.issueId}.`);
    reviewPassId = pass.id;
  }
  db.raw.prepare(`
    INSERT INTO findings (
      id, issue_id, review_pass_id, behavior_id, severity, status, title,
      blocker_reachability, blocker_impact, blocker_rollback, smallest_fix
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      review_pass_id = COALESCE(excluded.review_pass_id, findings.review_pass_id),
      behavior_id = COALESCE(excluded.behavior_id, findings.behavior_id),
      severity = excluded.severity,
      status = excluded.status,
      title = excluded.title,
      blocker_reachability = excluded.blocker_reachability,
      blocker_impact = excluded.blocker_impact,
      blocker_rollback = excluded.blocker_rollback,
      smallest_fix = excluded.smallest_fix
  `).run(
    input.findingId,
    input.issueId,
    reviewPassId,
    input.behaviorId ?? null,
    input.severity,
    input.status,
    input.title,
    input.reachability ?? null,
    input.impact ?? null,
    input.rollback ?? null,
    input.smallestFix ?? null,
  );
  return substrate(db, input.issueId);
}

export function recordEvidence(
  db: LoopbreakerDb,
  input: { issueId: string; behaviorId?: string; tier: EvidenceTier; verdict: Verdict; summary: string; source?: string },
): Substrate {
  const current = substrate(db, input.issueId);
  if (input.behaviorId && !current.behaviors.some((behavior) => behavior.id === input.behaviorId)) {
    throw new DomainError("behavior_not_found", `Behavior ${input.behaviorId} is not a child of ${input.issueId}.`);
  }
  db.raw.prepare(`
    INSERT INTO evidence (id, issue_id, behavior_id, tier, verdict, summary, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.issueId, input.behaviorId ?? null, input.tier, input.verdict, input.summary, input.source ?? "");
  return substrate(db, input.issueId);
}

export function verifyBehavior(db: LoopbreakerDb, behaviorId: string, evidenceId: string): Substrate {
  const behavior = db.raw.prepare("SELECT issue_id, enforced FROM behaviors WHERE id = ?").get(behaviorId) as { issue_id: string; enforced: number } | undefined;
  if (!behavior) throw new DomainError("behavior_not_found", `Behavior ${behaviorId} does not exist.`);
  const evidence = db.raw.prepare("SELECT behavior_id, verdict, tier FROM evidence WHERE id = ?").get(evidenceId) as
    | { behavior_id: string | null; verdict: Verdict; tier: EvidenceTier }
    | undefined;
  if (!evidence || evidence.behavior_id !== behaviorId) {
    throw new DomainError("evidence_mismatch", `Evidence ${evidenceId} is not attached to ${behaviorId}.`);
  }
  if (evidence.verdict !== "pass") {
    throw new DomainError("evidence_failed", "Failed evidence cannot verify a behavior.");
  }
  if (behavior.enforced === 1 && evidence.tier === "unit") {
    throw new DomainError(
      "proof_not_wired",
      "Unit evidence alone cannot verify an enforced behavior.",
      "Attach one passing wired or live capability proof; use lower-level tests as supporting fault injection.",
    );
  }
  db.raw.prepare("UPDATE behaviors SET status = 'verified' WHERE id = ?").run(behaviorId);
  return substrate(db, behavior.issue_id);
}

export function createWaiver(
  db: LoopbreakerDb,
  input: { issueId: string; behaviorId: string; rationale: string; approvedBy: string },
): Substrate {
  const current = substrate(db, input.issueId);
  const behavior = current.behaviors.find((item) => item.id === input.behaviorId);
  if (!behavior) throw new DomainError("behavior_not_found", `Behavior ${input.behaviorId} is not a child of ${input.issueId}.`);
  if (!behavior.enforced) throw new DomainError("waiver_not_needed", "Advisory behaviors do not require a waiver.");
  db.raw.prepare(`
    INSERT INTO waivers (id, issue_id, behavior_id, rationale, approved_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(behavior_id) DO UPDATE SET rationale = excluded.rationale, approved_by = excluded.approved_by
  `).run(randomUUID(), input.issueId, input.behaviorId, input.rationale, input.approvedBy);
  db.raw.prepare("UPDATE behaviors SET status = 'waived' WHERE id = ?").run(input.behaviorId);
  return substrate(db, input.issueId);
}
