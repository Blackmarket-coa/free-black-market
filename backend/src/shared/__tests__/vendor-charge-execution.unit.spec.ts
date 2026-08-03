import {
  applyVendorChargeEvent,
  createBillingSetupIntent,
  executeCharge,
  fulfillPaidCharge,
} from "../vendor-charge-execution"
import VendorBillingService from "../../modules/vendor-billing/service"
import {
  VendorChargeKind,
  VendorChargeStatus,
} from "../../modules/vendor-billing/charges"
import { VENDOR_BILLING_MODULE } from "../../modules/vendor-billing"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { PROMOTED_LISTING_FEATURE_KEY } from "../promoted-listing"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * The seam is exercised against the REAL VendorBillingService (prototype +
 * patched CRUD), so every status move here goes through the real state
 * machine — a fake billing service would let these tests pass while the
 * machine refused the moves in production.
 */

type Row = Record<string, unknown> & { id: string }

const realBilling = (rows: Row[]) => {
  const svc = Object.create(
    VendorBillingService.prototype
  ) as Record<string, unknown>
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      Array.isArray(v) ? v.includes(row[k]) : row[k] === v
    )
  svc.listVendorCharges = (async (where: Record<string, unknown> = {}) =>
    rows.filter((r) => matches(r, where))) as never
  svc.createVendorCharges = (async (data: Record<string, unknown>) => {
    const row = { ...data, id: `vc_${rows.length + 1}` } as Row
    rows.push(row)
    return row
  }) as never
  svc.updateVendorCharges = (async (data: Record<string, unknown>) => {
    const row = rows.find((r) => r.id === data.id)
    if (row) Object.assign(row, data)
    return row
  }) as never
  return svc as unknown as VendorBillingService
}

const makeWorld = (opts: {
  charges?: Row[]
  stripeCustomerId?: string | null
} = {}) => {
  const charges: Row[] = [...(opts.charges ?? [])]
  const metadata = [{ id: "sm_1", seller_id: "sel_1", featured: false }]
  const entitlements: Row[] = []
  const grant = jest.fn(async (input: Record<string, unknown>) => {
    const row = { ...input, id: `ent_${entitlements.length + 1}`, status: "active" } as Row
    entitlements.push(row)
    return row
  })

  const billing = realBilling(charges)

  const assignment: Record<string, unknown> = {
    id: "vpa_1",
    plan_code: "free",
    stripe_customer_id:
      opts.stripeCustomerId === undefined ? "cus_1" : opts.stripeCustomerId,
  }
  const updateVendorPlanAssignments = jest.fn(
    async (updates: Record<string, unknown>[]) => {
      for (const u of [updates].flat()) Object.assign(assignment, u)
      return [assignment]
    }
  )

  const container = {
    resolve: (key: string) => {
      if (key === VENDOR_BILLING_MODULE) return billing
      if (key === VENDOR_PLAN_MODULE) {
        return {
          ensureAssignment: async () => assignment,
          updateVendorPlanAssignments,
        }
      }
      if (key === ENTITLEMENT_MODULE) {
        return {
          listEntitlements: async (where: Record<string, unknown>) =>
            entitlements.filter(
              (e) =>
                e.seller_id === where.seller_id &&
                e.feature_key === where.feature_key &&
                e.status === where.status
            ),
          grant,
        }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph: async () => ({ data: metadata }) }
      }
      if (key === "sellerExtension") {
        return {
          updateSellerMetadata: async (data: Row[]) => {
            for (const d of [data].flat()) {
              const row = metadata.find((m) => m.id === d.id)
              if (row) row.featured = d.featured as boolean
            }
            return data
          },
        }
      }
      return undefined
    },
  }

  return {
    container,
    charges,
    metadata,
    entitlements,
    grant,
    assignment,
    updateVendorPlanAssignments,
  }
}

