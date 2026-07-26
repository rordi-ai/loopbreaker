import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";
import {
  createWaiver,
  DomainError,
  importContract,
  planningHealth,
  recordEvidence,
  recordPass,
  recordPlanning,
  recordPlanningReviewPass,
  recordShape,
  substrate,
  upsertPlanningFinding,
  upsertFinding,
  verifyBehavior,
} from "./domain.js";
import { primePayload } from "./prime.js";
import type { PlanningHealth } from "./types.js";
import { failure, success } from "./toon.js";

function content(data: unknown, dbPath: string) {
  return {
    content: [{ type: "text" as const, text: success(data, { db: dbPath }) }],
  };
}

function toolError(error: unknown) {
  const known = error instanceof DomainError;
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{
      type: "text" as const,
      text: failure(known ? error.code : "internal_error", message, known ? error.hint : undefined),
    }],
    isError: true,
  };
}

const planningSchema = z.object({
  outcome: z.string().optional(),
  appetite: z.string().optional(),
  non_goals: z.array(z.string()).optional(),
  work_units: z.array(z.object({
    id: z.string(),
    title: z.string(),
    behavior_ids: z.array(z.string()),
    done_when: z.string(),
  })).optional(),
  proofs: z.array(z.object({
    behavior_id: z.string(),
    tier: z.enum(["unit", "wired", "live"]),
    method: z.string(),
  })).optional(),
  production_wiring: z.string().optional(),
  rollback: z.string().optional(),
  migration: z.string().optional(),
  decision_owner: z.string().optional(),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })).optional(),
});

const shapeSchema = z.object({
  problem: z.string(),
  appetite: z.string(),
  smallest_slice: z.string(),
  non_goals: z.array(z.string()),
  success_signal: z.string(),
  reversibility: z.string(),
  decision_owner: z.string(),
  risks: z.array(z.object({ risk: z.string(), mitigation: z.string() })),
  disposition: z.enum(["proceed", "spike", "park", "reject"]),
});

function planningSummary(health: PlanningHealth) {
  return {
    score: health.score,
    threshold: health.threshold,
    grade: health.grade,
    ready: health.ready,
    profile_recorded: health.profile !== null,
    dimensions: health.dimensions,
    blockers: health.blockers,
    recommendations: health.recommendations,
  };
}

