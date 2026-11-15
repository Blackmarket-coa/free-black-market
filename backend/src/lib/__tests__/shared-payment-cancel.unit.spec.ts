import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  assertCancelLeavesSharedPaymentAlone,
  findOrdersSharingPayment,
  SHARED_PAYMENT_CANCEL_REFUSED,
  SharedPaymentCancelRefusedError,
  sharedPaymentCancelMessage,
} from "../shared-payment-cancel"

/**
 * SD-36 (8): which payment collections Medusa's cancel of an order would
 * also take from other orders. The real-database proof, through the admin
 * route, is integration-tests/http/admin-order-cancel-shared-payment.spec.ts;
 * this pins the reading rules against a Query stand-in that answers only the
 * three reads the guard makes, resolved under the framework's QUERY key.
 */

type Link = { order_id: string; payment_collection_id: string }
type Split = { id: string; payment_collection_id: string; order: { id: string } | null }

function world(links: Link[], splits: Split[] = []) {
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters: Record<string, unknown> }) => {
    const inList = (v: string, f: unknown) => (Array.isArray(f) ? f.includes(v) : f === v)
    if (entity === "order_payment_collection" && "order_id" in filters) {
      return { data: links.filter((l) => inList(l.order_id, filters.order_id)) }
    }
    if (entity === "order_payment_collection" && "payment_collection_id" in filters) {
      return { data: links.filter((l) => inList(l.payment_collection_id, filters.payment_collection_id)) }
    }
    if (entity === "split_order_payment") {
      return { data: splits.filter((s) => inList(s.payment_collection_id, filters.payment_collection_id)) }
    }
    throw new Error(`unexpected read: ${entity}`)
  })
  const container = {
    resolve: (key: string) => {
      if (key !== ContainerRegistrationKeys.QUERY) throw new Error(`unexpected resolve(${key})`)
      return { graph }
    },
  }
  return { container, graph }
}

describe("findOrdersSharingPayment", () => {
  it("is empty for an order whose collection is its own (a single-seller cart)", async () => {
    const { container } = world(
      [{ order_id: "order_1", payment_collection_id: "pc_1" }],
      [{ id: "sp_1", payment_collection_id: "pc_1", order: { id: "order_1" } }]
    )
    await expect(findOrdersSharingPayment(container, "order_1")).resolves.toEqual([])
  })

  it("is empty, after one read, for an order with no payment collection", async () => {
    const { container, graph } = world([])
    await expect(findOrdersSharingPayment(container, "order_1")).resolves.toEqual([])
    expect(graph).toHaveBeenCalledTimes(1)
  })

  it("names the other orders linked to the collection (a Mercur multi-seller cart)", async () => {
    const { container } = world([
      { order_id: "order_1", payment_collection_id: "pc_1" },
      { order_id: "order_3", payment_collection_id: "pc_1" },
      { order_id: "order_2", payment_collection_id: "pc_1" },
      { order_id: "order_9", payment_collection_id: "pc_other" },
    ])
    await expect(findOrdersSharingPayment(container, "order_1")).resolves.toEqual([
      { payment_collection_id: "pc_1", other_order_ids: ["order_2", "order_3"] },
    ])
  })

  it("counts another order that has a split row on the collection even without a link row", async () => {
    const { container } = world(
      [{ order_id: "order_1", payment_collection_id: "pc_1" }],
      [
        { id: "sp_1", payment_collection_id: "pc_1", order: { id: "order_1" } },
        { id: "sp_2", payment_collection_id: "pc_1", order: { id: "order_2" } },
        { id: "sp_3", payment_collection_id: "pc_1", order: null },
      ]
    )
    await expect(findOrdersSharingPayment(container, "order_1")).resolves.toEqual([
      { payment_collection_id: "pc_1", other_order_ids: ["order_2"] },
    ])
  })

  it("reports only the order's shared collections when it has several (an order edit's second collection)", async () => {
    const { container } = world([
      { order_id: "order_1", payment_collection_id: "pc_cart" },
      { order_id: "order_2", payment_collection_id: "pc_cart" },
      { order_id: "order_1", payment_collection_id: "pc_edit" },
    ])
    await expect(findOrdersSharingPayment(container, "order_1")).resolves.toEqual([
      { payment_collection_id: "pc_cart", other_order_ids: ["order_2"] },
    ])
  })
})

describe("assertCancelLeavesSharedPaymentAlone", () => {
  it("passes for an order whose collection is its own", async () => {
    const { container } = world([{ order_id: "order_1", payment_collection_id: "pc_1" }])
    await expect(assertCancelLeavesSharedPaymentAlone(container, "order_1")).resolves.toBeUndefined()
  })

  it("throws a NOT_ALLOWED refusal naming the shared collection and the other orders", async () => {
    const { container } = world([
      { order_id: "order_1", payment_collection_id: "pc_1" },
      { order_id: "order_2", payment_collection_id: "pc_1" },
    ])
    const err = await assertCancelLeavesSharedPaymentAlone(container, "order_1").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SharedPaymentCancelRefusedError)
    expect(err).toBeInstanceOf(MedusaError)
    const refusal = err as SharedPaymentCancelRefusedError
    expect(refusal.type).toBe(MedusaError.Types.NOT_ALLOWED)
    expect(refusal.code).toBe(SHARED_PAYMENT_CANCEL_REFUSED)
    expect(refusal.order_id).toBe("order_1")
    expect(refusal.shared_payment_collections).toEqual([{ payment_collection_id: "pc_1", other_order_ids: ["order_2"] }])
    expect(refusal.message).toContain("order_2")
  })
})

describe("sharedPaymentCancelMessage", () => {
  it("names every other order once and says what to do instead", () => {
    const message = sharedPaymentCancelMessage("order_1", [
      { payment_collection_id: "pc_1", other_order_ids: ["order_3", "order_2"] },
      { payment_collection_id: "pc_2", other_order_ids: ["order_2"] },
    ])
    expect(message).toContain("2 other orders from the same cart (order_2, order_3)")
    expect(message).toContain("vendor panel")
    expect(message).toContain("capture it first")
  })
})
