import type { LoopbreakerDb } from "./db.js";
import { DomainError, substrate } from "./domain.js";
import type { ShipState } from "./types.js";

export interface PrimeAuthorityChain {
  shape: { disposition: string | null; ready: boolean };
  planning: { score: number; ready: boolean };
  planning_review: { disposition: string; approved: boolean };
  implementation: { admitted: boolean };
  shipping: { disposition: string };
}

export interface PrimeBlockingFinding {
  id: string;
  severity: string;
  title: string;
}

export interface PrimeUnverifiedBehavior {
  id: string;
  title: string;
}

export interface PrimeBlock {
  issue_id: string;
  authority_chain: PrimeAuthorityChain;
  next_action: string;
  open_blocking_findings: PrimeBlockingFinding[];
  unverified_enforced_behaviors: PrimeUnverifiedBehavior[];
}

/**
 * Resolve the issue a builder or agent means: the explicitly named issue, or
 * this repository's linked active issue. Throws when neither is present.
 */
export function resolveIssue(db: LoopbreakerDb, explicit?: string): string {
  if (explicit && explicit.trim().length > 0) return explicit;
  const active = db.activeIssue();
  if (!active) {
    throw new DomainError(
      "no_active_issue",
      "No issue is linked for this repository and none was named.",
      "Run loopbreaker link ISSUE, or pass an issue ID directly.",
    );
  }
  return active;
}

function nextActionFor(gate: ShipState["gate"], planningReviewNextAction: string): string {
  switch (gate) {
    case "discovery": return "interview the founder and get the discovery record approved";
    case "shape": return "record shape proceed";
    case "planning": return "reach planning health ready";
    case "planning_review": return planningReviewNextAction;
    case "verification": return "verify or waive enforced behaviors";
    case "ready": return "ship";
    default: {
      // Fail closed: an unrecognized gate must never resolve to "ship". The `never`
      // binding also makes adding a new ShipState["gate"] literal a compile error here,
      // so a future gate can't silently inherit the ship instruction.
      const unreachable: never = gate;
      void unreachable;
      return "hold — unrecognized shipping gate";
    }
  }
}

/**
 * Compose the single deterministic prime block for an issue, built only from
 * persisted substrate: the ordered authority chain, the single next allowed
 * action, open blocking findings, and unverified enforced behaviors. No
 * advice or prose is included.
 */
export function composePrime(db: LoopbreakerDb, issueId: string): PrimeBlock {
  const state = substrate(db, issueId);

  const openBlockingFindings: PrimeBlockingFinding[] = [
    ...state.planning_findings
      .filter((finding) => finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1"))
      .map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title })),
    ...state.findings
      .filter((finding) => finding.status === "open" && (finding.severity === "P0" || finding.severity === "P1"))
      .map((finding) => ({ id: finding.id, severity: finding.severity, title: finding.title })),
  ];

  const unverifiedEnforcedBehaviors: PrimeUnverifiedBehavior[] = state.behaviors
    .filter((behavior) => behavior.enforced === 1 && behavior.status !== "verified" && behavior.waiver_id === null)
    .map((behavior) => ({ id: behavior.id, title: behavior.title }));

  return {
    issue_id: state.issue.id,
    authority_chain: {
      shape: { disposition: state.shape.profile?.disposition ?? null, ready: state.shape.ready },
      planning: { score: state.planning.score, ready: state.planning.ready },
      planning_review: { disposition: state.planning_review.disposition, approved: state.planning_review.approved },
      implementation: { admitted: state.shape.ready && state.planning.ready && state.planning_review.approved },
      shipping: { disposition: state.shipping.disposition },
    },
    next_action: nextActionFor(state.shipping.gate, state.planning_review.next_action),
    open_blocking_findings: openBlockingFindings,
    unverified_enforced_behaviors: unverifiedEnforcedBehaviors,
  };
}

/**
 * The single canonical payload both the CLI `prime` command and the MCP
 * `delivery_prime` tool return: composePrime's structured block plus its
 * rendered text, for the explicitly named issue or the linked active issue.
 * Both surfaces call this one function so their output is identical by
 * construction, not by separately-maintained duplication.
 */
export function primePayload(db: LoopbreakerDb, explicitIssueId?: string): PrimeBlock & { rendered: string } {
  const issueId = resolveIssue(db, explicitIssueId);
  const block = composePrime(db, issueId);
  return { ...block, rendered: renderPrime(block) };
}

/**
 * Render a prime block as a compact, stable, deterministic text form. No
 * timestamps or randomness; identical blocks always render identically.
 * This is the single canonical text form both the CLI and MCP surfaces emit.
 */
export function renderPrime(block: PrimeBlock): string {
  const lines: string[] = [
    `issue: ${block.issue_id}`,
    `shape: disposition=${block.authority_chain.shape.disposition ?? "none"} ready=${block.authority_chain.shape.ready}`,
    `planning: score=${block.authority_chain.planning.score} ready=${block.authority_chain.planning.ready}`,
    `planning_review: disposition=${block.authority_chain.planning_review.disposition} approved=${block.authority_chain.planning_review.approved}`,
    `implementation: admitted=${block.authority_chain.implementation.admitted}`,
    `shipping: disposition=${block.authority_chain.shipping.disposition}`,
    `next_action: ${block.next_action}`,
    block.open_blocking_findings.length === 0
      ? "open_blocking_findings: none"
      : `open_blocking_findings: ${block.open_blocking_findings.map((finding) => `${finding.id}[${finding.severity}] ${finding.title}`).join(" | ")}`,
    block.unverified_enforced_behaviors.length === 0
      ? "unverified_enforced_behaviors: none"
      : `unverified_enforced_behaviors: ${block.unverified_enforced_behaviors.map((behavior) => `${behavior.id} ${behavior.title}`).join(" | ")}`,
  ];
  return lines.join("\n");
}
