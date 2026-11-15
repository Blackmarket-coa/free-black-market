// The real createStep only runs inside a workflow composer, so stub the SDK
// to expose the step's compensate handler for direct unit testing.
jest.mock("@medusajs/framework/workflows-sdk", () => ({
  createStep: (_name: unknown, invokeFn: unknown, compensateFn: unknown) =>
    Object.assign(jest.fn(), { invokeFn, compensateFn }),
  StepResponse: class StepResponse {
    constructor(
      public output: unknown,
      public compensateInput?: unknown
    ) {}
  },
}))

jest.mock("@medusajs/medusa/core-flows", () => ({
  cancelOrderWorkflow: jest.fn(),
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { validateRentalStep } from "../validate-rental"
import { SharedPaymentCancelRefusedError } from "../../../../lib/shared-payment-cancel"

/**
 * validate-rental's compensation cancels the order a rental checkout created
 * (SD-36 (8)): it now refuses when the order's payment collection is shared
 * with another order, and it awaits the cancel instead of firing it and
 * forgetting it.
 */

const { compensateFn: compensate } = validateRentalStep as unknown as {
  compensateFn: (orderId: string | undefined, ctx: unknown) => Promise<void>
}

const containerWithCollection = (others: string[] = []) => {
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters: Record<string, unknown> }) => {
    if (entity === "order_payment_collection" && filters.order_id) {
      return { data: [{ order_id: filters.order_id, payment_collection_id: "pay_col_1" }] }
    }
    if (entity === "order_payment_collection") {
      return {
        data: ["order_1", ...others].map((order_id) => ({ order_id, payment_collection_id: "pay_col_1" })),
      }
    }
    return { data: [] }
  })
  return {
    graph,
    container: {
      resolve: jest.fn((key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`unexpected resolve(${key})`)
      }),
    },
  }
}

describe("validateRentalStep compensation", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("cancels the created order when its payment collection is its own, and waits for the cancel", async () => {
    let finished = false
    const run = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      finished = true
    })
    ;(cancelOrderWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const { container } = containerWithCollection()
    const context = { transactionId: "tx_1" }

    await compensate("order_1", { container, context })

    expect(run).toHaveBeenCalledWith({ input: { order_id: "order_1" }, context, container })
    expect(finished).toBe(true)
  })

  it("propagates a failed cancel instead of leaving an unhandled rejection", async () => {
    const run = jest.fn().mockRejectedValue(new Error("cancel failed"))
    ;(cancelOrderWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const { container } = containerWithCollection()

    await expect(compensate("order_1", { container, context: {} })).rejects.toThrow("cancel failed")
  })

  it("refuses, and does not cancel, when another order shares the payment collection", async () => {
    const run = jest.fn()
    ;(cancelOrderWorkflow as unknown as jest.Mock).mockReturnValue({ run })
    const { container } = containerWithCollection(["order_2"])

    const err = await compensate("order_1", { container, context: {} }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SharedPaymentCancelRefusedError)
    expect(cancelOrderWorkflow).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it("no-ops when no order id was recorded", async () => {
    await compensate(undefined, { container: { resolve: jest.fn() }, context: {} })
    expect(cancelOrderWorkflow).not.toHaveBeenCalled()
  })
})
