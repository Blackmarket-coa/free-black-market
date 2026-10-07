import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PAYOUT_MODULE } from "@mercurjs/b2c-core/modules/payout"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { cardOrderFixtures } from "./helpers/card-orders"
import { reconcileCardOrder } from "../../src/lib/card-order-reconcile"
import {
  CONNECT_PAYOUT_RAIL,
  MERCUR_PAID_ORDER_LEG,
  ledgerRailHasSent,
  runLedgerConnectPayouts,
  type ConnectTransfer,
} from "../../src/lib/ledger-connect-payouts"

jest.setTimeout(240 * 1000)

/**
 * SD-41 on a real migrated database (operator decision 2026-10-06 "FBM ledger
 * drives Connect"; FF_LEDGER_CONNECT_PAYOUTS_V1): vendors paid from the
 * hawala ledger, through Mercur's payout accounts and links, with the
 * refund receivable and payout holds of SD-40 in force. The one thing faked
 * is the Stripe transfer itself (`sendTransfer`); everything it is given,
 * and everything around it, is the real code on the real tables.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1
const PAYOUTS = PHASE0_FEATURE_FLAGS.LEDGER_CONNECT_PAYOUTS_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, cents, makeSeller, makeOrder, pay, refund, hawala, legs, sellerEarnings, placed } =
      cardOrderFixtures(getContainer)

    beforeEach(() => {
      process.env[CARD] = "true"
      process.env[PAYOUTS] = "true"
    })
    afterEach(() => {
      delete process.env[CARD]
      delete process.env[PAYOUTS]
    })

    /** A Mercur payout account linked to the seller, as Stripe last synced it. */
    async function payoutAccount(sellerId: string, opts: { status?: string; country?: string; currency?: string } = {}) {
      const payouts = container().resolve(PAYOUT_MODULE)
      const created = await payouts.createPayoutAccounts({
        status: opts.status ?? "active",
        reference_id: `acct_${sellerId}`,
        data: { country: opts.country ?? "US", default_currency: opts.currency ?? "usd" },
        context: {},
      })
      const account = Array.isArray(created) ? created[0] : created
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [SELLER_MODULE]: { seller_id: sellerId },
        [PAYOUT_MODULE]: { payout_account_id: account.id },
      })
      return account
    }

    /** A settled $amount card order for the seller. */
    async function sale(sellerId: string, amount = 40) {
      const order = await makeOrder(sellerId, amount)
      const paid = await pay([order.id], amount, { capture: true })
      await placed(order.id)
      return { order, ...paid }
    }

    const fakeStripe = () => {
      const calls: Array<Parameters<ConnectTransfer>[0]> = []
      let refuse = false
      const send: ConnectTransfer = async (args) => {
        calls.push(args)
        await new Promise((r) => setTimeout(r, 5))
        if (refuse) throw new Error("Your destination account needs to have at least one of the following capabilities enabled")
        return { payout_id: `pout_${calls.length}`, transfer_id: `tr_${calls.length}` }
      }
      return { calls, send, refuseNext: (v: boolean) => (refuse = v) }
    }
    const requestsFor = (sellerId: string) => hawala().listPayoutRequests({ vendor_id: sellerId }, { order: { requested_at: "ASC" } })

    it("pays what the ledger says, once: request, claim, one transfer to the seller's account, COMPLETED", async () => {
      const seller = await makeSeller()
      const account = await payoutAccount(seller.id)
      await sale(seller.id)
      const creditCents = cents((await sellerEarnings(seller.id)).balance)
      const stripe = fakeStripe()

      const summary = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(summary.requested).toEqual([expect.objectContaining({ seller_id: seller.id, amount: creditCents / 100 })])
      expect(stripe.calls).toEqual([
        {
          payout_account_id: account.id,
          amount: creditCents / 100,
          currency_code: "usd",
          transaction_id: `fbm-payout-${summary.requested[0].payout_request_id}`,
        },
      ])
      const [request] = await requestsFor(seller.id)
      expect(request).toMatchObject({ status: "COMPLETED", stripe_transfer_id: "tr_1" })
      expect(request.metadata).toMatchObject({ rail: CONNECT_PAYOUT_RAIL, mercur_payout_id: "pout_1" })
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)

      // The next night: nothing new owed, nothing sent again.
      const again = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(again.requested).toEqual([])
      expect(stripe.calls).toHaveLength(1)
      expect(await ledgerRailHasSent(hawala())).toBe(true)
    })

    it("three runs at once: one does the work, the others do nothing; one request, one transfer", async () => {
      const seller = await makeSeller()
      await payoutAccount(seller.id)
      await sale(seller.id)
      const stripe = fakeStripe()
      const runs = await Promise.all([1, 2, 3].map(() => runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })))
      expect(runs.filter((r) => !r.skipped)).toHaveLength(1)
      const requests = await requestsFor(seller.id)
      expect(requests).toHaveLength(1)
      expect(requests[0].status).toBe("COMPLETED")
      expect(stripe.calls.map((c) => c.transaction_id)).toEqual([`fbm-payout-${requests[0].id}`])
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
    })

    it("a payout request whose ledger legs cannot post is FAILED, not left PENDING", async () => {
      const seller = await makeSeller()
      await sale(seller.id)
      const earnings = await sellerEarnings(seller.id)
      // The balance moves between the check and the legs (simulated: the
      // legs are asked for more than the account holds).
      const original = hawala().createTransfer.bind(hawala())
      const svc = hawala() as { createTransfer: (d: Record<string, unknown>) => Promise<unknown> }
      svc.createTransfer = async (d) =>
        d.entry_type === "WITHDRAWAL" ? original({ ...d, amount: Number(earnings.balance) + 1 }) : original(d)
      try {
        await expect(
          hawala().requestPayout({ vendor_id: seller.id, amount: 5, payout_tier: "WEEKLY" })
        ).rejects.toThrow(/Insufficient balance/)
      } finally {
        svc.createTransfer = original
      }
      const [request] = await requestsFor(seller.id)
      expect(request.status).toBe("FAILED")
      expect(request.failure_reason).toMatch(/Ledger legs did not post/)
    })

    it("what the vendor owes for a refund after payout is taken first; only the rest is paid", async () => {
      const seller = await makeSeller()
      await payoutAccount(seller.id)
      const stripe = fakeStripe()
      const first = await sale(seller.id)
      await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      await refund(first.paymentId, 10)
      await reconcileCardOrder(container(), first.order.id)
      const earnings = await sellerEarnings(seller.id)
      const owedCents = (await hawala().getCardProcessingReceivable(earnings.id)).total_cents
      expect(owedCents).toBeGreaterThan(0)

      await sale(seller.id)
      const summary = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(summary.requested).toHaveLength(1)
      expect(stripe.calls).toHaveLength(2)
      expect((await hawala().getCardProcessingReceivable(earnings.id)).total_cents).toBe(0)
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
      // Paid: the second sale's credit less what was owed.
      expect(Math.round(stripe.calls[1].amount * 100)).toBe(Math.round(stripe.calls[0].amount * 100) - owedCents)
    })

    it("not paid: a non-US account, an account not yet active, a held seller — and a held seller's own request waits", async () => {
      const [ca, pending, held] = [await makeSeller(), await makeSeller(), await makeSeller()]
      await payoutAccount(ca.id, { country: "CA", currency: "cad" })
      await payoutAccount(pending.id, { status: "pending" })
      await payoutAccount(held.id)
      for (const s of [ca, pending, held]) await sale(s.id)
      // The held seller asked for a payout from the panel before the hold.
      await hawala().requestPayout({ vendor_id: held.id, amount: 5, payout_tier: "WEEKLY" })
      await hawala().placePayoutHolds({
        payment_collection_id: "pay_col_held",
        seller_ids: [held.id],
        amount: 3,
        currency_code: "usd",
        order_ids: [],
      })
      const stripe = fakeStripe()
      const summary = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(stripe.calls).toEqual([])
      expect(summary.requested).toEqual([])
      expect(summary.refused_accounts).toEqual(
        expect.arrayContaining([
          { seller_id: ca.id, refusal: "not_us_usd" },
          { seller_id: pending.id, refusal: "not_active" },
        ])
      )
      expect(summary.held).toContain(held.id)
      expect(summary.waiting).toEqual(expect.arrayContaining([expect.objectContaining({ why: "held" })]))
      const [waiting] = await requestsFor(held.id)
      expect(waiting.status).toBe("PROCESSING")
    })

    it("a refused transfer moves nothing: FAILED, the money back on the ledger, and the next night pays it", async () => {
      const seller = await makeSeller()
      await payoutAccount(seller.id)
      await sale(seller.id)
      const creditCents = cents((await sellerEarnings(seller.id)).balance)
      const stripe = fakeStripe()
      stripe.refuseNext(true)
      const summary = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(summary.failed).toHaveLength(1)
      const [failed] = await requestsFor(seller.id)
      expect(failed.status).toBe("FAILED")
      expect(failed.failure_reason).toMatch(/Stripe refused the transfer/)
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(creditCents)

      stripe.refuseNext(false)
      const next = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(next.sent).toHaveLength(1)
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
    })

    it("a request left IN_TRANSIT may have moved money: reported, never re-sent", async () => {
      const seller = await makeSeller()
      await payoutAccount(seller.id)
      await sale(seller.id)
      const request = await hawala().requestPayout({ vendor_id: seller.id, amount: 10, payout_tier: "WEEKLY" })
      expect(await hawala().claimPayoutRequestForSending(request.id)).toBe(true)
      expect(await hawala().claimPayoutRequestForSending(request.id)).toBe(false)
      const stripe = fakeStripe()
      const summary = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(summary.stuck_in_transit).toContain(request.id)
      expect(stripe.calls.map((c) => c.transaction_id)).not.toContain(`fbm-payout-${request.id}`)
    })

    it("cut-over: an order Mercur already paid is booked out of the earnings, never paid twice", async () => {
      const seller = await makeSeller()
      const account = await payoutAccount(seller.id)
      const paid = await sale(seller.id)
      const unpaid = await sale(seller.id)
      const creditOf = async (orderId: string) => cents((await legs(orderId)).find((e) => e.entry_type === "TRANSFER").amount)
      // Mercur's job paid the first order before the cut-over.
      const mercur = container().resolve(PAYOUT_MODULE)
      const created = await mercur.createPayouts({
        amount: 50,
        currency_code: "usd",
        data: { id: "tr_mercur" },
        payout_account: account.id,
      })
      const payout = Array.isArray(created) ? created[0] : created
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.ORDER]: { order_id: paid.order.id },
        [PAYOUT_MODULE]: { payout_id: payout.id },
      })
      const stripe = fakeStripe()
      const summary = await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(summary.booked_mercur_paid).toBe(1)
      const earnings = await sellerEarnings(seller.id)
      const booked = (await hawala().listLedgerEntries({ debit_account_id: earnings.id, entry_type: "WITHDRAWAL" })).find(
        (e: { metadata?: { leg?: string } }) => e.metadata?.leg === MERCUR_PAID_ORDER_LEG
      )
      // The smaller of what Mercur paid ($50) and what the ledger credited.
      expect(cents(booked.amount)).toBe(await creditOf(paid.order.id))
      expect(stripe.calls.map((c) => Math.round(c.amount * 100))).toEqual([await creditOf(unpaid.order.id)])

      await runLedgerConnectPayouts(container(), { sendTransfer: stripe.send })
      expect(stripe.calls).toHaveLength(1)
    })

    it("the scheduled job `job-daily-payouts` is FBM's, not Mercur's", async () => {
      const seller = await makeSeller()
      const account = await payoutAccount(seller.id)
      const paid = await sale(seller.id)
      // Mercur paid it in full, so FBM's job books it and sends nothing:
      // the booking is a ledger write only FBM's job makes.
      const mercur = container().resolve(PAYOUT_MODULE)
      const created = await mercur.createPayouts({ amount: 40, currency_code: "usd", data: {}, payout_account: account.id })
      const payout = Array.isArray(created) ? created[0] : created
      await container().resolve(ContainerRegistrationKeys.LINK).create({
        [Modules.ORDER]: { order_id: paid.order.id },
        [PAYOUT_MODULE]: { payout_id: payout.id },
      })
      await container().resolve(Modules.WORKFLOW_ENGINE).run("job-daily-payouts", { input: {} })
      const earnings = await sellerEarnings(seller.id)
      const booked = (await hawala().listLedgerEntries({ debit_account_id: earnings.id, entry_type: "WITHDRAWAL" })).filter(
        (e: { metadata?: { leg?: string } }) => e.metadata?.leg === MERCUR_PAID_ORDER_LEG
      )
      expect(booked).toHaveLength(1)
      expect(cents((await sellerEarnings(seller.id)).balance)).toBe(0)
    })
  },
})
