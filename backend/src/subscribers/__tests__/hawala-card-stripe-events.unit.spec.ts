import Stripe from "stripe"
import hawalaCardStripeEvents from "../hawala-card-stripe-events"
import { chargeIdOfStripeEvent, syncCardChargeFromStripe } from "../../lib/card-stripe-sync"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

/**
 * The subscriber that hands Stripe charge and dispute events to the card
 * ledger (SD-43). What the sync then does is proved on a real database
 * (integration-tests/http/hawala-card-stripe-sync.spec.ts); here: it acts
 * only on a correctly signed event, through FBM's own Stripe registration,
 * of a charge / refund / dispute type, with the flag on — and it names the
 * charge right for each event shape. Signatures are real.
 */

jest.mock("../../lib/card-stripe-sync", () => ({
  ...jest.requireActual("../../lib/card-stripe-sync"),
  syncCardChargeFromStripe: jest.fn(async (_c: unknown, chargeId: string) => ({ outcome: "synced", charge_id: chargeId, reconciled: [] })),
}))
const sync = syncCardChargeFromStripe as jest.MockedFunction<typeof syncCardChargeFromStripe>

const SECRET = "whsec_test_card_ledger"
const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

const eventJson = (type: string, object: Record<string, unknown>) =>
  JSON.stringify({ id: `evt_${type}`, object: "event", type, data: { object } })
const input = (payload: string, opts: { provider?: string; secret?: string } = {}) => ({
  provider: opts.provider ?? "stripe_stripe",
  payload: {
    rawData: Buffer.from(payload),
    headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? SECRET }) },
  },
})
const run = (data: unknown) =>
  hawalaCardStripeEvents({ event: { name: "payment.webhook_received", data }, container: {} } as never)

const refunded = eventJson("charge.refunded", { id: "ch_1", object: "charge", amount_refunded: 1000 })

beforeEach(() => {
  process.env[CARD] = "true"
  process.env.STRIPE_WEBHOOK_SECRET = SECRET
})
afterEach(() => {
  delete process.env[CARD]
  delete process.env.STRIPE_WEBHOOK_SECRET
  jest.clearAllMocks()
})

it("a signed charge.refunded through FBM's Stripe registration syncs that charge", async () => {
  await run(input(refunded))
  expect(sync).toHaveBeenCalledWith({}, "ch_1")
})

it.each([
  ["a bad signature", input(refunded, { secret: "whsec_other" })],
  ["another provider", input(refunded, { provider: "stripe-connect-direct_stripe_connect_direct" })],
  ["an event type that cannot change a charge", input(eventJson("payment_intent.succeeded", { id: "pi_1", object: "payment_intent" }))],
])("does nothing for %s", async (_why, data) => {
  await run(data)
  expect(sync).not.toHaveBeenCalled()
})

it("does nothing with the flag off, or without the webhook secret", async () => {
  delete process.env[CARD]
  await run(input(refunded))
  process.env[CARD] = "true"
  delete process.env.STRIPE_WEBHOOK_SECRET
  await run(input(refunded))
  expect(sync).not.toHaveBeenCalled()
})

it("names the charge for each event shape: a charge, a refund, a dispute", () => {
  const ev = (type: string, object: Record<string, unknown>) => JSON.parse(eventJson(type, object))
  expect(chargeIdOfStripeEvent(ev("charge.refunded", { id: "ch_a", object: "charge" }))).toBe("ch_a")
  expect(chargeIdOfStripeEvent(ev("charge.refund.updated", { id: "re_1", object: "refund", charge: "ch_b" }))).toBe("ch_b")
  expect(chargeIdOfStripeEvent(ev("charge.dispute.closed", { id: "dp_1", object: "dispute", charge: { id: "ch_c" } }))).toBe("ch_c")
  expect(chargeIdOfStripeEvent(ev("charge.dispute.created", { id: "dp_2", object: "dispute", charge: "ch_d" }))).toBe("ch_d")
  expect(chargeIdOfStripeEvent(ev("customer.created", { id: "cus_1", object: "customer" }))).toBeNull()
})
