#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { DomainError, recordEvidence, recordPass, substrate, verifyBehavior, createWaiver, importContract } from "./domain.js";
import { openDb, type LoopbreakerDb } from "./db.js";
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
  import: "loopbreaker import FILE [--db PATH]\n\nImport JSON shaped as {issue_id,title,description?,behaviors:[{id,title,trigger,expected,verify,advisory?}]}. Reviewed contracts are frozen.",
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

function dashboard(db: LoopbreakerDb) {
  const issues = db.listIssues();
  const result: Record<string, unknown> = {
    executable: "loopbreaker",
    description: "Local review graph with bounded passes and explicit ship decisions.",
    issue_count: issues.length,
    issues: issues.map((issue) => {
      const state = substrate(db, issue.id);
      return {
        id: issue.id,
        title: issue.title,
        review: state.review.complete ? "complete" : state.review.next_action,
        shipping: state.shipping.disposition,
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
      const record = value as { issue_id?: unknown; title?: unknown; description?: unknown; behaviors?: unknown };
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
      output(importContract(db, { issueId: record.issue_id, title: record.title, description: typeof record.description === "string" ? record.description : undefined, behaviors }), db);
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
  process.exitCode = known && ["missing_flag", "missing_issue", "missing_behavior", "missing_file", "invalid_value", "unknown_command", "invalid_port", "invalid_contract_file", "invalid_contract"].includes(error.code) ? 2 : 1;
});
