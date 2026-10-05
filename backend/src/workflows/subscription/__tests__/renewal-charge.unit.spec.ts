import { SUBSCRIPTION_MODULE } from "../../../modules/subscription"
import { SubscriptionInterval, SubscriptionStatus } from "../../../modules/subscription/types"
import {
  makeContainer,
  makeSubscriptionService,
  type FakeRow,
} from "../../../modules/subscription/__tests__/fake-subscription-service"
import {
  executeRenewalCharge,
  RenewalChargeError,
  type RenewalStripeLike,
} from "../renewal-charge"
import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * S0 — the live renewal charge: a direct off-session PaymentIntent, keyed by
 * the record, recorded on the subscription BEFORE Stripe is called (and so
 * before the period rolls). The subscription service is the real prototype;
 * Stripe is an injected double — no test-mode key exists here, so these pin
 * the requests we send, verified against stripe 17.7.0's types, not Stripe's
 * behaviour. The double keeps each intent's status so a retry can be shown to
 * read it rather than charge again.
 */

const PERIOD_START = "2026-10-01T00:00:00.000Z"
const KEY = `subscription-renewal:sub_1:${PERIOD_START}`

const row = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  id: "sub_1",
  status: SubscriptionStatus.ACTIVE,
  interval: SubscriptionInterval.MONTHLY,
  customer_id: "cus_1",
  last_order_date: new Date("2026-09-01T00:00:00.000Z"),
  next_order_date: new Date(PERIOD_START),
  payment_method_id: "pm_saved",
  metadata: { initial_order_id: "order_0" },
  ...overrides,
})

function setup(rowOverrides: Partial<FakeRow> = {}, intentStatus = "succeeded") {
  const log: string[] = []
  const svc = makeSubscriptionService([row(rowOverrides)])
  const realRecord = svc.recordRenewalCharge.bind(svc)
  svc.recordRenewalCharge = jest.fn(async (id: string, charge: { status: string }) => {
    log.push(`record:${charge.status}`)
    return realRecord(id, charge as never)
  }) as never
  // Stripe's side of the world: the status each intent id currently has.
  const intents = new Map<string, string>()
  const stripe = {
    paymentMethods: {
      retrieve: jest.fn(async (id: string) => {
        log.push("stripe:pm.retrieve")
        return { id, customer: "cus_stripe_1" }
      }),
    },
    paymentIntents: {
      create: jest.fn(async (_params: Record<string, unknown>, _opts: { idempotencyKey: string }) => {
        log.push("stripe:pi.create")
        intents.set("pi_1", "requires_confirmation")
        return { id: "pi_1", status: "requires_confirmation" }
      }),
      retrieve: jest.fn(async (id: string) => {
        log.push(`stripe:pi.retrieve:${id}`)
        return { id, status: intents.get(id) ?? "requires_payment_method" }
      }),
      confirm: jest.fn(
        async (id: string, _params: Record<string, unknown>, _opts: { idempotencyKey: string }) => {
          log.push(`stripe:pi.confirm:${id}`)
          intents.set(id, intentStatus)
          return { id, status: intentStatus }
        }
      ),
    },
  } satisfies RenewalStripeLike
  const container = makeContainer({ [SUBSCRIPTION_MODULE]: svc }) as unknown as MedusaContainer
  return { svc, stripe, container, log, intents }
}

const recorded = (status: string, payment_intent_id: string | null) => ({
  renewal_charge: {
    period_start: PERIOD_START,
    idempotency_key: KEY,
    amount: 1000,
    currency_code: "usd",
    status,
    payment_intent_id,
    recorded_at: "2026-10-01T00:05:00.000Z",
  },
})

