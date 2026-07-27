#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DomainError, approveDiscovery, bindHarness, demoteUnexecuted, discoveryState, recordDiscovery, planningHealth, recordEvidence, recordPass, recordPlanning, recordPlanningReviewPass, recordShape, substrate, upsertPlanningFinding, verifyBehavior, createWaiver, importContract } from "./domain.js";
import { loadRegistry } from "./harness.js";
import { proveBehavior } from "./prove.js";
import { cliActor, openDb, type LoopbreakerDb } from "./db.js";
import { dispatchHook } from "./hooks.js";
import { primePayload } from "./prime.js";
import type { PlanningHealth, PlanningProfile, ShapeProfile } from "./types.js";
import { runMcp } from "./mcp.js";
import { DEMO_ISSUE, seedDemo } from "./seed.js";
import { startServer } from "./server.js";
import { failure, success } from "./toon.js";

export type Flags = Record<string, string | boolean>;

const HELP = `loopbreaker — local review graph with bounded passes and explicit ship decisions

Usage:
  loopbreaker                                  Show the live issue dashboard
  loopbreaker init [--db PATH]                 Initialize an empty SQLite database
  loopbreaker demo [--db PATH]                 Seed the idempotent demo incident
  loopbreaker import FILE [--db PATH]          Import a JSON issue behavior contract
  loopbreaker plan ISSUE FILE [--db PATH]      Record or replace the pre-review planning profile
  loopbreaker shape ISSUE FILE [--db PATH]     Record the explicit shape disposition
  loopbreaker health ISSUE [--db PATH]         Show compact planning health and blockers
  loopbreaker readiness ISSUE [--db PATH]      Show the ordered admission and shipping gates
  loopbreaker plan-pass ISSUE --pass N --verdict V --summary TEXT
  loopbreaker plan-finding ISSUE --id ID --stage S --severity P --status S --title TEXT
  loopbreaker substrate ISSUE [--db PATH]      Show the full review substrate
  loopbreaker link ISSUE [--db PATH]           Bind the active issue for this repository
  loopbreaker link --show [--db PATH]          Show the currently linked active issue
  loopbreaker link --clear [--db PATH]         Clear the active issue binding
  loopbreaker prime [ISSUE] [--db PATH]        Compose the deterministic prime block
  loopbreaker pass ISSUE --pass N --verdict V --summary TEXT
  loopbreaker evidence ISSUE --behavior ID --tier T --verdict V --summary TEXT [--source URI]
  loopbreaker verify BEHAVIOR --evidence ID
  loopbreaker discover ISSUE FILE              Record the founder interview answers
  loopbreaker discover ISSUE --approve --by N  Approve the discovery record
  loopbreaker discovery ISSUE                  Show the discovery record and its status
  loopbreaker harnesses [--registry PATH]      List the registered verify harnesses
  loopbreaker bind BEHAVIOR --harness ID       Point a behavior at a registered harness
  loopbreaker prove BEHAVIOR [--live]          Execute the behavior's registered harness and record the result
  loopbreaker demote --dry-run | --apply       Report or demote behaviors verified without an executed proof
  loopbreaker waive ISSUE --behavior ID --rationale TEXT --approved-by NAME
  loopbreaker serve [--db PATH] [--port 7331]  Start the local visual decision view
  loopbreaker mcp [--db PATH]                  Start the local MCP server over stdio
  loopbreaker hook session-start [--db PATH]   Emit the prime block as SessionStart hook context
  loopbreaker hook pre-tool-use [--db PATH]    Allow/deny a PreToolUse edit against admission
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
  shape: "loopbreaker shape ISSUE FILE [--db PATH]\n\nRecord problem, appetite, smallest_slice, non_goals, success_signal, reversibility, decision_owner, risks, and disposition.",
  health: "loopbreaker health ISSUE [--db PATH]\n\nReturn score, dimensions, blockers, and readiness without the full planning profile.",
  readiness: "loopbreaker readiness ISSUE [--db PATH]\n\nReturn shape, planning health, independent planning-review state, implementation admission, and shipping gate.",
  "plan-pass": "loopbreaker plan-pass ISSUE --pass 1|2|3 --verdict approved|changes_required|rescope|return_to_shaping --summary TEXT [--db PATH]",
  "plan-finding": "loopbreaker plan-finding ISSUE --id ID --stage shape|planning --severity P0|P1|P2|P3 --status open|repaired|accepted_debt --title TEXT [--reachability TEXT --impact TEXT --smallest-fix TEXT]",
  substrate: "loopbreaker substrate ISSUE [--db PATH]\n\nReturn behaviors, evidence, findings, passes, waivers, and derived ship state.",
  link: "loopbreaker link ISSUE [--db PATH]\nloopbreaker link --show [--db PATH]\nloopbreaker link --clear [--db PATH]\n\nBind, show, or clear the one active issue persisted for this repository's loopbreaker state.",
  prime: "loopbreaker prime [ISSUE] [--db PATH]\n\nCompose the single deterministic prime block for ISSUE, or the linked active issue when ISSUE is omitted: the ordered authority chain, the single next allowed action, open blocking findings, and unverified enforced behaviors. Returns both the structured block and its rendered text.",
  pass: "loopbreaker pass ISSUE --pass 1|2|3 --verdict pass|fail --summary TEXT [--db PATH]\n\nRecord only the next pass. Pass 4 is rejected.",
  evidence: "loopbreaker evidence ISSUE [--behavior ID] --tier unit|wired|live --verdict pass|fail --summary TEXT [--source URI] [--db PATH]",
  verify: "loopbreaker verify BEHAVIOR --evidence ID [--db PATH]\n\nVerify a behavior with passing evidence attached to that behavior.",
  waive: "loopbreaker waive ISSUE --behavior ID --rationale TEXT --approved-by NAME [--db PATH]\n\nCreate durable named debt for one enforced behavior.",
  discover: "loopbreaker discover ISSUE FILE [--db PATH]\nloopbreaker discover ISSUE --approve --by NAME [--db PATH]\n\nRecord the founder interview as one answer per required shape field, then approve it. Shape cannot reach proceed without an approved record. Re-recording answers returns the record to draft: an approved premise silently edited would have the gate vouch for text the approver never saw.",
  discovery: "loopbreaker discovery ISSUE [--db PATH]\n\nShow the discovery record, its answers, and whether it is approved, grandfathered, or still a draft.",
  harnesses: "loopbreaker harnesses [--registry PATH] [--db PATH]\n\nList every registered verify harness with its declared tier and runner. A behavior's harness_ref names an entry here; it never stores a command.",
  bind: "loopbreaker bind BEHAVIOR --harness ID [--db PATH]\n\nPoint a behavior at a registered harness. Not frozen by the acceptance contract: the contract states what must be true, the ref only says which runner proves it. The registry entry must also name this behavior in its `proves` list, which is a reviewed code change.",
  prove: "loopbreaker prove BEHAVIOR [--live] [--registry PATH] [--db PATH]\n\nExecute the behavior's registered harness and record evidence whose verdict comes from the exit code. Rejects --verdict and --tier: the caller chooses which harness runs, never what the run concluded. A live-tier harness requires --live.",
  demote: "loopbreaker demote --dry-run | --apply [--db PATH]\n\nReport, or apply, the demotion of every enforced behavior that reached verified without a proof loopbreaker executed. --dry-run changes nothing and names the exact set --apply would demote.",
  serve: "loopbreaker serve [--db PATH] [--port 7331]\n\nServe the visual review graph on 127.0.0.1.",
  mcp: "loopbreaker mcp [--db PATH]\n\nRun the MCP server over stdio for a local client process.",
  hook: "loopbreaker hook session-start [--db PATH]\nloopbreaker hook pre-tool-use [--db PATH]\n\nRead one hook event JSON object from stdin and write the host's expected hookSpecificOutput to stdout. Always exits 0; unknown or unparseable input fails open with no output (session-start) or allow (pre-tool-use).",
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

function shapeFromUnknown(value: unknown): ShapeProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("invalid_shape", "Shape profile must be a JSON object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["problem", "appetite", "smallest_slice", "non_goals", "success_signal", "reversibility", "decision_owner", "risks", "disposition"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new DomainError("invalid_shape", `Unknown shape fields: ${unknown.join(", ")}.`);
  for (const key of ["problem", "appetite", "smallest_slice", "success_signal", "reversibility", "decision_owner"] as const) {
    if (typeof input[key] !== "string") throw new DomainError("invalid_shape", `${key} must be a string.`);
  }
  if (!Array.isArray(input.non_goals) || input.non_goals.some((item) => typeof item !== "string")) throw new DomainError("invalid_shape", "non_goals must be an array of strings.");
  if (!Array.isArray(input.risks)) throw new DomainError("invalid_shape", "risks must be an array.");
  const risks = input.risks.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new DomainError("invalid_shape", "Each risk must be an object.");
    const risk = item as Record<string, unknown>;
    if (typeof risk.risk !== "string" || typeof risk.mitigation !== "string") throw new DomainError("invalid_shape", "Each risk requires string risk and mitigation.");
    return { risk: risk.risk, mitigation: risk.mitigation };
  });
  const disposition = oneOf(String(input.disposition), ["proceed", "spike", "park", "reject"] as const, "disposition");
  return {
    problem: input.problem as string, appetite: input.appetite as string, smallest_slice: input.smallest_slice as string,
    non_goals: input.non_goals as string[], success_signal: input.success_signal as string,
    reversibility: input.reversibility as string, decision_owner: input.decision_owner as string, risks, disposition,
  };
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

function readinessSummary(db: LoopbreakerDb, issueId: string) {
  const state = substrate(db, issueId);
  return {
    issue_id: issueId,
    shape: state.shape,
    planning: planningSummary(state.planning),
    planning_review: state.planning_review,
    implementation: { admitted: state.shape.ready && state.planning.ready && state.planning_review.approved },
    shipping: state.shipping,
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
        planning_review: state.planning_review.disposition,
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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Pure, synchronous, in-process dispatch for `loopbreaker hook <name>`.
 * Thin delegator to hooks.ts's `dispatchHook`, the single source of truth
 * shared with the bundled plugin hook entry point (src/plugin-hook.ts) --
 * kept here (rather than callers using dispatchHook directly) only so tests
 * and callers have one stable name for "the CLI's in-process hook dispatch."
 * Exported so tests can exercise the full session-start/pre-tool-use wiring
 * without spawning a child process.
 */
export function runHookCommand(name: string, stdin: string, db: LoopbreakerDb): string {
  return dispatchHook(db, name, stdin);
}

/**
 * Pure, synchronous, in-process dispatch for `loopbreaker link`: `--clear`
 * wins over `--show`, which wins over binding the positional ISSUE. Exported
 * so tests can exercise the exact CLI dispatch logic -- flag priority,
 * existence validation, and the persisted binding it returns -- without
 * spawning a child process.
 */
export function runLinkCommand(db: LoopbreakerDb, positional: string[], flags: Flags): { active_issue: string | null } {
  if (flags.clear) {
    db.clearActiveIssue();
    return { active_issue: null };
  }
  if (flags.show) {
    return { active_issue: db.activeIssue() };
  }
  const issueId = positional[1];
  if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
  if (!db.issue(issueId)) throw new DomainError("issue_not_found", `Issue ${issueId} does not exist.`, "Import its behavior contract first.");
  db.setActiveIssue(issueId);
  return { active_issue: issueId };
}

/**
 * Thin IO wrapper around runHookCommand for a real `loopbreaker hook <name>`
 * process invocation: read real stdin, open the db, dispatch, write the
 * result, always exit 0. Hooks never go through the DomainError -> exit-1
 * path.
 */
async function dispatchHookCommand(name: string | undefined, dbPath: string | undefined): Promise<void> {
  let db: LoopbreakerDb | undefined;
  try {
    const raw = await readStdin();
    if (name === undefined) return;
    // LB-21 ingress: the CLI `hook` subcommand. Reachable as a trigger_type
    // value, but writes no rows in this slice — hooks are read-only.
    db = openDb(dbPath, { trigger_type: "hook", triggered_by: cliActor(), trigger_data: null });
    const result = runHookCommand(name, raw, db);
    if (result) process.stdout.write(`${result}\n`);
  } catch {
    // Fail open: no output, exit 0.
  } finally {
    db?.close();
  }
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
  if (command === "hook") {
    await dispatchHookCommand(positional[1], dbPath);
    return;
  }
  // LB-21 ingress: the CLI. `command` is parsed before openDb, so the
  // subcommand is available as trigger_data.
  const db = openDb(dbPath, {
    trigger_type: "cli",
    triggered_by: cliActor(),
    trigger_data: command ? { subcommand: command } : null,
  });
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
        const behavior = item as { id?: unknown; title?: unknown; trigger?: unknown; expected?: unknown; verify?: unknown; advisory?: unknown; harness_ref?: unknown };
        if (
          typeof behavior.id !== "string"
          || typeof behavior.title !== "string"
          || typeof behavior.trigger !== "string"
          || typeof behavior.expected !== "string"
          || typeof behavior.verify !== "string"
        ) throw new DomainError("invalid_contract", "Each behavior requires string id, title, trigger, expected, and verify.");
        if (behavior.advisory !== undefined && typeof behavior.advisory !== "boolean") throw new DomainError("invalid_contract", "behavior.advisory must be boolean when present.");
        if (behavior.harness_ref !== undefined && typeof behavior.harness_ref !== "string") throw new DomainError("invalid_contract", "behavior.harness_ref must be a string when present.");
        return {
          id: behavior.id,
          title: behavior.title,
          trigger: behavior.trigger,
          expected: behavior.expected,
          verify: behavior.verify,
          ...(typeof behavior.advisory === "boolean" ? { advisory: behavior.advisory } : {}),
          ...(typeof behavior.harness_ref === "string" ? { harness_ref: behavior.harness_ref } : {}),
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
    if (command === "shape") {
      const issueId = positional[1];
      const file = positional[2];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      if (!file) throw new DomainError("missing_file", "A shape JSON file is required.");
      let value: unknown;
      try { value = JSON.parse(readFileSync(file, "utf8")); }
      catch (error) { throw new DomainError("invalid_shape_file", `Could not read shape JSON: ${error instanceof Error ? error.message : String(error)}`); }
      const embedded = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).shape : undefined;
      output(recordShape(db, issueId, shapeFromUnknown(embedded ?? value)), db, [`loopbreaker readiness ${issueId}`]);
      return;
    }
    if (command === "health") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(planningSummary(planningHealth(db, issueId)), db);
      return;
    }
    if (command === "readiness") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(readinessSummary(db, issueId), db);
      return;
    }
    if (command === "plan-pass") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      const passNumber = Number(required(flags, "pass"));
      const verdict = oneOf(required(flags, "verdict"), ["approved", "changes_required", "rescope", "return_to_shaping"] as const, "--verdict");
      output(recordPlanningReviewPass(db, { issueId, passNumber, verdict, summary: required(flags, "summary") }), db);
      return;
    }
    if (command === "plan-finding") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(upsertPlanningFinding(db, {
        issueId, findingId: required(flags, "id"),
        stage: oneOf(required(flags, "stage"), ["shape", "planning"] as const, "--stage"),
        severity: oneOf(required(flags, "severity"), ["P0", "P1", "P2", "P3"] as const, "--severity"),
        status: oneOf(required(flags, "status"), ["open", "repaired", "accepted_debt"] as const, "--status"),
        title: required(flags, "title"), reviewPassNumber: typeof flags.pass === "string" ? Number(flags.pass) : undefined,
        reachability: typeof flags.reachability === "string" ? flags.reachability : undefined,
        impact: typeof flags.impact === "string" ? flags.impact : undefined,
        smallestFix: typeof flags["smallest-fix"] === "string" ? flags["smallest-fix"] : undefined,
      }), db);
      return;
    }
    if (command === "substrate") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(substrate(db, issueId), db);
      return;
    }
    if (command === "link") {
      const bound = runLinkCommand(db, positional, flags);
      const boundNewIssue = !flags.clear && !flags.show;
      output(bound, db, boundNewIssue ? ["loopbreaker prime"] : undefined);
      return;
    }
    if (command === "prime") {
      output(primePayload(db, positional[1]), db);
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
    if (command === "discovery") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      output(discoveryState(db, issueId), db, ["loopbreaker readiness " + issueId]);
      return;
    }
    if (command === "discover") {
      const issueId = positional[1];
      if (!issueId) throw new DomainError("missing_issue", "An issue ID is required.");
      if (flags.approve === true) {
        const by = flags.by;
        if (typeof by !== "string" || !by.trim()) {
          throw new DomainError("missing_flag", "--by is required: an approver must be named.", "The approval is the one act that must carry a human's name.");
        }
        output(approveDiscovery(db, issueId, by), db, ["loopbreaker readiness " + issueId]);
        return;
      }
      const file = positional[2];
      if (!file) throw new DomainError("missing_file", "A discovery JSON file is required.");
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(resolve(file), "utf8")); }
      catch (error) { throw new DomainError("invalid_discovery_file", `Could not read ${file}: ${(error as Error).message}`); }
      const record = parsed as { answers?: unknown };
      if (!Array.isArray(record.answers)) throw new DomainError("invalid_discovery", "Discovery JSON requires an answers array.");
      const answers = record.answers.map((item) => {
        const entry = item as { field?: unknown; question?: unknown; answer?: unknown };
        if (typeof entry.field !== "string" || typeof entry.question !== "string" || typeof entry.answer !== "string") {
          throw new DomainError("invalid_discovery", "Each answer requires string field, question, and answer.");
        }
        return { field: entry.field, question: entry.question, answer: entry.answer };
      });
      output(recordDiscovery(db, issueId, answers), db, [`loopbreaker discover ${issueId} --approve --by NAME`]);
      return;
    }
    if (command === "harnesses") {
      const registry = loadRegistry(typeof flags.registry === "string" ? flags.registry : undefined);
      output({
        registry: registry.path,
        harnesses: registry.harnesses.map((entry) => ({
          id: entry.id, tier: entry.tier, runner: entry.runner, target: entry.target, purpose: entry.purpose ?? "",
        })),
      }, db, ["loopbreaker prove <behavior>"]);
      return;
    }
    if (command === "bind") {
      const behaviorId = positional[1];
      if (!behaviorId) throw new DomainError("missing_behavior", "A behavior ID is required.");
      output(bindHarness(db, behaviorId, required(flags, "harness")), db, [`loopbreaker prove ${behaviorId}`]);
      return;
    }
    if (command === "prove") {
      const behaviorId = positional[1];
      if (!behaviorId) throw new DomainError("missing_behavior", "A behavior ID is required.");
      // LB-27: a caller chooses WHICH registered harness runs, never what the
      // run concluded. Honouring either of these would reopen the exact hole
      // this command exists to close, so they are refused rather than ignored.
      for (const forbidden of ["verdict", "tier", "executed", "exit-code"]) {
        if (flags[forbidden] !== undefined) {
          throw new DomainError(
            "outcome_not_caller_supplied",
            `\`prove\` does not accept --${forbidden}.`,
            "The verdict and tier come from the harness registry and the run's exit code.",
          );
        }
      }
      const result = proveBehavior(db, behaviorId, {
        registryPath: typeof flags.registry === "string" ? flags.registry : undefined,
        live: flags.live === true,
      });
      output({
        behavior_id: result.behavior_id,
        harness: result.harness.id,
        tier: result.harness.tier,
        verdict: result.verdict,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        reason: result.reason,
        shipping: result.substrate.shipping,
      }, db, result.verdict === "pass" ? [`loopbreaker verify ${result.behavior_id} --evidence <id>`] : []);
      return;
    }
    if (command === "demote") {
      const apply = flags.apply === true;
      if (!apply && flags["dry-run"] !== true) {
        throw new DomainError("missing_flag", "Pass --dry-run to report, or --apply to demote.", "The report is the default safety: nothing changes without --apply.");
      }
      const result = demoteUnexecuted(db, { apply });
      output({
        applied: result.applied,
        count: result.demoted.length,
        demoted: result.demoted,
      }, db, result.applied ? [] : ["loopbreaker demote --apply"]);
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
      // LB-29: the server gets its OWN handle stamped `web`. Every write it
      // makes originates from a browser request, so inheriting the CLI's
      // provenance would misattribute them to the terminal.
      const portValue = typeof flags.port === "string" ? Number(flags.port) : 7331;
      if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) throw new DomainError("invalid_port", "--port must be an integer from 1 to 65535.");
      const webDb = openDb(dbPath, { trigger_type: "web", triggered_by: "browser", trigger_data: null });
      const server = await startServer(webDb, portValue);
      keepOpen = true;
      process.stdout.write(`${success({ url: server.url, database: webDb.path, stop: "Ctrl-C" })}\n`);
      const stop = async () => { await server.close(); webDb.close(); db.close(); process.exit(0); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      return;
    }
    throw new DomainError("unknown_command", `Unknown command: ${command}`, "Run loopbreaker help.");
  } finally {
    if (!keepOpen) db.close();
  }
}

// Only run as a script (`node dist/cli.js`, `tsx src/cli.ts`, the `loopbreaker` bin), never as a
// side effect of importing this module -- e.g. from tests that call runHookCommand directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const known = error instanceof DomainError;
    process.stdout.write(`${failure(known ? error.code : "internal_error", error instanceof Error ? error.message : String(error), known ? error.hint : undefined)}\n`);
    process.exitCode = known && ["missing_flag", "missing_issue", "missing_behavior", "missing_file", "invalid_value", "unknown_command", "invalid_port", "invalid_contract_file", "invalid_contract", "invalid_plan_file", "invalid_plan", "invalid_shape_file", "invalid_shape", "no_active_issue", "invalid_discovery_file", "invalid_discovery", "incomplete_discovery", "missing_discovery", "discovery_grandfathered", "outcome_not_caller_supplied", "harness_ref_missing", "harness_not_registered", "registry_missing", "registry_invalid", "registry_unreadable", "live_opt_in_required"].includes(error.code) ? 2 : 1;
  });
}
