/**
 * LB-21 — the ingress that opened the database handle. Instance-carried, not
 * per-call: `mcp.ts` opens one shared handle closed over by interleaving async
 * handlers, so mutable per-call ambient state on that instance would be unsafe.
 * Per-MCP-tool granularity is an explicit non-goal of this slice.
 *
 * LB-29 added `web`, superseding LB-21-B2's four-value enumeration. Until then
 * the HTTP server inherited the CLI's handle, so a browser write and a terminal
 * write were indistinguishable. Note this is ATTRIBUTION, not prevention: an
 * agent with a shell can reach the HTTP surface as easily as the CLI.
 */
export type TriggerType = "cli" | "mcp" | "hook" | "plugin_hook" | "web";

/** LB-21 — the provenance triple stamped on every row version the mutation path writes. */
export interface Provenance {
  /** The ingress that called `openDb`. */
  trigger_type: TriggerType;
  /**
   * Never null. For `cli`: `LOOPBREAKER_ACTOR` when set, else the OS username,
   * else the literal `unknown`. For `mcp`: the client name reported at
   * initialize when available, else the literal `mcp-client`.
   */
  triggered_by: string;
  /**
   * Nullable JSON object. For `cli` it carries the parsed subcommand, which is
   * known before `openDb` is called. Null for `mcp`, `hook`, and `plugin_hook`
   * in this slice.
   */
  trigger_data: Record<string, unknown> | null;
}

/** The provenance triple as it appears on a persisted row and in the read model. */
export interface ProvenanceFields {
  trigger_type: TriggerType | null;
  triggered_by: string | null;
  trigger_data: string | null;
}

export type BehaviorStatus = "pending" | "verified" | "failed" | "waived";
export type EvidenceTier = "unit" | "wired" | "live";
/**
 * LB-27 — `not_run` is the fail-closed default. An unrun harness previously had
 * no honest representation, so absence got encoded as one of the two decided
 * states. It never verifies a behavior. Mirrors rordi's `evidence_verdict`.
 */
export type Verdict = "pass" | "fail" | "not_run";
export type ReviewKind = "comprehensive" | "repair_verification" | "decision";
export type FindingSeverity = "P0" | "P1" | "P2" | "P3";
export type FindingStatus = "open" | "repaired" | "accepted_debt";
export type PlanningDimensionKey = "scope" | "contract" | "traceability" | "proof" | "operability";
export type ShapeDisposition = "proceed" | "spike" | "park" | "reject";
export type PlanningReviewKind = "comprehensive" | "repair_verification" | "decision";
export type PlanningReviewVerdict = "approved" | "changes_required" | "rescope" | "return_to_shaping";
export type PlanningFindingStage = "shape" | "planning";

export interface PlanningWorkUnit {
  id: string;
  title: string;
  behavior_ids: string[];
  done_when: string;
}

export interface PlanningProof {
  behavior_id: string;
  tier: EvidenceTier;
  method: string;
}

/**
 * LB-31 — a decision planning had to make that the approved premise did not
 * settle. Discovery fixes the bet; planning DISCOVERS choices the founder could
 * not have anticipated, and the irreversible ones are product decisions wearing
 * technical clothes.
 */
export interface PlanningDecision {
  /** What was decided, in enough detail that a founder can recognise the stake. */
  decision: string;
  /** `one_way` means expensive or impossible to unwind, so it needs a founder answer. */
  reversibility: "reversible" | "one_way";
  /** Required for `one_way`: the founder's answer that settles it. */
  founder_answer?: string;
}

export interface PlanningRisk {
  risk: string;
  mitigation: string;
}

export interface PlanningProfile {
  outcome?: string;
  appetite?: string;
  non_goals?: string[];
  work_units?: PlanningWorkUnit[];
  proofs?: PlanningProof[];
  production_wiring?: string;
  rollback?: string;
  migration?: string;
  decision_owner?: string;
  risks?: PlanningRisk[];
  /** LB-31 — decisions the premise did not settle. Omit when planning faced none. */
  decisions?: PlanningDecision[];
}

export interface ShapeProfile {
  problem: string;
  appetite: string;
  smallest_slice: string;
  non_goals: string[];
  success_signal: string;
  reversibility: string;
  decision_owner: string;
  risks: PlanningRisk[];
  disposition: ShapeDisposition;
}

export interface ShapeState {
  profile: ShapeProfile | null;
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
}

