import { defineConfig } from "vitest/config";

/**
 * The default suite: in-process domain tests. `test/wired/` is excluded because
 * those are wired harnesses that drive real CLI/MCP/HTTP ingresses and are
 * deliberately RED until the behavior they prove is implemented. A pending
 * contract is not a regression, so it must not break `pnpm verify`.
 * Run them with `pnpm test:wired`.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "test/wired/**"],
  },
});
