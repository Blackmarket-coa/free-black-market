import { disburseReferralShare } from "../referral-revenue-payout"
import { HAWALA_LEDGER_MODULE } from "../../modules/hawala-ledger"

/**
 * Same posture as `plugin-revenue-payout`: a referral share is the least
 * important thing on an order, so every failure mode degrades rather than
 * failing the settlement that funds it.
 */
const makeContainer = (opts: {
  platformBalance?: number
  transferThrows?: boolean
  ledgerMissing?: boolean
} = {}) => {
  const transfers: Record<string, unknown>[] = []

  const hawala = {
    getOrCreateSystemAccount: jest.fn(async (t: string) => ({ id: `acc_${t}` })),
    getOrCreateSellerEarnings: jest.fn(async (s: string) => ({ id: `acc_${s}` })),
    getAccountBalance: jest.fn(async () => ({
      available_balance: opts.platformBalance ?? 1000,
    })),
    createTransfer: jest.fn(async (data: Record<string, unknown>) => {
      if (opts.transferThrows) throw new Error("transfer failed")
      transfers.push(data)
      return { id: `le_${transfers.length}` }
    }),
  }

  const container = {
    resolve: (key: string) => {
      if (key === HAWALA_LEDGER_MODULE) {
        if (opts.ledgerMissing) throw new Error("ledger module unavailable")
        return hawala
      }
      return undefined
    },
  }

  return { container, hawala, transfers }
}

const allocation = (over: Record<string, unknown> = {}) => ({
  referrer_seller_id: "sel_referrer",
  referred_seller_id: "sel_referred",
  amount_cents: 100,
  ...over,
})

describe("disburseReferralShare", () => {
  it("pays the referrer out of the platform-fee account", async () => {
    const { container, transfers } = makeContainer()
    const result = await disburseReferralShare(container as never, {
      orderId: "order_1",
      allocation: allocation(),
    })

    expect(result).toEqual({ transferred: 1, deferred: 0, failed: 0 })
    expect(transfers[0].debit_account_id).toBe("acc_PLATFORM_FEE")
    expect(transfers[0].credit_account_id).toBe("acc_sel_referrer")
    expect(transfers[0].amount).toBe(1)
    expect(transfers[0].idempotency_key).toBe(
      "referral-share:order_1:sel_referred"
    )
  })

  it("keys idempotency on the referred seller so a re-run collides", async () => {
    const { container, transfers } = makeContainer()
    await disburseReferralShare(container as never, {
      orderId: "order_9",
      allocation: allocation(),
    })
    expect(transfers[0].idempotency_key).toBe(
      "referral-share:order_9:sel_referred"
    )
  })

  it("defers rather than overdrawing the platform account", async () => {
    const { container, transfers } = makeContainer({ platformBalance: 0.5 })
    const result = await disburseReferralShare(container as never, {
      orderId: "order_1",
      allocation: allocation({ amount_cents: 150 }),
    })
    expect(result).toEqual({ transferred: 0, deferred: 1, failed: 0 })
    expect(transfers).toHaveLength(0)
  })

  it("never moves money on a self-referral allocation", async () => {
    const { container, hawala } = makeContainer()
    const result = await disburseReferralShare(container as never, {
      orderId: "order_1",
      allocation: allocation({ referrer_seller_id: "sel_referred" }),
    })
    expect(result).toEqual({ transferred: 0, deferred: 0, failed: 0 })
    expect(hawala.getOrCreateSystemAccount).not.toHaveBeenCalled()
  })

  it("does nothing with a null or zero allocation", async () => {
    const { container, hawala } = makeContainer()
    expect(
      await disburseReferralShare(container as never, {
        orderId: "order_1",
        allocation: null,
      })
    ).toEqual({ transferred: 0, deferred: 0, failed: 0 })
    expect(
      await disburseReferralShare(container as never, {
        orderId: "order_1",
        allocation: allocation({ amount_cents: 0 }),
      })
    ).toEqual({ transferred: 0, deferred: 0, failed: 0 })
    expect(hawala.getOrCreateSystemAccount).not.toHaveBeenCalled()
  })

  it("does not throw when the ledger is unavailable", async () => {
    const { container } = makeContainer({ ledgerMissing: true })
    const result = await disburseReferralShare(container as never, {
      orderId: "order_1",
      allocation: allocation(),
    })
    expect(result).toEqual({ transferred: 0, deferred: 0, failed: 1 })
  })

  it("does not throw when the transfer itself fails", async () => {
    const { container } = makeContainer({ transferThrows: true })
    const result = await disburseReferralShare(container as never, {
      orderId: "order_1",
      allocation: allocation(),
    })
    expect(result).toEqual({ transferred: 0, deferred: 0, failed: 1 })
  })

  it("credits the referrer in the order's currency", async () => {
    const { container, hawala } = makeContainer()
    await disburseReferralShare(container as never, {
      orderId: "order_1",
      currencyCode: "eur",
      allocation: allocation(),
    })
    expect(hawala.getOrCreateSellerEarnings).toHaveBeenCalledWith(
      "sel_referrer",
      "EUR"
    )
  })
})
