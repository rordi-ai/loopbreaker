#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DomainError, planningHealth, recordEvidence, recordPass, recordPlanning, substrate, verifyBehavior, createWaiver, importContract } from "./domain.js";
import { openDb, type LoopbreakerDb } from "./db.js";
import type { PlanningHealth, PlanningProfile } from "./types.js";
import { runMcp } from "./mcp.js";
import { DEMO_ISSUE, seedDemo } from "./seed.js";
import { startServer } from "./server.js";
import { failure, success } from "./toon.js";

type Flags = Record<string, string | boolean>;

const HELP = `loopbreaker — local review graph with bounded passes and explicit ship decisions

Usage:
  loopbreaker                                  Show the live issue dashboard
  loopbreaker init [--db PATH]                 Initialize an empty SQLite database
  loopbreaker demo [--db PATH]                 Seed the idempotent demo incident
  loopbreaker import FILE [--db PATH]          Import a JSON issue behavior contract
  loopbreaker plan ISSUE FILE [--db PATH]      Record or replace the pre-review planning profile
  loopbreaker health ISSUE [--db PATH]         Show compact planning health and blockers
  loopbreaker substrate ISSUE [--db PATH]      Show the full review substrate
  loopbreaker pass ISSUE --pass N --verdict V --summary TEXT
  loopbreaker evidence ISSUE --behavior ID --tier T --verdict V --summary TEXT [--source URI]
  loopbreaker verify BEHAVIOR --evidence ID
  loopbreaker waive ISSUE --behavior ID --rationale TEXT --approved-by NAME
  loopbreaker serve [--db PATH] [--port 7331]  Start the local visual decision view
  loopbreaker mcp [--db PATH]                  Start the local MCP server over stdio
  loopbreaker help [COMMAND]

Environment:
  LOOPBREAKER_DB  Default database path (otherwise .loopbreaker/loopbreaker.db)

Output:
  Successful CLI output is TOON. Errors are structured TOON on stdout with exit 1;
  usage errors exit 2. MCP uses stdio, so its protocol stream is JSON-RPC.`;

const COMMAND_HELP: Record<string, string> = {
  init: "loopbreaker init [--db PATH]\n\nCreate the database and schema. Safe to run repeatedly.",
  demo: "loopbreaker demo [--db PATH]\n\nSeed DEMO-1 without replacing existing records. Safe to run repeatedly.",
  import: "loopbreaker import FILE [--db PATH]\n\nImport JSON shaped as {issue_id,title,description?,behaviors:[...],planning?}. Reviewed contracts and planning are frozen.",
  plan: "loopbreaker plan ISSUE FILE [--db PATH]\n\nRecord a partial or complete planning profile before pass one. Returns deterministic health and named blockers.",
  health: "loopbreaker health ISSUE [--db PATH]\n\nReturn score, dimensions, blockers, and readiness without the full planning profile.",
  substrate: "loopbreaker substrate ISSUE [--db PATH]\n\nReturn behaviors, evidence, findings, passes, waivers, and derived ship state.",
  pass: "loopbreaker pass ISSUE --pass 1|2|3 --verdict pass|fail --summary TEXT [--db PATH]\n\nRecord only the next pass. Pass 4 is rejected.",
  evidence: "loopbreaker evidence ISSUE [--behavior ID] --tier unit|wired|live --verdict pass|fail --summary TEXT [--source URI] [--db PATH]",
  verify: "loopbreaker verify BEHAVIOR --evidence ID [--db PATH]\n\nVerify a behavior with passing evidence attached to that behavior.",
  waive: "loopbreaker waive ISSUE --behavior ID --rationale TEXT --approved-by NAME [--db PATH]\n\nCreate durable named debt for one enforced behavior.",
  serve: "loopbreaker serve [--db PATH] [--port 7331]\n\nServe the visual review graph on 127.0.0.1.",
  mcp: "loopbreaker mcp [--db PATH]\n\nRun the MCP server over stdio for a local client process.",
};

function parse(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value?.startsWith("--")) {
      if (value !== undefined) positional.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    if (!rawName) continue;
    if (inline !== undefined) {
      flags[rawName] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[rawName] = next;
      index += 1;
    } else {
      flags[rawName] = true;
    }
  }
  return { positional, flags };
}

