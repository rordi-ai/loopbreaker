export type BehaviorStatus = "pending" | "verified" | "failed" | "waived";
export type EvidenceTier = "unit" | "wired" | "live";
export type Verdict = "pass" | "fail";
export type ReviewKind = "comprehensive" | "repair_verification" | "decision";
export type FindingSeverity = "P0" | "P1" | "P2" | "P3";
export type FindingStatus = "open" | "repaired" | "accepted_debt";

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

export interface ShipState {
  disposition: "ship" | "hold" | "ship_with_debt";
  ready: boolean;
  reason: string;
  enforced_total: number;
  verified_total: number;
  waived_total: number;
  unresolved_behavior_ids: string[];
}

export interface Substrate {
  issue: IssueRow;
  contract: {
    frozen_to_behavior_children: true;
    enforced_by_default: true;
  };
  behaviors: Array<BehaviorRow & { evidence_ids: string[]; waiver_id: string | null }>;
  evidence: EvidenceRow[];
  findings: FindingRow[];
  review_passes: ReviewPassRow[];
  waivers: WaiverRow[];
  review: ReviewState;
  shipping: ShipState;
}
