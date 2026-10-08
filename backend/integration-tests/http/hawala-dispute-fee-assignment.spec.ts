import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PHASE0_FEATURE_FLAGS } from "../../src/shared/feature-flags"
import { cardOrderFixtures } from "./helpers/card-orders"
import { syncCardChargeFromStripe, type ChargeLedgerState } from "../../src/lib/card-stripe-sync"
import {
  assignDisputeFee,
  DisputeFeeAssignmentError,
  listUnassignedDisputeFees,
  readDisputeFee,
} from "../../src/lib/card-dispute-fee-assignment"
import { VENDOR_DISPUTE_FEE_LEG } from "../../src/modules/hawala-ledger/vendor-receivable"

jest.setTimeout(240 * 1000)

/**
 * SD-44 (a) on a real migrated database: an admin assigns a Stripe dispute
 * fee the automatic rule puts on no seller (a partial chargeback on a shared
 * Mercur cart). Stripe's answer for the charge is supplied (`fetchCharge`);
 * the charge state, the ledger legs, the receivable and the lock are real.
 */

const CARD = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    const { container, cents, uid, makeSeller, makeOrder, pay, split, hawala, captured, placed, sellerEarnings } =
      cardOrderFixtures(getContainer)

    beforeEach(() => {
      process.env[CARD] = "true"
    })
    afterEach(() => {
      delete process.env[CARD]
    })

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
      if (s.disputed_cents === undefined) state.disputed_cents = Math.max(state.dispute_open_cents, state.dispute_lost_cents)
      return { chargeId: state.charge_id, fetchCharge: async () => state }
    }
    const sync = (d: ReturnType<typeof stripeSays>) => syncCardChargeFromStripe(container(), d.chargeId, { fetchCharge: d.fetchCharge })
    const feeLegs = async (orderId: string) =>
      (await hawala().listLedgerEntries({ reference_id: orderId, entry_type: "ADJUSTMENT" })).filter(
        (e: { metadata?: { leg?: string } }) => e.metadata?.leg === VENDOR_DISPUTE_FEE_LEG
      )
    const owedFee = async (sellerId: string) =>
      (await hawala().getCardProcessingReceivable((await sellerEarnings(sellerId)).id)).by_kind_cents.dispute_fee
    const refusal = async (p: Promise<unknown>) => {
      try {
        await p
      } catch (e) {
        return e instanceof DisputeFeeAssignmentError ? e.code : `other: ${(e as Error).message}`
      }
      return "none"
    }

    /** A $40 + $30 Mercur cart, settled, with a $30 chargeback (partial) carrying a $15 fee. */
    async function partialChargeback(fee = 1500) {
      const [s1, s2] = [await makeSeller(), await makeSeller()]
      const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
      const { collectionId, paymentId } = await pay([o1.id, o2.id], 70, { capture: true })
      await split(o1.id, collectionId, 40)
      await split(o2.id, collectionId, 30)
      await captured(paymentId)
      const pi = await intentFor(paymentId)
      const d = stripeSays(pi, 70, { dispute_open_cents: 3000, dispute_fee_cents: fee })
      await sync(d)
      return { s1, s2, o1, o2, collectionId, pi, d }
    }

    it("queues a partial chargeback's fee with the cart's orders; an admin puts it on the disputed order's seller", async () => {
      const { s1, s2, o1, o2, d } = await partialChargeback()
      const queued = (await listUnassignedDisputeFees(container())).find((f) => f.stripe_charge_id === d.chargeId)
      expect(queued).toMatchObject({ reason: "partial_chargeback", fee_cents: 1500, unassigned_cents: 1500, assigned_cents: 0 })
      expect(queued!.orders.map((o) => [o.order_id, o.order_amount, o.settled]).sort()).toEqual(
        [
          [o1.id, 40, true],
          [o2.id, 30, true],
        ].sort()
      )

      const result = await assignDisputeFee(container(), {
        stripe_charge_id: d.chargeId,
        allocations: [{ order_id: o2.id, amount: 15 }],
        actor_id: "user_admin_1",
      })
      expect(result).toMatchObject({ posted: [{ order_id: o2.id, cents: 1500 }], unassigned_cents: 0 })
      const [leg, ...more] = await feeLegs(o2.id)
      expect(more).toEqual([])
      expect(leg).toMatchObject({ status: "COMPLETED", reference_id: o2.id })
      expect(leg.metadata).toMatchObject({ assigned_by: "user_admin_1", stripe_charge_id: d.chargeId })
      expect(await feeLegs(o1.id)).toEqual([])
      expect(await owedFee(s2.id)).toBe(1500)
      expect(await owedFee(s1.id)).toBe(0)
      expect((await listUnassignedDisputeFees(container())).some((f) => f.stripe_charge_id === d.chargeId)).toBe(false)

      // A retry, or a second admin: nothing left.
      expect(
        await refusal(
          assignDisputeFee(container(), { stripe_charge_id: d.chargeId, allocations: [{ order_id: o1.id, amount: 15 }], actor_id: "user_admin_2" })
        )
      ).toBe("nothing_to_assign")
      // A later re-read from Stripe never adds an automatic share on top.
      await sync(d)
      expect(await feeLegs(o1.id)).toEqual([])
      expect(await feeLegs(o2.id)).toHaveLength(1)
    })

    it("part to a seller, the rest left with BMC; the record names who and how much", async () => {
      const { s1, o1, d } = await partialChargeback()
      await assignDisputeFee(container(), {
        stripe_charge_id: d.chargeId,
        allocations: [{ order_id: o1.id, amount: 5 }],
        bmc_absorbs: 10,
        actor_id: "user_admin_1",
      })
      expect(await owedFee(s1.id)).toBe(500)
      const view = await readDisputeFee(container(), d.chargeId)
      expect(view).toMatchObject({ assigned_cents: 500, absorbed_cents: 1000, unassigned_cents: 0 })
      expect(view!.assignment).toMatchObject({
        assigned_by: "user_admin_1",
        absorbed_cents: 1000,
        history: [{ by: "user_admin_1", allocations: [{ order_id: o1.id, cents: 500 }], absorbed_cents: 1000 }],
      })
    })

    it("refuses what does not add up, an order off the cart, or the same order twice — and writes nothing", async () => {
      const { o1, o2, d } = await partialChargeback()
      const other = await makeOrder((await makeSeller()).id, 10)
      const attempts: Array<[string, Parameters<typeof assignDisputeFee>[1]]> = [
        ["amount_mismatch", { stripe_charge_id: d.chargeId, allocations: [{ order_id: o1.id, amount: 14.99 }], actor_id: "a" }],
        ["amount_mismatch", { stripe_charge_id: d.chargeId, allocations: [{ order_id: o1.id, amount: 15 }], bmc_absorbs: 0.01, actor_id: "a" }],
        ["invalid_allocation", { stripe_charge_id: d.chargeId, allocations: [{ order_id: other.id, amount: 15 }], actor_id: "a" }],
        ["invalid_allocation", { stripe_charge_id: d.chargeId, allocations: [{ order_id: o1.id, amount: 5 }, { order_id: o1.id, amount: 10 }], actor_id: "a" }],
        ["not_found", { stripe_charge_id: "ch_nobody", allocations: [{ order_id: o1.id, amount: 15 }], actor_id: "a" }],
      ]
      for (const [code, args] of attempts) expect(await refusal(assignDisputeFee(container(), args))).toBe(code)
      expect(await feeLegs(o1.id)).toEqual([])
      expect(await feeLegs(o2.id)).toEqual([])
      expect((await readDisputeFee(container(), d.chargeId))!.assignment).toBeNull()
      expect((await readDisputeFee(container(), d.chargeId))!.unassigned_cents).toBe(1500)
    })

    it("a fee the automatic rule decides is refused: one order, or one chargeback covering the whole cart", async () => {
      const seller = await makeSeller()
      const order = await makeOrder(seller.id, 40)
      const paid = await pay([order.id], 40, { capture: true })
      await placed(order.id)
      const single = stripeSays(await intentFor(paid.paymentId), 40, { dispute_open_cents: 4000, dispute_fee_cents: 1500 })
      await sync(single)
      expect(await refusal(assignDisputeFee(container(), { stripe_charge_id: single.chargeId, bmc_absorbs: 15, allocations: [], actor_id: "a" }))).toBe(
        "automatic"
      )
      expect((await readDisputeFee(container(), single.chargeId))!.reason).toBeNull()

      const [s1, s2] = [await makeSeller(), await makeSeller()]
      const [o1, o2] = [await makeOrder(s1.id, 40), await makeOrder(s2.id, 30)]
      const cart = await pay([o1.id, o2.id], 70, { capture: true })
      await split(o1.id, cart.collectionId, 40)
      await split(o2.id, cart.collectionId, 30)
      await captured(cart.paymentId)
      const whole = stripeSays(await intentFor(cart.paymentId), 70, { dispute_open_cents: 7000, dispute_fee_cents: 1500 })
      await sync(whole)
      expect(await refusal(assignDisputeFee(container(), { stripe_charge_id: whole.chargeId, bmc_absorbs: 15, allocations: [], actor_id: "a" }))).toBe(
        "automatic"
      )
      expect((await listUnassignedDisputeFees(container())).some((f) => f.stripe_charge_id === whole.chargeId)).toBe(false)
    })

    it("a later, larger fee on an assigned charge returns to the queue and is never posted automatically", async () => {
      const { s1, s2, o1, o2, pi, d } = await partialChargeback()
      await assignDisputeFee(container(), { stripe_charge_id: d.chargeId, allocations: [{ order_id: o2.id, amount: 15 }], actor_id: "a" })
      // A second chargeback, this time covering the whole cart: on its own
      // that would be automatic, but the charge is the admin's now.
      const second = stripeSays(pi, 70, { dispute_open_cents: 7000, dispute_fee_cents: 3000 })
      await sync(second)
      expect(await feeLegs(o1.id)).toEqual([])
      expect(await owedFee(s2.id)).toBe(1500)
      const queued = (await listUnassignedDisputeFees(container())).find((f) => f.stripe_charge_id === d.chargeId)
      expect(queued).toMatchObject({ reason: "assigned_in_part", unassigned_cents: 1500, assigned_cents: 1500 })
      await assignDisputeFee(container(), { stripe_charge_id: d.chargeId, allocations: [{ order_id: o1.id, amount: 15 }], actor_id: "b" })
      expect(await owedFee(s1.id)).toBe(1500)
      expect((await readDisputeFee(container(), d.chargeId))!.assignment!.history.map((h) => h.by)).toEqual(["a", "b"])
    })

    it("two admins assigning the same fee at once: exactly one assignment posts", async () => {
      const { s1, s2, o1, o2, d } = await partialChargeback()
      const outcomes = await Promise.all([
        refusal(assignDisputeFee(container(), { stripe_charge_id: d.chargeId, allocations: [{ order_id: o1.id, amount: 15 }], actor_id: "a" })),
        refusal(assignDisputeFee(container(), { stripe_charge_id: d.chargeId, allocations: [{ order_id: o2.id, amount: 15 }], actor_id: "b" })),
      ])
      expect(outcomes.sort()).toEqual(["none", "nothing_to_assign"])
      expect((await owedFee(s1.id)) + (await owedFee(s2.id))).toBe(1500)
      expect((await feeLegs(o1.id)).length + (await feeLegs(o2.id)).length).toBe(1)
      expect(cents((await sellerEarnings(s1.id)).balance)).toBeGreaterThan(0)
    })
  },
})
