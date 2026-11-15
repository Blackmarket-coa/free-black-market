import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { WorkflowManager } from "@medusajs/framework/orchestration"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflowId } from "@medusajs/medusa/core-flows"
import {
  ORDER_COLLECTION_REFUND_WORKFLOWS,
  REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID,
  refuseSharedPaymentOrderCancel,
  refuseSharedPaymentWorkflowRun,
} from "../shared-payment-order-cancel"
import { SHARED_PAYMENT_CANCEL_REFUSED } from "../../../lib/shared-payment-cancel"

/**
 * SD-36 (8): the two HTTP refusals, against a Query stand-in that answers the
 * guard's three reads (registered under the framework's QUERY key). The
 * real-database proof through Medusa's router, admin auth and routes is
 * integration-tests/http/admin-order-cancel-shared-payment.spec.ts; this pins
 * which requests the runner guard reads, refuses and passes.
 */

type Link = { order_id: string; payment_collection_id: string }

/** order_1 shares pc_shared with order_2; order_9 has pc_own to itself. */
const LINKS: Link[] = [
  { order_id: "order_1", payment_collection_id: "pc_shared" },
  { order_id: "order_2", payment_collection_id: "pc_shared" },
  { order_id: "order_9", payment_collection_id: "pc_own" },
]

function harness(opts: { params: Record<string, string>; body?: unknown; validatedBody?: unknown }) {
  const graph = jest.fn(async ({ entity, filters }: { entity: string; filters: Record<string, unknown> }) => {
    const inList = (v: string, f: unknown) => (Array.isArray(f) ? f.includes(v) : f === v)
    if (entity === "order_payment_collection" && "order_id" in filters) {
      return { data: LINKS.filter((l) => inList(l.order_id, filters.order_id)) }
    }
    if (entity === "order_payment_collection" && "payment_collection_id" in filters) {
      return { data: LINKS.filter((l) => inList(l.payment_collection_id, filters.payment_collection_id)) }
    }
    if (entity === "split_order_payment") return { data: [] }
    throw new Error(`unexpected read: ${entity}`)
  })
  const scope = {
    resolve: (key: string) => {
      if (key !== ContainerRegistrationKeys.QUERY) throw new Error(`unexpected resolve(${key})`)
      return { graph }
    },
  }
  const req = {
    params: opts.params,
    body: opts.body,
    validatedBody: opts.validatedBody,
    scope,
  } as unknown as MedusaRequest
  const sent: { status?: number; body?: Record<string, unknown> } = {}
  const res = {
    status(code: number) {
      sent.status = code
      return this
    },
    json(body: Record<string, unknown>) {
      sent.body = body
      return this
    },
  } as unknown as MedusaResponse
  const next = jest.fn() as unknown as MedusaNextFunction & jest.Mock
  return { req, res, next, graph, sent }
}

describe("REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID (written by hand: core-flows does not export it)", () => {
  it("is a workflow Medusa registers, and the refund step inside cancel-order", () => {
    // Importing core-flows (above) registers its workflows.
    expect(WorkflowManager.getWorkflow(REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID)).toBeDefined()
    const cancel = WorkflowManager.getWorkflow(cancelOrderWorkflowId)
    expect(cancel).toBeDefined()
    expect(JSON.stringify(cancel?.flow_)).toContain(`"${REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID}-as-step"`)
  })

  it("guards exactly cancel-order and its refund half", () => {
    expect([...ORDER_COLLECTION_REFUND_WORKFLOWS.entries()]).toEqual([
      ["cancel-order", "cancel"],
      [REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID, "refund"],
    ])
  })
})