export interface PlanningHealth {
  score: number;
  threshold: 80;
  ready: boolean;
  grade: "healthy" | "at_risk" | "blocked";
  dimensions: Array<{
    key: PlanningDimensionKey;
    score: number;
    max_score: number;
    status: "pass" | "partial" | "fail";
  }>;
  blockers: Array<{ code: string; message: string }>;
  recommendations: string[];
  profile: PlanningProfile | null;
}

export interface IssueRow extends ProvenanceFields {
  id: string;
  title: string;
  description: string;
  created_at: string;
}

export interface BehaviorRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  title: string;
  trigger: string;
  expected: string;
  verify: string;
  /** LB-27 — the registry entry id whose execution proves this behavior. */
  harness_ref: string | null;
  status: BehaviorStatus;
  enforced: number;
  ordinal: number;
}

export interface EvidenceRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  behavior_id: string | null;
  tier: EvidenceTier;
  verdict: Verdict;
  summary: string;
  source: string;
  created_at: string;
  /** LB-27 — 1 when loopbreaker executed the harness itself; 0 when a caller asserted the result. */
  executed: number;
  /** The registry entry that produced this row, when it was executed. */
  harness_id: string | null;
  /** The runner's exit code. Null when the harness could not be executed at all. */
  exit_code: number | null;
  /** 1 when an earlier executed FAIL exists for the same behavior and harness — the red baseline. */
  baselined: number;
}

export interface ReviewPassRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  pass_number: number;
  kind: ReviewKind;
  verdict: Verdict;
  summary: string;
  legacy_pass_count: number | null;
  created_at: string;
}

export interface PlanningReviewPassRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  pass_number: number;
  kind: PlanningReviewKind;
  verdict: PlanningReviewVerdict;
  summary: string;
  created_at: string;
}

export interface PlanningFindingRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  planning_review_pass_id: string | null;
  stage: PlanningFindingStage;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  reachability: string | null;
  impact: string | null;
  smallest_fix: string | null;
}

export interface FindingRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  review_pass_id: string | null;
  behavior_id: string | null;
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  blocker_reachability: string | null;
  blocker_impact: string | null;
  blocker_rollback: string | null;
  smallest_fix: string | null;
}

export interface WaiverRow extends ProvenanceFields {
  id: string;
  issue_id: string;
  behavior_id: string;
  rationale: string;
  approved_by: string;
  created_at: string;
}

export interface ReviewState {
  pass_count: number;
  current_pass: number | null;
  next_pass: number | null;
  next_action: ReviewKind | "none";
  automatic_pass_four: false;
  decision_required: boolean;
  complete: boolean;
}

export interface PlanningReviewState {
  pass_count: number;
  current_pass: number | null;
  next_pass: number | null;
  next_action: PlanningReviewKind | "none";
  automatic_pass_four: false;
  decision_required: boolean;
  complete: boolean;
  approved: boolean;
  disposition: PlanningReviewVerdict | "pending";
  open_blocking_count: number;
}

export interface ShipState {
  disposition: "ship" | "hold" | "ship_with_debt";
  ready: boolean;
  reason: string;
  enforced_total: number;
  verified_total: number;
  waived_total: number;
  unresolved_behavior_ids: string[];
  /**
   * LB-32 — verified behaviors whose passing proof was never observed failing.
   * Advisory, not blocking: a behavior whose code already existed can never
   * produce a red baseline. Surfaced HERE, at the decision, because buried in an
   * evidence column it took a SQLite query to find — and the HEALTH-1 dry run
   * shipped all three unbaselined while its plan claimed red-first.
   */
  unbaselined_behavior_ids: string[];
  gate: "discovery" | "shape" | "planning" | "planning_review" | "verification" | "ready";
  planning_score: number;
}

export interface Substrate {
  issue: IssueRow;
  contract: {
    frozen_to_behavior_children: true;
    enforced_by_default: true;
  };
  shape: ShapeState;
  planning: PlanningHealth;
  planning_review: PlanningReviewState;
  planning_findings: PlanningFindingRow[];
  planning_review_passes: PlanningReviewPassRow[];
  behaviors: Array<BehaviorRow & { evidence_ids: string[]; waiver_id: string | null }>;
  evidence: EvidenceRow[];
  findings: FindingRow[];
  review_passes: ReviewPassRow[];
  waivers: WaiverRow[];
  review: ReviewState;
  shipping: ShipState;
}
