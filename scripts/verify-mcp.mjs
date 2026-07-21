import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "loopbreaker-mcp-"));
const db = join(temp, "verify.db");
const cli = join(root, "dist", "cli.js");

execFileSync(process.execPath, [cli, "demo", "--db", db], { cwd: root, stdio: "ignore" });

const client = new Client({ name: "loopbreaker-verifier", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, "mcp", "--db", db],
  cwd: root,
  stderr: "ignore",
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const required = ["review_list_issues", "review_substrate", "review_ship_status"];
  for (const name of required) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing MCP tool: ${name}`);
  }
  const result = await client.callTool({ name: "review_ship_status", arguments: { issue_id: "DEMO-1" } });
  const text = result.content.find((item) => item.type === "text")?.text ?? "";
  if (!text.includes("disposition: hold") || !text.includes("automatic_pass_four: false")) {
    throw new Error("MCP ship status did not preserve bounded-review and hold state.");
  }
  process.stdout.write(`MCP verified: ${tools.tools.length} tools; DEMO-1 is held with no pass 4.\n`);
} finally {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
}