const promotionCharge = (over: Partial<Row> = {}): Row => ({
  id: "vc_1",
  seller_id: "sel_1",
  kind: VendorChargeKind.PROMOTION,
  status: VendorChargeStatus.PENDING,
  amount: 1500,
  currency_code: "usd",
  description: "Promoted placement — 1 week",
  idempotency_key: "promotion:sel_1:week:2026-08-03",
  metadata: { tier_code: "week" },
  ...over,
})

const fakeStripe = (opts: {
  intentStatus?: string
  createThrows?: string
  paymentMethods?: string[]
} = {}) => {
  const created: Record<string, unknown>[] = []
  const keys: string[] = []
  const customersCreated: Record<string, unknown>[] = []
  return {
    customersCreated,
    stripe: {
      customers: {
        create: jest.fn(async (params: Record<string, unknown>) => {
          customersCreated.push(params)
          return { id: `cus_new_${customersCreated.length}` }
        }),
      },
      setupIntents: {
        create: jest.fn(async () => ({
          id: "seti_1",
          client_secret: "seti_1_secret",
        })),
      },
      paymentIntents: {
        create: jest.fn(
          async (params: Record<string, unknown>, o: { idempotencyKey: string }) => {
            if (opts.createThrows) {
              const err = new Error(opts.createThrows)
              ;(err as { code?: string }).code = opts.createThrows
              throw err
            }
            created.push(params)
            keys.push(o.idempotencyKey)
            return { id: "pi_1", status: opts.intentStatus ?? "succeeded" }
          }
        ),
      },
      paymentMethods: {
        list: jest.fn(async () => ({
          data: (opts.paymentMethods ?? ["pm_1"]).map((id) => ({ id })),
        })),
      },
    },
    created,
    keys,
  }
}

const ENV_KEYS = ["STRIPE_SECRET_KEY", "VENDOR_BILLING_ENABLED"] as const
let savedEnv: Record<string, string | undefined>
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("executeCharge", () => {
  it("collects a card charge and fulfils it in one pass", async () => {
    const world = makeWorld({ charges: [promotionCharge()] })
    const { stripe, created, keys } = fakeStripe({ intentStatus: "succeeded" })

    const result = await executeCharge(world.container as never, "vc_1", { stripe })

    expect(result).toEqual({ executed: true, status: VendorChargeStatus.PAID })
    expect(world.charges[0].status).toBe(VendorChargeStatus.PAID)
    // Fulfilment: the paid promotion granted placement…
    expect(world.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_id: "sel_1",
        feature_key: PROMOTED_LISTING_FEATURE_KEY,
      })
    )
    expect(world.metadata[0].featured).toBe(true)
    // …and the replay guard is stamped.
    expect(
      (world.charges[0].metadata as Record<string, unknown>).fulfilled_at
    ).toBeDefined()
    // Stripe idempotency rides the ledger key, so a crash-retry cannot mint a
    // second intent.
    expect(keys).toEqual(["vendor-charge:promotion:sel_1:week:2026-08-03"])
    expect(created[0]).toMatchObject({ amount: 1500, off_session: true })
  })

  it("leaves a slow rail in processing and does not fulfil early", async () => {
    const world = makeWorld({ charges: [promotionCharge()] })
    const { stripe } = fakeStripe({ intentStatus: "processing" })

    const result = await executeCharge(world.container as never, "vc_1", { stripe })

    expect(result.status).toBe(VendorChargeStatus.PROCESSING)
    // No money confirmed -> no placement. The webhook finishes this path.
    expect(world.grant).not.toHaveBeenCalled()
    expect(world.metadata[0].featured).toBe(false)
  })

  it("stays pending without a saved payment method", async () => {
    // Pending, not failed: "failed" implies an attempt was made. The balance
    // still shows what is owed, collectable once the vendor adds a card.
    const world = makeWorld({
      charges: [promotionCharge()],
      stripeCustomerId: null,
    })
    const { stripe } = fakeStripe()

    const result = await executeCharge(world.container as never, "vc_1", { stripe })

    expect(result).toEqual({
      executed: false,
      status: VendorChargeStatus.PENDING,
      reason: "no_payment_method",
    })
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  it("stays pending when billing is not configured", async () => {
    const world = makeWorld({ charges: [promotionCharge()] })

    const result = await executeCharge(world.container as never, "vc_1")

    expect(result).toEqual({
      executed: false,
      status: VendorChargeStatus.PENDING,
      reason: "billing_not_configured",
    })
    expect(world.charges[0].status).toBe(VendorChargeStatus.PENDING)
  })

  it("marks a declined charge failed, and a retry can still collect it", async () => {
    const world = makeWorld({ charges: [promotionCharge()] })
    const declined = fakeStripe({ createThrows: "card_declined" })

    const first = await executeCharge(world.container as never, "vc_1", {
      stripe: declined.stripe,
    })
    expect(first).toEqual({
      executed: false,
      status: VendorChargeStatus.FAILED,
      reason: "payment_failed",
    })
    expect(world.charges[0].failure_reason).toBe("card_declined")

    // failed -> paid is a legal move; the vendor fixed their card.
    const retry = fakeStripe({ intentStatus: "succeeded" })
    const second = await executeCharge(world.container as never, "vc_1", {
      stripe: retry.stripe,
    })
    expect(second.status).toBe(VendorChargeStatus.PAID)
    expect(world.charges[0].failure_reason).toBeNull()
  })

  it("refuses to re-present a charge that is not outstanding", async () => {
    const world = makeWorld({
      charges: [promotionCharge({ status: VendorChargeStatus.PAID })],
    })
    const { stripe } = fakeStripe()

    const result = await executeCharge(world.container as never, "vc_1", { stripe })

    expect(result.reason).toBe("not_outstanding")
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })
})

