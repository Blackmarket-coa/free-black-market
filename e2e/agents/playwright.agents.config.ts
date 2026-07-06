import { defineConfig, devices } from "@playwright/test"

/**
 * playwright.agents.config.ts — DEDICATED, STANDALONE config for the e2e agent
 * personas. This is the ONLY way the agents run; it is NEVER auto-discovered.
 *
 * Why a separate config (not a `--project=agents` gate on the maintainers'
 * playwright.config.ts): Playwright spawns WORKER processes that re-load the
 * config but do NOT inherit the launcher's `process.argv`, so a config that adds
 * the `agents` project only when it sees `--project=agents` in argv builds that
 * project in the launcher yet OMITS it in every worker — the run dies with
 * "Project 'agents' not found in the worker process". Here the agents run is the
 * config's DEFAULT (and only) project, so every worker re-loads the same project
 * and that failure mode cannot occur.
 *
 * Footprint on the maintainers: ZERO. Their e2e/playwright.config.ts is untouched
 * and byte-identical to HEAD; a bare `npx playwright test` (their CI gate) loads
 * that pristine config, which has `testDir: "./tests"` and never sees this dir.
 * The agents run is opt-in only via the `test:agents*` npm scripts, which pass
 * `--config=agents/playwright.agents.config.ts` explicitly.
 *
 * Run it:  pnpm test:agents         (personas + instrument + stress engine-smoke)
 *          pnpm test:agents:stress  (the stress subtree; live scenarios stay
 *                                    test.skip-gated behind STRESS_BUG01_CLEARED)
 */
export default defineConfig({
  // This dir: personas/*.spec.ts + instrument.spec.ts + stress/*.spec.ts.
  testDir: __dirname,

  // Per-test cap (FIX B): a persona on a broken stack must log its leads and STOP
  // fast, never grind to a hard timeout. 90s is the ceiling; every persona is
  // engineered to finish well under it (target < 60s) via the tightened
  // action/navigation/expect timeouts below + the base-loop stuck/step caps.
  timeout: 90_000,
  expect: { timeout: 5_000 },

  // Cross-surface personas (vendor↔storefront) and phase machines are inherently
  // sequential; run one at a time so leads/artifacts stay legible and the stack
  // isn't hammered by parallel journeys.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  // Its OWN report tree, separate from the maintainers' playwright-report so the
  // two runs never collide.
  reporter: [
    ["list"],
    ["html", { outputFolder: "../playwright-report-agents", open: "never" }],
  ],

  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.STOREFRONT_URL || "http://localhost:3000",
    // FIX B — bounded per-op timeouts so an ABSENT element/hung nav fast-fails
    // (throws in a few seconds, caught by the persona) instead of blocking on
    // Playwright's default of 0 (= no timeout, wait the whole 90s test budget).
    // These are what turn a broken-stack persona from a 180s grind into a run
    // that terminates in seconds and reports funnel-blocked leads.
    actionTimeout: 8_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
})
