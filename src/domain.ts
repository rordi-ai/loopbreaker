import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { LoopbreakerDb } from "./db.js";
import type {
  EvidenceTier,
  FindingSeverity,
  FindingStatus,
  PlanningFindingStage,
  PlanningHealth,
  PlanningProfile,
  PlanningReviewKind,
  PlanningReviewState,
  PlanningReviewVerdict,
  ReviewKind,
  ShapeProfile,
  ShapeState,
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
const PLANNING_REVIEW_KINDS: Record<number, PlanningReviewKind> = {
  1: "comprehensive",
  2: "repair_verification",
  3: "decision",
};

function reviewKind(passNumber: number): ReviewKind {
  const kind = REVIEW_KINDS[passNumber];
  if (!kind) throw new DomainError("invalid_pass", "Review passes are limited to 1, 2, and 3.");
  return kind;
}

function planningReviewKind(passNumber: number): PlanningReviewKind {
  const kind = PLANNING_REVIEW_KINDS[passNumber];
  if (!kind) throw new DomainError("invalid_planning_review_pass", "Planning review passes are limited to 1, 2, and 3.", "There is no automatic pass 4.");
  return kind;
}

const PLANNING_THRESHOLD = 80 as const;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function shapeState(db: LoopbreakerDb, issueId: string): ShapeState {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Import its behavior contract first.");
  const profile = db.shapeProfile(issueId);
  const blockers: ShapeState["blockers"] = [];
  // LB-28 — discovery is the first ordered authority. A shape may be drafted
  // from an approved record (that is the shaping agent's job); what is refused
  // is `proceed` on a premise no human ever approved.
  const discovery = discoveryState(db, issueId);
  if (discovery.status === "missing") {
    blockers.push({ code: "missing_discovery", message: "No discovery record exists; the premise has no human behind it." });
  } else if (discovery.status === "draft") {
    blockers.push({ code: "unapproved_discovery", message: "The discovery record is still a draft and has not been approved." });
  }
  if (!profile) blockers.push({ code: "missing_shape", message: "No explicit shape decision is recorded." });
  if (profile) {
    const required = [profile.problem, profile.appetite, profile.smallest_slice, profile.success_signal, profile.reversibility, profile.decision_owner];
    if (required.some((value) => !present(value))) blockers.push({ code: "incomplete_shape", message: "Shape requires problem, appetite, smallest slice, success signal, reversibility, and decision owner." });
    if (profile.non_goals.length === 0) blockers.push({ code: "missing_non_goals", message: "Shape must state at least one non-goal." });
    if (profile.risks.some((risk) => !present(risk.risk) || !present(risk.mitigation))) blockers.push({ code: "unmitigated_shape_risk", message: "Every shape risk requires a mitigation." });
    if (profile.disposition !== "proceed") blockers.push({ code: `shape_${profile.disposition}`, message: `Shape disposition is ${profile.disposition}, not proceed.` });
  }
  return { profile, ready: blockers.length === 0, blockers };
}

export function recordShape(db: LoopbreakerDb, issueId: string, profile: ShapeProfile): ShapeState {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Import its behavior contract first.");
  const current = db.shapeProfile(issueId);
  if (planningReviewState(db, issueId).approved && current !== null) {
    if (isDeepStrictEqual(current, profile)) return shapeState(db, issueId);
    throw new DomainError("shape_frozen", `${issueId} has an approved planning review; its shape cannot change silently.`, "Create a new issue or record an explicit re-scope decision.");
  }
  db.setShapeProfile(issueId, profile);
  return shapeState(db, issueId);
}

export function planningReviewState(db: LoopbreakerDb, issueId: string): PlanningReviewState {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`);
  const passes = db.planningReviewPasses(issueId);
  const findings = db.planningFindings(issueId);
  const latest = passes.at(-1);
  const terminal = latest?.verdict === "approved" || latest?.verdict === "rescope" || latest?.verdict === "return_to_shaping";
  const nextPass = terminal || passes.length >= 3 ? null : passes.length + 1;
  return {
    pass_count: passes.length,
    current_pass: latest?.pass_number ?? null,
    next_pass: nextPass,
    next_action: nextPass ? planningReviewKind(nextPass) : "none",
    automatic_pass_four: false,
    decision_required: passes.length === 2 && latest?.verdict === "changes_required",
    complete: terminal || passes.length === 3,
    approved: latest?.verdict === "approved",
    disposition: latest?.verdict ?? "pending",
    open_blocking_count: findings.filter((finding) => finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1")).length,
  };
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
  if ((db.reviewPasses(issueId).length > 0 || planningReviewState(db, issueId).approved) && current !== null) {
    if (isDeepStrictEqual(current, profile)) return planningHealth(db, issueId);
    throw new DomainError("plan_frozen", `${issueId} has an approved planning review or code review passes; its planning profile cannot change silently.`, "Create a new issue or explicitly re-scope before another review.");
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
  const planningReviewPasses = db.planningReviewPasses(issueId);
  const planningFindings = db.planningFindings(issueId);
  const waivers = db.waivers(issueId);
  const planning = planningHealth(db, issueId);
  const shape = shapeState(db, issueId);
  const planningReview = planningReviewState(db, issueId);
  const waiverByBehavior = new Map(waivers.map((waiver) => [waiver.behavior_id, waiver.id]));

  const enforced = behaviors.filter((behavior) => behavior.enforced === 1);
  const verified = enforced.filter((behavior) => behavior.status === "verified");
  const waived = enforced.filter((behavior) => waiverByBehavior.has(behavior.id));
  const resolved = new Set([...verified, ...waived].map((behavior) => behavior.id));
  const unresolved = enforced.filter((behavior) => !resolved.has(behavior.id));

  let shipping: ShipState;
  // LB-28 — discovery gates ahead of shape, so an issue held for a missing
  // premise reports THAT rather than a downstream stage it never reached.
  const discovery = discoveryState(db, issueId);
  if (!discovery.satisfied) {
    shipping = {
      disposition: "hold", ready: false,
      reason: discovery.status === "missing"
        ? "No discovery record exists; the premise has no human behind it."
        : "The discovery record is still a draft and has not been approved.",
      enforced_total: enforced.length, verified_total: verified.length, waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id), gate: "discovery", planning_score: planning.score,
    };
  } else if (!shape.ready) {
    shipping = {
      disposition: "hold", ready: false,
      reason: `Shape is not ready: ${shape.blockers.map((blocker) => blocker.code).join(", ")}.`,
      enforced_total: enforced.length, verified_total: verified.length, waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id), gate: "shape", planning_score: planning.score,
    };
  } else if (!planning.ready) {
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
  } else if (!planningReview.approved) {
    shipping = {
      disposition: "hold", ready: false,
      reason: `Planning review is ${planningReview.disposition}; independent approval is required before implementation.`,
      enforced_total: enforced.length, verified_total: verified.length, waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id), gate: "planning_review", planning_score: planning.score,
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
    shape,
    planning,
    planning_review: planningReview,
    planning_findings: planningFindings,
    planning_review_passes: planningReviewPasses,
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
    behaviors: Array<{ id: string; title: string; trigger: string; expected: string; verify: string; advisory?: boolean; harness_ref?: string }>;
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
    if (existing && (db.reviewPasses(input.issueId).length > 0 || planningReviewState(db, input.issueId).approved)) {
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
          `${input.issueId} has an approved planning review or code review passes; its behavior acceptance surface cannot be changed silently.`,
          "Create a new issue or explicitly re-scope before starting another review.",
        );
      }
    }

    // LB-21 write site 1/12 — issues. The ON CONFLICT branch re-stamps: a
    // re-imported issue is a new row version.
    db.raw.prepare(`
      INSERT INTO issues (id, title, description, trigger_type, triggered_by, trigger_data) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, description = excluded.description,
        trigger_type = excluded.trigger_type, triggered_by = excluded.triggered_by, trigger_data = excluded.trigger_data
    `).run(input.issueId, input.title, input.description ?? "", ...db.provenanceValues());

    if (!existing || (db.reviewPasses(input.issueId).length === 0 && !planningReviewState(db, input.issueId).approved)) {
      db.raw.prepare("DELETE FROM behaviors WHERE issue_id = ?").run(input.issueId);
      // LB-21 write site 2/12 — behaviors on insert.
      const statement = db.raw.prepare(`
        INSERT INTO behaviors (id, issue_id, title, trigger, expected, verify, status, enforced, ordinal, harness_ref, trigger_type, triggered_by, trigger_data)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
      `);
      const provenance = db.provenanceValues();
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
          behavior.harness_ref ?? null,
          ...provenance,
        );
      });
    }
    if (input.planning) {
      const currentPlan = db.planningProfile(input.issueId);
      if ((db.reviewPasses(input.issueId).length > 0 || planningReviewState(db, input.issueId).approved) && currentPlan !== null && !isDeepStrictEqual(currentPlan, input.planning)) {
        throw new DomainError("plan_frozen", `${input.issueId} has an approved planning review or code review passes; its planning profile cannot change silently.`);
      }
      db.setPlanningProfile(input.issueId, input.planning);
    }
    return substrate(db, input.issueId);
  });
}

export function upsertPlanningFinding(
  db: LoopbreakerDb,
  input: {
    issueId: string;
    findingId: string;
    reviewPassNumber?: number;
    stage: PlanningFindingStage;
    severity: FindingSeverity;
    status: FindingStatus;
    title: string;
    reachability?: string;
    impact?: string;
    smallestFix?: string;
  },
): Substrate {
  const current = substrate(db, input.issueId);
  if ((input.severity === "P0" || input.severity === "P1") && input.status === "open") {
    if ([input.reachability, input.impact, input.smallestFix].some((value) => !value?.trim())) {
      throw new DomainError("incomplete_planning_blocker", "An open P0/P1 planning finding requires reachability, impact, and smallest fix.");
    }
  }
  const existing = db.raw.prepare("SELECT issue_id FROM planning_findings WHERE id = ?").get(input.findingId) as { issue_id: string } | undefined;
  if (existing && existing.issue_id !== input.issueId) throw new DomainError("planning_finding_conflict", `Finding ${input.findingId} already belongs to ${existing.issue_id}.`);
  let passId: string | null = null;
  if (input.reviewPassNumber !== undefined) {
    const pass = current.planning_review_passes.find((item) => item.pass_number === input.reviewPassNumber);
    if (!pass) throw new DomainError("planning_review_pass_not_found", `Planning-review pass ${input.reviewPassNumber} has not been recorded for ${input.issueId}.`);
    passId = pass.id;
  }
  // LB-21 write site 3/12 — planning_findings.
  db.raw.prepare(`
    INSERT INTO planning_findings (id, issue_id, planning_review_pass_id, stage, severity, status, title, reachability, impact, smallest_fix, trigger_type, triggered_by, trigger_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      planning_review_pass_id = COALESCE(excluded.planning_review_pass_id, planning_findings.planning_review_pass_id),
      stage = excluded.stage, severity = excluded.severity, status = excluded.status,
      title = excluded.title, reachability = COALESCE(excluded.reachability, planning_findings.reachability),
      impact = COALESCE(excluded.impact, planning_findings.impact), smallest_fix = COALESCE(excluded.smallest_fix, planning_findings.smallest_fix),
      trigger_type = excluded.trigger_type, triggered_by = excluded.triggered_by, trigger_data = excluded.trigger_data
  `).run(input.findingId, input.issueId, passId, input.stage, input.severity, input.status, input.title,
    input.reachability ?? null, input.impact ?? null, input.smallestFix ?? null, ...db.provenanceValues());
  return substrate(db, input.issueId);
}

export function recordPlanningReviewPass(
  db: LoopbreakerDb,
  input: { issueId: string; passNumber: number; verdict: PlanningReviewVerdict; summary: string },
): Substrate {
  const current = substrate(db, input.issueId);
  planningReviewKind(input.passNumber);
  const existing = current.planning_review_passes.find((pass) => pass.pass_number === input.passNumber);
  if (existing) {
    if (existing.verdict === input.verdict && existing.summary === input.summary) return current;
    throw new DomainError("planning_review_pass_conflict", `Planning-review pass ${input.passNumber} already has a different result.`);
  }
  if (input.passNumber !== current.planning_review.pass_count + 1) {
    throw new DomainError("planning_review_pass_out_of_order", `Expected planning-review pass ${current.planning_review.pass_count + 1}, received pass ${input.passNumber}.`);
  }
  if (current.planning_review.complete) throw new DomainError("planning_review_complete", "Planning review is complete; another pass would expand the review loop.");
  if (input.passNumber === 1 && !current.shape.ready) throw new DomainError("shape_not_ready", "Planning review cannot start until shape disposition is proceed and the shape is complete.");
  if (input.passNumber === 1 && !current.planning.ready) throw new DomainError("planning_not_ready", `Planning review cannot start while health is ${current.planning.score}/100.`);
  const allowed = input.passNumber < 3
    ? ["approved", "changes_required"]
    : ["approved", "rescope", "return_to_shaping"];
  if (!allowed.includes(input.verdict)) {
    throw new DomainError("invalid_planning_review_verdict", `Pass ${input.passNumber} permits: ${allowed.join(", ")}.`);
  }
  if (input.verdict === "approved" && current.planning_review.open_blocking_count > 0) {
    throw new DomainError("open_planning_blockers", `Approval is blocked by ${current.planning_review.open_blocking_count} open P0/P1 planning finding(s).`);
  }
  db.raw.prepare(`
    INSERT INTO planning_review_passes (id, issue_id, pass_number, kind, verdict, summary, trigger_type, triggered_by, trigger_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.issueId, input.passNumber, planningReviewKind(input.passNumber), input.verdict, input.summary, ...db.provenanceValues());
  return substrate(db, input.issueId);
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
  if (!current.shape.ready) {
    throw new DomainError("shape_not_ready", "Code review cannot continue until shape disposition is proceed and the shape is complete.");
  }
  if (!current.planning.ready) {
    throw new DomainError(
      "planning_not_ready",
      `Code review cannot continue while planning health is ${current.planning.score}/100 with ${current.planning.blockers.length} blocker(s).`,
      `Run loopbreaker health ${input.issueId}, repair the named blockers, then record the next allowed pass.`,
    );
  }
  if (!current.planning_review.approved) {
    throw new DomainError("planning_review_not_approved", "Code review cannot continue until the independent planning review is approved.", `Run loopbreaker readiness ${input.issueId} and complete the named planning-review action.`);
  }
  if (input.passNumber !== current.review.pass_count + 1) {
    throw new DomainError("pass_out_of_order", `Expected pass ${current.review.pass_count + 1}, received pass ${input.passNumber}.`);
  }
  if (current.review.complete) {
    throw new DomainError("review_complete", "Review is already complete; another pass would expand the review loop.");
  }

  db.raw.prepare(`
    INSERT INTO review_passes (id, issue_id, pass_number, kind, verdict, summary, trigger_type, triggered_by, trigger_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.issueId, input.passNumber, reviewKind(input.passNumber), input.verdict, input.summary, ...db.provenanceValues());
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
      blocker_reachability, blocker_impact, blocker_rollback, smallest_fix,
      trigger_type, triggered_by, trigger_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      review_pass_id = COALESCE(excluded.review_pass_id, findings.review_pass_id),
      behavior_id = COALESCE(excluded.behavior_id, findings.behavior_id),
      severity = excluded.severity,
      status = excluded.status,
      title = excluded.title,
      blocker_reachability = COALESCE(excluded.blocker_reachability, findings.blocker_reachability),
      blocker_impact = COALESCE(excluded.blocker_impact, findings.blocker_impact),
      blocker_rollback = COALESCE(excluded.blocker_rollback, findings.blocker_rollback),
      smallest_fix = COALESCE(excluded.smallest_fix, findings.smallest_fix),
      trigger_type = excluded.trigger_type, triggered_by = excluded.triggered_by, trigger_data = excluded.trigger_data
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
    ...db.provenanceValues(),
  );
  return substrate(db, input.issueId);
}

export function recordEvidence(
  db: LoopbreakerDb,
  input: {
    issueId: string;
    behaviorId?: string;
    tier: EvidenceTier;
    verdict: Verdict;
    summary: string;
    source?: string;
    /**
     * LB-27 — set ONLY by the prove path. A caller cannot claim execution: the
     * CLI and MCP evidence surfaces do not expose these, so anything recorded
     * through them is `executed: 0` by construction.
     */
    executed?: boolean;
    harnessId?: string;
    exitCode?: number | null;
  },
): Substrate {
  const current = substrate(db, input.issueId);
  if (input.behaviorId && !current.behaviors.some((behavior) => behavior.id === input.behaviorId)) {
    throw new DomainError("behavior_not_found", `Behavior ${input.behaviorId} is not a child of ${input.issueId}.`);
  }
  // A red baseline exists when this behavior has already recorded an EXECUTED
  // failure from the same harness. That is what makes a later pass meaningful:
  // the harness has been observed discriminating.
  const baselined = input.executed && input.behaviorId && input.harnessId
    ? Boolean(db.raw.prepare(
        "SELECT 1 FROM evidence WHERE behavior_id = ? AND harness_id = ? AND executed = 1 AND verdict = 'fail' LIMIT 1",
      ).get(input.behaviorId, input.harnessId))
    : false;
  db.raw.prepare(`
    INSERT INTO evidence (id, issue_id, behavior_id, tier, verdict, summary, source, executed, harness_id, exit_code, baselined, trigger_type, triggered_by, trigger_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), input.issueId, input.behaviorId ?? null, input.tier, input.verdict, input.summary, input.source ?? "",
    input.executed ? 1 : 0, input.harnessId ?? null, input.exitCode ?? null, baselined ? 1 : 0,
    ...db.provenanceValues(),
  );
  return substrate(db, input.issueId);
}

export function verifyBehavior(db: LoopbreakerDb, behaviorId: string, evidenceId: string): Substrate {
  const behavior = db.raw.prepare("SELECT issue_id, enforced FROM behaviors WHERE id = ?").get(behaviorId) as { issue_id: string; enforced: number } | undefined;
  if (!behavior) throw new DomainError("behavior_not_found", `Behavior ${behaviorId} does not exist.`);
  const evidence = db.raw.prepare("SELECT behavior_id, verdict, tier, executed FROM evidence WHERE id = ?").get(evidenceId) as
    | { behavior_id: string | null; verdict: Verdict; tier: EvidenceTier; executed: number }
    | undefined;
  if (!evidence || evidence.behavior_id !== behaviorId) {
    throw new DomainError("evidence_mismatch", `Evidence ${evidenceId} is not attached to ${behaviorId}.`);
  }
  if (evidence.verdict === "not_run") {
    throw new DomainError(
      "evidence_not_run",
      "Evidence whose harness did not run cannot verify a behavior.",
      "`not_run` is the fail-closed default: not observing a pass is never the same as passing.",
    );
  }
  if (evidence.verdict !== "pass") {
    throw new DomainError("evidence_failed", "Failed evidence cannot verify a behavior.");
  }
  // LB-27 — the gate. An enforced behavior needs proof loopbreaker executed
  // itself, not a caller's claim about a run. This is the mirror of the
  // enforced+unit refusal below, closing the same hole one level up.
  if (behavior.enforced === 1 && evidence.executed !== 1) {
    throw new DomainError(
      "evidence_not_executed",
      "Asserted evidence cannot verify an enforced behavior; loopbreaker did not execute this proof.",
      `Run \`loopbreaker prove ${behaviorId}\` so the verdict comes from the harness rather than from the caller.`,
    );
  }
  if (behavior.enforced === 1 && evidence.tier === "unit") {
    throw new DomainError(
      "proof_not_wired",
      "Unit evidence alone cannot verify an enforced behavior.",
      "Attach one passing wired or live capability proof; use lower-level tests as supporting fault injection.",
    );
  }
  // LB-21 write site 9/12 — the verifyBehavior status progression. A status
  // change is a new row version, so it re-stamps rather than inheriting the
  // provenance of whichever ingress originally inserted the behavior.
  db.raw.prepare(
    "UPDATE behaviors SET status = 'verified', trigger_type = ?, triggered_by = ?, trigger_data = ? WHERE id = ?",
  ).run(...db.provenanceValues(), behaviorId);
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
    INSERT INTO waivers (id, issue_id, behavior_id, rationale, approved_by, trigger_type, triggered_by, trigger_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(behavior_id) DO UPDATE SET
      rationale = excluded.rationale, approved_by = excluded.approved_by,
      trigger_type = excluded.trigger_type, triggered_by = excluded.triggered_by, trigger_data = excluded.trigger_data
  `).run(randomUUID(), input.issueId, input.behaviorId, input.rationale, input.approvedBy, ...db.provenanceValues());
  // LB-21 write site 10/12 — the second behaviour-status progression.
  db.raw.prepare(
    "UPDATE behaviors SET status = 'waived', trigger_type = ?, triggered_by = ?, trigger_data = ? WHERE id = ?",
  ).run(...db.provenanceValues(), input.behaviorId);
  return substrate(db, input.issueId);
}

/** One behavior that reached `verified` without proof loopbreaker executed. */
export interface DemotionCandidate {
  behavior_id: string;
  issue_id: string;
  title: string;
  enforced: number;
  reason: string;
}

/**
 * LB-27 — every enforced behavior currently `verified` whose supporting evidence
 * was asserted rather than executed.
 *
 * Pure read. `demote --dry-run` reports exactly this set and changes nothing;
 * `--apply` demotes exactly this set. Keeping the two on one query is what makes
 * the promise "applies the reported set" mechanically true rather than a claim.
 */
export function demotionCandidates(db: LoopbreakerDb): DemotionCandidate[] {
  const rows = db.raw.prepare(`
    SELECT b.id AS behavior_id, b.issue_id, b.title, b.enforced,
           (SELECT COUNT(*) FROM evidence e WHERE e.behavior_id = b.id AND e.executed = 1 AND e.verdict = 'pass') AS executed_passes
    FROM behaviors b
    WHERE b.status = 'verified' AND b.enforced = 1
    ORDER BY b.issue_id, b.ordinal
  `).all() as Array<{ behavior_id: string; issue_id: string; title: string; enforced: number; executed_passes: number }>;

  return rows
    .filter((row) => row.executed_passes === 0)
    .map((row) => ({
      behavior_id: row.behavior_id,
      issue_id: row.issue_id,
      title: row.title,
      enforced: row.enforced,
      reason: "verified on evidence loopbreaker never executed",
    }));
}

export interface DemotionResult {
  applied: boolean;
  demoted: DemotionCandidate[];
}

/**
 * Report or apply the demotion. Idempotent: once demoted, a behavior is no
 * longer `verified`, so a second apply finds nothing further.
 */
export function demoteUnexecuted(db: LoopbreakerDb, options: { apply: boolean }): DemotionResult {
  const demoted = demotionCandidates(db);
  if (!options.apply) return { applied: false, demoted };

  const statement = db.raw.prepare(
    "UPDATE behaviors SET status = 'pending', trigger_type = ?, triggered_by = ?, trigger_data = ? WHERE id = ?",
  );
  const provenance = db.provenanceValues();
  db.transaction(() => {
    for (const candidate of demoted) statement.run(...provenance, candidate.behavior_id);
  });
  return { applied: true, demoted };
}

/**
 * LB-27 — bind a behavior to a registered harness.
 *
 * Deliberately NOT subject to the contract freeze. The behavior contract states
 * what must be true and how it is proven in prose (`trigger`/`expected`/
 * `verify`); the harness ref only says which registered runner implements that
 * prose. Changing the runner does not change the requirement, and freezing the
 * ref would make an approved issue permanently unprovable — which is exactly
 * where LB-21 ended up.
 *
 * The binding is not trusted on its own: `resolveHarnessFor` additionally
 * requires the registry entry to name this behavior in its `proves` list, which
 * is a reviewed code change. One half of the binding is cheap and revocable;
 * the other half has to survive review.
 */
export function bindHarness(db: LoopbreakerDb, behaviorId: string, harnessRef: string): Substrate {
  const behavior = db.raw.prepare("SELECT issue_id FROM behaviors WHERE id = ?").get(behaviorId) as { issue_id: string } | undefined;
  if (!behavior) throw new DomainError("behavior_not_found", `Behavior ${behaviorId} does not exist.`);
  db.raw.prepare(
    "UPDATE behaviors SET harness_ref = ?, trigger_type = ?, triggered_by = ?, trigger_data = ? WHERE id = ?",
  ).run(harnessRef, ...db.provenanceValues(), behaviorId);
  return substrate(db, behavior.issue_id);
}

/**
 * LB-28 — the shape fields a discovery record must answer before the gate opens.
 *
 * Field-isomorphic by construction: one answer per field, so LB-25's stronger
 * value-binding becomes a later increment on this storage rather than a rewrite.
 */
export const DISCOVERY_FIELDS = [
  "problem",
  "appetite",
  "smallest_slice",
  "non_goals",
  "success_signal",
  "reversibility",
  "decision_owner",
  "risks",
] as const;

export interface DiscoveryAnswer {
  field: string;
  question: string;
  answer: string;
}

export interface DiscoveryState {
  issue_id: string;
  status: "missing" | "draft" | "approved" | "grandfathered";
  approved_by: string | null;
  approved_at: string | null;
  answers: DiscoveryAnswer[];
  /** True when the premise has a human behind it, or the issue predates the gate. */
  satisfied: boolean;
}

export function discoveryState(db: LoopbreakerDb, issueId: string): DiscoveryState {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`);
  const record = db.raw.prepare(
    "SELECT status, approved_by, approved_at FROM discovery_records WHERE issue_id = ?",
  ).get(issueId) as { status: DiscoveryState["status"]; approved_by: string | null; approved_at: string | null } | undefined;
  const answers = db.raw.prepare(
    "SELECT field, question, answer FROM discovery_answers WHERE issue_id = ? ORDER BY rowid",
  ).all(issueId) as unknown as DiscoveryAnswer[];
  const status = record?.status ?? "missing";
  return {
    issue_id: issueId,
    status,
    approved_by: record?.approved_by ?? null,
    approved_at: record?.approved_at ?? null,
    answers,
    satisfied: status === "approved" || status === "grandfathered",
  };
}

/**
 * Record or replace an issue's discovery answers.
 *
 * Replacing the answers returns the record to `draft`, even if it was approved:
 * an approved premise silently edited afterwards would have the gate vouch for
 * text the approver never saw — the same defect one layer up.
 */
export function recordDiscovery(db: LoopbreakerDb, issueId: string, answers: DiscoveryAnswer[]): DiscoveryState {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`);
  const supplied = new Map(answers.map((entry) => [entry.field, entry]));
  const missing = DISCOVERY_FIELDS.filter((field) => {
    const entry = supplied.get(field);
    return !entry || !present(entry.question) || !present(entry.answer);
  });
  if (missing.length > 0) {
    throw new DomainError(
      "incomplete_discovery",
      `The discovery record leaves required shape fields unanswered: ${missing.join(", ")}.`,
      "Every required shape field needs a question and a founder answer. Interview for what is missing; do not invent it.",
    );
  }
  const provenance = db.provenanceValues();
  db.transaction(() => {
    db.raw.prepare("DELETE FROM discovery_answers WHERE issue_id = ?").run(issueId);
    const statement = db.raw.prepare(`
      INSERT INTO discovery_answers (issue_id, field, question, answer, trigger_type, triggered_by, trigger_data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const field of DISCOVERY_FIELDS) {
      const entry = supplied.get(field)!;
      statement.run(issueId, field, entry.question, entry.answer, ...provenance);
    }
    db.raw.prepare(`
      INSERT INTO discovery_records (issue_id, status, approved_by, approved_at, trigger_type, triggered_by, trigger_data)
      VALUES (?, 'draft', NULL, NULL, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        status = 'draft', approved_by = NULL, approved_at = NULL,
        updated_at = CURRENT_TIMESTAMP,
        trigger_type = excluded.trigger_type, triggered_by = excluded.triggered_by, trigger_data = excluded.trigger_data
    `).run(issueId, ...provenance);
  });
  return discoveryState(db, issueId);
}

