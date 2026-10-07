import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { SPLIT_ORDER_PAYMENT_MODULE } from "@mercurjs/b2c-core/modules/split-order-payment"
import { PAYOUT_BREAKDOWN_MODULE } from "../../src/modules/payout-breakdown"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { cardOrderFixtures } from "./helpers/card-orders"
import hawalaOrderRefundSubscriber from "../../src/subscribers/hawala-order-refund"
import hawalaCardOrderReconcileJob from "../../src/jobs/hawala-card-order-reconcile"
import { reconcileCardOrder } from "../../src/lib/card-order-reconcile"

jest.setTimeout(240 * 1000)

/**
 * SD-36 / SD-39 on a real migrated database: the real order, payment, seller,
 * split-order-payment and link modules, the real subscribers and job, and the
 * real hawala ledger — nothing about the order or its money is mocked. That
 * is the point: the unit specs mocked exactly the reads that turned out to be
 * wrong (an Order `customer` relation that does not exist, totals that are
 * never computed without item fields, major units read as cents, a seller id
 * the Order model does not carry).
 *
 * Payments are taken with Medusa's built-in `pp_system_default` provider (no
 * network), then re-labelled `pp_stripe_stripe` in the database — the
 * provider id is the only thing the settlement code reads from the payment.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const {
      container,
      cents,
      makeSeller,
      makeOrder,
      setProvider,
      pay,
      refund,
      split,
      hawala,
      legs,
      sellerEarnings,
      clearing,
      placed,
      captured,
      refunded,
    } = cardOrderFixtures(getContainer)

    beforeEach(() => {
      process.env[CARD] = "true"
    })
    afterEach(() => {
      delete process.env[CARD]
    })

    describe("SD-39: the legacy order read, flag off", () => {
      it("throws on the Order model's missing `customer` relation, so it never settled anything", async () => {
        delete process.env[CARD]
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        await pay([order.id], 40, { capture: true })
        await placed(order.id)
        expect(await legs(order.id)).toEqual([])
        const breakdowns = await container().resolve(PAYOUT_BREAKDOWN_MODULE).listOrderPayoutBreakdowns({ order_id: order.id })
        expect(breakdowns).toEqual([])
      })
    })

    describe("single-order card checkout", () => {
      it("captured at placement: settles $40.00 (not $0.40) from card clearing to the order's REAL seller, with a breakdown", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        await pay([order.id], 40, { capture: true })
        await placed(order.id)

        const rows = await legs(order.id)
        const purchase = rows.find((e) => e.entry_type === "PURCHASE")
        const fee = rows.find((e) => e.entry_type === "COMMISSION")
        const sellerLeg = rows.find((e) => e.entry_type === "TRANSFER")
        expect(cents(purchase.amount)).toBe(4000)
        expect(purchase.status).toBe("COMPLETED")
        expect(purchase.metadata.funding).toBe("card")
        expect(purchase.debit_account_id).toBe((await clearing()).id)
        expect(cents(fee.amount)).toBeGreaterThan(0)
        expect(cents(fee.amount) + cents(sellerLeg.amount)).toBe(4000)
        expect(sellerLeg.credit_account_id).toBe((await sellerEarnings(seller.id)).id)
        expect(await hawala().listLedgerAccounts({ owner_id: "default-seller" })).toEqual([])
        expect(await hawala().listLedgerAccounts({ account_type: "USER_WALLET", owner_id: order.customer_id })).toEqual([])
        const breakdowns = await container().resolve(PAYOUT_BREAKDOWN_MODULE).listOrderPayoutBreakdowns({ order_id: order.id })
        expect(breakdowns).toHaveLength(1)
      })

      it("authorised only at placement: nothing; captured later: settles once, however many times the event arrives", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 25.5)
        const { paymentId } = await pay([order.id], 25.5, { capture: false })
        await placed(order.id)
        expect(await legs(order.id)).toEqual([])

        await setProvider(paymentId, "pp_system_default")
        await container().resolve(Modules.PAYMENT).capturePayment({ payment_id: paymentId, amount: 25.5 })
        await setProvider(paymentId, "pp_stripe_stripe")
        await captured(paymentId)
        await captured(paymentId)
        const purchases = (await legs(order.id)).filter((e) => e.entry_type === "PURCHASE")
        expect(purchases).toHaveLength(1)
        expect(cents(purchases[0].amount)).toBe(2550)
      })

      it("two partial refunds post as two deltas back to clearing; the second completes the refund and reverses the settlement", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        const { paymentId } = await pay([order.id], 40, { capture: true })
        await placed(order.id)
        const clearingBefore = cents((await clearing()).balance)

        await refund(paymentId, 10)
        await refunded(paymentId)
        await refunded(paymentId) // redelivery posts nothing
        let rows = await legs(order.id)
        const toCard = (rs: any[]) => rs.filter((e) => e.entry_type === "REFUND" && e.credit_account_id === rows[0].debit_account_id)
        expect(toCard(rows).map((e) => cents(e.amount))).toEqual([1000])
        expect(rows.find((e) => e.entry_type === "PURCHASE").status).toBe("COMPLETED")

        await refund(paymentId, 30)
        await refunded(paymentId)
        rows = await legs(order.id)
        expect(toCard(rows).map((e) => cents(e.amount))).toEqual([1000, 3000])
        expect(rows.find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
        expect(cents((await clearing()).balance) - clearingBefore).toBe(4000)
        expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
      })

      it("cancelling a card order defers to the money: no full refund is posted on top of what was refunded", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        const { paymentId } = await pay([order.id], 40, { capture: true })
        await placed(order.id)
        await refund(paymentId, 40)
        await hawalaOrderRefundSubscriber({
          event: { data: { id: order.id, reason: "Order cancelled" } },
          container: container(),
        } as any)
        await refunded(paymentId)
        const toCard = (await legs(order.id)).filter((e) => e.entry_type === "REFUND" && e.metadata == null && e.description?.includes("customer refund"))
        expect(toCard.map((e) => cents(e.amount))).toEqual([4000])
      })
    })

    describe("Mercur multi-seller cart: one collection, one order per seller", () => {
      it("each order settles for its own share at capture, before Mercur marks the splits captured", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        await split(o2.id, collectionId, 30)

        await captured(paymentId)
        const p1 = (await legs(o1.id)).find((e) => e.entry_type === "PURCHASE")
        const p2 = (await legs(o2.id)).find((e) => e.entry_type === "PURCHASE")
        expect(cents(p1.amount)).toBe(4000)
        expect(cents(p2.amount)).toBe(3000)
        expect((await legs(o1.id)).find((e) => e.entry_type === "TRANSFER").credit_account_id).toBe(
          (await sellerEarnings(s1.id)).id
        )
        expect((await legs(o2.id)).find((e) => e.entry_type === "TRANSFER").credit_account_id).toBe(
          (await sellerEarnings(s2.id)).id
        )
      })

      it("a Mercur split refund (no event) is posted by the reconciler to that seller's order only", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        const sp2 = await split(o2.id, collectionId, 30)
        await captured(paymentId)

        await container().resolve(SPLIT_ORDER_PAYMENT_MODULE).updateSplitOrderPayments({ id: sp2.id, refunded_amount: 15 })
        await hawalaCardOrderReconcileJob(container())
        await hawalaCardOrderReconcileJob(container()) // idempotent

        const refundsTo = async (orderId: string) =>
          (await legs(orderId)).filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
        expect((await refundsTo(o2.id)).map((e) => cents(e.amount))).toEqual([1500])
        expect(await refundsTo(o1.id)).toEqual([])
      })
    })

    describe("review findings (second adversarial review)", () => {
      it("a Medusa-native refund of the WHOLE shared collection (admin cancel) refunds every seller's order in full", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        await split(o2.id, collectionId, 30)
        await captured(paymentId)
        await refund(paymentId, 70)
        await hawalaOrderRefundSubscriber({ event: { data: { id: o1.id } }, container: container() } as any)
        await hawalaCardOrderReconcileJob(container())
        for (const [orderId, sellerId, c] of [[o1.id, s1.id, 4000], [o2.id, s2.id, 3000]] as const) {
          const rows = await legs(orderId)
          const toCard = rows.filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
          expect(toCard.map((e) => cents(e.amount))).toEqual([c])
          expect(rows.find((e) => e.entry_type === "PURCHASE").status).toBe("REVERSED")
          expect(cents((await sellerEarnings(sellerId)).balance)).toBe(0)
        }
      })

      it("a PARTIAL Medusa-native refund on a shared collection is attributed to no seller (needs a person)", async () => {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        await split(o2.id, collectionId, 30)
        await captured(paymentId)
        await refund(paymentId, 20)
        expect((await reconcileCardOrder(container(), o1.id)).outcome).toBe("unattributed_refund")
        expect((await reconcileCardOrder(container(), o2.id)).outcome).toBe("unattributed_refund")
        for (const id of [o1.id, o2.id]) {
          expect((await legs(id)).filter((e) => e.entry_type === "REFUND")).toEqual([])
        }
      })

      // Was "refused before any leg, retried whole" (SD-36). Operator answer
      // 2026-10-06 (SD-40): the vendor owes it. Covered in full, with the
      // recovery and the write-off, in hawala-vendor-refund-receivable.spec.ts.
      it("a refund after the vendor was paid out posts every leg; what they cannot cover is recorded as owed by them", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        const { paymentId } = await pay([order.id], 40, { capture: true })
        await placed(order.id)
        // The vendor's earnings leave the ledger (a payout).
        const earnings = await sellerEarnings(seller.id)
        const settlement = await hawala().getOrCreateSystemAccount("SETTLEMENT")
        await hawala().createTransfer({
          debit_account_id: earnings.id,
          credit_account_id: settlement.id,
          amount: Number(earnings.balance),
          entry_type: "WITHDRAWAL",
          idempotency_key: `test-payout-${order.id}`,
        })
        await refund(paymentId, 10)
        expect((await reconcileCardOrder(container(), order.id)).outcome).toBe("refund_posted")
        const toCard = (await legs(order.id)).filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
        expect(toCard.map((e) => cents(e.amount))).toEqual([1000])
        expect((await reconcileCardOrder(container(), order.id)).outcome).toBe("in_step")
      })

      // Chosen so per-part rounding drifts: at a 3% fee ($1.20 on $40) each
      // $10.50 part rounds its reversal UP to $0.32 and the $8.50 part to
      // $0.26 — $1.22 in all without the final-part remainder.
      it("partial refunds of 10.50 x3 + 8.50 reverse the platform fee exactly, not a cent more", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        const { paymentId } = await pay([order.id], 40, { capture: true })
        await placed(order.id)
        const fee = (await legs(order.id)).find((e) => e.entry_type === "COMMISSION")
        for (const amount of [10.5, 10.5, 10.5, 8.5]) {
          await refund(paymentId, amount)
          await refunded(paymentId)
        }
        const reversals = (await legs(order.id)).filter(
          (e) => e.entry_type === "REFUND" && e.debit_account_id === fee.credit_account_id
        )
        expect(reversals.reduce((sum, e) => sum + cents(e.amount), 0)).toBe(cents(fee.amount))
        expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
      })

      it("a settlement that died after its purchase leg is completed by the reconciler; a FAILED purchase is never built on", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        await pay([order.id], 40, { capture: true })
        // Only the purchase leg landed (a crash between legs).
        const clearingAccount = await hawala().getOrCreateCardClearingAccount()
        const escrow = await hawala().getOrCreateSystemAccount("ESCROW")
        await hawala().createTransfer({
          debit_account_id: clearingAccount.id,
          credit_account_id: escrow.id,
          amount: 40,
          entry_type: "PURCHASE",
          order_id: order.id,
          idempotency_key: `order-payment-${order.id}-purchase`,
          metadata: { funding: "card" },
        })
        await hawalaCardOrderReconcileJob(container())
        const rows = await legs(order.id)
        expect(rows.find((e) => e.entry_type === "TRANSFER")?.status).toBe("COMPLETED")
        expect(rows.filter((e) => e.entry_type === "PURCHASE")).toHaveLength(1)

        const other = await makeOrder(seller.id, 40)
        await pay([other.id], 40, { capture: true })
        await hawala().createLedgerEntries({
          debit_account_id: clearingAccount.id,
          credit_account_id: escrow.id,
          amount: 40,
          currency_code: "USD",
          entry_type: "PURCHASE",
          status: "FAILED",
          order_id: other.id,
          idempotency_key: `order-payment-${other.id}-purchase`,
          metadata: { funding: "card" },
        })
        expect((await reconcileCardOrder(container(), other.id)).outcome).toBe("needs_attention")
        expect((await legs(other.id)).map((e) => e.entry_type)).toEqual(["PURCHASE"])
      })

      it("concurrent reconciliations of one order post its refund once", async () => {
        const seller = await makeSeller()
        const order = await makeOrder(seller.id, 40)
        const { paymentId } = await pay([order.id], 40, { capture: true })
        await placed(order.id)
        await refund(paymentId, 25)
        await Promise.all([1, 2, 3, 4].map(() => reconcileCardOrder(container(), order.id)))
        const toCard = (await legs(order.id)).filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
        expect(toCard.map((e) => cents(e.amount))).toEqual([2500])
      })
    })

    it("a collection shared by two orders with no split rows is attributed to neither", async () => {
      const [s1, s2] = [await makeSeller(), await makeSeller()]
      const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
      const { paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
      await captured(paymentId)
      expect(await legs(o1.id)).toEqual([])
      expect(await legs(o2.id)).toEqual([])
    })
  },
})
