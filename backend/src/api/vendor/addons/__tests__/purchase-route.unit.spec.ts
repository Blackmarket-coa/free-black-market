import { POST } from "../purchase/route"
import VendorBillingService from "../../../../modules/vendor-billing/service"
import { VENDOR_BILLING_MODULE } from "../../../../modules/vendor-billing"
import { VENDOR_PLAN_MODULE } from "../../../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../../../modules/entitlement"

jest.mock("../../../../shared", () => ({
  requireSellerId: jest.fn(async () => "sel_1"),
}))

/**
 * Same invariant as the promotion purchase spec, same harness: billing is
 * configured but the seller has no saved payment method, so every purchase
 * records a charge, collects nothing — and must therefore grant nothing.
 */

const createRes = () => {
  const res: Record<string, unknown> = { statusCode: 200, body: undefined }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (payload: unknown) => {
    res.body = payload
    return res
  }
  return res as {
    statusCode: number
    body: Record<string, unknown>
    status: (c: number) => unknown
    json: (p: unknown) => unknown
  }
}

type Row = Record<string, unknown> & { id: string }

const makeWorld = () => {
  const charges: Row[] = []
  const billing = Object.create(
    VendorBillingService.prototype
  ) as Record<string, unknown>
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v)
  billing.listVendorCharges = (async (where: Record<string, unknown> = {}) =>
    charges.filter((r) => matches(r, where))) as never
  billing.createVendorCharges = (async (data: Record<string, unknown>) => {
    const row = { ...data, id: `vc_${charges.length + 1}` } as Row
    charges.push(row)
    return row
  }) as never
  billing.updateVendorCharges = (async (data: Record<string, unknown>) => {
    const row = charges.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never

  const grant = jest.fn(async () => ({}))

  const req = {
    body: {} as Record<string, unknown>,
    scope: {
      resolve: (key: string) => {
        if (key === VENDOR_BILLING_MODULE) return billing
        if (key === VENDOR_PLAN_MODULE) {
          // No stripe_customer_id: the vendor never saved a payment method.
          return {
            ensureAssignment: async () => ({
              plan_code: "free",
              stripe_customer_id: null,
            }),
          }
        }
        if (key === ENTITLEMENT_MODULE) {
          return { listEntitlements: async () => [], grant }
        }
        return undefined
      },
    },
  }

  return { req, charges, grant }
}

const ENV_KEYS = ["STRIPE_SECRET_KEY", "VENDOR_BILLING_ENABLED"] as const
let savedEnv: Record<string, string | undefined>
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy"
  process.env.VENDOR_BILLING_ENABLED = "true"
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("POST /vendor/addons/purchase", () => {
  it("rejects an unknown pack before recording anything", async () => {
    const { req, charges } = makeWorld()
    req.body = { code: "mystery_pack" }
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(400)
    expect(charges).toHaveLength(0)
  })

  it("refuses outright when billing is not configured", async () => {
    // A 503, not a silent grant: the admin route stays the only free path.
    delete process.env.VENDOR_BILLING_ENABLED
    const { req, charges } = makeWorld()
    req.body = { code: "quest_pack" }
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe("billing_unavailable")
    expect(charges).toHaveLength(0)
  })

  it("records the charge but grants nothing while uncollected", async () => {
    const { req, charges, grant } = makeWorld()
    req.body = { code: "quest_pack" }
    const res = createRes()
    await POST(req as never, res as never)

    expect(res.statusCode).toBe(201)
    expect(charges).toHaveLength(1)
    expect(charges[0]).toMatchObject({
      seller_id: "sel_1",
      kind: "addon",
      amount: 4900,
      status: "pending",
    })
    // No confirmed money, no features.
    expect(grant).not.toHaveBeenCalled()
    expect((res.body.addon as Record<string, unknown>).active).toBe(false)
    // The panel is told exactly what to do about it.
    expect((res.body.execution as Record<string, unknown>).reason).toBe(
      "no_payment_method"
    )
  })

  it("collapses a same-day double-click into one charge", async () => {
    const { req, charges } = makeWorld()
    req.body = { code: "quest_pack" }
    await POST(req as never, createRes() as never)
    const res = createRes()
    await POST(req as never, res as never)

    expect(charges).toHaveLength(1)
    expect(res.statusCode).toBe(200)
    expect(res.body.replayed).toBe(true)
  })

  it("keeps deliberate repeat purchases separate via client keys", async () => {
    const { req, charges } = makeWorld()
    req.body = { code: "quest_pack", idempotency_key: "first" }
    await POST(req as never, createRes() as never)
    req.body = { code: "quest_pack", idempotency_key: "second" }
    await POST(req as never, createRes() as never)

    expect(charges).toHaveLength(2)
  })
})
