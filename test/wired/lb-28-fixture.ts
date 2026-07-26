/**
 * Fixtures for the LB-28 discovery gate.
 *
 * A discovery record holds one answer per required shape field, each carrying
 * the question that produced it. Per-field rather than a transcript blob, so
 * LB-25's field-isomorphic binding becomes a later increment on the same data
 * instead of a rewrite.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliOk, ROOT, type Workspace } from "./harness.js";
import { readFileSync } from "node:fs";

/** The shape fields a discovery record must answer for the gate to open. */
export const REQUIRED_FIELDS = [
  "problem",
  "appetite",
  "smallest_slice",
  "non_goals",
  "success_signal",
  "reversibility",
  "decision_owner",
  "risks",
] as const;

export function discoveryDoc(fields: readonly string[] = REQUIRED_FIELDS): { answers: Array<{ field: string; question: string; answer: string }> } {
  return {
    answers: fields.map((field) => ({
      field,
      question: `What is the ${field.replaceAll("_", " ")}?`,
      answer: `A founder-supplied answer for ${field}.`,
    })),
  };
}

/** Import a one-behavior issue and record a complete shape marked `proceed`. */
export async function importAndShape(workspace: Workspace, issueId: string): Promise<void> {
  const contract = {
    issue_id: issueId,
    title: `${issueId} discovery-gate fixture`,
    description: "Minimal contract for exercising the discovery gate.",
    behaviors: [{ id: `${issueId}-B1`, title: "Fixture", trigger: "t", expected: "e", verify: "v" }],
  };
  const contractPath = join(workspace.dir, `${issueId}-contract.json`);
  writeFileSync(contractPath, JSON.stringify(contract));
  await cliOk(["import", contractPath], { db: workspace.db });

  const shape = JSON.parse(readFileSync(join(ROOT, "examples", "lifecycle-hooks-shape.json"), "utf8"));
  const shapePath = join(workspace.dir, `${issueId}-shape.json`);
  writeFileSync(shapePath, JSON.stringify(shape));
  await cliOk(["shape", issueId, shapePath], { db: workspace.db });
}

/** Write a discovery document to disk and return its path. */
export function writeDiscovery(workspace: Workspace, issueId: string, fields?: readonly string[]): string {
  const path = join(workspace.dir, `${issueId}-discovery.json`);
  writeFileSync(path, JSON.stringify(discoveryDoc(fields)));
  return path;
}
