import type { Edge, Node } from "@xyflow/react";
import type { Substrate } from "../../src/types";
import type { WorkflowEdgeData } from "./components/ai-elements/edge";
import type { WorkflowNodeData } from "./components/ai-elements/node";

export interface ReviewGraph {
  nodes: Array<Node<WorkflowNodeData, "workflow">>;
  edges: Array<Edge<WorkflowEdgeData, "workflow">>;
}

const NODE_WIDTH = 340;
const BEHAVIOR_GAP = 300;

function node(
  id: string,
  x: number,
  y: number,
  data: WorkflowNodeData,
): Node<WorkflowNodeData, "workflow"> {
  return { id, position: { x, y }, type: "workflow", data, width: NODE_WIDTH };
}

function edge(
  id: string,
  source: string,
  target: string,
  data: WorkflowEdgeData,
): Edge<WorkflowEdgeData, "workflow"> {
  return { id, source, target, type: "workflow", data, focusable: true };
}

export function buildReviewGraph(substrate: Substrate): ReviewGraph {
  const nodes: ReviewGraph["nodes"] = [];
  const edges: ReviewGraph["edges"] = [];
  const behaviorY = new Map<string, number>();
  const centerY = Math.max(0, ((substrate.behaviors.length - 1) * BEHAVIOR_GAP) / 2);

  nodes.push(node("issue", 0, centerY, {
    kind: "issue",
    eyebrow: substrate.issue.id,
    title: substrate.issue.title,
    status: substrate.review.complete ? "review complete" : substrate.review.next_action.replaceAll("_", " "),
    tone: "blue",
    lines: [
      { label: "CONTRACT", value: `${substrate.shipping.enforced_total} enforced behaviors` },
      { label: "BOUNDARY", value: "Behavior children are frozen acceptance" },
    ],
    footer: substrate.issue.description,
    handles: { target: false, source: true },
  }));

  const planningTone = substrate.planning.ready ? "green" : substrate.planning.score >= substrate.planning.threshold ? "amber" : "red";
  nodes.push(node("planning", 430, centerY, {
    kind: "planning",
    eyebrow: "planning gate",
    title: `${substrate.planning.score}/100 · ${substrate.planning.grade.replaceAll("_", " ")}`,
    status: substrate.planning.ready ? "ready" : "blocked",
    tone: planningTone,
    lines: substrate.planning.dimensions.map((dimension) => ({
      label: dimension.key,
      value: `${dimension.score}/${dimension.max_score} · ${dimension.status}`,
    })),
    footer: substrate.planning.blockers.length
      ? `Blockers: ${substrate.planning.blockers.map((blocker) => blocker.code).join(", ")}`
      : "Zero hard blockers · verification gate may proceed",
    handles: { target: true, source: true },
  }));
  edges.push(edge("issue:planning", "issue", "planning", { tone: planningTone, dashed: !substrate.planning.ready, animated: !substrate.planning.ready }));

  substrate.behaviors.forEach((behavior, index) => {
    const y = index * BEHAVIOR_GAP;
    behaviorY.set(behavior.id, y);
    const tone = behavior.status === "verified" ? "green" : behavior.status === "waived" ? "amber" : behavior.status === "failed" ? "red" : "neutral";
    const behaviorNodeId = `behavior:${behavior.id}`;
    nodes.push(node(behaviorNodeId, 860, y, {
      kind: "behavior",
      eyebrow: `${behavior.id} · ${behavior.enforced ? "enforced" : "advisory"}`,
      title: behavior.title,
      status: behavior.status,
      tone,
      lines: [
        { label: "WHEN", value: behavior.trigger },
        { label: "EXPECT", value: behavior.expected },
        { label: "PROVE", value: behavior.verify },
      ],
      footer: `${behavior.evidence_ids.length} evidence · ${behavior.waiver_id ? "waiver attached" : "no waiver"}`,
      handles: { target: true, source: true },
    }));
    edges.push(edge(`planning:${behavior.id}`, "planning", behaviorNodeId, { tone: substrate.planning.ready ? "blue" : "red", dashed: !substrate.planning.ready, animated: behavior.status === "pending" }));
  });

  const evidenceOffset = new Map<string, number>();
  substrate.evidence.forEach((item, index) => {
    const key = item.behavior_id ?? "issue";
    const offset = evidenceOffset.get(key) ?? 0;
    evidenceOffset.set(key, offset + 1);
    const y = item.behavior_id ? (behaviorY.get(item.behavior_id) ?? index * 160) + offset * 150 : centerY + index * 150;
    const evidenceId = `evidence:${item.id}`;
    nodes.push(node(evidenceId, 1290, y, {
      kind: "evidence",
      eyebrow: `${item.tier} proof · ${item.id}`,
      title: item.summary,
      status: item.verdict,
      tone: item.verdict === "pass" ? "green" : "red",
      lines: item.source ? [{ label: "SOURCE", value: item.source }] : undefined,
      footer: item.behavior_id ?? "issue-level evidence",
      handles: { target: true, source: true },
    }));
    edges.push(edge(`evidence-link:${item.id}`, item.behavior_id ? `behavior:${item.behavior_id}` : "planning", evidenceId, {
      tone: item.verdict === "pass" ? "green" : "red",
      animated: item.tier === "wired" || item.tier === "live",
      label: item.tier,
    }));
  });

  const findingOffset = new Map<string, number>();
  substrate.findings.forEach((finding, index) => {
    const key = finding.behavior_id ?? "issue";
    const offset = findingOffset.get(key) ?? 0;
    findingOffset.set(key, offset + 1);
    const y = finding.behavior_id ? (behaviorY.get(finding.behavior_id) ?? index * 180) + 115 + offset * 170 : centerY + 180 + index * 170;
    const findingId = `finding:${finding.id}`;
    const tone = finding.status === "repaired" ? "green" : finding.status === "accepted_debt" ? "amber" : "red";
    nodes.push(node(findingId, 1710, y, {
      kind: "finding",
      eyebrow: `${finding.severity} finding · ${finding.id}`,
      title: finding.title,
      status: finding.status.replaceAll("_", " "),
      tone,
      lines: [
        ...(finding.blocker_reachability ? [{ label: "REACH", value: finding.blocker_reachability }] : []),
        ...(finding.blocker_impact ? [{ label: "IMPACT", value: finding.blocker_impact }] : []),
        ...(finding.smallest_fix ? [{ label: "FIX", value: finding.smallest_fix }] : []),
      ],
      footer: finding.blocker_rollback ? `Rollback: ${finding.blocker_rollback}` : "No rollback recorded",
      handles: { target: true, source: true },
    }));
    edges.push(edge(`finding-link:${finding.id}`, finding.behavior_id ? `behavior:${finding.behavior_id}` : "planning", findingId, {
      tone,
      dashed: finding.status !== "open",
      label: finding.severity,
    }));
  });

  const decisionTone = substrate.shipping.disposition === "ship" ? "green" : substrate.shipping.disposition === "ship_with_debt" ? "amber" : "red";
  nodes.push(node("decision", 2140, centerY, {
    kind: "decision",
    eyebrow: "shipping authority",
    title: substrate.shipping.disposition.replaceAll("_", " "),
    status: substrate.shipping.ready ? "ready" : "held",
    tone: decisionTone,
    lines: [
      { label: "REVIEW", value: substrate.review.complete ? "complete" : `next: ${substrate.review.next_action.replaceAll("_", " ")}` },
      { label: "ACTIVE GATE", value: substrate.shipping.gate },
      { label: "PLANNING", value: `${substrate.planning.score}/100 · ${substrate.planning.ready ? "ready" : "blocked"}` },
      { label: "VERIFIED", value: `${substrate.shipping.verified_total}/${substrate.shipping.enforced_total}` },
      { label: "WAIVED", value: String(substrate.shipping.waived_total) },
    ],
    footer: substrate.shipping.reason,
    handles: { target: true, source: false },
  }));

  substrate.behaviors.filter((behavior) => behavior.enforced === 1).forEach((behavior) => {
    const tone = behavior.status === "verified" ? "green" : behavior.waiver_id ? "amber" : "red";
    edges.push(edge(`decision-link:${behavior.id}`, `behavior:${behavior.id}`, "decision", {
      tone,
      dashed: behavior.status !== "verified",
      animated: behavior.status === "pending",
      label: behavior.status,
    }));
  });

  const passY = Math.max(substrate.behaviors.length * BEHAVIOR_GAP, 840) + 180;
  [1, 2, 3].forEach((passNumber) => {
    const pass = substrate.review_passes.find((item) => item.pass_number === passNumber);
    const passId = `pass:${passNumber}`;
    const kind = ["comprehensive", "repair verification", "decision only"][passNumber - 1] ?? "review";
    nodes.push(node(passId, 860 + (passNumber - 1) * 430, passY, {
      kind: "pass",
      eyebrow: `bounded review · pass ${passNumber}`,
      title: pass ? pass.kind.replaceAll("_", " ") : kind,
      status: pass?.verdict ?? "not run",
      tone: pass?.verdict === "pass" ? "green" : pass?.verdict === "fail" ? "red" : "neutral",
      lines: pass ? [{ label: "SUMMARY", value: pass.summary }] : [{ label: "RULE", value: passNumber === 3 ? "Decision only; no new audit" : "Runs only when prior pass requires it" }],
      footer: pass?.legacy_pass_count ? `Compresses ${pass.legacy_pass_count} legacy passes` : passNumber === 3 ? "No automatic pass 4" : "Bounded pass",
      handles: { target: true, source: true },
    }));
  });
  edges.push(edge("review:planning-pass1", "planning", "pass:1", { tone: substrate.planning.ready ? "blue" : "red", dashed: substrate.review_passes.length === 0 }));
  edges.push(edge("review:pass1-pass2", "pass:1", "pass:2", { tone: "blue", dashed: substrate.review_passes.length < 2 }));
  edges.push(edge("review:pass2-pass3", "pass:2", "pass:3", { tone: "blue", dashed: substrate.review_passes.length < 3 }));
  edges.push(edge("review:pass3-decision", "pass:3", "decision", { tone: decisionTone, dashed: !substrate.review.complete }));

  return { nodes, edges };
}
