export type BehaviorStatus = "pending" | "verified" | "failed" | "waived";
export type EvidenceTier = "unit" | "wired" | "live";
export type Verdict = "pass" | "fail";
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

export interface IssueRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
}

export interface BehaviorRow {
  id: string;
  issue_id: string;
  title: string;
  trigger: string;
  expected: string;
  verify: string;
  status: BehaviorStatus;
  enforced: number;
  ordinal: number;
}

export interface EvidenceRow {
  id: string;
  issue_id: string;
  behavior_id: string | null;
  tier: EvidenceTier;
  verdict: Verdict;
  summary: string;
  source: string;
  created_at: string;
}

export interface ReviewPassRow {
  id: string;
  issue_id: string;
  pass_number: number;
  kind: ReviewKind;
  verdict: Verdict;
  summary: string;
  legacy_pass_count: number | null;
  created_at: string;
}

export interface PlanningReviewPassRow {
  id: string;
  issue_id: string;
  pass_number: number;
  kind: PlanningReviewKind;
  verdict: PlanningReviewVerdict;
  summary: string;
  created_at: string;
}

export interface PlanningFindingRow {
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

export interface FindingRow {
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

export interface WaiverRow {
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
  gate: "shape" | "planning" | "planning_review" | "verification" | "ready";
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