export async function runMcp(dbPath?: string): Promise<void> {
  // LB-21 ingress: MCP. The client name is not known until `initialize`
  // completes, so the handle opens with the fail-safe literal and is refined
  // once, after connect.
  const db = openDb(dbPath, { trigger_type: "mcp", triggered_by: "mcp-client", trigger_data: null });
  const server = new McpServer(
    { name: "loopbreaker", version: "0.4.0" },
    {
      instructions:
        "Call delivery_readiness before implementation or review. Admission requires shape proceed, planning health ready, and independent planning-review approval. Planning review and code review each stop after pass 3; there is no pass 4. Shipping additionally requires every enforced behavior verified or explicitly waived.",
    },
  );

  server.registerTool(
    "review_import_contract",
    {
      description: "Create or import an issue's behavior-child acceptance contract. Behaviors are enforced unless advisory is explicitly true; reviewed contracts are frozen.",
      inputSchema: {
        issue_id: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        behaviors: z.array(z.object({
          id: z.string().min(1),
          title: z.string().min(1),
          trigger: z.string().min(1),
          expected: z.string().min(1),
          verify: z.string().min(1),
          advisory: z.boolean().optional(),
          harness_ref: z.string().min(1).optional(),
        })).min(1),
        planning: planningSchema.optional(),
      },
    },
    async (input) => {
      try { return content(importContract(db, { issueId: input.issue_id, title: input.title, description: input.description, behaviors: input.behaviors, planning: input.planning }), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_list_issues",
    { description: "List locally tracked issues with derived review and shipping states." },
    async () => {
      try {
        return content(db.listIssues().map((issue) => {
          const state = substrate(db, issue.id);
          return {
            id: issue.id,
            title: issue.title,
            review_complete: state.review.complete,
            next_review_action: state.review.next_action,
            ship_disposition: state.shipping.disposition,
            planning_score: state.planning.score,
            planning_ready: state.planning.ready,
          };
        }), db.path);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "planning_record",
    {
      description: "Record a partial or complete planning profile before review. Incomplete plans are accepted so named health blockers can guide repair.",
      inputSchema: {
        issue_id: z.string().min(1),
        planning: planningSchema,
      },
    },
    async ({ issue_id, planning }) => {
      try { return content(planningSummary(recordPlanning(db, issue_id, planning)), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "shape_record",
    {
      description: "Record the explicit product-shape decision. Only a complete proceed disposition releases the shape gate; exact replay is idempotent and review freezes changes.",
      inputSchema: { issue_id: z.string().min(1), shape: shapeSchema },
    },
    async ({ issue_id, shape }) => {
      try { return content(recordShape(db, issue_id, shape), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "planning_health",
    {
      description: "Return deterministic planning score, five dimensions, named hard blockers, and readiness without the full profile.",
      inputSchema: { issue_id: z.string().min(1) },
    },
    async ({ issue_id }) => {
      try { return content(planningSummary(planningHealth(db, issue_id)), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_substrate",
    {
      description: "Return the issue's frozen behavior contract, evidence, findings, bounded review state, waivers, and ship decision.",
      inputSchema: { issue_id: z.string().min(1) },
    },
    async ({ issue_id }) => {
      try { return content(substrate(db, issue_id), db.path); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "delivery_readiness",
    {
      description: "Return the compact ordered authority chain: shape, structural planning health, independent planning review, implementation admission, and shipping.",
      inputSchema: { issue_id: z.string().min(1) },
    },
    async ({ issue_id }) => {
      try {
        const state = substrate(db, issue_id);
        return content({
          issue_id, shape: state.shape, planning: planningSummary(state.planning), planning_review: state.planning_review,
          implementation: { admitted: state.shape.ready && state.planning.ready && state.planning_review.approved }, shipping: state.shipping,
        }, db.path);
      } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "delivery_prime",
    {
      description: "Compose the single deterministic prime block for the active or named issue: the ordered authority chain, the single next allowed action, open blocking findings, and unverified enforced behaviors. Composed only from the database, with no advice prose.",
      inputSchema: { issue_id: z.string().min(1).optional() },
    },
    async ({ issue_id }) => {
      try { return content(primePayload(db, issue_id), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "planning_review_upsert_finding",
    {
      description: "Create or update one stable shape/planning finding. Open P0/P1 findings require reachability, impact, and smallest fix and prevent approval.",
      inputSchema: {
        issue_id: z.string().min(1), finding_id: z.string().min(1), review_pass_number: z.number().int().min(1).max(3).optional(),
        stage: z.enum(["shape", "planning"]), severity: z.enum(["P0", "P1", "P2", "P3"]),
        status: z.enum(["open", "repaired", "accepted_debt"]), title: z.string().min(1),
        reachability: z.string().optional(), impact: z.string().optional(), smallest_fix: z.string().optional(),
      },
    },
    async (input) => {
      try { return content(upsertPlanningFinding(db, {
        issueId: input.issue_id, findingId: input.finding_id, reviewPassNumber: input.review_pass_number,
        stage: input.stage, severity: input.severity, status: input.status, title: input.title,
        reachability: input.reachability, impact: input.impact, smallestFix: input.smallest_fix,
      }), db.path); } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "planning_review_record_pass",
    {
      description: "Record the next independent planning-review pass: comprehensive, repair verification, then decision-only. No pass four exists.",
      inputSchema: {
        issue_id: z.string().min(1), pass_number: z.number().int().min(1).max(3),
        verdict: z.enum(["approved", "changes_required", "rescope", "return_to_shaping"]), summary: z.string().min(1),
      },
    },
    async (input) => {
      try { return content(recordPlanningReviewPass(db, { issueId: input.issue_id, passNumber: input.pass_number, verdict: input.verdict, summary: input.summary }), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_upsert_finding",
    {
      description: "Create or update one stable root-cause finding with severity, disposition, blocker-test facts, and optional behavior/pass attribution.",
      inputSchema: {
        issue_id: z.string().min(1),
        finding_id: z.string().min(1),
        behavior_id: z.string().min(1).optional(),
        review_pass_number: z.number().int().min(1).max(3).optional(),
        severity: z.enum(["P0", "P1", "P2", "P3"]),
        status: z.enum(["open", "repaired", "accepted_debt"]),
        title: z.string().min(1),
        reachability: z.string().optional(),
        impact: z.string().optional(),
        rollback: z.string().optional(),
        smallest_fix: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return content(upsertFinding(db, {
          issueId: input.issue_id,
          findingId: input.finding_id,
          behaviorId: input.behavior_id,
          reviewPassNumber: input.review_pass_number,
          severity: input.severity,
          status: input.status,
          title: input.title,
          reachability: input.reachability,
          impact: input.impact,
          rollback: input.rollback,
          smallestFix: input.smallest_fix,
        }), db.path);
      } catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_record_pass",
    {
      description: "Record the next bounded review pass. Only passes 1-3 are accepted and pass 3 is decision-only.",
      inputSchema: {
        issue_id: z.string().min(1),
        pass_number: z.number().int().min(1).max(3),
        verdict: z.enum(["pass", "fail"]),
        summary: z.string().min(1),
      },
    },
    async (input) => {
      try { return content(recordPass(db, { issueId: input.issue_id, passNumber: input.pass_number, verdict: input.verdict, summary: input.summary }), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_record_evidence",
    {
      description: "Attach proportionate unit, wired, or live evidence to an issue behavior.",
      inputSchema: {
        issue_id: z.string().min(1),
        behavior_id: z.string().min(1).optional(),
        tier: z.enum(["unit", "wired", "live"]),
        verdict: z.enum(["pass", "fail"]),
        summary: z.string().min(1),
        source: z.string().optional(),
      },
    },
    async (input) => {
      try { return content(recordEvidence(db, { issueId: input.issue_id, behaviorId: input.behavior_id, tier: input.tier, verdict: input.verdict, summary: input.summary, source: input.source }), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_verify_behavior",
    {
      description: "Mark one behavior verified using attached passing evidence.",
      inputSchema: { behavior_id: z.string().min(1), evidence_id: z.string().min(1) },
    },
    async ({ behavior_id, evidence_id }) => {
      try { return content(verifyBehavior(db, behavior_id, evidence_id), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_create_waiver",
    {
      description: "Explicitly accept named debt for one enforced behavior; this can produce ship_with_debt.",
      inputSchema: {
        issue_id: z.string().min(1),
        behavior_id: z.string().min(1),
        rationale: z.string().min(1),
        approved_by: z.string().min(1),
      },
    },
    async (input) => {
      try { return content(createWaiver(db, { issueId: input.issue_id, behaviorId: input.behavior_id, rationale: input.rationale, approvedBy: input.approved_by }), db.path); }
      catch (error) { return toolError(error); }
    },
  );

  server.registerTool(
    "review_ship_status",
    {
      description: "Return the authoritative ship disposition derived from shape, planning health, planning-review approval, then enforced behavior verification and waivers.",
      inputSchema: { issue_id: z.string().min(1) },
    },
    async ({ issue_id }) => {
      try {
        const state = substrate(db, issue_id);
        return content({ issue_id, shape: state.shape, planning: planningSummary(state.planning), planning_review: state.planning_review, review: state.review, shipping: state.shipping }, db.path);
      } catch (error) { return toolError(error); }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Now that `initialize` has completed, attribute writes to the real client.
  // Falls back to the literal `mcp-client` when the peer reported no name.
  db.setTriggeredBy(server.server.getClientVersion()?.name ?? "mcp-client");
}