function required(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== "string" || value.length === 0) throw new DomainError("missing_flag", `--${name} is required.`);
  return value;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) throw new DomainError("invalid_value", `${label} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

function planningFromUnknown(value: unknown): PlanningProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("invalid_plan", "Planning profile must be a JSON object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["outcome", "appetite", "non_goals", "work_units", "proofs", "production_wiring", "rollback", "migration", "decision_owner", "risks"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new DomainError("invalid_plan", `Unknown planning fields: ${unknown.join(", ")}.`);
  const profile: PlanningProfile = {};
  for (const key of ["outcome", "appetite", "production_wiring", "rollback", "migration", "decision_owner"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "string") throw new DomainError("invalid_plan", `${key} must be a string.`);
      profile[key] = input[key];
    }
  }
  if (input.non_goals !== undefined) {
    if (!Array.isArray(input.non_goals) || input.non_goals.some((item) => typeof item !== "string")) throw new DomainError("invalid_plan", "non_goals must be an array of strings.");
    profile.non_goals = input.non_goals;
  }
  if (input.work_units !== undefined) {
    if (!Array.isArray(input.work_units)) throw new DomainError("invalid_plan", "work_units must be an array.");
    profile.work_units = input.work_units.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new DomainError("invalid_plan", "Each work unit must be an object.");
      const unit = item as Record<string, unknown>;
      if (typeof unit.id !== "string" || typeof unit.title !== "string" || typeof unit.done_when !== "string" || !Array.isArray(unit.behavior_ids) || unit.behavior_ids.some((id) => typeof id !== "string")) {
        throw new DomainError("invalid_plan", "Each work unit requires string id, title, done_when, and string[] behavior_ids.");
      }
      return { id: unit.id, title: unit.title, done_when: unit.done_when, behavior_ids: unit.behavior_ids as string[] };
    });
  }
  if (input.proofs !== undefined) {
    if (!Array.isArray(input.proofs)) throw new DomainError("invalid_plan", "proofs must be an array.");
    profile.proofs = input.proofs.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new DomainError("invalid_plan", "Each proof must be an object.");
      const proof = item as Record<string, unknown>;
      if (typeof proof.behavior_id !== "string" || typeof proof.method !== "string" || !["unit", "wired", "live"].includes(String(proof.tier))) {
        throw new DomainError("invalid_plan", "Each proof requires behavior_id, method, and tier unit|wired|live.");
      }
      return { behavior_id: proof.behavior_id, method: proof.method, tier: proof.tier as "unit" | "wired" | "live" };
    });
  }
  if (input.risks !== undefined) {
    if (!Array.isArray(input.risks)) throw new DomainError("invalid_plan", "risks must be an array.");
    profile.risks = input.risks.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new DomainError("invalid_plan", "Each risk must be an object.");
      const risk = item as Record<string, unknown>;
      if (typeof risk.risk !== "string" || typeof risk.mitigation !== "string") throw new DomainError("invalid_plan", "Each risk requires string risk and mitigation.");
      return { risk: risk.risk, mitigation: risk.mitigation };
    });
  }
  return profile;
}

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

function dashboard(db: LoopbreakerDb) {
  const issues = db.listIssues();
  const executablePath = resolve(process.argv[1] ?? "loopbreaker");
  const result: Record<string, unknown> = {
    bin: executablePath.startsWith(`${homedir()}/`) ? `~/${executablePath.slice(homedir().length + 1)}` : executablePath,
    description: "Evaluate planning health, bound review, and derive explicit ship decisions.",
    issue_count: issues.length,
    issues: issues.map((issue) => {
      const state = substrate(db, issue.id);
      return {
        id: issue.id,
        title: issue.title,
        review: state.review.complete ? "complete" : state.review.next_action,
        shipping: state.shipping.disposition,
        planning: `${state.planning.score}/100 ${state.planning.ready ? "ready" : "blocked"}`,
        unresolved_behaviors: state.shipping.unresolved_behavior_ids.length,
      };
    }),
  };
  if (issues.length === 0) result.empty = "No issues. Run: loopbreaker demo";
  return result;
}

function output(data: unknown, db: LoopbreakerDb, next?: string[]): void {
  process.stdout.write(`${success(data, { db: db.path, ...(next ? { next } : {}) })}\n`);
}

async function main(): Promise<void> {
  const { positional, flags } = parse(process.argv.slice(2));
  const command = positional[0];
  if (flags.help || command === "help" || command === "--help") {
    const topic = command === "help" ? positional[1] : command;
    process.stdout.write(`${topic && COMMAND_HELP[topic] ? COMMAND_HELP[topic] : HELP}\n`);
    return;
  }

  const dbPath = typeof flags.db === "string" ? flags.db : undefined;
  if (command === "mcp") {
    await runMcp(dbPath);
    return;
  }
  const db = openDb(dbPath);
  let keepOpen = false;
  try {
    if (!command) {
      output(dashboard(db), db, db.listIssues().length ? ["loopbreaker substrate <issue>", "loopbreaker serve"] : ["loopbreaker demo"]);
      return;
    }
    if (command === "init") {
      output({ initialized: true, database: db.path }, db, ["loopbreaker demo"]);
      return;
    }
    if (command === "demo") {
      output(seedDemo(db), db, [`loopbreaker substrate ${DEMO_ISSUE}`, "loopbreaker serve"]);
      return;
    }
    if (command === "import") {
      const file = positional[1];
      if (!file) throw new DomainError("missing_file", "A JSON contract file is required.");
      let value: unknown;
      try { value = JSON.parse(readFileSync(file, "utf8")); }
      catch (error) { throw new DomainError("invalid_contract_file", `Could not read JSON contract: ${error instanceof Error ? error.message : String(error)}`); }
      if (!value || typeof value !== "object") throw new DomainError("invalid_contract", "Contract JSON must be an object.");
      const record = value as { issue_id?: unknown; title?: unknown; description?: unknown; behaviors?: unknown; planning?: unknown };
      if (typeof record.issue_id !== "string" || typeof record.title !== "string" || !Array.isArray(record.behaviors)) {
        throw new DomainError("invalid_contract", "Contract requires string issue_id, string title, and a behaviors array.");
      }
      const behaviors = record.behaviors.map((item) => {
        if (!item || typeof item !== "object") throw new DomainError("invalid_contract", "Each behavior must be an object.");
        const behavior = item as { id?: unknown; title?: unknown; trigger?: unknown; expected?: unknown; verify?: unknown; advisory?: unknown };
        if (
          typeof behavior.id !== "string"
          || typeof behavior.title !== "string"
          || typeof behavior.trigger !== "string"
          || typeof behavior.expected !== "string"
          || typeof behavior.verify !== "string"
        ) throw new DomainError("invalid_contract", "Each behavior requires string id, title, trigger, expected, and verify.");
        if (behavior.advisory !== undefined && typeof behavior.advisory !== "boolean") throw new DomainError("invalid_contract", "behavior.advisory must be boolean when present.");
        return {
          id: behavior.id,
          title: behavior.title,
          trigger: behavior.trigger,
          expected: behavior.expected,
          verify: behavior.verify,
          ...(typeof behavior.advisory === "boolean" ? { advisory: behavior.advisory } : {}),
        };
      });
      output(importContract(db, {
        issueId: record.issue_id,
        title: record.title,
        description: typeof record.description === "string" ? record.description : undefined,
        behaviors,
        planning: record.planning === undefined ? undefined : planningFromUnknown(record.planning),
      }), db);
      return;
    }
    if (command === "plan") {
      const issueId = positional[1];
      const file = positional[2];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      if (!file) throw new DomainError("missing_file", "A planning JSON file is required.");
      let value: unknown;
      try { value = JSON.parse(readFileSync(file, "utf8")); }
      catch (error) { throw new DomainError("invalid_plan_file", `Could not read planning JSON: ${error instanceof Error ? error.message : String(error)}`); }
      const embedded = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).planning : undefined;
      output(planningSummary(recordPlanning(db, issueId, planningFromUnknown(embedded ?? value))), db, [`loopbreaker health ${issueId}`]);
      return;
    }
    if (command === "health") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(planningSummary(planningHealth(db, issueId)), db);
      return;
    }
    if (command === "substrate") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(substrate(db, issueId), db);
      return;
    }
    if (command === "pass") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      const passNumber = Number(required(flags, "pass"));
      const verdict = oneOf(required(flags, "verdict"), ["pass", "fail"] as const, "--verdict");
      output(recordPass(db, { issueId, passNumber, verdict, summary: required(flags, "summary") }), db);
      return;
    }
    if (command === "evidence") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      const tier = oneOf(required(flags, "tier"), ["unit", "wired", "live"] as const, "--tier");
      const verdict = oneOf(required(flags, "verdict"), ["pass", "fail"] as const, "--verdict");
      output(recordEvidence(db, {
        issueId,
        behaviorId: typeof flags.behavior === "string" ? flags.behavior : undefined,
        tier,
        verdict,
        summary: required(flags, "summary"),
        source: typeof flags.source === "string" ? flags.source : undefined,
      }), db);
      return;
    }
    if (command === "verify") {
      const behaviorId = positional[1];
      if (!behaviorId) throw new DomainError("missing_behavior", "A behavior ID is required.");
      output(verifyBehavior(db, behaviorId, required(flags, "evidence")), db);
      return;
    }
    if (command === "waive") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(createWaiver(db, {
        issueId,
        behaviorId: required(flags, "behavior"),
        rationale: required(flags, "rationale"),
        approvedBy: required(flags, "approved-by"),
      }), db);
      return;
    }
    if (command === "serve") {
      const portValue = typeof flags.port === "string" ? Number(flags.port) : 7331;
      if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) throw new DomainError("invalid_port", "--port must be an integer from 1 to 65535.");
      const server = await startServer(db, portValue);
      keepOpen = true;
      process.stdout.write(`${success({ url: server.url, database: db.path, stop: "Ctrl-C" })}\n`);
      const stop = async () => { await server.close(); db.close(); process.exit(0); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return;
    }
    throw new DomainError("unknown_command", `Unknown command: ${command}`, "Run loopbreaker help.");
  } finally {
    if (!keepOpen) db.close();
  }
}

main().catch((error) => {
  const known = error instanceof DomainError;
  process.stdout.write(`${failure(known ? error.code : "internal_error", error instanceof Error ? error.message : String(error), known ? error.hint : undefined)}\n`);
  process.exitCode = known && ["missing_flag", "missing_issue", "missing_behavior", "missing_file", "invalid_value", "unknown_command", "invalid_port", "invalid_contract_file", "invalid_contract", "invalid_plan_file", "invalid_plan"].includes(error.code) ? 2 : 1;
});