/** Ingresses permitted to approve a premise. Only the browser: see approveDiscovery. */
const APPROVAL_INGRESSES = new Set<string>(["web"]);

/**
 * Approve a discovery record — the one act an agent must not be able to issue on
 * its own behalf.
 *
 * ONLY the `web` ingress may approve. This is not fussiness; it was demonstrated
 * live. In a dry run an agent offered "I'll approve on your behalf" as its first
 * option, ran the CLI, and wrote the founder's name into `approved_by`. The
 * record read `approved_by: "Ben (ben@rordi.ai)"` while provenance read
 * `cli`/`ubuntu` — the agent's own shell. LB-25's shape had named exactly that:
 * an attester that is a caller-supplied string lets an in-session agent "write
 * its own answers, name the founder, and certify its own premise as
 * founder-backed."
 *
 * `approved_by` is caller-supplied and therefore worthless as an authenticator;
 * only the INGRESS is evidence. A founder's terminal and an agent's terminal are
 * indistinguishable, so allowing `cli` at all reopens the hole — which is why
 * the terminal route is refused even though it is less convenient. The browser
 * is a channel the in-session agent does not hold.
 */
export function approveDiscovery(db: LoopbreakerDb, issueId: string, approvedBy: string): DiscoveryState {
  const state = discoveryState(db, issueId);
  if (state.status === "missing") {
    throw new DomainError("missing_discovery", `${issueId} has no discovery record to approve.`, "Record the interview answers first.");
  }
  if (state.status === "grandfathered") {
    throw new DomainError("discovery_grandfathered", `${issueId} predates the discovery gate and needs no approval.`);
  }
  if (!present(approvedBy)) throw new DomainError("missing_flag", "An approver must be named.", "Pass --by NAME.");
  if (!APPROVAL_INGRESSES.has(db.provenance.trigger_type)) {
    throw new DomainError(
      "approval_ingress_refused",
      `A premise cannot be approved through the ${db.provenance.trigger_type} ingress; only the browser may approve.`,
      "Run `loopbreaker serve`, open http://127.0.0.1:7331 and press \"Approve the premise\". "
        + "`approved_by` is a string any caller can type, so the ingress is the only real evidence a human acted.",
    );
  }
  db.raw.prepare(`
    UPDATE discovery_records
    SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP,
        trigger_type = ?, triggered_by = ?, trigger_data = ?
    WHERE issue_id = ?
  `).run(approvedBy, ...db.provenanceValues(), issueId);
  return discoveryState(db, issueId);
}
