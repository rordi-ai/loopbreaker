import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./db.js";
import {
  createWaiver,
  DomainError,
  importContract,
  recordEvidence,
  recordPass,
  substrate,
  verifyBehavior,
} from "./domain.js";
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

export async function runMcp(dbPath?: string): Promise<void> {
  const db = openDb(dbPath);
  const server = new McpServer(
    { name: "loopbreaker", version: "0.1.0" },
    {
      instructions:
        "Call review_list_issues, then review_substrate before reviewing. Never create pass 4. Review completion is not shipping readiness: check review_ship_status before recommending shipment.",
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
          advisory: z.boolean().optional(),
        })).min(1),
      },
    },
    async (input) => {
      try { return content(importContract(db, { issueId: input.issue_id, title: input.title, description: input.description, behaviors: input.behaviors }), db.path); }
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
          };
        }), db.path);
      } catch (error) {
        return toolError(error);
      }
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
      description: "Return the authoritative ship disposition derived from enforced behavior verification and waivers.",
      inputSchema: { issue_id: z.string().min(1) },
    },
    async ({ issue_id }) => {
      try {
        const state = substrate(db, issue_id);
        return content({ issue_id, review: state.review, shipping: state.shipping }, db.path);
      } catch (error) { return toolError(error); }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
