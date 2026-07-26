/**
 * Drives every one of LB-21's ten mutation writers through a real ingress, so
 * the harnesses have row versions in all ten domain tables to assert against.
 *
 * The contract and shape bodies are cribbed from `examples/lifecycle-hooks-*`
 * (the LB-18 contract, which is known to reach 100/100 planning health) and
 * re-keyed to a disposable issue id. Reaching `review_passes`, `evidence`,
 * `behaviors`-UPDATE, and `waivers` requires the ordered gate to actually open,
 * so this fixture necessarily walks shape -> planning -> planning review first.
 */

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliOk, readDb, withMcp, ROOT, type Workspace } from "./harness.js";

export const FIXTURE_ISSUE = "WIRED-1";

export interface DrivenFixture {
  issueId: string;
  /** Behavior verified through the CLI `verify` path (a `behaviors` status UPDATE). */
  verifiedBehaviorId: string;
  /** Behavior waived through the CLI `waive` path (a `waivers` INSERT plus a `behaviors` status UPDATE). */
  waivedBehaviorId: string;
  evidenceId: string;
  findingId: string;
}

function loadContract(): { behaviors: Array<{ id: string }>; planning: unknown; [key: string]: unknown } {
  const raw = JSON.parse(readFileSync(join(ROOT, "examples", "lifecycle-hooks-contract.json"), "utf8"));
  raw.issue_id = FIXTURE_ISSUE;
  raw.behaviors = raw.behaviors.map((behavior: { id: string }, index: number) => ({
    ...behavior,
    id: `${FIXTURE_ISSUE}-B${index + 1}`,
    // LB-27: the first behavior is the one driven to `verified`, so it needs a
    // registered harness for `prove` to resolve.
    ...(index === 0 ? { harness_ref: "fixture-wired" } : {}),
  }));
  // Re-key the planning proofs and work units onto the new behavior ids.
  const planning = raw.planning as { proofs?: Array<{ behavior_id: string }>; work_units?: Array<{ behavior_ids: string[] }> };
  const idMap = new Map<string, string>(
    JSON.parse(readFileSync(join(ROOT, "examples", "lifecycle-hooks-contract.json"), "utf8"))
      .behaviors.map((behavior: { id: string }, index: number) => [behavior.id, `${FIXTURE_ISSUE}-B${index + 1}`]),
  );
  planning.proofs = planning.proofs?.map((proof) => ({ ...proof, behavior_id: idMap.get(proof.behavior_id) ?? proof.behavior_id }));
  planning.work_units = planning.work_units?.map((unit) => ({
    ...unit,
    behavior_ids: unit.behavior_ids.map((id) => idMap.get(id) ?? id),
  }));
  return raw;
}

/** Run the full ten-writer drive. Every mutation goes through the CLI or MCP, never in-process. */
export async function driveAllWriters(workspace: Workspace): Promise<DrivenFixture> {
  const db = workspace.db;
  const contract = loadContract();
  const contractPath = join(workspace.dir, "contract.json");
  const shapePath = join(workspace.dir, "shape.json");
  const planningPath = join(workspace.dir, "planning.json");

  writeFileSync(contractPath, JSON.stringify(contract));
  writeFileSync(shapePath, readFileSync(join(ROOT, "examples", "lifecycle-hooks-shape.json"), "utf8"));
  writeFileSync(planningPath, JSON.stringify(contract.planning));

  // 1. issues + behaviors (+ planning_profiles, since the contract carries planning)
  await cliOk(["init"], { db });
  await cliOk(["import", contractPath], { db });
  // 2. shape_assessments
  await cliOk(["shape", FIXTURE_ISSUE, shapePath], { db });
  // 3. planning_profiles, explicitly through the plan writer
  await cliOk(["plan", FIXTURE_ISSUE, planningPath], { db });
  // 4. planning_findings
  await cliOk(
    ["plan-finding", FIXTURE_ISSUE, "--id", `${FIXTURE_ISSUE}-PLAN-F1`, "--stage", "planning",
      "--severity", "P2", "--status", "repaired", "--title", "Fixture planning finding"],
    { db },
  );
  // 5. planning_review_passes — opens the implementation gate
  await cliOk(
    ["plan-pass", FIXTURE_ISSUE, "--pass", "1", "--verdict", "approved", "--summary", "Fixture planning approval."],
    { db },
  );
  // 6. review_passes
  await cliOk(["pass", FIXTURE_ISSUE, "--pass", "1", "--verdict", "pass", "--summary", "Fixture comprehensive pass."], { db });

  const behaviorIds = (contract.behaviors as Array<{ id: string }>).map((behavior) => behavior.id);
  const verifiedBehaviorId = behaviorIds[0];
  const waivedBehaviorId = behaviorIds[1];

  // 7. evidence — produced by `prove`, not asserted. Since LB-27, an enforced
  // behavior cannot be verified on evidence loopbreaker did not execute, so
  // reaching the verifyBehavior write site at step 8 requires a real run.
  const proofScript = join(workspace.dir, "fixture-proof.sh");
  writeFileSync(proofScript, "#!/bin/sh\nexit 0\n");
  chmodSync(proofScript, 0o755);
  const fixtureRegistry = join(workspace.dir, "fixture-harnesses.json");
  writeFileSync(fixtureRegistry, JSON.stringify({
    harnesses: [{ id: "fixture-wired", tier: "wired", runner: "script", target: proofScript, purpose: "Fixture wired proof.", proves: [verifiedBehaviorId] }],
  }));
  await cliOk(["prove", verifiedBehaviorId, "--registry", fixtureRegistry], { db });
  const evidenceId = readDb(db, (handle) =>
    (handle.prepare("SELECT id FROM evidence WHERE behavior_id = ? ORDER BY rowid DESC LIMIT 1").get(verifiedBehaviorId) as { id: string }).id,
  );

  // 8. behaviors status UPDATE via verify
  await cliOk(["verify", verifiedBehaviorId, "--evidence", evidenceId], { db });
  // 9. waivers INSERT plus a second behaviors status UPDATE
  await cliOk(
    ["waive", FIXTURE_ISSUE, "--behavior", waivedBehaviorId, "--rationale", "Fixture named debt.", "--approved-by", "fixture-human"],
    { db },
  );

  // 10. findings — reachable only through MCP; the CLI exposes no review-finding writer.
  const findingId = `${FIXTURE_ISSUE}-F1`;
  await withMcp(db, async (client) => {
    await client.callTool({
      name: "review_upsert_finding",
      arguments: {
        issue_id: FIXTURE_ISSUE,
        finding_id: findingId,
        severity: "P2",
        status: "open",
        title: "Fixture review finding",
      },
    });
  });

  return { issueId: FIXTURE_ISSUE, verifiedBehaviorId, waivedBehaviorId, evidenceId, findingId };
}
