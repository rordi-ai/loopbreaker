import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { LoopbreakerDb } from "./db.js";
import type {
  EvidenceTier,
  FindingSeverity,
  FindingStatus,
  PlanningHealth,
  PlanningProfile,
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

const PLANNING_THRESHOLD = 80 as const;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function planningHealth(db: LoopbreakerDb, issueId: string): PlanningHealth {
  const issue = db.issue(issueId);
  if (!issue) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Run loopbreaker to list issues.");
  const behaviors = db.behaviors(issueId);
  const enforced = behaviors.filter((behavior) => behavior.enforced === 1);
  const profile = db.planningProfile(issueId);
  const workUnits = profile?.work_units ?? [];
  const proofs = profile?.proofs ?? [];
  const knownBehaviorIds = new Set(behaviors.map((behavior) => behavior.id));
  const enforcedIds = new Set(enforced.map((behavior) => behavior.id));
  const referencedIds = new Set(workUnits.flatMap((unit) => unit.behavior_ids));
  const proofIds = new Set(proofs.map((proof) => proof.behavior_id));
  const invalidReferences = [
    ...workUnits.flatMap((unit) => unit.behavior_ids),
    ...proofs.map((proof) => proof.behavior_id),
  ].filter((id) => !knownBehaviorIds.has(id));
  const invalidWorkReferences = workUnits.flatMap((unit) => unit.behavior_ids).filter((id) => !knownBehaviorIds.has(id));
  const unitOnly = proofs.filter((proof) => enforcedIds.has(proof.behavior_id) && proof.tier === "unit");
  const enforcedProofs = proofs.filter((proof) => enforcedIds.has(proof.behavior_id));
  const duplicateWorkUnitIds = workUnits.length > 0 && new Set(workUnits.map((unit) => unit.id)).size !== workUnits.length;
  const unmitigatedRisks = profile?.risks?.filter((risk) => present(risk.risk) && !present(risk.mitigation)) ?? [];

  const scopeScore = (present(profile?.outcome) ? 8 : 0)
    + (present(profile?.appetite) ? 6 : 0)
    + ((profile?.non_goals?.length ?? 0) > 0 ? 6 : 0);
  const contractScore = (behaviors.length > 0 ? 4 : 0)
    + (enforced.length > 0 ? 4 : 0)
    + (behaviors.every((behavior) => present(behavior.title)) ? 3 : 0)
    + (behaviors.every((behavior) => present(behavior.trigger)) ? 3 : 0)
    + (behaviors.every((behavior) => present(behavior.expected)) ? 3 : 0)
    + (behaviors.every((behavior) => present(behavior.verify)) ? 3 : 0);
  const traceabilityScore = (workUnits.length > 0 ? 4 : 0)
    + (workUnits.length > 0 && new Set(workUnits.map((unit) => unit.id)).size === workUnits.length && workUnits.every((unit) => present(unit.id)) ? 4 : 0)
    + (workUnits.length > 0 && invalidWorkReferences.length === 0 ? 4 : 0)
    + (enforced.every((behavior) => referencedIds.has(behavior.id)) ? 6 : 0)
    + (workUnits.length > 0 && workUnits.every((unit) => present(unit.title) && present(unit.done_when)) ? 2 : 0);
  const proofScore = (proofs.length > 0 ? 4 : 0)
    + (proofs.length > 0 && proofs.every((proof) => knownBehaviorIds.has(proof.behavior_id)) ? 3 : 0)
    + (enforced.every((behavior) => proofIds.has(behavior.id)) ? 6 : 0)
    + (enforcedProofs.length > 0 && unitOnly.length === 0 && enforcedProofs.every((proof) => proof.tier === "wired" || proof.tier === "live") ? 4 : 0)
    + (proofs.length > 0 && proofs.every((proof) => present(proof.method)) ? 3 : 0);
  const operabilityScore = (present(profile?.production_wiring) ? 5 : 0)
    + (present(profile?.rollback) ? 5 : 0)
    + (present(profile?.migration) ? 3 : 0)
    + (present(profile?.decision_owner) ? 3 : 0)
    + (Array.isArray(profile?.risks) && profile.risks.every((risk) => present(risk.risk) && present(risk.mitigation)) ? 4 : 0);

  const dimensions: PlanningHealth["dimensions"] = [
    { key: "scope", score: scopeScore, max_score: 20, status: scopeScore === 20 ? "pass" : scopeScore === 0 ? "fail" : "partial" },
    { key: "contract", score: contractScore, max_score: 20, status: contractScore === 20 ? "pass" : contractScore === 0 ? "fail" : "partial" },
    { key: "traceability", score: traceabilityScore, max_score: 20, status: traceabilityScore === 20 ? "pass" : traceabilityScore === 0 ? "fail" : "partial" },
    { key: "proof", score: proofScore, max_score: 20, status: proofScore === 20 ? "pass" : proofScore === 0 ? "fail" : "partial" },
    { key: "operability", score: operabilityScore, max_score: 20, status: operabilityScore === 20 ? "pass" : operabilityScore === 0 ? "fail" : "partial" },
  ];
  const score = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const blockers: PlanningHealth["blockers"] = [];
  if (!profile) blockers.push({ code: "missing_plan", message: "No planning profile is recorded." });
  if (enforced.length === 0) blockers.push({ code: "missing_enforced_behavior", message: "The contract has no enforced behavior." });
  const unmapped = enforced.filter((behavior) => !referencedIds.has(behavior.id)).map((behavior) => behavior.id);
  if (unmapped.length > 0) blockers.push({ code: "unmapped_behavior", message: `Enforced behaviors lack work-unit ownership: ${unmapped.join(", ")}.` });
  const unproved = enforced.filter((behavior) => !proofIds.has(behavior.id)).map((behavior) => behavior.id);
  if (unproved.length > 0) blockers.push({ code: "missing_proof", message: `Enforced behaviors lack planned proof: ${unproved.join(", ")}.` });
  if (unitOnly.length > 0) blockers.push({ code: "unit_only_proof", message: `Enforced behaviors plan only unit proof: ${unitOnly.map((proof) => proof.behavior_id).join(", ")}.` });
  if (invalidReferences.length > 0) blockers.push({ code: "invalid_behavior_reference", message: `Plan references unknown behaviors: ${[...new Set(invalidReferences)].join(", ")}.` });
  if (duplicateWorkUnitIds) blockers.push({ code: "duplicate_work_unit", message: "Work-unit IDs must be unique." });
  if (unmitigatedRisks.length > 0) blockers.push({ code: "unmitigated_risk", message: "Every named planning risk requires a mitigation." });
  if (!present(profile?.production_wiring)) blockers.push({ code: "missing_production_wiring", message: "Production construction and wiring are not described." });
  if (!present(profile?.rollback)) blockers.push({ code: "missing_rollback", message: "Rollback or safe disablement is not described." });
  if (score < PLANNING_THRESHOLD) blockers.push({ code: "score_below_threshold", message: `Planning health ${score}/100 is below ${PLANNING_THRESHOLD}.` });
  const ready = blockers.length === 0;

  return {
    score,
    threshold: PLANNING_THRESHOLD,
    ready,
    grade: ready ? "healthy" : score >= PLANNING_THRESHOLD ? "at_risk" : "blocked",
    dimensions,
    blockers,
    recommendations: blockers.map((blocker) => blocker.message),
    profile,
  };
}

export function recordPlanning(db: LoopbreakerDb, issueId: string, profile: PlanningProfile): PlanningHealth {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Import its behavior contract first.");
  const current = db.planningProfile(issueId);
  if (db.reviewPasses(issueId).length > 0 && current !== null) {
    if (isDeepStrictEqual(current, profile)) return planningHealth(db, issueId);
    throw new DomainError("plan_frozen", `${issueId} already has review passes; its planning profile cannot change silently.`, "Create a new issue or explicitly re-scope before another review.");
  }
  db.setPlanningProfile(issueId, profile);
  return planningHealth(db, issueId);
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
  const planning = planningHealth(db, issueId);
  const waiverByBehavior = new Map(waivers.map((waiver) => [waiver.behavior_id, waiver.id]));

  const enforced = behaviors.filter((behavior) => behavior.enforced === 1);
  const verified = enforced.filter((behavior) => behavior.status === "verified");
  const waived = enforced.filter((behavior) => waiverByBehavior.has(behavior.id));
  const resolved = new Set([...verified, ...waived].map((behavior) => behavior.id));
  const unresolved = enforced.filter((behavior) => !resolved.has(behavior.id));

  let shipping: ShipState;
  if (!planning.ready) {
    shipping = {
      disposition: "hold",
      ready: false,
      reason: `Planning health ${planning.score}/100 is not ready: ${planning.blockers.map((blocker) => blocker.code).join(", ")}.`,
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id),
      gate: "planning",
      planning_score: planning.score,
    };
  } else if (unresolved.length > 0) {
    shipping = {
      disposition: "hold",
      ready: false,
      reason: `${unresolved.length} enforced behavior${unresolved.length === 1 ? " is" : "s are"} neither verified nor waived.`,
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id),
      gate: "verification",
      planning_score: planning.score,
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
      gate: "ready",
      planning_score: planning.score,
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
      gate: "ready",
      planning_score: planning.score,
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
    planning,
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
    planning?: PlanningProfile;
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
    if (input.planning) {
      const currentPlan = db.planningProfile(input.issueId);
      if (db.reviewPasses(input.issueId).length > 0 && currentPlan !== null && !isDeepStrictEqual(currentPlan, input.planning)) {
        throw new DomainError("plan_frozen", `${input.issueId} already has review passes; its planning profile cannot change silently.`);
      }
      db.setPlanningProfile(input.issueId, input.planning);
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
  if (input.passNumber === 1 && !current.planning.ready) {
    throw new DomainError(
      "planning_not_ready",
      `Pass one cannot start while planning health is ${current.planning.score}/100 with ${current.planning.blockers.length} blocker(s).`,
      `Run loopbreaker health ${input.issueId}, repair the named blockers, then record pass one.`,
    );
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
