#!/usr/bin/env node

// src/plugin-hook.ts
import { existsSync } from "node:fs";
import { resolve as resolve3 } from "node:path";

// src/db.ts
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
var DEFAULT_DB = ".loopbreaker/loopbreaker.db";
var LoopbreakerDb = class {
  path;
  raw;
  constructor(path = process.env.LOOPBREAKER_DB ?? DEFAULT_DB) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.raw = new DatabaseSync(this.path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }
  close() {
    this.raw.close();
  }
  migrate() {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS behaviors (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT '',
        expected TEXT NOT NULL DEFAULT '',
        verify TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'verified', 'failed', 'waived')),
        enforced INTEGER NOT NULL DEFAULT 1 CHECK (enforced IN (0, 1)),
        ordinal INTEGER NOT NULL,
        UNIQUE(issue_id, ordinal)
      );

      CREATE TABLE IF NOT EXISTS review_passes (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        pass_number INTEGER NOT NULL CHECK (pass_number BETWEEN 1 AND 3),
        kind TEXT NOT NULL CHECK (kind IN ('comprehensive', 'repair_verification', 'decision')),
        verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
        summary TEXT NOT NULL,
        legacy_pass_count INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(issue_id, pass_number)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        behavior_id TEXT REFERENCES behaviors(id) ON DELETE CASCADE,
        tier TEXT NOT NULL CHECK (tier IN ('unit', 'wired', 'live')),
        verdict TEXT NOT NULL CHECK (verdict IN ('pass', 'fail')),
        summary TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        review_pass_id TEXT REFERENCES review_passes(id) ON DELETE SET NULL,
        behavior_id TEXT REFERENCES behaviors(id) ON DELETE SET NULL,
        severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'repaired', 'accepted_debt')),
        title TEXT NOT NULL,
        blocker_reachability TEXT,
        blocker_impact TEXT,
        blocker_rollback TEXT,
        smallest_fix TEXT
      );

      CREATE TABLE IF NOT EXISTS waivers (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        behavior_id TEXT NOT NULL UNIQUE REFERENCES behaviors(id) ON DELETE CASCADE,
        rationale TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planning_profiles (
        issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS shape_assessments (
        issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS planning_review_passes (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        pass_number INTEGER NOT NULL CHECK (pass_number BETWEEN 1 AND 3),
        kind TEXT NOT NULL CHECK (kind IN ('comprehensive', 'repair_verification', 'decision')),
        verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'changes_required', 'rescope', 'return_to_shaping')),
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(issue_id, pass_number)
      );

      CREATE TABLE IF NOT EXISTS planning_findings (
        id TEXT PRIMARY KEY,
        issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        planning_review_pass_id TEXT REFERENCES planning_review_passes(id) ON DELETE SET NULL,
        stage TEXT NOT NULL CHECK (stage IN ('shape', 'planning')),
        severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2', 'P3')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'repaired', 'accepted_debt')),
        title TEXT NOT NULL,
        reachability TEXT,
        impact TEXT,
        smallest_fix TEXT
      );

      CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_issue TEXT REFERENCES issues(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_behaviors_issue ON behaviors(issue_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_issue ON evidence(issue_id);
      CREATE INDEX IF NOT EXISTS idx_findings_issue ON findings(issue_id);
      CREATE INDEX IF NOT EXISTS idx_review_passes_issue ON review_passes(issue_id);
      CREATE INDEX IF NOT EXISTS idx_planning_review_passes_issue ON planning_review_passes(issue_id);
      CREATE INDEX IF NOT EXISTS idx_planning_findings_issue ON planning_findings(issue_id);
    `);
    const behaviorColumns = new Set(
      this.raw.prepare("PRAGMA table_info(behaviors)").all().map((column) => column.name)
    );
    for (const column of ["trigger", "expected", "verify"]) {
      if (!behaviorColumns.has(column)) this.raw.exec(`ALTER TABLE behaviors ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
  }
  transaction(fn) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
  listIssues() {
    return this.raw.prepare("SELECT * FROM issues ORDER BY created_at, id").all();
  }
  issue(id) {
    return this.raw.prepare("SELECT * FROM issues WHERE id = ?").get(id);
  }
  behaviors(issueId) {
    return this.raw.prepare("SELECT * FROM behaviors WHERE issue_id = ? ORDER BY ordinal").all(issueId);
  }
  evidence(issueId) {
    return this.raw.prepare("SELECT * FROM evidence WHERE issue_id = ? ORDER BY rowid").all(issueId);
  }
  findings(issueId) {
    return this.raw.prepare("SELECT * FROM findings WHERE issue_id = ? ORDER BY severity, id").all(issueId);
  }
  reviewPasses(issueId) {
    return this.raw.prepare("SELECT * FROM review_passes WHERE issue_id = ? ORDER BY pass_number").all(issueId);
  }
  planningReviewPasses(issueId) {
    return this.raw.prepare("SELECT * FROM planning_review_passes WHERE issue_id = ? ORDER BY pass_number").all(issueId);
  }
  planningFindings(issueId) {
    return this.raw.prepare("SELECT * FROM planning_findings WHERE issue_id = ? ORDER BY severity, id").all(issueId);
  }
  waivers(issueId) {
    return this.raw.prepare("SELECT * FROM waivers WHERE issue_id = ? ORDER BY created_at, id").all(issueId);
  }
  planningProfile(issueId) {
    const row = this.raw.prepare("SELECT profile_json FROM planning_profiles WHERE issue_id = ?").get(issueId);
    return row ? JSON.parse(row.profile_json) : null;
  }
  setPlanningProfile(issueId, profile) {
    this.raw.prepare(`
      INSERT INTO planning_profiles (issue_id, profile_json) VALUES (?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = CURRENT_TIMESTAMP
    `).run(issueId, JSON.stringify(profile));
  }
  shapeProfile(issueId) {
    const row = this.raw.prepare("SELECT profile_json FROM shape_assessments WHERE issue_id = ?").get(issueId);
    return row ? JSON.parse(row.profile_json) : null;
  }
  setShapeProfile(issueId, profile) {
    this.raw.prepare(`
      INSERT INTO shape_assessments (issue_id, profile_json) VALUES (?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = CURRENT_TIMESTAMP
    `).run(issueId, JSON.stringify(profile));
  }
  activeIssue() {
    const row = this.raw.prepare("SELECT active_issue FROM workspace WHERE id = 1").get();
    return row?.active_issue ?? null;
  }
  setActiveIssue(issueId) {
    this.raw.prepare(`
      INSERT INTO workspace (id, active_issue) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET active_issue = excluded.active_issue
    `).run(issueId);
  }
  clearActiveIssue() {
    this.raw.prepare(`
      INSERT INTO workspace (id, active_issue) VALUES (1, NULL)
      ON CONFLICT(id) DO UPDATE SET active_issue = NULL
    `).run();
  }
};
function openDb(path) {
  const db = new LoopbreakerDb(path);
  db.migrate();
  return db;
}

// src/hooks.ts
import { dirname as dirname2, isAbsolute, relative, resolve as resolve2 } from "node:path";

// src/domain.ts
var DomainError = class extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = "DomainError";
  }
  code;
  hint;
};
var REVIEW_KINDS = {
  1: "comprehensive",
  2: "repair_verification",
  3: "decision"
};
var PLANNING_REVIEW_KINDS = {
  1: "comprehensive",
  2: "repair_verification",
  3: "decision"
};
function reviewKind(passNumber) {
  const kind = REVIEW_KINDS[passNumber];
  if (!kind) throw new DomainError("invalid_pass", "Review passes are limited to 1, 2, and 3.");
  return kind;
}
function planningReviewKind(passNumber) {
  const kind = PLANNING_REVIEW_KINDS[passNumber];
  if (!kind) throw new DomainError("invalid_planning_review_pass", "Planning review passes are limited to 1, 2, and 3.", "There is no automatic pass 4.");
  return kind;
}
var PLANNING_THRESHOLD = 80;
function present(value) {
  return Boolean(value?.trim());
}
function shapeState(db, issueId) {
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Import its behavior contract first.");
  const profile = db.shapeProfile(issueId);
  const blockers = [];
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
function planningReviewState(db, issueId) {
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
    open_blocking_count: findings.filter((finding) => finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1")).length
  };
}
function planningHealth(db, issueId) {
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
    ...proofs.map((proof) => proof.behavior_id)
  ].filter((id) => !knownBehaviorIds.has(id));
  const invalidWorkReferences = workUnits.flatMap((unit) => unit.behavior_ids).filter((id) => !knownBehaviorIds.has(id));
  const unitOnly = proofs.filter((proof) => enforcedIds.has(proof.behavior_id) && proof.tier === "unit");
  const enforcedProofs = proofs.filter((proof) => enforcedIds.has(proof.behavior_id));
  const duplicateWorkUnitIds = workUnits.length > 0 && new Set(workUnits.map((unit) => unit.id)).size !== workUnits.length;
  const unmitigatedRisks = profile?.risks?.filter((risk) => present(risk.risk) && !present(risk.mitigation)) ?? [];
  const scopeScore = (present(profile?.outcome) ? 8 : 0) + (present(profile?.appetite) ? 6 : 0) + ((profile?.non_goals?.length ?? 0) > 0 ? 6 : 0);
  const contractScore = (behaviors.length > 0 ? 4 : 0) + (enforced.length > 0 ? 4 : 0) + (behaviors.every((behavior) => present(behavior.title)) ? 3 : 0) + (behaviors.every((behavior) => present(behavior.trigger)) ? 3 : 0) + (behaviors.every((behavior) => present(behavior.expected)) ? 3 : 0) + (behaviors.every((behavior) => present(behavior.verify)) ? 3 : 0);
  const traceabilityScore = (workUnits.length > 0 ? 4 : 0) + (workUnits.length > 0 && new Set(workUnits.map((unit) => unit.id)).size === workUnits.length && workUnits.every((unit) => present(unit.id)) ? 4 : 0) + (workUnits.length > 0 && invalidWorkReferences.length === 0 ? 4 : 0) + (enforced.every((behavior) => referencedIds.has(behavior.id)) ? 6 : 0) + (workUnits.length > 0 && workUnits.every((unit) => present(unit.title) && present(unit.done_when)) ? 2 : 0);
  const proofScore = (proofs.length > 0 ? 4 : 0) + (proofs.length > 0 && proofs.every((proof) => knownBehaviorIds.has(proof.behavior_id)) ? 3 : 0) + (enforced.every((behavior) => proofIds.has(behavior.id)) ? 6 : 0) + (enforcedProofs.length > 0 && unitOnly.length === 0 && enforcedProofs.every((proof) => proof.tier === "wired" || proof.tier === "live") ? 4 : 0) + (proofs.length > 0 && proofs.every((proof) => present(proof.method)) ? 3 : 0);
  const operabilityScore = (present(profile?.production_wiring) ? 5 : 0) + (present(profile?.rollback) ? 5 : 0) + (present(profile?.migration) ? 3 : 0) + (present(profile?.decision_owner) ? 3 : 0) + (Array.isArray(profile?.risks) && profile.risks.every((risk) => present(risk.risk) && present(risk.mitigation)) ? 4 : 0);
  const dimensions = [
    { key: "scope", score: scopeScore, max_score: 20, status: scopeScore === 20 ? "pass" : scopeScore === 0 ? "fail" : "partial" },
    { key: "contract", score: contractScore, max_score: 20, status: contractScore === 20 ? "pass" : contractScore === 0 ? "fail" : "partial" },
    { key: "traceability", score: traceabilityScore, max_score: 20, status: traceabilityScore === 20 ? "pass" : traceabilityScore === 0 ? "fail" : "partial" },
    { key: "proof", score: proofScore, max_score: 20, status: proofScore === 20 ? "pass" : proofScore === 0 ? "fail" : "partial" },
    { key: "operability", score: operabilityScore, max_score: 20, status: operabilityScore === 20 ? "pass" : operabilityScore === 0 ? "fail" : "partial" }
  ];
  const score = dimensions.reduce((total, dimension) => total + dimension.score, 0);
  const blockers = [];
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
    profile
  };
}
function substrate(db, issueId) {
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
  let shipping;
  if (!shape.ready) {
    shipping = {
      disposition: "hold",
      ready: false,
      reason: `Shape is not ready: ${shape.blockers.map((blocker) => blocker.code).join(", ")}.`,
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id),
      gate: "shape",
      planning_score: planning.score
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
      planning_score: planning.score
    };
  } else if (!planningReview.approved) {
    shipping = {
      disposition: "hold",
      ready: false,
      reason: `Planning review is ${planningReview.disposition}; independent approval is required before implementation.`,
      enforced_total: enforced.length,
      verified_total: verified.length,
      waived_total: waived.length,
      unresolved_behavior_ids: unresolved.map((behavior) => behavior.id),
      gate: "planning_review",
      planning_score: planning.score
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
      planning_score: planning.score
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
      planning_score: planning.score
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
      planning_score: planning.score
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
      enforced_by_default: true
    },
    shape,
    planning,
    planning_review: planningReview,
    planning_findings: planningFindings,
    planning_review_passes: planningReviewPasses,
    behaviors: behaviors.map((behavior) => ({
      ...behavior,
      evidence_ids: evidence.filter((item) => item.behavior_id === behavior.id).map((item) => item.id),
      waiver_id: waiverByBehavior.get(behavior.id) ?? null
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
      complete
    },
    shipping
  };
}

// src/prime.ts
function nextActionFor(gate, planningReviewNextAction) {
  switch (gate) {
    case "shape":
      return "record shape proceed";
    case "planning":
      return "reach planning health ready";
    case "planning_review":
      return planningReviewNextAction;
    case "verification":
      return "verify or waive enforced behaviors";
    case "ready":
      return "ship";
    default:
      return "ship";
  }
}
function composePrime(db, issueId) {
  const state = substrate(db, issueId);
  const openBlockingFindings = [
    ...state.planning_findings.filter((finding) => finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1")).map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title })),
    ...state.findings.filter((finding) => finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1")).map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title }))
  ];
  const unverifiedEnforcedBehaviors = state.behaviors.filter((behavior) => behavior.enforced === 1 && behavior.status !== "verified" && behavior.waiver_id === null).map((behavior) => ({ id: behavior.id, title: behavior.title }));
  return {
    issue_id: state.issue.id,
    authority_chain: {
      shape: { disposition: state.shape.profile?.disposition ?? null, ready: state.shape.ready },
      planning: { score: state.planning.score, ready: state.planning.ready },
      planning_review: { disposition: state.planning_review.disposition, approved: state.planning_review.approved },
      implementation: { admitted: state.shape.ready && state.planning.ready && state.planning_review.approved },
      shipping: { disposition: state.shipping.disposition }
    },
    next_action: nextActionFor(state.shipping.gate, state.planning_review.next_action),
    open_blocking_findings: openBlockingFindings,
    unverified_enforced_behaviors: unverifiedEnforcedBehaviors
  };
}
function renderPrime(block) {
  const lines = [
    `issue: ${block.issue_id}`,
    `shape: disposition=${block.authority_chain.shape.disposition ?? "none"} ready=${block.authority_chain.shape.ready}`,
    `planning: score=${block.authority_chain.planning.score} ready=${block.authority_chain.planning.ready}`,
    `planning_review: disposition=${block.authority_chain.planning_review.disposition} approved=${block.authority_chain.planning_review.approved}`,
    `implementation: admitted=${block.authority_chain.implementation.admitted}`,
    `shipping: disposition=${block.authority_chain.shipping.disposition}`,
    `next_action: ${block.next_action}`,
    block.open_blocking_findings.length === 0 ? "open_blocking_findings: none" : `open_blocking_findings: ${block.open_blocking_findings.map((finding) => `${finding.id}[${finding.severity}] ${finding.title}`).join(" | ")}`,
    block.unverified_enforced_behaviors.length === 0 ? "unverified_enforced_behaviors: none" : `unverified_enforced_behaviors: ${block.unverified_enforced_behaviors.map((behavior) => `${behavior.id} ${behavior.title}`).join(" | ")}`
  ];
  return lines.join("\n");
}

// src/hooks.ts
var MUTATING_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function runSessionStartHook(db, _event) {
  try {
    const activeIssue = db.activeIssue();
    if (!activeIssue) return "";
    if (!db.issue(activeIssue)) return "";
    const block = composePrime(db, activeIssue);
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: renderPrime(block)
      }
    });
  } catch {
    return "";
  }
}
function evaluatePreToolUse(db, event, repoRoot) {
  try {
    const toolName = event.tool_name;
    if (typeof toolName !== "string" || !MUTATING_TOOLS.has(toolName)) return { decision: "allow" };
    const rawTargets = [event.tool_input?.file_path, event.tool_input?.notebook_path].filter(
      (value) => typeof value === "string" && value.length > 0
    );
    if (rawTargets.length === 0) return { decision: "allow" };
    const cwd = typeof event.cwd === "string" && event.cwd.length > 0 ? event.cwd : repoRoot;
    const absoluteRepoRoot = resolve2(repoRoot);
    const loopbreakerDir = resolve2(absoluteRepoRoot, ".loopbreaker");
    const targets = rawTargets.map((target) => resolve2(cwd, target));
    const deniableTarget = targets.some((target) => isWithin(absoluteRepoRoot, target) && !isWithin(loopbreakerDir, target));
    if (!deniableTarget) return { decision: "allow" };
    const activeIssue = db.activeIssue();
    if (!activeIssue) return { decision: "allow" };
    const state = substrate(db, activeIssue);
    const admitted = state.shape.ready && state.planning.ready && state.planning_review.approved;
    if (admitted) return { decision: "allow" };
    return { decision: "deny", reason: state.shipping.reason };
  } catch {
    return { decision: "allow" };
  }
}
var PRE_TOOL_USE_ALLOW = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" }
});
function dispatchHook(db, name, stdin) {
  try {
    let event;
    try {
      event = stdin.trim().length > 0 ? JSON.parse(stdin) : {};
    } catch {
      if (name === "pre-tool-use") return PRE_TOOL_USE_ALLOW;
      return "";
    }
    if (name === "session-start") return runSessionStartHook(db, event);
    if (name === "pre-tool-use") {
      const repoRoot = resolve2(dirname2(db.path), "..");
      const decision = evaluatePreToolUse(db, event, repoRoot);
      return JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision.decision,
          ...decision.reason ? { permissionDecisionReason: decision.reason } : {}
        }
      });
    }
    return "";
  } catch {
    return "";
  }
}

// src/plugin-hook.ts
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
async function main() {
  const name = process.argv[2];
  const dbPath = resolve3(process.env.LOOPBREAKER_DB ?? DEFAULT_DB);
  if (!existsSync(dbPath)) return;
  let db;
  try {
    const raw = await readStdin();
    if (name === void 0) return;
    db = openDb(dbPath);
    const result = dispatchHook(db, name, raw);
    if (result) process.stdout.write(`${result}
`);
  } catch {
  } finally {
    db?.close();
  }
}
main().catch(() => {
}).finally(() => {
  process.exit(0);
});