describe("refuseSharedPaymentWorkflowRun (POST /admin/workflows-executions/:workflow_id/run)", () => {
  it("passes any other workflow without reading anything", async () => {
    const h = harness({ params: { workflow_id: "create-products" }, body: { input: { order_id: "order_1" } } })
    await refuseSharedPaymentWorkflowRun(h.req, h.res, h.next)
    expect(h.next).toHaveBeenCalledTimes(1)
    expect(h.graph).not.toHaveBeenCalled()
    expect(h.sent.status).toBeUndefined()
  })

  it.each([
    ["cancel-order", "canceled"],
    [REFUND_CAPTURED_PAYMENTS_WORKFLOW_ID, "refunded"],
  ])("refuses %s on an order whose collection is shared, with 409", async (workflowId, verb) => {
    const h = harness({ params: { workflow_id: workflowId }, body: { input: { order_id: "order_1" } } })
    await refuseSharedPaymentWorkflowRun(h.req, h.res, h.next)
    expect(h.next).not.toHaveBeenCalled()
    expect(h.sent.status).toBe(409)
    expect(h.sent.body).toMatchObject({
      type: "not_allowed",
      code: SHARED_PAYMENT_CANCEL_REFUSED,
      order_id: "order_1",
      shared_payment_collections: [{ payment_collection_id: "pc_shared", other_order_ids: ["order_2"] }],
    })
    expect(h.sent.body?.message).toContain(`cannot be ${verb} here`)
    expect(h.sent.body?.message).toContain("order_2")
  })

  it("passes cancel-order on an order whose collection is its own", async () => {
    const h = harness({ params: { workflow_id: "cancel-order" }, body: { input: { order_id: "order_9" } } })
    await refuseSharedPaymentWorkflowRun(h.req, h.res, h.next)
    expect(h.next).toHaveBeenCalledTimes(1)
    expect(h.graph).toHaveBeenCalled()
    expect(h.sent.status).toBeUndefined()
  })

  it("reads the order from validatedBody too, and refuses when that one is shared", async () => {
    const h = harness({
      params: { workflow_id: "cancel-order" },
      body: { input: { order_id: "order_1" } },
      validatedBody: { input: { order_id: "order_1" } },
    })
    await refuseSharedPaymentWorkflowRun(h.req, h.res, h.next)
    expect(h.sent.status).toBe(409)
    expect(h.next).not.toHaveBeenCalled()
  })

  it.each<[string, unknown, unknown]>([
    ["no body", undefined, undefined],
    ["no input", {}, undefined],
    ["no order_id", { input: {} }, undefined],
    ["an empty order_id", { input: { order_id: "" } }, undefined],
    ["order_id as an array", { input: { order_id: ["order_9", "order_1"] } }, undefined],
    ["order_id as a number", { input: { order_id: 1 } }, undefined],
    ["input as a string", { input: "order_1" }, undefined],
    ["body and validatedBody naming different orders", { input: { order_id: "order_9" } }, { input: { order_id: "order_1" } }],
    ["validatedBody naming none", { input: { order_id: "order_9" } }, { input: {} }],
  ])("fails closed with 400 on %s, before reading or running anything", async (_label, body, validatedBody) => {
    const h = harness({ params: { workflow_id: "cancel-order" }, body, validatedBody })
    await refuseSharedPaymentWorkflowRun(h.req, h.res, h.next)
    expect(h.sent.status).toBe(400)
    expect(h.sent.body?.type).toBe("invalid_data")
    expect(h.next).not.toHaveBeenCalled()
    expect(h.graph).not.toHaveBeenCalled()
  })

  it("lets a failed read reach the error handler, without running the workflow", async () => {
    const h = harness({ params: { workflow_id: "cancel-order" }, body: { input: { order_id: "order_1" } } })
    h.graph.mockRejectedValueOnce(new Error("db down"))
    await expect(refuseSharedPaymentWorkflowRun(h.req, h.res, h.next)).rejects.toThrow("db down")
    expect(h.next).not.toHaveBeenCalled()
  })
})

describe("refuseSharedPaymentOrderCancel (POST /admin/orders/:id/cancel)", () => {
  it("refuses an order whose collection is shared, with the cancel wording", async () => {
    const h = harness({ params: { id: "order_2" } })
    await refuseSharedPaymentOrderCancel(h.req, h.res, h.next)
    expect(h.sent.status).toBe(409)
    expect(h.sent.body?.shared_payment_collections).toEqual([
      { payment_collection_id: "pc_shared", other_order_ids: ["order_1"] },
    ])
    expect(h.sent.body?.message).toContain("cannot be canceled here")
    expect(h.next).not.toHaveBeenCalled()
  })

  it("passes an order whose collection is its own", async () => {
    const h = harness({ params: { id: "order_9" } })
    await refuseSharedPaymentOrderCancel(h.req, h.res, h.next)
    expect(h.next).toHaveBeenCalledTimes(1)
    expect(h.sent.status).toBeUndefined()
  })
})
