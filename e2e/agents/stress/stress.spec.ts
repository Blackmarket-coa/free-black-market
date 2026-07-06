/**
 * stress.spec.ts — Tier-2 STRESS layer spec.
 *
 * Two halves:
 *   A. ENGINE SMOKE (no stack, no browser) — "verify the instrument" for
 *      the swarm: determinism under a fixed seed, resource caps + no-silent-caps
 *      caveats, the BUG-01 gate logic, and the honest-skip / no-false-green
 *      contract. These are pure and run everywhere, like instrument.spec.ts.
 *   B. GATED SCENARIOS — the check-then-write race scenarios. CLOSED BY
 *      DEFAULT: `test.skip` fires unless STRESS_BUG01_CLEARED=1 AND
 *      STRESS_INVENTORY_PINNED=<n>. They are the wiring point once BUG-01 clears.
 *
 * This spec legitimately uses the LOAD ENGINE (which may use the API request
 * context) — NOT the DOM-only persona fixture. The engine smoke never opens a
 * network connection (the swarm's API context is lazy), so it needs no stack.
 */

import { expect, test } from "@playwright/test"
import { Oracle } from "../lib/oracle"
import {
  Swarm,
  SWARM_CAPS,
  resolveSwarmConfig,
  runScenario,
  stressGate,
  type StressGate,
} from "./swarm"
import { oversellLastUnit, stressScenarios } from "./scenarios"

// ---- A. Engine smoke (pure; no docker stack, no browser) ----

test.describe("swarm engine — verify the instrument", () => {
  test("is deterministic across runs under a fixed seed", async () => {
    const runOnce = async (): Promise<string[]> => {
      const swarm = await Swarm.create({ seed: 4242, actors: 8, concurrency: 4, durationMs: 10_000 })
      const result = await swarm.run("smoke", async (ctx) => ({
        ok: true,
        label: "rng",
        value: Math.floor(ctx.rng() * 1e9),
      }))
      await swarm.dispose()
      // Sort by actorId so the (intentionally racy) completion order can't matter.
      return result.outcomes
        .slice()
        .sort((a, b) => a.actorId - b.actorId)
        .map((o) => `${o.actorId}:${o.value}`)
    }
    const a = await runOnce()
    const b = await runOnce()
    expect(a).toHaveLength(8)
    expect(a).toEqual(b)
  })

  test("clamps to resource caps and records no-silent-caps caveats", () => {
    const cfg = resolveSwarmConfig({ actors: 99_999, concurrency: 9_999, durationMs: 999_999_999 })
    expect(cfg.actors).toBe(SWARM_CAPS.maxActors)
    expect(cfg.concurrency).toBe(SWARM_CAPS.maxConcurrency)
    expect(cfg.durationMs).toBe(SWARM_CAPS.maxDurationMs)
    expect(cfg.caveats.length).toBeGreaterThanOrEqual(3)
    expect(cfg.caveats.join(" ")).toMatch(/capped/i)
  })

  test("BUG-01 gate opens ONLY when cleared AND inventory pinned", () => {
    const saved = {
      c: process.env.STRESS_BUG01_CLEARED,
      p: process.env.STRESS_INVENTORY_PINNED,
    }
    const restore = (k: "STRESS_BUG01_CLEARED" | "STRESS_INVENTORY_PINNED", v?: string) => {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      restore("STRESS_BUG01_CLEARED")
      restore("STRESS_INVENTORY_PINNED")
      expect(stressGate().open).toBe(false) // default: closed

      process.env.STRESS_BUG01_CLEARED = "1"
      expect(stressGate().open).toBe(false) // cleared but not pinned → still closed

      process.env.STRESS_INVENTORY_PINNED = "1"
      const open = stressGate()
      expect(open.open).toBe(true)
      expect(open.inventoryPinned).toBe(1)
    } finally {
      restore("STRESS_BUG01_CLEARED", saved.c)
      restore("STRESS_INVENTORY_PINNED", saved.p)
    }
  })

  test("GATED scenarios skip with a GATED-ON-BUG-01 caveat and NO false green", async () => {
    const closed: StressGate = { open: false, reason: "test-forced closed", inventoryPinned: null }
    const swarm = await Swarm.create({ actors: 4, concurrency: 2 })
    const oracle = new Oracle()
    try {
      for (const def of stressScenarios) {
        const o = await runScenario(def, { swarm, oracle, gate: closed })
        expect(o.ran).toBe(false)
        expect(o.findings).toEqual([])
        expect(o.report.invariantsBroken).toEqual([])
        expect(o.report.invariantsHeld).toEqual([]) // nothing exercised ⇒ nothing "held"
        expect(o.report.caveats.join(" ")).toMatch(/GATED-ON-BUG-01/)
      }
    } finally {
      await swarm.dispose()
    }
  })

  test("an OPEN gate with an UNWIRED task still refuses a false green", async () => {
    const open: StressGate = { open: true, reason: "test-forced open", inventoryPinned: 1 }
    const swarm = await Swarm.create({ actors: 4, concurrency: 2 })
    try {
      const o = await runScenario(oversellLastUnit, { swarm, oracle: new Oracle(), gate: open })
      expect(o.ran).toBe(false)
      expect(o.report.invariantsHeld).toEqual([])
      expect(o.report.caveats.join(" ")).toMatch(/NOT YET WIRED/i)
    } finally {
      await swarm.dispose()
    }
  })
})

// ---- B. Gated live scenarios (run ONLY once BUG-01 clears + inventory pinned) ----

test.describe("gated stress scenarios — live check-then-write races", () => {
  const gate = stressGate()
  test.skip(
    !gate.open,
    "GATED-ON-BUG-01: cart-creation 500 must be fixed and inventory pinned " +
      "(set STRESS_BUG01_CLEARED=1 + STRESS_INVENTORY_PINNED=<n>). Not run — no-silent-caps."
  )

  for (const def of stressScenarios) {
    test(`${def.name} → ${def.invariant}`, async () => {
      const swarm = await Swarm.create()
      try {
        const outcome = await runScenario(def, { swarm, oracle: new Oracle(), gate })
        // Leads only — assert the invariant did not break once the task is wired.
        expect(outcome.report.invariantsBroken).toEqual([])
      } finally {
        await swarm.dispose()
      }
    })
  }
})
