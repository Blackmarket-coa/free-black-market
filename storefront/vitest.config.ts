import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist", "storybook-static", "qa", ".storybook"],
    passWithNoTests: false,
    globals: true,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // Scope coverage gating to the pure helper layer that unit tests target.
      // The network-bound `src/lib/data/**` modules require mocked-fetch
      // integration suites to cover meaningfully; that remains tracked as TC-1
      // in docs/AUDIT_DEBT.md.
      include: ["src/lib/helpers/**"],
      thresholds: {
        lines: 30,
        functions: 30,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
