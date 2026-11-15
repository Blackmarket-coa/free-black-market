import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { POST, parseClaimAmount } from "../route"
import { HAWALA_LEDGER_MODULE } from "../../../../../../modules/hawala-ledger"
import { ORDER_DISPUTE_MODULE } from "../../../../../../modules/order-dispute"

/**
 * POST /store/orders/:id/dispute takes `claim_amount` in the currency's minor
 * unit and refuses anything that is not a whole number of them, rather than
 * flooring it: 25.99 floored to 25 is how a $25.99 claim became $0.25.
 *
 * The request goes through the real intake (`shared/order-dispute-intake.ts`)
 * on a container that resolves only the keys the code imports.
 */

type TestRes = {
  statusCode: number
  body: unknown
  status: (code: number) => TestRes
  json: (payload: unknown) => TestRes
}

const createRes = (): TestRes => {
  const res = { statusCode: 200, body: undefined } as TestRes
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res
}

function makeReq(body: Record<string, unknown>) {
  const open = jest.fn(async (a: { claimCents: number | null }) => ({ id: "odsp_1", claim_amount: a.claimCents }))
  const graph = jest.fn(async () => ({
    data: [
      {
        id: "order_1",
        customer_id: "cus_1",
        created_at: new Date().toISOString(),
        currency_code: "usd",
        seller: { id: "sel_a" },
        items: [{ total: 25.99, product: { seller: { id: "sel_a" } } }],
      },
    ],
  }))
  const registry: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    [ORDER_DISPUTE_MODULE]: { liveForOrder: jest.fn(async () => null), open },
    [HAWALA_LEDGER_MODULE]: { listEscrowAgreements: jest.fn(async () => []) },
  }
  const resolve = jest.fn((key: string) => {
    if (!(key in registry)) throw new Error(`unexpected container key: ${key}`)
    return registry[key]
  })
  const req = {
    params: { id: "order_1" },
    body: { description: "Never arrived.", ...body },
    scope: { resolve },
    auth_context: { actor_type: "customer", actor_id: "cus_1" },
  }
  return { req, open, resolve }
}

type RouteArgs = Parameters<typeof POST>
const invoke = async (body: Record<string, unknown>) => {
  const made = makeReq(body)
  const res = createRes()
  await POST(made.req as unknown as RouteArgs[0], res as unknown as RouteArgs[1])
  return { ...made, res }
}

describe("POST /store/orders/:id/dispute: claim_amount", () => {
  it("refuses anything that is not a whole number of minor units, before reading the order", async () => {
    for (const claim_amount of [25.99, 0.5, -1, "2599", "25.99", Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, true, {}]) {
      const { res, resolve } = await invoke({ claim_amount })
      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({ type: "invalid_claim_amount" })
      expect(resolve).not.toHaveBeenCalled()
    }
  })

  it("passes a whole number of minor units through unchanged", async () => {
    const { res, open } = await invoke({ claim_amount: 1250 })
    expect(res.statusCode).toBe(201)
    expect(open.mock.calls[0][0]).toMatchObject({ claimCents: 1250, orderTotalCents: 2599 })
  })

  it("claims the whole order when it is left out", async () => {
    for (const body of [{}, { claim_amount: null }]) {
      const { res, open } = await invoke(body)
      expect(res.statusCode).toBe(201)
      expect(open.mock.calls[0][0]).toMatchObject({ claimCents: null, orderTotalCents: 2599 })
    }
  })

  it("parseClaimAmount: absent is the whole order; only a non-negative safe integer is a figure", () => {
    expect(parseClaimAmount(undefined)).toEqual({ ok: true, value: null })
    expect(parseClaimAmount(null)).toEqual({ ok: true, value: null })
    expect(parseClaimAmount(0)).toEqual({ ok: true, value: 0 })
    expect(parseClaimAmount(2599)).toEqual({ ok: true, value: 2599 })
    expect(parseClaimAmount(25.99)).toEqual({ ok: false })
    expect(parseClaimAmount("2599")).toEqual({ ok: false })
  })
})
