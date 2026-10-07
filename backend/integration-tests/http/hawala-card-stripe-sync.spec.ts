import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { cardOrderFixtures } from "./helpers/card-orders"
import { syncCardChargeFromStripe, type ChargeLedgerState } from "../../src/lib/card-stripe-sync"
import { PayoutHeldError } from "../../src/modules/hawala-ledger/service"

jest.setTimeout(240 * 1000)

/**
 * SD-43 on a real migrated database (operator answer 2026-10-06: "listen to
 * Stripe; a chargeback counts as a refund of that order"). Stripe's answer
 * for a charge is given (`fetchCharge`); everything from there — finding
 * the Medusa payment by its PaymentIntent, the charge-state row, the locked
 * reconciler, holds, the ledger legs — is the real code on real tables.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, cents, uid, makeSeller, makeOrder, pay, refund, split, hawala, legs, captured, placed } =
      cardOrderFixtures(getContainer)

    beforeEach(() => {
      process.env[CARD] = "true"
    })
    afterEach(() => {
      delete process.env[CARD]
    })

    /** Give the payment a PaymentIntent, as @medusajs/payment-stripe stores it. */
    async function intentFor(paymentId: string) {
      const pi = `pi_${uid()}`
      await container()
        .resolve(ContainerRegistrationKeys.PG_CONNECTION)
        .raw(`UPDATE payment SET data = ?::jsonb WHERE id = ?`, [JSON.stringify({ id: pi, object: "payment_intent" }), paymentId])
      return pi
    }
    const stripeSays = (pi: string, amount: number, s: Partial<ChargeLedgerState> = {}) => {
      const state: ChargeLedgerState = {
        charge_id: `ch_${pi}`,
        payment_intent_id: pi,
        currency: "usd",
        amount_cents: amount * 100,
        refunded_cents: 0,
        dispute_lost_cents: 0,
        dispute_open_cents: 0,
        ...s,
      }
      return { chargeId: state.charge_id, fetchCharge: async () => state }
    }
    const toCard = async (orderId: string) =>
      (await legs(orderId))
        .filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
        .map((e) => cents(e.amount))
    const holds = (collectionId: string, status = "ACTIVE") =>
      hawala().listPayoutHolds({ payment_collection_id: collectionId, status })

    async function cardOrder(amount = 40) {
      const seller = await makeSeller()
      const order = await makeOrder(seller.id, amount)
      const paid = await pay([order.id], amount, { capture: true })
      await placed(order.id)
      const pi = await intentFor(paymentIdOf(paid))
      return { seller, order, ...paid, pi }
    }
    const paymentIdOf = (p: { paymentId: string }) => p.paymentId

    it("a refund issued in the Stripe dashboard posts as a refund of the order; a repeated event posts nothing more", async () => {
      const { order, pi } = await cardOrder()
      const { chargeId, fetchCharge } = stripeSays(pi, 40, { refunded_cents: 1000 })
      const result = await syncCardChargeFromStripe(container(), chargeId, { fetchCharge })
      expect(result).toMatchObject({ outcome: "synced", reconciled: [{ order_id: order.id, outcome: "refund_posted" }] })
      expect(await toCard(order.id)).toEqual([1000])
      await syncCardChargeFromStripe(container(), chargeId, { fetchCharge })
      expect(await toCard(order.id)).toEqual([1000])
      const [state] = await hawala().listCardChargeStates({ stripe_charge_id: chargeId })
      expect(state).toMatchObject({ refunded_cents: 1000, payment_collection_id: expect.any(String) })
    })

    it("a refund made through Medusa is not counted twice: the larger of Medusa's and Stripe's figure", async () => {
      const { order, paymentId, pi } = await cardOrder()
      await refund(paymentId, 10)
      const { chargeId, fetchCharge } = stripeSays(pi, 40, { refunded_cents: 1000 })
      await syncCardChargeFromStripe(container(), chargeId, { fetchCharge })
      expect(await toCard(order.id)).toEqual([1000])
      // Stripe then shows a further dashboard refund of $5 on top.
      const more = stripeSays(pi, 40, { refunded_cents: 1500 })
      await syncCardChargeFromStripe(container(), more.chargeId, { fetchCharge: more.fetchCharge })
      expect(await toCard(order.id)).toEqual([1000, 500])
    })

    it("an open dispute holds the seller and posts nothing; won, the hold lifts and nothing was posted", async () => {
      const { seller, order, collectionId, pi } = await cardOrder()
      const open = stripeSays(pi, 40, { dispute_open_cents: 4000 })
      await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
      expect(await toCard(order.id)).toEqual([])
      const [hold] = await holds(collectionId)
      expect(hold).toMatchObject({ seller_id: seller.id, reason: "card_dispute_open" })
      await expect(
        hawala().requestPayout({ vendor_id: seller.id, amount: 1, payout_tier: "WEEKLY" })
      ).rejects.toThrow(PayoutHeldError)
      await expect(
        hawala().requestPayout({ vendor_id: seller.id, amount: 1, payout_tier: "WEEKLY" })
      ).rejects.toThrow(/disputed by the cardholder/)
      expect((await hawala().getPayoutOptions(seller.id)).payout_hold).toMatchObject({ reason: "card_dispute_open" })

      const won = stripeSays(pi, 40)
      await syncCardChargeFromStripe(container(), won.chargeId, { fetchCharge: won.fetchCharge })
      expect(await holds(collectionId)).toEqual([])
      expect(await toCard(order.id)).toEqual([])
    })

    it("a lost dispute counts as a refund of the order: posted in full, the settlement reversed, the hold lifted", async () => {
      const { order, collectionId, pi } = await cardOrder()
      const open = stripeSays(pi, 40, { dispute_open_cents: 4000 })
      await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
      const lost = stripeSays(pi, 40, { dispute_lost_cents: 4000 })
      await syncCardChargeFromStripe(container(), lost.chargeId, { fetchCharge: lost.fetchCharge })
      expect(await toCard(order.id)).toEqual([4000])
      expect((await legs(order.id)).find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
      expect(await holds(collectionId)).toEqual([])
    })

    it("on a shared Mercur cart a dashboard refund is attributed to no seller: every seller held until it is assigned", async () => {
      const [s1, s2] = [await makeSeller(), await makeSeller()]
      const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
      const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
      await split(o1.id, collectionId, 40)
      await split(o2.id, collectionId, 30)
      await captured(paymentId)
      const pi = await intentFor(paymentId)
      const { chargeId, fetchCharge } = stripeSays(pi, 70, { refunded_cents: 2000 })
      const result = await syncCardChargeFromStripe(container(), chargeId, { fetchCharge })
      expect(result).toMatchObject({ outcome: "synced" })
      expect((await holds(collectionId)).map((h: { seller_id: string }) => h.seller_id).sort()).toEqual([s1.id, s2.id].sort())
      for (const id of [o1.id, o2.id]) expect(await toCard(id)).toEqual([])
    })

    it("ignores a charge that paid nothing FBM knows, or another provider's payment; does nothing with the flag off", async () => {
      const unknown = stripeSays("pi_nobody", 10, { refunded_cents: 1000 })
      expect((await syncCardChargeFromStripe(container(), unknown.chargeId, { fetchCharge: unknown.fetchCharge })).outcome).toBe(
        "not_found"
      )
      const { paymentId, pi, order } = await cardOrder()
      await container()
        .resolve(ContainerRegistrationKeys.PG_CONNECTION)
        .raw(`UPDATE payment SET provider_id = 'pp_stripe_connect_direct' WHERE id = ?`, [paymentId])
      const other = stripeSays(pi, 40, { refunded_cents: 1000 })
      expect((await syncCardChargeFromStripe(container(), other.chargeId, { fetchCharge: other.fetchCharge })).outcome).toBe(
        "not_fbm_card"
      )
      delete process.env[CARD]
      expect((await syncCardChargeFromStripe(container(), other.chargeId, { fetchCharge: other.fetchCharge })).outcome).toBe(
        "flag_off"
      )
      expect(await toCard(order.id)).toEqual([])
    })
  },
})
