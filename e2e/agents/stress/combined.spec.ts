/**
 * combined.spec.ts — the FLAGSHIP: surface × stress, GATED-ON-BUG-01.
 *
 * The harness's signature payoff: drive ONE real user's Bargain-Hunter journey
 * through the browser (DOM-only) WHILE the swarm floods the backend for the SAME
 * last in-stock unit, then assert the UI stayed correct AND `no-oversell` held.
 *
 * This spec imports the DOM-ONLY `test`/`agent` fixture from `../lib/persona`, so
 * the buyer side is API-blind (it may use only `page`/`browser`). The swarm — the
 * load engine — builds its OWN loopback API context internally; that separation
 * is the doctrine (the persona can't cheat; the swarm is the flood).
 *
 * GATED-ON-BUG-01. The `test.skip` is a DESCRIBE-level modifier, so while gated
 * the browser fixture never even launches — nothing runs against the broken
 * checkout. Open with STRESS_BUG01_CLEARED=1 + STRESS_INVENTORY_PINNED=<n>.
 */

import { expect, test } from "../lib/persona"
import { Oracle } from "../lib/oracle"
import { Swarm, stressGate } from "./swarm"
import { runCombinedSurfaceXStress } from "./scenarios"

test.describe("combined surface×stress flagship", () => {
  const gate = stressGate()
  test.skip(
    !gate.open,
    "GATED-ON-BUG-01: the combined DOM-checkout-WHILE-swarm-floods flagship does not run until " +
      "cart-creation works AND inventory is pinned. Not run — no-silent-caps."
  )

  test("Bargain-Hunter DOM checkout WHILE swarm floods the last unit → no oversell", async ({
    agent,
  }, testInfo) => {
    const swarm = await Swarm.create()
    try {
      const outcome = await runCombinedSurfaceXStress({
        agent,
        swarm,
        oracle: new Oracle(),
        gate,
        testInfo,
      })
      testInfo.annotations.push({
        type: "stress",
        description: `combined ran=${outcome.ran} broken=[${outcome.report.invariantsBroken.join(",")}]`,
      })
      // Once wired: the UI stayed correct AND no invariant broke under the flood.
      expect(outcome.report.invariantsBroken).toEqual([])
    } finally {
      await swarm.dispose()
    }
  })
})
