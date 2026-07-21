import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const expectedSkills = ["shape-strategy", "plan-feature", "implement-feature", "review-invariants"];
const manifest = JSON.parse(readFileSync(resolve(root, ".codex-plugin/plugin.json"), "utf8"));
const mcp = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));
const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

if (manifest.name !== "loopbreaker" || manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json") {
  throw new Error("Plugin manifest does not register Loopbreaker skills and MCP.");
}
if (manifest.version !== packageManifest.version) throw new Error("Plugin and package versions must match.");
if (mcp.mcpServers?.loopbreaker?.args?.[0] !== "./mcp/server.bundle.mjs") {
  throw new Error("Plugin MCP config does not target the bundled server.");
}
if (!existsSync(resolve(root, "mcp/server.bundle.mjs"))) throw new Error("Bundled MCP server is missing.");

for (const name of expectedSkills) {
  const skill = readFileSync(resolve(root, "skills", name, "SKILL.md"), "utf8");
  const metadata = readFileSync(resolve(root, "skills", name, "agents/openai.yaml"), "utf8");
  if (!skill.startsWith(`---\nname: ${name}\ndescription:`)) throw new Error(`${name} has invalid frontmatter.`);
  if (/\bTODO\b|\[TODO:/i.test(skill)) throw new Error(`${name} contains a placeholder.`);
  if (!metadata.includes(`$${name}`)) throw new Error(`${name} metadata does not name the skill in its default prompt.`);
}

process.stdout.write(`Plugin verified: ${expectedSkills.length} skills and bundled Loopbreaker MCP.\n`);
