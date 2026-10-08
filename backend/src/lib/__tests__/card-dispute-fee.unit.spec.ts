import { postDisputeFees } from "../card-dispute-fee"
import { VENDOR_DISPUTE_FEE_LEG } from "../../modules/hawala-ledger/vendor-receivable"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * postDisputeFees against a stubbed ledger, for the shapes the real-database
 * suite (integration-tests/http/hawala-card-stripe-sync.spec.ts) does not
 * build: a consignment order (consignor and vendor seller legs, so the
 * order's share is split by each leg's cents and keyed per leg), and a
 * failure on one charge that must not stop the next.
 */

type Row = Record<string, any>

function world(opts: { charges: Row[]; sellerLegs: Row[]; failCharge?: string }) {
  const feeRows: Row[] = []
  const calls: Row[] = []
  const hawala = {
    listCardChargeStates: jest.fn(async () => opts.charges),
    listLedgerEntries: jest.fn(async (f: Row) => {
      if (f.entry_type === "TRANSFER") return opts.sellerLegs
      if (f.entry_type === "ADJUSTMENT") return feeRows
      return []
    }),
    recordDisputeFee: jest.fn(async (args: Row) => {
      calls.push(args)
      if (args.stripeChargeId === opts.failCharge) throw new Error("balance move failed")
      const row = {
        id: `e${feeRows.length + 1}`,
        status: "COMPLETED",
        entry_type: "ADJUSTMENT",
        amount: args.amountCents / 100,
        metadata: {
          leg: VENDOR_DISPUTE_FEE_LEG,
          stripe_charge_id: args.stripeChargeId,
          ...(args.splitTag ? { split_leg: args.splitTag } : {}),
        },
      }
      feeRows.push(row)
      return row
    }),
  }
  const query = {
    graph: jest.fn(async (q: { entity: string }) => {
      if (q.entity === "split_order_payment") return { data: [] }
      if (q.entity === "order_payment_collection") return { data: [{ order_id: "order_1", payment_collection_id: "pc_1" }] }
      return { data: [] }
    }),
  }
  const container = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  const order = { id: "order_1", payment_collection_ids: ["pc_1"] } as never
  return { hawala, container, order, calls, feeRows }
}

const charge = (id: string, fee: number) => ({
  stripe_charge_id: id,
  currency_code: "usd",
  amount_cents: 4000,
  disputed_cents: 4000,
  dispute_fee_cents: fee,
})
const consignment = [
  { status: "COMPLETED", idempotency_key: "order-payment-order_1-consignor", credit_account_id: "acc-consignor", amount: 30 },
  { status: "COMPLETED", idempotency_key: "order-payment-order_1-vendor", credit_account_id: "acc-vendor", amount: 10 },
]

describe("postDisputeFees: a consignment order", () => {
  it("splits the order's share across the consignor and vendor legs by their cents, keyed per leg", async () => {
    const w = world({ charges: [charge("ch_1", 1500)], sellerLegs: consignment })
    expect(await postDisputeFees(w.container, w.hawala as never, w.order)).toBe(1500)
    expect(w.calls).toEqual([
      expect.objectContaining({ owedByAccountId: "acc-consignor", amountCents: 1125, toCents: 1125, seq: 0, splitTag: "consignor" }),
      expect.objectContaining({ owedByAccountId: "acc-vendor", amountCents: 375, toCents: 375, seq: 0, splitTag: "vendor" }),
    ])
  })

  it("re-read: nothing more; the fee rises: only each leg's difference, under the next sequence", async () => {
    const w = world({ charges: [charge("ch_1", 1500)], sellerLegs: consignment })
    await postDisputeFees(w.container, w.hawala as never, w.order)
    expect(await postDisputeFees(w.container, w.hawala as never, w.order)).toBe(0)
    w.hawala.listCardChargeStates.mockResolvedValue([charge("ch_1", 3000)])
    w.calls.length = 0
    expect(await postDisputeFees(w.container, w.hawala as never, w.order)).toBe(1500)
    expect(w.calls).toEqual([
      expect.objectContaining({ owedByAccountId: "acc-consignor", amountCents: 1125, toCents: 2250, seq: 1, splitTag: "consignor" }),
      expect.objectContaining({ owedByAccountId: "acc-vendor", amountCents: 375, toCents: 750, seq: 1, splitTag: "vendor" }),
    ])
  })
})

describe("postDisputeFees: failures", () => {
  it("one charge failing does not stop the next, and is not counted as posted", async () => {
    const w = world({
      charges: [charge("ch_bad", 1500), charge("ch_ok", 1500)],
      sellerLegs: [consignment[0]].map((l) => ({ ...l, idempotency_key: "order-payment-order_1-seller" })),
      failCharge: "ch_bad",
    })
    expect(await postDisputeFees(w.container, w.hawala as never, w.order)).toBe(1500)
    expect(w.calls.map((c) => c.stripeChargeId)).toEqual(["ch_bad", "ch_ok"])
    expect(w.feeRows).toHaveLength(1)
  })

  it("an unsettled order posts nothing", async () => {
    const w = world({ charges: [charge("ch_1", 1500)], sellerLegs: [] })
    expect(await postDisputeFees(w.container, w.hawala as never, w.order)).toBe(0)
    expect(w.calls).toEqual([])
  })
})
