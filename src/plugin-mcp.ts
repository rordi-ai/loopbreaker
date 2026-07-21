import { runMcp } from "./mcp.js";

runMcp().catch((error) => {
  process.stderr.write(`loopbreaker MCP failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