describe("applyVendorChargeEvent", () => {
  const event = (type: string, over: Record<string, unknown> = {}) => ({
    type,
    data: {
      id: "pi_1",
      metadata: { type: "vendor_charge", charge_id: "vc_1" },
      ...over,
    },
  })

  it("settles a processing charge and fulfils it", async () => {
    const world = makeWorld({
      charges: [
        promotionCharge({
          status: VendorChargeStatus.PROCESSING,
          stripe_payment_intent_id: "pi_1",
        }),
      ],
    })

    const result = await applyVendorChargeEvent(
      world.container as never,
      event("payment_intent.succeeded") as never
    )

    expect(result).toEqual({ handled: true, outcome: "paid" })
    expect(world.charges[0].status).toBe(VendorChargeStatus.PAID)
    expect(world.grant).toHaveBeenCalledTimes(1)
    expect(world.metadata[0].featured).toBe(true)
  })

  it("delivers exactly once across a webhook replay", async () => {
    const world = makeWorld({
      charges: [
        promotionCharge({
          status: VendorChargeStatus.PROCESSING,
          stripe_payment_intent_id: "pi_1",
        }),
      ],
    })

    await applyVendorChargeEvent(
      world.container as never,
      event("payment_intent.succeeded") as never
    )
    await applyVendorChargeEvent(
      world.container as never,
      event("payment_intent.succeeded") as never
    )

    // Promotion fulfilment EXTENDS the expiry — a second delivery would hand
    // out double time. The fulfilled_at stamp is what prevents that.
    expect(world.grant).toHaveBeenCalledTimes(1)
  })

  it("records why a payment failed", async () => {
    const world = makeWorld({
      charges: [
        promotionCharge({
          status: VendorChargeStatus.PROCESSING,
          stripe_payment_intent_id: "pi_1",
        }),
      ],
    })

    const result = await applyVendorChargeEvent(
      world.container as never,
      event("payment_intent.payment_failed", {
        last_payment_error: { message: "insufficient funds" },
      }) as never
    )

    expect(result.outcome).toBe("failed")
    expect(world.charges[0].failure_reason).toBe("insufficient funds")
  })

  it("ignores intents that are not vendor charges", async () => {
    // This Stripe account also carries the hawala ACH rails; their traffic
    // must pass through untouched.
    const world = makeWorld({ charges: [promotionCharge()] })

    const result = await applyVendorChargeEvent(world.container as never, {
      type: "payment_intent.succeeded",
      data: { id: "pi_ach", metadata: { type: "ach_deposit" } },
    } as never)

    expect(result).toEqual({ handled: false, outcome: "ignored" })
    expect(world.charges[0].status).toBe(VendorChargeStatus.PENDING)
  })

  it("finds the charge by payment intent when metadata lacks the id", async () => {
    const world = makeWorld({
      charges: [
        promotionCharge({
          status: VendorChargeStatus.PROCESSING,
          stripe_payment_intent_id: "pi_1",
        }),
      ],
    })

    const result = await applyVendorChargeEvent(world.container as never, {
      type: "payment_intent.succeeded",
      data: { id: "pi_1", metadata: { type: "vendor_charge" } },
    } as never)

    expect(result.outcome).toBe("paid")
  })
})

