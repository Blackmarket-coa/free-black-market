import {
  getOrCreateCcrCartEscrow,
  getOrCreateCustomerCcrWallet,
  releaseCartCredits,
  reserveCartCredits,
  settleCartCredits,
} from "../ccr-cart-ledger"

/**
 * The three legs of a cart credit reservation. `CART` has been a blessed
 * purchase context in `posture-a-guard.ts` since it was written, so a
 * reservation could clear the closed-loop guard, and nothing ever posted one
 * (`docs/CCR_HRS_IGNITION.md` §3). These pin the producer that closes that gap.
 */

type Account = Record<string, unknown> & { id: string }

function makeHawala(seed: Account[] = []) {
  const accounts: Account[] = [...seed]
  const transfers: Record<string, unknown>[] = []
  let next = 1

  return {
    accounts,
    transfers,
    listLedgerAccounts: jest.fn(async (filters: Record<string, unknown>) =>
      accounts.filter((a) =>
        Object.entries(filters).every(([k, v]) => a[k] === v)
      )
    ),
    createAccount: jest.fn(async (data: Record<string, unknown>) => {
      const account: Account = { id: `acct_${next++}`, ...data }
      accounts.push(account)
      return account
    }),
    createTransfer: jest.fn(async (data: Record<string, unknown>) => {
      transfers.push(data)
      return { id: `entry_${transfers.length}` }
    }),
  }
}

const asService = (h: ReturnType<typeof makeHawala>) => h as never

describe("CCR account provisioning", () => {
  it("creates a buyer wallet as USER_WALLET on the CCR rail", async () => {
    // rails.ts declares CCR lives on USER_WALLET; the reconciler already looks
    // one up and finds nothing. This resolves that drift in the registry's
    // direction rather than papering over it.
    const h = makeHawala()

    const wallet = await getOrCreateCustomerCcrWallet(asService(h), "cus_1")

    expect(h.createAccount).toHaveBeenCalledWith({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: "cus_1",
      currency_code: "CCR",
    })
    expect(wallet.id).toBe("acct_1")
  })

  it("reuses an existing CCR wallet instead of duplicating it", async () => {
    const h = makeHawala([
      { id: "acct_existing", owner_id: "cus_1", owner_type: "CUSTOMER", currency_code: "CCR" },
    ])

    const wallet = await getOrCreateCustomerCcrWallet(asService(h), "cus_1")

    expect(wallet.id).toBe("acct_existing")
    expect(h.createAccount).not.toHaveBeenCalled()
  })

  it("never returns a USD account for a CCR flow", async () => {
    // getOrCreateSystemAccount lacks a currency filter; this must not inherit
    // that, or a USD escrow would receive credits.
    const h = makeHawala([
      { id: "acct_usd", account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", currency_code: "USD" },
    ])

    const escrow = await getOrCreateCcrCartEscrow(asService(h))

    expect(escrow.id).not.toBe("acct_usd")
    expect(h.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ currency_code: "CCR", account_type: "ESCROW" })
    )
  })
})

describe("reserveCartCredits", () => {
  it("posts wallet -> escrow with the CART purchase context", async () => {
    const h = makeHawala()

    await reserveCartCredits(asService(h), {
      cartId: "cart_1",
      customerId: "cus_1",
      credits: 40,
    })

    expect(h.transfers).toHaveLength(1)
    expect(h.transfers[0]).toMatchObject({
      amount: 40,
      entry_type: "TRANSFER",
      reference_type: "CART",
      reference_id: "cart_1",
      idempotency_key: "ccr-cart-apply:cart_1:40",
    })
  })

  it("debits the buyer wallet and credits the escrow, not the reverse", async () => {
    const h = makeHawala()

    await reserveCartCredits(asService(h), {
      cartId: "cart_1",
      customerId: "cus_1",
      credits: 10,
    })

    const t = h.transfers[0] as Record<string, string>
    const wallet = h.accounts.find((a) => a.account_type === "USER_WALLET")
    const escrow = h.accounts.find((a) => a.account_type === "ESCROW")

    expect(t.debit_account_id).toBe(wallet?.id)
    expect(t.credit_account_id).toBe(escrow?.id)
  })
})

describe("releaseCartCredits", () => {
  it("is the exact inverse of a reservation", async () => {
    const h = makeHawala()

    await reserveCartCredits(asService(h), { cartId: "cart_1", customerId: "cus_1", credits: 25 })
    await releaseCartCredits(asService(h), { cartId: "cart_1", customerId: "cus_1", credits: 25 })

    const [reserve, release] = h.transfers as Record<string, unknown>[]
    expect(release.debit_account_id).toBe(reserve.credit_account_id)
    expect(release.credit_account_id).toBe(reserve.debit_account_id)
    expect(release.amount).toBe(reserve.amount)
  })

  it("records the cart it returned credits from", async () => {
    const h = makeHawala()

    await releaseCartCredits(asService(h), { cartId: "cart_9", customerId: "cus_1", credits: 5 })

    expect(h.transfers[0]).toMatchObject({
      entry_type: "REFUND",
      reference_type: "CART",
      reference_id: "cart_9",
      idempotency_key: "ccr-cart-release:cart_9",
    })
  })
})

describe("settleCartCredits", () => {
  it("burns escrowed credits to the issuer and records the order", async () => {
    const h = makeHawala()

    await settleCartCredits(
      asService(h),
      { cartId: "cart_1", orderId: "order_1", credits: 40 },
      "acct_issuer"
    )

    const t = h.transfers[0] as Record<string, unknown>
    expect(t).toMatchObject({
      amount: 40,
      entry_type: "BURN",
      reference_type: "ORDER",
      reference_id: "order_1",
      credit_account_id: "acct_issuer",
      idempotency_key: "ccr-cart-settle:cart_1",
    })
  })

  it("burns rather than paying a vendor, so one credit cannot fund two carts", async () => {
    // The vendor is made whole in cash on the USD rail by ordinary settlement.
    // If settle credited a vendor instead of the issuer, the credit would keep
    // existing as spendable value somewhere in the system.
    const h = makeHawala()

    await settleCartCredits(
      asService(h),
      { cartId: "cart_1", orderId: "order_1", credits: 40 },
      "acct_issuer"
    )

    const escrow = h.accounts.find((a) => a.account_type === "ESCROW")
    const t = h.transfers[0] as Record<string, unknown>
    expect(t.debit_account_id).toBe(escrow?.id)
    expect(t.credit_account_id).toBe("acct_issuer")
  })

  it("keys settle distinctly from release so a retry cannot cross the two", async () => {
    const h = makeHawala()

    await settleCartCredits(asService(h), { cartId: "cart_1", orderId: "o1", credits: 1 }, "acct_i")
    await releaseCartCredits(asService(h), { cartId: "cart_1", customerId: "cus_1", credits: 1 })

    const keys = (h.transfers as Record<string, string>[]).map((t) => t.idempotency_key)
    expect(new Set(keys).size).toBe(2)
  })
})
