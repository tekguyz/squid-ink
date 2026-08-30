import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    // Nested node_modules (worktrees, sub-packages) ship their own type-stub
    // "tests"; a bare "node_modules/**" only matches the top level.
    //
    // Both worktree locations are excluded. `.worktrees/` is the manual
    // `git worktree add` convention; `.claude/worktrees/` is where the
    // harness puts them. A worktree holds a full second copy of the suite,
    // and its files resolve `@/` against THIS root, so a branch that adds a
    // module fails to resolve here and reds the suite from outside.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
    ],
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
});
