import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { cardOrderFixtures } from "./helpers/card-orders"
import { syncCardChargeFromStripe, type ChargeLedgerState } from "../../src/lib/card-stripe-sync"
import { PayoutHeldError } from "../../src/modules/hawala-ledger/service"
import { resyncCardChargesFromStripe } from "../../src/jobs/hawala-card-stripe-resync"
import { reconcileCardOrder } from "../../src/lib/card-order-reconcile"
import {
  VENDOR_DISPUTE_FEE_LEG,
  VENDOR_RECEIVABLE_ACCOUNT_TYPE,
  VENDOR_REFUND_RECOVERY_LEG,
  VendorReceivableLegError,
} from "../../src/modules/hawala-ledger/vendor-receivable"
import { CARD_PROCESSING_ACCOUNT_TYPE, CARD_PROCESSING_OWNER_ID } from "../../src/modules/hawala-ledger/card-processing"

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
    const { container, cents, uid, makeSeller, makeOrder, pay, refund, split, hawala, legs, captured, placed, sellerEarnings } =
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
        dispute_fee_cents: 0,
        ...s,
      }
      // As Stripe reports it: what every dispute covered, whatever its outcome.
      if (s.disputed_cents === undefined) state.disputed_cents = state.dispute_open_cents + state.dispute_lost_cents
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

    describe("the hourly re-read (a webhook Stripe never delivered)", () => {
      /** Stripe's current answer per charge; the job asks for whichever it re-reads. */
      const stripeNow = (...states: Array<ReturnType<typeof stripeSays>>) => {
        const byCharge = new Map<string, () => Promise<ChargeLedgerState>>()
        for (const s of states) byCharge.set(s.chargeId, s.fetchCharge)
        const asked: string[] = []
        const fetchCharge = async (id: string) => {
          asked.push(id)
          const f = byCharge.get(id)
          if (!f) throw new Error(`no such charge ${id}`)
          return f()
        }
        return { fetchCharge, asked }
      }

      it("an open dispute whose close never arrived: re-read, the hold lifts once Stripe says it was won", async () => {
        const { order, collectionId, pi } = await cardOrder()
        const open = stripeSays(pi, 40, { dispute_open_cents: 4000 })
        await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
        expect(await holds(collectionId)).toHaveLength(1)

        // The dispute was won; the charge.dispute.closed event was lost.
        const stripe = stripeNow(stripeSays(pi, 40))
        const result = await resyncCardChargesFromStripe(container(), {
          listRecentCharges: async () => [],
          fetchCharge: stripe.fetchCharge,
        })
        expect(stripe.asked).toContain(open.chargeId)
        expect(result.counts.synced).toBeGreaterThanOrEqual(1)
        expect(await holds(collectionId)).toEqual([])
        expect(await toCard(order.id)).toEqual([])
      })

      it("a dispute lost while its events were lost posts as a refund of the order", async () => {
        const { order, collectionId, pi } = await cardOrder()
        const open = stripeSays(pi, 40, { dispute_open_cents: 4000 })
        await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
        const stripe = stripeNow(stripeSays(pi, 40, { dispute_lost_cents: 4000 }))
        await resyncCardChargesFromStripe(container(), { listRecentCharges: async () => [], fetchCharge: stripe.fetchCharge })
        expect(await toCard(order.id)).toEqual([4000])
        expect(await holds(collectionId)).toEqual([])
      })

      it("a dashboard refund and a new dispute that never arrived as events are found from Stripe's own lists", async () => {
        const refunded = await cardOrder()
        const disputed = await cardOrder()
        const r = stripeSays(refunded.pi, 40, { refunded_cents: 1500 })
        const d = stripeSays(disputed.pi, 40, { dispute_open_cents: 4000 })
        const stripe = stripeNow(r, d)
        const since: Date[] = []
        await resyncCardChargesFromStripe(container(), {
          listRecentCharges: async (s) => {
            since.push(s)
            return [r.chargeId, d.chargeId, "ch_not_ours"]
          },
          fetchCharge: stripe.fetchCharge,
          now: new Date("2026-10-07T12:00:00Z"),
        })
        expect(since[0].toISOString()).toBe("2026-10-04T12:00:00.000Z")
        expect(await toCard(refunded.order.id)).toEqual([1500])
        expect(await holds(disputed.collectionId)).toHaveLength(1)
        // Run again: nothing more posts.
        await resyncCardChargesFromStripe(container(), {
          listRecentCharges: async () => [r.chargeId, d.chargeId],
          fetchCharge: stripe.fetchCharge,
        })
        expect(await toCard(refunded.order.id)).toEqual([1500])
        expect(await holds(disputed.collectionId)).toHaveLength(1)
      })

      it("when Stripe's lists cannot be read, open disputes on record are still re-read", async () => {
        const { collectionId, pi } = await cardOrder()
        const open = stripeSays(pi, 40, { dispute_open_cents: 4000 })
        await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
        const stripe = stripeNow(stripeSays(pi, 40))
        const result = await resyncCardChargesFromStripe(container(), {
          listRecentCharges: async () => {
            throw new Error("stripe unavailable")
          },
          fetchCharge: stripe.fetchCharge,
        })
        expect(result.listed).toBe(false)
        expect(await holds(collectionId)).toEqual([])
      })
    })

    describe("Stripe's dispute fee: owed by the vendor whose order was disputed (operator answer 2026-10-07)", () => {
      const feeLegs = async (orderId: string) =>
        (await hawala().listLedgerEntries({ reference_id: orderId, entry_type: "ADJUSTMENT" })).filter(
          (e: { metadata?: { leg?: string } }) => e.metadata?.leg === VENDOR_DISPUTE_FEE_LEG
        )
      const owed = async (sellerId: string) => hawala().getCardProcessingReceivable((await sellerEarnings(sellerId)).id)

      it("owed as soon as the dispute opens, once however often it is re-read, and still owed once the dispute is won", async () => {
        const { seller, order, collectionId, pi } = await cardOrder()
        const open = stripeSays(pi, 40, { dispute_open_cents: 4000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
        await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })

        const [leg, ...more] = await feeLegs(order.id)
        expect(more).toEqual([])
        expect(cents(leg.amount)).toBe(1500)
        expect(leg).toMatchObject({ status: "COMPLETED", entry_type: "ADJUSTMENT", reference_type: "ORDER" })
        expect(leg.order_id ?? null).toBeNull()
        const [receivableAcc] = await hawala().listLedgerAccounts({ account_type: VENDOR_RECEIVABLE_ACCOUNT_TYPE })
        const [processingAcc] = await hawala().listLedgerAccounts({
          account_type: CARD_PROCESSING_ACCOUNT_TYPE,
          owner_type: "SYSTEM",
          owner_id: CARD_PROCESSING_OWNER_ID,
        })
        expect(leg.debit_account_id).toBe(receivableAcc.id)
        expect(leg.credit_account_id).toBe(processingAcc.id)
        expect((await owed(seller.id)).by_kind_cents).toEqual({ card_processing: 0, refund: 0, dispute_fee: 1500 })
        expect((await owed(seller.id)).open[0]).toMatchObject({ kind: "dispute_fee", order_id: order.id })

        // Won: the hold lifts, nothing posts as a refund, the fee stays owed.
        const won = stripeSays(pi, 40, { dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), won.chargeId, { fetchCharge: won.fetchCharge })
        expect(await holds(collectionId)).toEqual([])
        expect(await toCard(order.id)).toEqual([])
        expect(await feeLegs(order.id)).toHaveLength(1)
        expect((await owed(seller.id)).total_cents).toBe(1500)

        // What can be paid out is the balance net of it.
        const earningsCents = cents((await sellerEarnings(seller.id)).available_balance)
        const options = await hawala().getPayoutOptions(seller.id)
        expect(options).toMatchObject({ dispute_fee_owed: 15, total_owed: 15, payout_hold: null })
        expect(cents(options.payable_balance)).toBe(earningsCents - 1500)
      })

      it("the vendor's next sale repays it first, back to the receivable", async () => {
        const { seller, order, pi } = await cardOrder()
        const d = stripeSays(pi, 40, { dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), d.chargeId, { fetchCharge: d.fetchCharge })
        const earnings = await sellerEarnings(seller.id)
        const before = cents(earnings.balance)

        const next = await makeOrder(seller.id, 40)
        await pay([next.id], 40, { capture: true })
        await placed(next.id)
        const credit = (await legs(next.id)).find((e) => e.entry_type === "TRANSFER")
        const recovery = (
          await hawala().listLedgerEntries({ debit_account_id: earnings.id, entry_type: "ADJUSTMENT" })
        ).filter((e: { metadata?: { leg?: string } }) => e.metadata?.leg === VENDOR_REFUND_RECOVERY_LEG)
        expect(recovery).toHaveLength(1)
        expect(cents(recovery[0].amount)).toBe(1500)
        expect(cents((await sellerEarnings(seller.id)).balance)).toBe(before + cents(credit.amount) - 1500)
        expect((await owed(seller.id)).total_cents).toBe(0)
        expect(order.id).toBeTruthy()
      })

      it("lost: the order is refunded in full and the fee stays owed — the refund never reverses it", async () => {
        const { seller, order, pi } = await cardOrder()
        const open = stripeSays(pi, 40, { dispute_open_cents: 4000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), open.chargeId, { fetchCharge: open.fetchCharge })
        const lost = stripeSays(pi, 40, { dispute_lost_cents: 4000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), lost.chargeId, { fetchCharge: lost.fetchCharge })
        expect(await toCard(order.id)).toEqual([4000])
        expect((await legs(order.id)).find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
        const [leg, ...more] = await feeLegs(order.id)
        expect(more).toEqual([])
        expect(leg.status).toBe("COMPLETED")
        expect((await owed(seller.id)).by_kind_cents.dispute_fee).toBe(1500)
      })

      it("a dispute first seen already lost (no open phase) still posts its fee, though the order is then fully refunded", async () => {
        const { seller, order, pi } = await cardOrder()
        const lost = stripeSays(pi, 40, { dispute_lost_cents: 4000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), lost.chargeId, { fetchCharge: lost.fetchCharge })
        expect(await toCard(order.id)).toEqual([4000])
        expect(await feeLegs(order.id)).toHaveLength(1)
        expect((await reconcileCardOrder(container(), order.id)).outcome).toBe("in_step")
        expect(await feeLegs(order.id)).toHaveLength(1)
        expect((await owed(seller.id)).by_kind_cents.dispute_fee).toBe(1500)
      })

      it("a dispute filed after the order was already refunded in full still posts its fee", async () => {
        const { seller, order, pi } = await cardOrder()
        const refunded = stripeSays(pi, 40, { refunded_cents: 4000 })
        await syncCardChargeFromStripe(container(), refunded.chargeId, { fetchCharge: refunded.fetchCharge })
        expect((await legs(order.id)).find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
        expect(await feeLegs(order.id)).toEqual([])

        const disputed = stripeSays(pi, 40, { refunded_cents: 4000, dispute_open_cents: 4000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), disputed.chargeId, { fetchCharge: disputed.fetchCharge })
        expect(await feeLegs(order.id)).toHaveLength(1)
        expect((await owed(seller.id)).by_kind_cents.dispute_fee).toBe(1500)
      })

      it("on a shared Mercur cart each seller owes a share in proportion to their order, summing to the fee", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        await split(o2.id, collectionId, 30)
        await captured(paymentId)
        const pi = await intentFor(paymentId)
        const d = stripeSays(pi, 70, { dispute_open_cents: 7000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), d.chargeId, { fetchCharge: d.fetchCharge })
        const shares = [cents((await feeLegs(o1.id))[0]?.amount), cents((await feeLegs(o2.id))[0]?.amount)]
        expect(shares).toEqual([857, 643])
        expect((await owed(s1.id)).by_kind_cents.dispute_fee).toBe(857)
        expect((await owed(s2.id)).by_kind_cents.dispute_fee).toBe(643)
      })

      it("a fee that rises (a second dispute) posts only the difference; a lower figure later posts nothing", async () => {
        const { seller, order, pi } = await cardOrder()
        const first = stripeSays(pi, 40, { dispute_open_cents: 4000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), first.chargeId, { fetchCharge: first.fetchCharge })
        const second = stripeSays(pi, 40, { dispute_open_cents: 4000, disputed_cents: 8000, dispute_fee_cents: 3000 })
        await syncCardChargeFromStripe(container(), second.chargeId, { fetchCharge: second.fetchCharge })
        const rows = await feeLegs(order.id)
        expect(rows.map((e: { amount: unknown }) => cents(e.amount))).toEqual([1500, 1500])
        expect(rows.map((e: { idempotency_key: string }) => e.idempotency_key.replace(/^.*-to-/, "to-")).sort()).toEqual([
          "to-1500-0",
          "to-3000-1",
        ])
        expect((await owed(seller.id)).by_kind_cents.dispute_fee).toBe(3000)
        await syncCardChargeFromStripe(container(), first.chargeId, { fetchCharge: first.fetchCharge })
        expect(await feeLegs(order.id)).toHaveLength(2)
        expect((await owed(seller.id)).by_kind_cents.dispute_fee).toBe(3000)
      })

      it("an earlier attempt that FAILED is retried under the next sequence, not handed back", async () => {
        const { seller, order, pi } = await cardOrder()
        const d = stripeSays(pi, 40, { dispute_open_cents: 4000, dispute_fee_cents: 1500 })
        // A first attempt whose balance move failed: its key is taken, FAILED.
        const [receivableAcc] = await hawala().listLedgerAccounts({ account_type: VENDOR_RECEIVABLE_ACCOUNT_TYPE })
        const receivable = receivableAcc ?? (await hawala().getOrCreateVendorReceivableAccount())
        const processing = await hawala().getOrCreateCardProcessingAccount()
        await hawala().createLedgerEntries({
          debit_account_id: receivable.id,
          credit_account_id: processing.id,
          amount: 15,
          currency_code: "USD",
          entry_type: "ADJUSTMENT",
          status: "FAILED",
          reference_type: "ORDER",
          reference_id: order.id,
          idempotency_key: `dispute-fee-${d.chargeId}-${order.id}-to-1500-0`,
          metadata: {
            leg: VENDOR_DISPUTE_FEE_LEG,
            stripe_charge_id: d.chargeId,
            owed_by_account_id: (await sellerEarnings(seller.id)).id,
          },
        })
        await syncCardChargeFromStripe(container(), d.chargeId, { fetchCharge: d.fetchCharge })
        const completed = (await feeLegs(order.id)).filter((e: { status: string }) => e.status === "COMPLETED")
        expect(completed).toHaveLength(1)
        expect(completed[0].idempotency_key).toBe(`dispute-fee-${d.chargeId}-${order.id}-to-1500-1`)
        expect((await owed(seller.id)).by_kind_cents.dispute_fee).toBe(1500)
      })

      it("a partial dispute on a shared cart is put on no seller (which order was disputed is unknown)", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        await split(o2.id, collectionId, 30)
        await captured(paymentId)
        const pi = await intentFor(paymentId)
        const d = stripeSays(pi, 70, { dispute_open_cents: 3000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), d.chargeId, { fetchCharge: d.fetchCharge })
        expect(await feeLegs(o1.id)).toEqual([])
        expect(await feeLegs(o2.id)).toEqual([])
        expect((await owed(s1.id)).total_cents).toBe(0)
        expect((await owed(s2.id)).total_cents).toBe(0)
      })

      it("a shared collection with no split rows is put on no seller", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await captured(paymentId)
        const pi = await intentFor(paymentId)
        const d = stripeSays(pi, 70, { dispute_open_cents: 7000, dispute_fee_cents: 1500 })
        await syncCardChargeFromStripe(container(), d.chargeId, { fetchCharge: d.fetchCharge })
        expect(await feeLegs(o1.id)).toEqual([])
        expect(await feeLegs(o2.id)).toEqual([])
      })

      it("the fee shape cannot be written through caller-supplied metadata (what the admin manual-transfer route forwards)", async () => {
        const { order } = await cardOrder()
        const receivable = await hawala().getOrCreateVendorReceivableAccount()
        const processing = await hawala().getOrCreateCardProcessingAccount()
        await expect(
          hawala().createTransfer({
            debit_account_id: receivable.id,
            credit_account_id: processing.id,
            amount: 50000,
            entry_type: "ADJUSTMENT",
            reference_type: "ORDER",
            reference_id: order.id,
            idempotency_key: `forged-${order.id}`,
            metadata: { leg: VENDOR_DISPUTE_FEE_LEG, stripe_charge_id: "ch_forged" },
          })
        ).rejects.toThrow(VendorReceivableLegError)
        expect(cents((await hawala().retrieveLedgerAccount(processing.id)).balance)).toBe(cents(processing.balance))
        expect(await feeLegs(order.id)).toEqual([])
      })

      it("a charge with no dispute fee owes nothing", async () => {
        const { seller, order, pi } = await cardOrder()
        const r = stripeSays(pi, 40, { refunded_cents: 1000 })
        await syncCardChargeFromStripe(container(), r.chargeId, { fetchCharge: r.fetchCharge })
        expect(await feeLegs(order.id)).toEqual([])
        expect((await owed(seller.id)).total_cents).toBe(0)
      })
    })
  },
})