describe("executeRenewalCharge", () => {
  it("charges the saved method off-session, confirm + automatic capture, integer cents", async () => {
    const { stripe, container } = setup()
    const out = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 19.99, currency_code: "USD" },
      { stripe }
    )

    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1)
    const [params, opts] = stripe.paymentIntents.create.mock.calls[0]
    expect(params).toMatchObject({
      amount: 1999,
      currency: "usd",
      customer: "cus_stripe_1",
      payment_method: "pm_saved",
      confirm: false,
      capture_method: "automatic",
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { type: "subscription_renewal", subscription_id: "sub_1", period_start: PERIOD_START },
    })
    // off_session is only valid on create with confirm=true; it goes on the confirm.
    expect(params).not.toHaveProperty("off_session")
    expect(opts).toEqual({ idempotencyKey: KEY })
    expect(stripe.paymentIntents.confirm).toHaveBeenCalledTimes(1)
    expect(stripe.paymentIntents.confirm.mock.calls[0]).toEqual([
      "pi_1",
      { payment_method: "pm_saved", off_session: true },
      { idempotencyKey: `${KEY}:confirm:pi_1` },
    ])
    expect(out).toMatchObject({ status: "succeeded", payment_intent_id: "pi_1", amount: 1999, replayed: false })
  })

  it("records the charge BEFORE Stripe is called, and the intent id BEFORE it is confirmed", async () => {
    const { svc, stripe, container, log } = setup()
    const seenAtConfirm: unknown[] = []
    const realConfirm = stripe.paymentIntents.confirm.getMockImplementation()!
    stripe.paymentIntents.confirm.mockImplementation(async (id, params, opts) => {
      seenAtConfirm.push(svc.store.get("sub_1")?.metadata)
      return realConfirm(id, params, opts)
    })
    await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    )
    expect(log).toEqual([
      "record:pending",
      "stripe:pm.retrieve",
      "stripe:pi.create",
      "record:pending",
      "stripe:pi.confirm:pi_1",
      "record:succeeded",
    ])
    expect(seenAtConfirm[0]).toMatchObject({
      renewal_charge: { status: "pending", payment_intent_id: "pi_1" },
    })
    expect(svc.store.get("sub_1")?.metadata).toMatchObject({
      initial_order_id: "order_0",
      renewal_charge: {
        period_start: PERIOD_START,
        idempotency_key: KEY,
        amount: 1000,
        currency_code: "usd",
        status: "succeeded",
        payment_intent_id: "pi_1",
      },
    })
    // Recording a charge never rolls the period.
    expect(svc.store.get("sub_1")?.last_order_date).toEqual(new Date("2026-09-01T00:00:00.000Z"))
  })

  it("the key comes from the record, not the attempt: a dunning retry date or counter does not change it", async () => {
    const { stripe, container } = setup({
      next_order_date: new Date("2026-10-04T00:00:00.000Z"),
      metadata: { dunning_attempts: 2 },
    })
    await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    )
    expect(stripe.paymentIntents.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY })
  })

  it("a missing payment method is a dunning failure, never a free renewal", async () => {
    const { svc, stripe, container } = setup({ payment_method_id: null })
    const err = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RenewalChargeError)
    expect((err as RenewalChargeError).code).toBe("no_payment_method")
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(svc.store.get("sub_1")?.metadata).toMatchObject({
      renewal_charge: { status: "failed", failure_reason: "no_payment_method" },
    })
  })

  it("a cycle already collected is never presented again", async () => {
    const { stripe, container } = setup({ metadata: recorded("succeeded", "pi_prev") })
    const out = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    )
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(stripe.paymentIntents.confirm).not.toHaveBeenCalled()
    expect(out).toMatchObject({ replayed: true, payment_intent_id: "pi_prev", status: "succeeded" })
  })

  it("a cycle recorded `processing` (money in flight) is never presented again — days later included", async () => {
    const { stripe, container } = setup({ metadata: recorded("processing", "pi_ach") })
    const out = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe, now: new Date("2026-10-04T00:00:00.000Z") }
    )
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(stripe.paymentIntents.confirm).not.toHaveBeenCalled()
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(out).toMatchObject({ replayed: true, payment_intent_id: "pi_ach", status: "processing" })
  })

  it("crash after the confirm (left `pending` with an intent id): the intent is read, not charged again", async () => {
    const { svc, stripe, container, intents } = setup({ metadata: recorded("pending", "pi_1") })
    intents.set("pi_1", "succeeded")
    const out = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    )
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1")
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(stripe.paymentIntents.confirm).not.toHaveBeenCalled()
    expect(out).toMatchObject({ replayed: true, status: "succeeded", payment_intent_id: "pi_1" })
    expect(svc.store.get("sub_1")?.metadata).toMatchObject({
      renewal_charge: { status: "succeeded", payment_intent_id: "pi_1" },
    })
  })

  it("a dunning retry of a declined cycle re-confirms the SAME intent — never a second one", async () => {
    const { stripe, container, intents } = setup({ metadata: recorded("failed", "pi_1") })
    intents.set("pi_1", "requires_payment_method")
    const out = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe, now: new Date("2026-10-04T00:00:00.000Z") }
    )
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
    expect(stripe.paymentIntents.confirm).toHaveBeenCalledTimes(1)
    expect(stripe.paymentIntents.confirm.mock.calls[0][0]).toBe("pi_1")
    expect(out).toMatchObject({ status: "succeeded", payment_intent_id: "pi_1", replayed: false })
  })

  it("an intent Stripe canceled is replaced under a key that names it", async () => {
    const { stripe, container, intents } = setup({ metadata: recorded("failed", "pi_dead") })
    intents.set("pi_dead", "canceled")
    await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    )
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1)
    expect(stripe.paymentIntents.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `${KEY}:replaces:pi_dead`,
    })
    expect(stripe.paymentIntents.confirm.mock.calls[0][0]).toBe("pi_1")
  })

  it("a confirm refused because the intent already collected is recorded as collected, not failed", async () => {
    const { svc, stripe, container, intents } = setup()
    stripe.paymentIntents.confirm.mockImplementationOnce(async (id: string) => {
      intents.set(id, "succeeded")
      throw Object.assign(new Error("already succeeded"), { code: "payment_intent_unexpected_state" })
    })
    const out = await executeRenewalCharge(
      container,
      { subscription_id: "sub_1", amount: 10, currency_code: "usd" },
      { stripe }
    )
    expect(out).toMatchObject({ status: "succeeded", payment_intent_id: "pi_1" })
    expect(svc.store.get("sub_1")?.metadata).toMatchObject({
      renewal_charge: { status: "succeeded", payment_intent_id: "pi_1" },
    })
  })

  it("a decline is recorded failed (keeping the intent id) and thrown so the job runs dunning", async () => {
    const { svc, stripe, container } = setup()
    stripe.paymentIntents.confirm.mockRejectedValueOnce(
      Object.assign(new Error("Your card was declined."), { code: "card_declined" })
    )
    await expect(
      executeRenewalCharge(container, { subscription_id: "sub_1", amount: 10, currency_code: "usd" }, { stripe })
    ).rejects.toMatchObject({ name: "RenewalChargeError", code: "payment_failed" })
    expect(svc.store.get("sub_1")?.metadata).toMatchObject({
      renewal_charge: { status: "failed", failure_reason: "card_declined", payment_intent_id: "pi_1" },
    })
  })

  it("an intent that needs customer action did not collect: failed", async () => {
    const { stripe, container } = setup({}, "requires_action")
    await expect(
      executeRenewalCharge(container, { subscription_id: "sub_1", amount: 10, currency_code: "usd" }, { stripe })
    ).rejects.toMatchObject({ code: "payment_failed" })
  })

  it("a method not attached to a Stripe customer fails closed", async () => {
    const { stripe, container } = setup()
    stripe.paymentMethods.retrieve.mockResolvedValueOnce({ id: "pm_saved", customer: null } as never)
    await expect(
      executeRenewalCharge(container, { subscription_id: "sub_1", amount: 10, currency_code: "usd" }, { stripe })
    ).rejects.toMatchObject({ code: "payment_method_has_no_customer" })
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled()
  })

  describe("without a Stripe key", () => {
    const saved = process.env.STRIPE_API_KEY
    afterEach(() => {
      if (saved === undefined) delete process.env.STRIPE_API_KEY
      else process.env.STRIPE_API_KEY = saved
    })

    it("fails closed (billing_not_configured) after recording the attempt", async () => {
      delete process.env.STRIPE_API_KEY
      const { svc, container } = setup()
      await expect(
        executeRenewalCharge(container, { subscription_id: "sub_1", amount: 10, currency_code: "usd" })
      ).rejects.toMatchObject({ code: "billing_not_configured" })
      expect(svc.store.get("sub_1")?.metadata).toMatchObject({
        renewal_charge: { status: "failed", failure_reason: "billing_not_configured" },
      })
    })
  })
})
