import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "loopbreaker-mcp-"));
const db = join(temp, "verify.db");
const cli = join(root, "dist", "cli.js");
const pluginServer = join(root, "mcp", "server.bundle.mjs");

execFileSync(process.execPath, [cli, "demo", "--db", db], { cwd: root, stdio: "ignore" });

const client = new Client({ name: "loopbreaker-verifier", version: "0.4.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [pluginServer],
  cwd: root,
  env: { ...getDefaultEnvironment(), LOOPBREAKER_DB: db },
  stderr: "ignore",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const required = ["shape_record", "planning_record", "planning_health", "delivery_readiness", "planning_review_upsert_finding", "planning_review_record_pass", "review_list_issues", "review_substrate", "review_upsert_finding", "review_ship_status"];
  for (const name of required) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing MCP tool: ${name}`);
  }
  await client.callTool({
    name: "review_import_contract",
    arguments: {
      issue_id: "MCP-PLAN",
      title: "Evaluate one partial plan",
      description: "MCP planning verification fixture.",
      behaviors: [{ id: "MCP-PLAN-B1", title: "Expose health", trigger: "A plan is read.", expected: "Health is returned.", verify: "Call the MCP health tool." }],
    },
  });
  const recordedPlan = await client.callTool({ name: "planning_record", arguments: { issue_id: "MCP-PLAN", planning: { outcome: "Expose deterministic health." } } });
  const recordedText = recordedPlan.content.find((item) => item.type === "text")?.text ?? "";
  if (!recordedText.includes("ready: false") || !recordedText.includes("missing_proof")) throw new Error("MCP planning_record did not return actionable incomplete health.");
  const healthResult = await client.callTool({ name: "planning_health", arguments: { issue_id: "MCP-PLAN" } });
  const healthText = healthResult.content.find((item) => item.type === "text")?.text ?? "";
  if (!healthText.includes("score:") || !healthText.includes("dimensions[5]")) throw new Error("MCP planning_health did not return five scored dimensions.");
  const shape = await client.callTool({ name: "shape_record", arguments: { issue_id: "MCP-PLAN", shape: {
    problem: "Agents need exact readiness.", appetite: "One fixture.", smallest_slice: "Expose the ordered gate.",
    non_goals: ["Implementation"], success_signal: "The active gate is exact.", reversibility: "Delete the fixture.",
    decision_owner: "Verifier", risks: [], disposition: "proceed",
  } } });
  const shapeText = shape.content.find((item) => item.type === "text")?.text ?? "";
  if (!shapeText.includes("ready: true") || !shapeText.includes("disposition: proceed")) throw new Error("MCP shape_record did not persist proceed readiness.");
  const readiness = await client.callTool({ name: "delivery_readiness", arguments: { issue_id: "MCP-PLAN" } });
  const readinessText = readiness.content.find((item) => item.type === "text")?.text ?? "";
  if (!readinessText.includes("gate: planning") || !readinessText.includes("admitted: false")) throw new Error("MCP readiness did not expose the ordered planning gate.");
  const finding = await client.callTool({
    name: "review_upsert_finding",
    arguments: {
      issue_id: "DEMO-1",
      finding_id: "VERIFY-F1",
      behavior_id: "DEMO-B3",
      review_pass_number: 1,
      severity: "P2",
      status: "open",
      title: "Wired proof is still absent",
    },
  });
  const findingText = finding.content.find((item) => item.type === "text")?.text ?? "";
  if (!findingText.includes("VERIFY-F1")) throw new Error("MCP finding mutation did not preserve the stable finding ID.");
  const result = await client.callTool({ name: "review_ship_status", arguments: { issue_id: "DEMO-1" } });
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  if (!text.includes("disposition: hold") || !text.includes("automatic_pass_four: false")) {
    throw new Error("MCP ship status did not preserve bounded-review and hold state.");
  }
  process.stdout.write(`MCP verified: ${tools.tools.length} tools; shape is explicit; partial planning is blocked; DEMO-1 is planning-approved and verification-held with no pass 4.\n`);
} finally {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
}
