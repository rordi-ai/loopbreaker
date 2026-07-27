/**
 * LB-31-B1 — planning must escalate one-way doors to the founder.
 *
 * Discovery settles the premise, but planning DISCOVERS decisions the premise
 * could not have anticipated — a migration, a public API shape, a destructive
 * change. Some are cheap to unwind and some are not, and the expensive ones are
 * product decisions wearing technical clothes.
 *
 * Observed in HEALTH-1: the agent's first repair demoted two enforced behaviors
 * from `wired` to `unit` tier to hit the appetite — trading proof strength for
 * speed, a product call — and was caught only because `unit_only_proof` happened
 * to exist as a rule. Nothing general was watching.
 *
 * So: a plan may record decisions it had to make. Any decision marked `one_way`
 * needs a founder answer; without one, planning is not ready.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliOk, makeWorkspace, requireBuild, runCli, type Workspace } from "./harness.js";
import { importAndShape, writeDiscovery } from "./lb-28-fixture.js";
import { approveViaBrowser } from "./harness.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A plan that reaches 100/100 on every existing dimension, so only the new rule can move it. */
function plan(decisions?: unknown): Record<string, unknown> {
  return {
    outcome: "The endpoint reports what is deployed.",
    appetite: "Small.",
    non_goals: ["Auth"],
    work_units: [{ id: "wire", title: "Wire it", behavior_ids: ["ESC-1-B1"], done_when: "It responds." }],
    proofs: [{ behavior_id: "ESC-1-B1", tier: "wired", method: "Drive the served route." }],
    production_wiring: "A real server route in the app's route tree.",
    rollback: "Delete the route.",
    migration: "None.",
    decision_owner: "ben@rordi.ai",
    risks: [{ risk: "Stale value.", mitigation: "Fail the build." }],
    ...(decisions === undefined ? {} : { decisions }),
  };
}

async function planWith(workspace: Workspace, decisions?: unknown) {
  const path = join(workspace.dir, "plan.json");
  writeFileSync(path, JSON.stringify(plan(decisions)));
  return runCli(["plan", "ESC-1", path], { db: workspace.db });
}

describe("LB-31-B1 · one-way doors escalate to the founder", () => {
  let workspace: Workspace;

  beforeAll(async () => {
    requireBuild();
    workspace = makeWorkspace("lb31b1");
    await cliOk(["init"], { db: workspace.db });
    await importAndShape(workspace, "ESC-1");
    await cliOk(["discover", "ESC-1", writeDiscovery(workspace, "ESC-1")], { db: workspace.db });
    await approveViaBrowser(workspace.db, "ESC-1", "ben@rordi.ai");
  });

  afterAll(() => workspace?.dispose());

  it("stays ready when a plan records no decisions at all", async () => {
    // The rule must not tax plans that genuinely faced no such choice, or every
    // plan will grow a decorative empty block.
    const result = await planWith(workspace);
    expect(result.code, `plan exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("score: 100");
    expect(result.stdout).toContain("ready: true");
  });

  it("stays ready when every recorded decision is reversible", async () => {
    const result = await planWith(workspace, [
      { decision: "Bake the SHA at build time rather than reading git at runtime.", reversibility: "reversible" },
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ready: true");
  });

  it("blocks a one-way decision that carries no founder answer, by name", async () => {
    const result = await planWith(workspace, [
      { decision: "Add a users table migration that drops the legacy column.", reversibility: "one_way" },
    ]);
    expect(result.stdout, "an unescalated one-way door did not block planning").toContain("unescalated_one_way_door");
    expect(result.stdout).toContain("ready: false");
  });

  it("names the specific decision in the blocker, not just the rule", async () => {
    const result = await planWith(workspace, [
      { decision: "Add a users table migration that drops the legacy column.", reversibility: "one_way" },
    ]);
    expect(result.stdout, "the blocker does not say WHICH decision needs an answer").toMatch(/legacy column|users table/);
  });

  it("clears once the founder answer is recorded against it", async () => {
    const result = await planWith(workspace, [
      {
        decision: "Add a users table migration that drops the legacy column.",
        reversibility: "one_way",
        founder_answer: "Asked 2026-07-27: drop it. The column has been unread for two releases and we accept the one-way cost.",
      },
    ]);
    expect(result.code, `plan exited ${result.code}: ${result.stderr}`).toBe(0);
    expect(result.stdout, "an answered one-way door still blocked").not.toContain("unescalated_one_way_door");
    expect(result.stdout).toContain("ready: true");
  });

  it("rejects an unknown reversibility value rather than treating it as reversible", async () => {
    // Failing open here would make the gate trivially escapable by typo.
    const result = await planWith(workspace, [
      { decision: "Something irreversible.", reversibility: "probably_fine" },
    ]);
    expect(result.code, "an unknown reversibility value was accepted").not.toBe(0);
  });
});
