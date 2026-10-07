import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SPLIT_ORDER_PAYMENT_MODULE } from "@mercurjs/b2c-core/modules/split-order-payment"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { cardOrderFixtures } from "./helpers/card-orders"
import { reconcileCardOrder } from "../../src/lib/card-order-reconcile"
import {
  attributeCollectionRefund,
  readCollectionRefunds,
  RefundAttributionError,
} from "../../src/lib/card-refund-attribution"
import hawalaCardOrderReconcileJob from "../../src/jobs/hawala-card-order-reconcile"
import {
  VENDOR_RECEIVABLE_ACCOUNT_TYPE,
  VENDOR_REFUND_RECOVERY_LEG,
  VENDOR_REFUND_SHORTFALL_LEG,
  VendorReceivableLegError,
} from "../../src/modules/hawala-ledger/vendor-receivable"
import { PayoutHeldError } from "../../src/modules/hawala-ledger/service"

jest.setTimeout(240 * 1000)

/**
 * SD-40 on a real migrated database (operator answers 2026-10-06):
 *
 *   - "the vendor owes it": a card refund after the vendor's earnings were
 *     paid out posts in full, and what their earnings cannot cover is a
 *     receivable funded from the VENDOR_RECEIVABLE account, recovered from
 *     their next sales and before any payout, forgiven after 180 days;
 *   - "hold their payouts": a refund on a shared Mercur cart that no
 *     seller's order records holds every seller on the cart until an admin
 *     assigns it, which releases the holds and posts each order's share.
 *
 * Real order, payment, seller, split and link modules and the real ledger;
 * see `helpers/card-orders.ts`.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, cents, makeSeller, makeOrder, pay, refund, split, hawala, legs, sellerEarnings, placed, captured } =
      cardOrderFixtures(getContainer)

    beforeEach(() => {
      process.env[CARD] = "true"
    })
    afterEach(() => {
      delete process.env[CARD]
    })

    const receivable = async () =>
      (await hawala().listLedgerAccounts({ account_type: VENDOR_RECEIVABLE_ACCOUNT_TYPE }))[0]
    const escrowNet = async (orderId: string) => {
      const escrow = await hawala().getOrCreateSystemAccount("ESCROW")
      let net = 0
      for (const e of await legs(orderId)) {
        if (e.status !== "COMPLETED" && e.status !== "REVERSED") continue
        if (e.credit_account_id === escrow.id) net += cents(e.amount)
        if (e.debit_account_id === escrow.id) net -= cents(e.amount)
      }
      return net
    }

    /** A settled $40 card order whose seller has since been paid out in full. */
    async function paidOutOrder() {
      const seller = await makeSeller()
      const order = await makeOrder(seller.id, 40)
      const { paymentId } = await pay([order.id], 40, { capture: true })
      await placed(order.id)
      const earnings = await sellerEarnings(seller.id)
      await hawala().requestPayout({ vendor_id: seller.id, amount: Number(earnings.balance), payout_tier: "WEEKLY" })
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
      return { seller, order, paymentId, earnings }
    }

    describe("a card refund after the vendor was paid out: the vendor owes it", () => {
      it("posts every leg; the part the vendor cannot cover is a refund receivable, escrow nets to zero", async () => {
        const { seller, order, paymentId, earnings } = await paidOutOrder()
        await refund(paymentId, 10)
        expect((await reconcileCardOrder(container(), order.id)).outcome).toBe("refund_posted")

        const rows = await legs(order.id)
        const fee = rows.find((e) => e.entry_type === "COMMISSION")
        const feeReversal = rows.find((e) => e.entry_type === "REFUND" && e.debit_account_id === fee.credit_account_id)
        const owedLeg = rows.find((e) => e.metadata?.leg === VENDOR_REFUND_SHORTFALL_LEG)
        const toCard = rows.filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
        expect(toCard.map((e) => cents(e.amount))).toEqual([1000])
        expect(owedLeg).toMatchObject({
          entry_type: "ADJUSTMENT",
          status: "COMPLETED",
          debit_account_id: (await receivable()).id,
          metadata: { owed_by_account_id: earnings.id, receivable: true },
        })
        // The vendor held nothing, so everything but the fee reversal is owed.
        expect(cents(owedLeg.amount) + cents(feeReversal.amount)).toBe(1000)
        expect(cents((await receivable()).balance)).toBe(-cents(owedLeg.amount))
        expect(await escrowNet(order.id)).toBe(0)

        const owed = await hawala().getCardProcessingReceivable(earnings.id)
        expect(owed.total_cents).toBe(cents(owedLeg.amount))
        expect(owed.by_kind_cents).toEqual({ card_processing: 0, refund: cents(owedLeg.amount) })
        expect(owed.open[0]).toMatchObject({ kind: "refund", order_id: order.id, funding_account_id: (await receivable()).id })

        const options = await hawala().getPayoutOptions(seller.id)
        expect(options).toMatchObject({ payable_balance: 0, refund_owed: cents(owedLeg.amount) / 100, card_processing_owed: 0 })
        const dashboard = await hawala().getVendorDashboard(seller.id)
        expect(dashboard.card_processing_owed.by_kind.refund).toBe(cents(owedLeg.amount) / 100)
        expect(dashboard.card_processing_owed.open[0]).toMatchObject({ kind: "refund", order_id: order.id })

        // A second refund later on the same order is owed the same way.
        await refund(paymentId, 5)
        expect((await reconcileCardOrder(container(), order.id)).outcome).toBe("refund_posted")
        const owedLegs = (await legs(order.id)).filter((e) => e.metadata?.leg === VENDOR_REFUND_SHORTFALL_LEG)
        expect(owedLegs).toHaveLength(2)
        expect(await escrowNet(order.id)).toBe(0)
      })

      it("no payout leaves while it is owed; the vendor's next sale repays it first, back to the receivable", async () => {
        const { seller, order, paymentId, earnings } = await paidOutOrder()
        await refund(paymentId, 10)
        await reconcileCardOrder(container(), order.id)
        const owedCents = (await hawala().getCardProcessingReceivable(earnings.id)).total_cents
        expect(owedCents).toBeGreaterThan(0)

        await expect(
          hawala().requestPayout({ vendor_id: seller.id, amount: 1, payout_tier: "WEEKLY" })
        ).rejects.toThrow(/still owed \(card processing or a refund after payout\)/)

        const next = await makeOrder(seller.id, 40)
        await pay([next.id], 40, { capture: true })
        await placed(next.id)
        const credit = (await legs(next.id)).find((e) => e.entry_type === "TRANSFER")
        const recovery = (
          await hawala().listLedgerEntries({ debit_account_id: earnings.id, entry_type: "ADJUSTMENT" })
        ).filter((e: { metadata?: { leg?: string } }) => e.metadata?.leg === VENDOR_REFUND_RECOVERY_LEG)
        expect(recovery).toHaveLength(1)
        expect(recovery[0]).toMatchObject({ status: "COMPLETED", credit_account_id: (await receivable()).id })
        expect(recovery[0].order_id ?? null).toBeNull()
        expect(cents(recovery[0].amount)).toBe(owedCents)
        expect(cents((await sellerEarnings(seller.id)).balance)).toBe(cents(credit.amount) - owedCents)
        expect(cents((await receivable()).balance)).toBe(0)
        expect((await hawala().getCardProcessingReceivable(earnings.id)).total_cents).toBe(0)
      })

      it("180 days after the refund what is still owed is forgiven: never collected from a later sale", async () => {
        const { seller, order, paymentId, earnings } = await paidOutOrder()
        await refund(paymentId, 10)
        await reconcileCardOrder(container(), order.id)
        const owedLeg = (await legs(order.id)).find((e) => e.metadata?.leg === VENDOR_REFUND_SHORTFALL_LEG)
        const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
        await pg.raw(`UPDATE hawala_ledger_entry SET created_at = now() - interval '181 days' WHERE id = ?`, [owedLeg.id])

        const owed = await hawala().getCardProcessingReceivable(earnings.id)
        expect(owed.total_cents).toBe(0)
        expect(owed.written_off).toEqual([
          expect.objectContaining({ kind: "refund", order_id: order.id, forgiven_cents: cents(owedLeg.amount) }),
        ])

        const next = await makeOrder(seller.id, 40)
        await pay([next.id], 40, { capture: true })
        await placed(next.id)
        const credit = (await legs(next.id)).find((e) => e.entry_type === "TRANSFER")
        expect(cents((await sellerEarnings(seller.id)).balance)).toBe(cents(credit.amount))
      })
    })

    describe("the vendor-receivable account: below zero, never above, two leg shapes only", () => {
      it("refuses any other leg, and a recovery that would take it above zero", async () => {
        const { seller, order, paymentId, earnings } = await paidOutOrder()
        await refund(paymentId, 10)
        await reconcileCardOrder(container(), order.id)
        const account = await receivable()

        await expect(
          hawala().createTransfer({
            debit_account_id: account.id,
            credit_account_id: earnings.id,
            amount: 1,
            entry_type: "TRANSFER",
          })
        ).rejects.toBeInstanceOf(VendorReceivableLegError)
        await expect(
          hawala().createTransfer({
            debit_account_id: account.id,
            credit_account_id: (await hawala().getOrCreateSystemAccount("ESCROW")).id,
            amount: 1,
            entry_type: "ADJUSTMENT",
            order_id: order.id,
            metadata: { leg: "something_else" },
          })
        ).rejects.toBeInstanceOf(VendorReceivableLegError)

        // Repay it all, then one cent more: the balance update itself refuses it.
        const next = await makeOrder(seller.id, 40)
        await pay([next.id], 40, { capture: true })
        await placed(next.id)
        expect(cents((await receivable()).balance)).toBe(0)
        await expect(
          hawala().createTransfer({
            debit_account_id: earnings.id,
            credit_account_id: account.id,
            amount: 0.01,
            entry_type: "ADJUSTMENT",
            metadata: { leg: VENDOR_REFUND_RECOVERY_LEG, recovers_entry_id: "x" },
          })
        ).rejects.toThrow(/Insufficient balance/)
        expect(cents((await receivable()).balance)).toBe(0)
      })
    })

    describe("a refund on a shared cart that no seller's order records: hold everyone, until an admin assigns it", () => {
      async function sharedCart() {
        const [s1, s2] = [await makeSeller(), await makeSeller()]
        const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
        const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
        await split(o1.id, collectionId, 40)
        await split(o2.id, collectionId, 30)
        await captured(paymentId)
        return { s1, s2, o1, o2, collectionId, paymentId }
      }
      const holdsOn = (collectionId: string, status = "ACTIVE") =>
        hawala().listPayoutHolds({ payment_collection_id: collectionId, status })

      it("holds every seller on the cart once, however many times or at once the reconciler runs; no payout or vendor payment leaves", async () => {
        const { s1, s2, o1, o2, collectionId, paymentId } = await sharedCart()
        await refund(paymentId, 20)
        await Promise.all([o1.id, o2.id, o1.id, o2.id].map((id) => reconcileCardOrder(container(), id)))
        await hawalaCardOrderReconcileJob(container())

        const holds = await holdsOn(collectionId)
        expect(holds.map((h: { seller_id: string }) => h.seller_id).sort()).toEqual([s1.id, s2.id].sort())
        expect(holds.every((h: { amount: unknown }) => cents(h.amount) === 2000)).toBe(true)
        for (const id of [o1.id, o2.id]) {
          expect((await legs(id)).filter((e) => e.entry_type === "REFUND")).toEqual([])
        }

        await expect(
          hawala().requestPayout({ vendor_id: s1.id, amount: 1, payout_tier: "WEEKLY" })
        ).rejects.toBeInstanceOf(PayoutHeldError)
        await expect(
          hawala().createVendorToVendorPayment({
            payer_vendor_id: s2.id,
            payee_vendor_id: s1.id,
            amount: 1,
            payment_type: "INVOICE",
          })
        ).rejects.toBeInstanceOf(PayoutHeldError)
        const options = await hawala().getPayoutOptions(s1.id)
        expect(options.payable_balance).toBe(0)
        expect(options.payout_hold).toMatchObject({ held: true, reason: "unattributed_card_refund" })

        const view = await readCollectionRefunds(container(), collectionId)
        expect(view).toMatchObject({ unassigned: 20 })
        expect(view!.orders.map((o) => [o.order_id, o.refundable]).sort()).toEqual(
          [
            [o1.id, 40],
            [o2.id, 30],
          ].sort()
        )
      })

      it("an exact assignment records it on the split rows without a second refund, releases the holds, and posts each share", async () => {
        const { s1, s2, o1, o2, collectionId, paymentId } = await sharedCart()
        await refund(paymentId, 20)
        await reconcileCardOrder(container(), o1.id)
        const refundsBefore = await container().resolve(Modules.PAYMENT).listRefunds({ payment_id: paymentId })

        const attempt = (allocations: Array<{ order_id: string; amount: number }>) =>
          attributeCollectionRefund(container(), { payment_collection_id: collectionId, allocations, actor_id: "user_admin_1" })
        const code = async (p: Promise<unknown>) => {
          try {
            await p
            return "ok"
          } catch (e) {
            return e instanceof RefundAttributionError ? e.code : String(e)
          }
        }
        expect(await code(attempt([{ order_id: o1.id, amount: 15 }, { order_id: o2.id, amount: 4.99 }]))).toBe("amount_mismatch")
        expect(await code(attempt([{ order_id: o2.id, amount: 31 }]))).toBe("invalid_allocation")
        expect(await code(attempt([{ order_id: "order_elsewhere", amount: 20 }]))).toBe("invalid_allocation")
        // Refused attempts wrote nothing.
        expect((await holdsOn(collectionId)).length).toBe(2)
        const splits = await container().resolve(SPLIT_ORDER_PAYMENT_MODULE).listSplitOrderPayments({ payment_collection_id: collectionId })
        expect(splits.map((s: { refunded_amount: unknown }) => cents(s.refunded_amount))).toEqual([0, 0])

        const result = await attempt([{ order_id: o1.id, amount: 15 }, { order_id: o2.id, amount: 5 }])
        expect(result.released_hold_ids).toHaveLength(2)
        expect(Object.fromEntries(result.reconciled.map((r) => [r.order_id, r.outcome]))).toEqual({
          [o1.id]: "refund_posted",
          [o2.id]: "refund_posted",
        })
        const toCard = async (orderId: string) =>
          (await legs(orderId))
            .filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
            .map((e) => cents(e.amount))
        expect(await toCard(o1.id)).toEqual([1500])
        expect(await toCard(o2.id)).toEqual([500])
        expect(await holdsOn(collectionId)).toEqual([])
        const released = await holdsOn(collectionId, "RELEASED")
        expect(released.every((h: { released_by: string }) => h.released_by === "user_admin_1")).toBe(true)
        // No second refund was issued: the customer had already been refunded.
        const refundsAfter = await container().resolve(Modules.PAYMENT).listRefunds({ payment_id: paymentId })
        expect(refundsAfter).toHaveLength(refundsBefore.length)

        expect(await code(attempt([{ order_id: o1.id, amount: 1 }]))).toBe("nothing_to_assign")
        await hawalaCardOrderReconcileJob(container())
        expect(await holdsOn(collectionId)).toEqual([])
        await expect(
          hawala().requestPayout({ vendor_id: s1.id, amount: 1, payout_tier: "WEEKLY" })
        ).resolves.toBeTruthy()
        expect((await hawala().getPayoutOptions(s2.id)).payout_hold).toBeNull()
      })

      it("a later refund of the rest of the cart accounts for everything: the holds release on their own", async () => {
        const { o1, o2, collectionId, paymentId } = await sharedCart()
        await refund(paymentId, 10)
        await reconcileCardOrder(container(), o1.id)
        expect((await holdsOn(collectionId)).length).toBe(2)

        await refund(paymentId, 60)
        await hawalaCardOrderReconcileJob(container())
        expect(await holdsOn(collectionId)).toEqual([])
        const released = await holdsOn(collectionId, "RELEASED")
        expect(released.every((h: { released_by: string }) => h.released_by === "system")).toBe(true)
        for (const [id, c] of [[o1.id, 4000], [o2.id, 3000]] as const) {
          const toCard = (await legs(id)).filter((e) => e.entry_type === "REFUND" && e.description?.includes("customer refund"))
          expect(toCard.map((e) => cents(e.amount))).toEqual([c])
        }
      })
    })
  },
})
