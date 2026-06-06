import {
  CollectiveHawalaService,
  SPONSORSHIP_PLATFORM_FEE_PERCENT,
} from "../collective-hawala"

/**
 * Fake hawala ledger for the sponsorship money path. createTransfer is
 * idempotent by idempotency_key; accounts always resolve (with ample balance)
 * and the platform fee account is a real stub so the 90/10 split can run.
 */
function makeFakeHawala() {
  const transfers: any[] = []
  const byKey = new Map<string, any>()
  let seq = 0

  return {
    transfers,
    listLedgerAccounts: jest.fn(async (filter: any) => [
      {
        id: `acct_${filter.owner_id || filter.id || filter.account_type || "x"}`,
        available_balance: 1_000_000,
      },
    ]),
    createAccount: jest.fn(async (input: any) => ({
      id: `acct_${input.owner_id}`,
      ...input,
    })),
    getOrCreateSystemAccount: jest.fn(async (accountType: string) => ({
      id: `acct_system_${accountType}`,
    })),
    createTransfer: jest.fn(async (input: any) => {
      if (input.idempotency_key && byKey.has(input.idempotency_key)) {
        return byKey.get(input.idempotency_key)
      }
      const entry = { id: `entry_${seq++}`, ...input }
      transfers.push(entry)
      if (input.idempotency_key) byKey.set(input.idempotency_key, entry)
      return entry
    }),
  }
}

function makeService() {
  const hawala = makeFakeHawala()
  const svc = new CollectiveHawalaService(hawala as any, {} as any)
  return { hawala, svc }
}

describe("CollectiveHawalaService — sponsorship", () => {
  it("the platform fee is 10%", () => {
    expect(SPONSORSHIP_PLATFORM_FEE_PERCENT).toBe(10)
  })

  it("escrowSponsorshipFunds locks producer funds with a SPONSORSHIP ref", async () => {
    const { hawala, svc } = makeService()

    await svc.escrowSponsorshipFunds({
      sponsorship_id: "spn_1",
      producer_id: "seller_1",
      amount: 100,
    })

    const call = hawala.createTransfer.mock.calls[0][0]
    expect(call.amount).toBe(100)
    expect(call.entry_type).toBe("FEE")
    expect(call.reference_type).toBe("SPONSORSHIP")
    expect(call.reference_id).toBe("spn_1")
    expect(call.idempotency_key).toBe("sponsorship-escrow-spn_1")
  })

  it("escrowSponsorshipFunds rejects when the wallet can't cover it", async () => {
    const { hawala, svc } = makeService()
    hawala.listLedgerAccounts.mockImplementation(async (filter: any) =>
      filter.account_type === "USER_WALLET"
        ? [{ id: "acct_seller_1", available_balance: 10 }]
        : [{ id: "acct_escrow", available_balance: 0 }]
    )

    await expect(
      svc.escrowSponsorshipFunds({
        sponsorship_id: "spn_1",
        producer_id: "seller_1",
        amount: 100,
      })
    ).rejects.toThrow("Insufficient balance for sponsorship escrow")
  })

  it("paySponsorship splits into exactly two entries (10% fee + 90% payout)", async () => {
    const { hawala, svc } = makeService()

    const result = await svc.paySponsorship({
      sponsorship_id: "spn_1",
      creator_id: "creator_1",
      amount: 100,
    })

    expect(result.platform_fee).toBe(10)
    expect(result.creator_amount).toBe(90)
    expect(hawala.transfers).toHaveLength(2)

    const fee = hawala.createTransfer.mock.calls.find(
      (c: any[]) => c[0].idempotency_key === "sponsorship-fee-spn_1"
    )![0]
    expect(fee.amount).toBe(10)
    expect(fee.entry_type).toBe("COMMISSION")
    expect(fee.reference_type).toBe("SPONSORSHIP")
    expect(fee.credit_account_id).toBe("acct_system_PLATFORM_FEE")

    const payout = hawala.createTransfer.mock.calls.find(
      (c: any[]) => c[0].idempotency_key === "sponsorship-payout-spn_1"
    )![0]
    expect(payout.amount).toBe(90)
    expect(payout.entry_type).toBe("TRANSFER")
  })

  it("the two payout legs always sum to the escrowed amount (non-round case)", async () => {
    const { svc } = makeService()

    const result = await svc.paySponsorship({
      sponsorship_id: "spn_2",
      creator_id: "creator_1",
      amount: 33.33,
    })

    expect(result.platform_fee + result.creator_amount).toBeCloseTo(33.33, 2)
    expect(result.platform_fee).toBe(3.33)
  })

  it("paySponsorship is idempotent — a retry produces no duplicate entries", async () => {
    const { hawala, svc } = makeService()

    const first = await svc.paySponsorship({
      sponsorship_id: "spn_1",
      creator_id: "creator_1",
      amount: 100,
    })
    const second = await svc.paySponsorship({
      sponsorship_id: "spn_1",
      creator_id: "creator_1",
      amount: 100,
    })

    expect(second.fee_entry.id).toBe(first.fee_entry.id)
    expect(second.payout_entry.id).toBe(first.payout_entry.id)
    expect(hawala.transfers).toHaveLength(2)
  })
})
