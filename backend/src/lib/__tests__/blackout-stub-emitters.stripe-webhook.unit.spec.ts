import Stripe from "stripe"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import emitBlackoutStripePaymentEvents, {
  config,
} from "../../subscribers/emit-blackout-stripe-payment-events"
import { MARKETPLACE_LISTING_MODULE } from "../../modules/marketplace-listing"
import { emitBlackoutEvent } from "../blackout-emit"

jest.mock("../blackout-emit", () => ({
  emitBlackoutEvent: jest.fn(async () => "evt_1"),
}))

const emitMock = emitBlackoutEvent as jest.MockedFunction<typeof emitBlackoutEvent>

/**
 * The Stripe → Blackout wiring for `purchase.failed` / `purchase.chargebacked`
 * (subscribers/emit-blackout-stripe-payment-events). Signatures are real:
 * payloads are signed with Stripe's own test-header helper, so these cases
 * exercise the same `constructEvent` verification production runs.
 */

const WEBHOOK_SECRET = "whsec_unit_test_secret"
const ENV_KEYS = [
  "FBM_BLACKOUT_INTEGRATION",
  "FREEBLACKMARKET_WEBHOOK_SECRET",
  "BLACKOUT_API_BASE",
  "STRIPE_WEBHOOK_SECRET",
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

beforeEach(() => {
  process.env.FBM_BLACKOUT_INTEGRATION = "1"
  process.env.FREEBLACKMARKET_WEBHOOK_SECRET = "fbm_whsec_test"
  process.env.BLACKOUT_API_BASE = "https://blackout.test"
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  emitMock.mockClear()
})

const SESSION = {
  id: "bcs_1",
  blackout_user_id: "bo_user_1",
  listing_id: "lst_1",
  status: "pending",
  order_id: null as string | null,
  cart_id: "cart_1",
  requested_metadata: { tipId: "tip_1" },
}

type CartRow = {
  cart_id: string
  cart_completed_at: string | null
  order_id: string | null
  payment_session_status: string | null
}

const makeContainer = (opts: {
  cartRow?: CartRow | null
  sessions?: Array<Record<string, unknown>>
  completedSessions?: Array<Record<string, unknown>>
  entitlementKind?: string | null
  listThrows?: boolean
} = {}) => {
  const cartRow =
    opts.cartRow === undefined
      ? { cart_id: "cart_1", cart_completed_at: null, order_id: null, payment_session_status: "pending" }
      : opts.cartRow
  const pg = {
    raw: jest.fn(async (_sql: string, _bindings?: unknown[]) => ({
      rows: cartRow ? [cartRow] : [],
    })),
  }
  const listing = {
    listBlackoutCheckoutSessions: jest.fn(async (filters: Record<string, unknown>) => {
      if (opts.listThrows) throw new Error("db down")
      if (filters.status === "completed") return opts.completedSessions ?? []
      return filters.cart_id === "cart_1" ? opts.sessions ?? [SESSION] : []
    }),
    listCreatorListings: jest.fn(async () => [
      { id: "lst_1", entitlement_kind: opts.entitlementKind ?? "digital" },
    ]),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
      if (key === MARKETPLACE_LISTING_MODULE) return listing
      throw new Error(`unexpected resolve ${key}`)
    }),
  }
  return { container, pg, listing }
}

const stripeEvent = (type: string, object: Record<string, unknown>) =>
  JSON.stringify({ id: `evt_${type}`, object: "event", type, data: { object } })

const webhookInput = (
  payload: string,
  opts: { provider?: string; secret?: string; serialized?: boolean } = {}
) => {
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: opts.secret ?? WEBHOOK_SECRET,
  })
  const raw = Buffer.from(payload)
  return {
    provider: opts.provider ?? "stripe_stripe",
    payload: {
      data: JSON.parse(payload),
      // A Redis event bus hands subscribers the JSON form of the Buffer.
      rawData: opts.serialized ? JSON.parse(JSON.stringify(raw)) : raw,
      headers: { "stripe-signature": signature },
    },
  }
}

type Args = Parameters<typeof emitBlackoutStripePaymentEvents>[0]
const run = (container: unknown, data: unknown) =>
  emitBlackoutStripePaymentEvents({
    event: { name: "payment.webhook_received", data },
    container,
  } as unknown as Args)

const paymentFailed = stripeEvent("payment_intent.payment_failed", {
  id: "pi_1",
  object: "payment_intent",
  metadata: { session_id: "payses_1" },
})

const disputeCreated = (status: string, paymentIntent: unknown = "pi_9") =>
  stripeEvent("charge.dispute.created", {
    id: "dp_1",
    object: "dispute",
    status,
    payment_intent: paymentIntent,
  })

