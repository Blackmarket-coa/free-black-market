/**
 * instrument.spec.ts — verify the instrument before trusting greens.
 *
 * This is a HARNESS self-test, not a persona: it drives no browser and hits no
 * stack. It asserts the harness's own oracle/verdict/guard logic against
 * golden expectations, so a green agents run is only trusted once this passes.
 * Runs standalone with `pnpm agents:instrument` (no docker stack required).
 */

import { expect, test } from "@playwright/test"
import { runInstrumentCheck } from "./lib/instrument-check"

test("harness instrument-check passes all golden expectations", () => {
  const report = runInstrumentCheck()
  const failures = report.checks.filter((c) => !c.ok)
  // Surface every failing check name so a red is self-explaining.
  expect(failures.map((f) => `${f.name} — ${f.detail}`)).toEqual([])
  expect(report.ok).toBe(true)
})
