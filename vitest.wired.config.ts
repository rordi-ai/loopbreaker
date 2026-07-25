import { defineConfig } from "vitest/config";

/**
 * The wired-harness suite. Every test here drives a real ingress — a spawned
 * CLI process, a real MCP stdio client, or the HTTP server — never an
 * in-process domain import. These are the executable form of the behaviors'
 * `verify` clauses.
 *
 * Requires a current build: the harnesses spawn `dist/cli.js` and
 * `mcp/server.bundle.mjs`. Run `pnpm build` first.
 */
export default defineConfig({
  test: {
    include: ["test/wired/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each harness owns a disposable database, but they spawn processes and
    // bind ports; serialize to keep failures attributable.
    fileParallelism: false,
  },
});