describe("emit-blackout-stripe-payment-events", () => {
  it("rides Medusa's existing payment webhook event (no new endpoint)", () => {
    expect(config.event).toBe("payment.webhook_received")
  })

  describe("purchase.failed", () => {
    it("emits for a verified payment failure on an open Blackout checkout cart", async () => {
      const { container, pg } = makeContainer()
      await run(container, webhookInput(paymentFailed))

      expect(pg.raw).toHaveBeenCalledTimes(1)
      const [sql, bindings] = pg.raw.mock.calls[0]
      expect(sql).toContain("ps.id = ?")
      expect(bindings).toEqual(["payses_1"])

      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith(
        container,
        "purchase.failed",
        { userId: "bo_user_1", providerListingId: "lst_1", sku: null, kind: "asset_bundle" },
        {
          eventId: "purchase.failed:bcs_1",
          metadata: { tipId: "tip_1", fbmCheckoutSessionId: "bcs_1", fbmCartId: "cart_1" },
        }
      )
    })

    it("verifies the Redis-serialized raw body form too", async () => {
      const { container } = makeContainer()
      await run(container, webhookInput(paymentFailed, { serialized: true }))
      expect(emitMock).toHaveBeenCalledTimes(1)
    })

    it("skips carts no Blackout checkout session minted (storefront orders, renewals)", async () => {
      const { container } = makeContainer({ sessions: [] })
      await run(container, webhookInput(paymentFailed))
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("skips once the cart completed into an order", async () => {
      const { container } = makeContainer({
        cartRow: {
          cart_id: "cart_1",
          cart_completed_at: "2026-09-25T00:00:00.000Z",
          order_id: "order_1",
          payment_session_status: "authorized",
        },
      })
      await run(container, webhookInput(paymentFailed))
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("skips when the member already completed a purchase of this listing", async () => {
      const { container, listing } = makeContainer({
        completedSessions: [{ id: "bcs_0", status: "completed" }],
      })
      await run(container, webhookInput(paymentFailed))

      expect(listing.listBlackoutCheckoutSessions).toHaveBeenCalledWith(
        { blackout_user_id: "bo_user_1", listing_id: "lst_1", status: "completed" },
        { take: 1 }
      )
      expect(emitMock).not.toHaveBeenCalled()
    })
  })

  describe("purchase.chargebacked", () => {
    const completedSession = { ...SESSION, status: "completed", order_id: "order_1" }

    it("emits for a chargeback on a Blackout checkout order, resolved by PaymentIntent", async () => {
      const { container, pg } = makeContainer({
        sessions: [completedSession],
        cartRow: {
          cart_id: "cart_1",
          cart_completed_at: "2026-09-01T00:00:00.000Z",
          order_id: "order_1",
          payment_session_status: "captured",
        },
      })
      await run(container, webhookInput(disputeCreated("needs_response")))

      const [sql, bindings] = pg.raw.mock.calls[0]
      expect(sql).toContain("ps.data->>'id' = ?")
      expect(bindings).toEqual(["pi_9"])

      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith(
        container,
        "purchase.chargebacked",
        { userId: "bo_user_1", providerListingId: "lst_1", kind: "asset_bundle" },
        { eventId: "purchase.chargebacked:order_1", metadata: { tipId: "tip_1", fbmOrderId: "order_1" } }
      )
    })

    it("emits on funds withdrawn with an expanded PaymentIntent", async () => {
      const { container, pg } = makeContainer({ sessions: [completedSession] })
      await run(
        container,
        webhookInput(
          stripeEvent("charge.dispute.funds_withdrawn", {
            id: "dp_1",
            object: "dispute",
            status: "needs_response",
            payment_intent: { id: "pi_9", object: "payment_intent" },
          })
        )
      )
      expect(pg.raw.mock.calls[0][1]).toEqual(["pi_9"])
      expect(emitMock).toHaveBeenCalledWith(
        container,
        "purchase.chargebacked",
        expect.anything(),
        expect.objectContaining({ eventId: "purchase.chargebacked:order_1" })
      )
    })

    it("ignores inquiries (no funds withdrawn)", async () => {
      const { container, pg } = makeContainer({ sessions: [completedSession] })
      await run(container, webhookInput(disputeCreated("warning_needs_response")))
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("skips disputes on payments FBM cannot tie to a Blackout checkout", async () => {
      const { container } = makeContainer({ cartRow: null })
      await run(container, webhookInput(disputeCreated("needs_response")))
      expect(emitMock).not.toHaveBeenCalled()
    })
  })

  describe("guards", () => {
    it("drops a payload whose Stripe signature does not verify, before any lookup", async () => {
      const { container, pg } = makeContainer()
      await run(container, webhookInput(paymentFailed, { secret: "whsec_someone_else" }))
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("drops a tampered body", async () => {
      const { container, pg } = makeContainer()
      const input = webhookInput(paymentFailed)
      input.payload.rawData = Buffer.from(paymentFailed.replace("payses_1", "payses_2"))
      await run(container, input)
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("does nothing without STRIPE_WEBHOOK_SECRET", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET
      const { container, pg } = makeContainer()
      await run(container, webhookInput(paymentFailed))
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("ignores other payment providers", async () => {
      const { container, pg } = makeContainer()
      await run(container, webhookInput(paymentFailed, { provider: "system_default" }))
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("stays dark unless FBM_BLACKOUT_INTEGRATION=1 and the emitter is configured", async () => {
      const { container, pg } = makeContainer()
      process.env.FBM_BLACKOUT_INTEGRATION = "0"
      await run(container, webhookInput(paymentFailed))
      process.env.FBM_BLACKOUT_INTEGRATION = "1"
      delete process.env.BLACKOUT_API_BASE
      await run(container, webhookInput(paymentFailed))

      expect(container.resolve).not.toHaveBeenCalled()
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("ignores Stripe events it does not report", async () => {
      const { container, pg } = makeContainer()
      await run(
        container,
        webhookInput(
          stripeEvent("payment_intent.succeeded", {
            id: "pi_1",
            object: "payment_intent",
            metadata: { session_id: "payses_1" },
          })
        )
      )
      expect(pg.raw).not.toHaveBeenCalled()
      expect(emitMock).not.toHaveBeenCalled()
    })

    it("swallows lookup failures (never makes Medusa retry the webhook)", async () => {
      const { container } = makeContainer({ listThrows: true })
      await expect(run(container, webhookInput(paymentFailed))).resolves.toBeUndefined()
      expect(emitMock).not.toHaveBeenCalled()
    })
  })
})
