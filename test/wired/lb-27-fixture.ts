/**
 * Fixture helpers for the LB-27 harnesses: import a minimal issue whose single
 * behavior points at a chosen registry entry, and drive it to the point where
 * evidence can legally be recorded.
 */

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cliOk, ROOT, type Workspace } from "./harness.js";

export interface OneBehaviorOptions {
  issueId: string;
  /** Registry entry id, or undefined to import a behavior with no harness at all. */
  harnessRef: string | undefined;
  /** Advisory behaviors skip the enforced-only gates. */
  advisory?: boolean;
}

/** Import a one-behavior contract through the real CLI ingress. */
export async function importOneBehavior(workspace: Workspace, options: OneBehaviorOptions): Promise<string> {
  const behaviorId = `${options.issueId}-B1`;
  const contract = {
    issue_id: options.issueId,
    title: `${options.issueId} harness-gate fixture`,
    description: "Minimal contract for exercising the executed-evidence gate.",
    behaviors: [{
      id: behaviorId,
      title: "Fixture behavior",
      trigger: "The gate is exercised.",
      expected: "Evidence is executed, not asserted.",
      verify: "Run the registered harness.",
      ...(options.advisory ? { advisory: true } : {}),
      ...(options.harnessRef ? { harness_ref: options.harnessRef } : {}),
    }],
  };
  const path = join(workspace.dir, `${options.issueId}.json`);
  writeFileSync(path, JSON.stringify(contract));
  await cliOk(["import", path], { db: workspace.db });
  return behaviorId;
}

/**
 * Register a throwaway harness entry pointing at a target of our choosing, so a
 * harness can be made to pass or fail on demand without editing the real
 * registry. Writes a scratch registry into the workspace and returns its path.
 */
export function scratchRegistry(workspace: Workspace, entries: Array<Record<string, unknown>>): string {
  const path = join(workspace.dir, "harnesses.json");
  writeFileSync(path, JSON.stringify({ harnesses: entries }, null, 2));
  return path;
}

/** The real repository registry, for tests that assert against shipped entries. */
export function realRegistry(): { harnesses: Array<Record<string, unknown>> } {
  return JSON.parse(readFileSync(join(ROOT, "harnesses.json"), "utf8"));
}
