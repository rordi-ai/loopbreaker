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
  substrate,
  upsertFinding,
  verifyBehavior,
} from "./domain.js";
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
  const db = openDb(dbPath);
  const server = new McpServer(
    { name: "loopbreaker", version: "0.3.0" },
    {
      instructions:
        "Call review_list_issues, planning_health, then review_substrate before implementation or review. Planning must be ready before pass one. Never create pass 4. Review completion is not shipping readiness: check review_ship_status before recommending shipment.",
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
      description: "Return the authoritative ship disposition derived in order from planning readiness, then enforced behavior verification and waivers.",
      inputSchema: { issue_id: z.string().min(1) },
    },
    async ({ issue_id }) => {
      try {
        const state = substrate(db, issue_id);
        return content({ issue_id, planning: planningSummary(state.planning), review: state.review, shipping: state.shipping }, db.path);
      } catch (error) { return toolError(error); }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
