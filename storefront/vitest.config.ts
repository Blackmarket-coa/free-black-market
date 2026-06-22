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
      // TC-1: gate both the pure helper layer and the (mocked-fetch tested)
      // data-access layer at >=30%. Per-glob thresholds keep each layer
      // independently honest rather than letting one mask the other.
      include: ["src/lib/helpers/**", "src/lib/data/**"],
      thresholds: {
        "src/lib/helpers/**": {
          lines: 30,
          functions: 30,
        },
        "src/lib/data/**": {
          lines: 30,
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
})
