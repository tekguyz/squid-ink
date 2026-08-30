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
    exclude: ["**/node_modules/**", "**/.next/**", "**/.worktrees/**"],
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
});