describe("fulfillPaidCharge", () => {
  it("does nothing for a charge that is not paid", async () => {
    const world = makeWorld({ charges: [promotionCharge()] })
    const result = await fulfillPaidCharge(world.container as never, "vc_1")
    expect(result).toEqual({ fulfilled: false, replayed: false })
    expect(world.grant).not.toHaveBeenCalled()
  })

  it("needs no fulfilment for a plan charge", async () => {
    // The plan transition already happened; the charge only collects for it.
    const world = makeWorld({
      charges: [
        promotionCharge({
          kind: VendorChargeKind.PLAN,
          status: VendorChargeStatus.PAID,
          metadata: {},
        }),
      ],
    })
    const result = await fulfillPaidCharge(world.container as never, "vc_1")
    expect(result.fulfilled).toBe(true)
    expect(world.grant).not.toHaveBeenCalled()
  })
})

describe("createBillingSetupIntent", () => {
  it("is unavailable when billing is not configured", async () => {
    const world = makeWorld()
    const result = await createBillingSetupIntent(world.container as never, "sel_1")
    expect(result).toEqual({
      available: false,
      reason: "billing_not_configured",
    })
  })

  it("creates and persists the Stripe customer exactly once", async () => {
    const world = makeWorld({ stripeCustomerId: null })
    const fake = fakeStripe()

    const first = await createBillingSetupIntent(world.container as never, "sel_1", {
      stripe: fake.stripe,
    })
    expect(first).toEqual({
      available: true,
      client_secret: "seti_1_secret",
      stripe_customer_id: "cus_new_1",
    })
    // Written back BEFORE the SetupIntent, so a failed intent retries against
    // the same customer instead of leaking one per attempt.
    expect(world.updateVendorPlanAssignments).toHaveBeenCalledWith([
      { id: "vpa_1", stripe_customer_id: "cus_new_1" },
    ])

    const second = await createBillingSetupIntent(world.container as never, "sel_1", {
      stripe: fake.stripe,
    })
    expect(second.available && second.stripe_customer_id).toBe("cus_new_1")
    expect(fake.customersCreated).toHaveLength(1)
  })

  it("reuses an existing Stripe customer untouched", async () => {
    const world = makeWorld({ stripeCustomerId: "cus_existing" })
    const fake = fakeStripe()

    const result = await createBillingSetupIntent(world.container as never, "sel_1", {
      stripe: fake.stripe,
    })

    expect(result.available && result.stripe_customer_id).toBe("cus_existing")
    expect(fake.customersCreated).toHaveLength(0)
    expect(world.updateVendorPlanAssignments).not.toHaveBeenCalled()
  })
})
