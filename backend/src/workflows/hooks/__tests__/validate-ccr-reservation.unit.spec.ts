import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { CompleteCartWorkflowInput } from "@medusajs/medusa/core-flows"

import { validateCcrReservation } from "../validate-ccr-reservation"
import { CCR_RESERVATION_METADATA_KEY } from "../../../lib/ccr-checkout"

/**
 * The Coalition Credits reservation guard on `completeCartWorkflow`'s
 * validate hook (Posture A: credits move only in a purchase context, and the
 * tender half that would let a reserved credit reduce the charge is not
 * built, so a cart holding a reservation must not complete).
 *
 * SD-54: the guard read `input.cart_id`, which Medusa 2.14.2 never passes —
 * it calls the hook with `{ input: { id }, cart }` (`@medusajs/core-flows`
 * `cart/workflows/complete-cart.js`) — so it returned before reading the cart
 * at every checkout, and it had no test. `ARGS` is typed with Medusa's own
 * `CompleteCartWorkflowInput`, so a fixture in any other shape does not
 * compile. `integration-tests/http/complete-cart-validate-guards.spec.ts`
 * runs the guard through the real workflow and a real store route.
 */

/**
 * The argument Medusa passes the hook: `{ input, cart }`, `input` being the
 * workflow's own input, typed with Medusa's own `CompleteCartWorkflowInput`
 * (`{ id }`). (The hook's declared handler type wraps `input` in the
 * composition-time `WorkflowData` proxy, which a plain object cannot satisfy;
 * at run time it is the plain input.)
 */
type MedusaValidateArgs = { input: CompleteCartWorkflowInput; cart: unknown }

const ARGS: MedusaValidateArgs = { input: { id: "cart_1" }, cart: { id: "cart_1" } }

const graphCalls: Array<{ entity: string; fields: string[]; filters: Record<string, unknown> }> = []
beforeEach(() => {
  graphCalls.length = 0
})

/** A container whose query answers for `cart_1` only, with `metadata`; `throws` makes the read fail. */
const ctxWith = (metadata: Record<string, unknown> | null | undefined, opts: { throws?: boolean } = {}) => ({
  container: {
    resolve: (key: string) => {
      if (key !== ContainerRegistrationKeys.QUERY) throw new Error(`unresolvable: ${key}`)
      return {
        graph: async (q: { entity: string; fields: string[]; filters: Record<string, unknown> }) => {
          graphCalls.push(q)
          if (opts.throws) throw new Error("database unavailable")
          return { data: q.filters?.id === "cart_1" ? [{ id: "cart_1", metadata }] : [] }
        },
      }
    },
  },
})

describe("validateCcrReservation", () => {
  it("refuses a cart holding a reservation, read by the id Medusa passes in input.id", async () => {
    const run = validateCcrReservation(ARGS, ctxWith({ [CCR_RESERVATION_METADATA_KEY]: 3 }))
    await expect(run).rejects.toBeInstanceOf(MedusaError)
    await expect(run).rejects.toMatchObject({ type: MedusaError.Types.NOT_ALLOWED })
    await expect(run).rejects.toThrow(
      /3 Coalition Credits reserved, and credit tender is not yet wired into payment/
    )
    await expect(run).rejects.toThrow("DELETE /store/carts/cart_1/credits")
    expect(graphCalls).toEqual([{ entity: "cart", fields: ["id", "metadata"], filters: { id: "cart_1" } }])
  })

  it("refuses a reservation stored as a numeric string", async () => {
    await expect(
      validateCcrReservation(ARGS, ctxWith({ [CCR_RESERVATION_METADATA_KEY]: "2" }))
    ).rejects.toThrow(/2 Coalition Credits reserved/)
  })

  it.each([
    ["no metadata", null],
    ["metadata without the key", { tier: "standard" }],
    ["a released reservation (0)", { [CCR_RESERVATION_METADATA_KEY]: 0 }],
    ["a negative count", { [CCR_RESERVATION_METADATA_KEY]: -4 }],
    ["a non-numeric value", { [CCR_RESERVATION_METADATA_KEY]: "lots" }],
  ])("lets a cart with %s complete", async (_label, metadata) => {
    await expect(validateCcrReservation(ARGS, ctxWith(metadata))).resolves.toBeUndefined()
    expect(graphCalls).toHaveLength(1)
  })

  it("lets the completion go on when the cart cannot be read (documented: the other validators read the same cart first)", async () => {
    await expect(
      validateCcrReservation(ARGS, ctxWith({ [CCR_RESERVATION_METADATA_KEY]: 3 }, { throws: true }))
    ).resolves.toBeUndefined()
  })

  it("does nothing without a cart id or a container", async () => {
    await expect(validateCcrReservation({ input: {} }, ctxWith({ [CCR_RESERVATION_METADATA_KEY]: 3 }))).resolves.toBeUndefined()
    await expect(validateCcrReservation(ARGS, {})).resolves.toBeUndefined()
    expect(graphCalls).toEqual([])
  })
})
