/**
 * scenarios/index.ts — the stress scenario registry + the combined flagship stub.
 *
 * Collects the check-then-write race scenarios and provides:
 *   • `stressScenarios`            — the registry (drives the gated spec loop).
 *   • `runAllStressScenarios`      — run every scenario through the gate.
 *   • `runCombinedSurfaceXStress`  — the FLAGSHIP runner STUB: a Bargain
 *     Hunter completing a REAL DOM checkout WHILE the swarm floods the same last
 *     unit, then asserting the UI stayed correct AND no invariant broke.
 *
 * All of it is GATED-ON-BUG-01 (see `stressGate()`); the runners return honest
 * skips until the gate opens, and never emit a false green.
 */

import {
  runScenario,
  type ScenarioDef,
  type ScenarioDeps,
  type ScenarioOutcome,
  type StressGate,
  type Swarm,
} from "../swarm"
import type { Oracle } from "../../lib/oracle"
import type { AgentHandles } from "../../lib/persona"
import type { TestInfo } from "@playwright/test"
import { couponDoubleRedeem, oversellLastUnit, paymentReplayIdempotency } from "./oversell"

export * from "./oversell"

/** Every check-then-write race scenario, in run order. */
export const stressScenarios: ScenarioDef[] = [
  oversellLastUnit,
  couponDoubleRedeem,
  paymentReplayIdempotency,
]

/** Run every registered scenario through the gate. Leads only — files nothing. */
export async function runAllStressScenarios(deps: ScenarioDeps): Promise<ScenarioOutcome[]> {
  const out: ScenarioOutcome[] = []
  for (const def of stressScenarios) {
    out.push(await runScenario(def, deps))
  }
  return out
}

// -------------------------------------------------------------------------
// The combined surface×stress flagship — GATED-ON-BUG-01 runner STUB.
// -------------------------------------------------------------------------

export interface CombinedDeps {
  /** The DOM-only persona handles ({ page, browser }) — the Surfaces side. */
  agent: AgentHandles
  /** The load engine — floods the same last unit over the API. */
  swarm: Swarm
  oracle: Oracle
  gate: StressGate
  testInfo?: TestInfo
}

/**
 * The flagship: drive ONE real user's Bargain-Hunter journey through the browser
 * (DOM-only, `agent.page`) WHILE the swarm floods the backend for the SAME last
 * in-stock unit, then assert the UI stayed correct AND `no-oversell` held under
 * load. This is the demo the whole Stress layer builds toward.
 *
 * GATED-ON-BUG-01 + inventory-pinned. Today this is a STUB: it reuses the
 * `oversell-last-unit` scenario for the swarm side via `runScenario`, which
 * HONESTLY SKIPS while gated/unwired. When the gate opens AND the oversell
 * `task` is wired, ALSO drive the Bargain Hunter DOM persona on `agent.page`
 * concurrently (Promise.all), fold its verdict-doc divergences into
 * `outcome.findings`, and assert the buyer either got the unit or saw an honest
 * out-of-stock — never a UI success for an oversold unit. Until then the DOM
 * side is intentionally NOT driven (no-silent-caps).
 */
export async function runCombinedSurfaceXStress(deps: CombinedDeps): Promise<ScenarioOutcome> {
  const { agent, swarm, oracle, gate, testInfo } = deps

  // Reuse the gated oversell scenario for the swarm/flood + oracle accounting.
  // While gated or unwired this returns a skip with a GATED/NOT-WIRED caveat.
  const outcome = await runScenario(oversellLastUnit, { swarm, oracle, gate })

  // WIRING POINT: when `gate.open` AND oversellLastUnit.task is wired, run the
  // Bargain Hunter DOM checkout on `agent.page` concurrently with the flood and
  // reconcile the buyer's UI result against `outcome` here. `agent`/`testInfo`
  // are threaded through for that future concurrent DOM drive.
  void agent
  void testInfo

  return {
    ...outcome,
    scenario: "combined-surface-x-stress",
    report: { ...outcome.report, scenario: "combined-surface-x-stress" },
  }
}
