import { CollectiveHawalaService } from "../collective-hawala"

/**
 * Tier 0 of docs/SAVINGS_ROUTING_SPEC.md: at group-buy completion, each
 * participant's escrow residual — whatever they escrowed beyond
 * `quantity_committed × final_unit_price` — is returned instead of being
 * stranded in the pool's escrow account.
 *
 * These pin the money-shaped properties: the drain legs are untouched, the
 * residual moves on REFUND/ORDER vocabulary with a deterministic idempotency
 * key, shortfalls clamp to zero rather than charging anyone, retries cannot
 * double-move, and a DONATE disposition only redirects while the mutual-aid
 * rail is actually open. Fakes mirror collective-hawala.unit.spec.ts:
 * createTransfer is idempotent by key, like the real ledger.
 */

function makeFakeHawala() {
  const transfers: any[] = []
  const byKey = new Map<string, any>()
  let seq = 0

  return {
    transfers,
    listLedgerAccounts: jest.fn(async (filter: any) => {
      return [{ id: `acct_${filter.owner_id || filter.id || "x"}` }]
    }),
    createTransfer: jest.fn(async (input: any) => {
      if (input.idempotency_key && byKey.has(input.idempotency_key)) {
        return byKey.get(input.idempotency_key)
      }
      const entry = { id: `entry_${seq++}`, ...input }
      transfers.push(entry)
      if (input.idempotency_key) byKey.set(input.idempotency_key, entry)
      return entry
    }),
    createAccount: jest.fn(),
    getOrCreateSystemAccount: jest.fn(async () => ({
      id: "acct_platform_fee",
    })),
  }
}

type FakeParticipant = {
  id: string
  demand_post_id: string
  customer_id: string
  quantity_committed: number
  escrow_amount: number
  escrow_locked: boolean
  status: string
  surplus_disposition: string
}

function makeCompletionFixture(opts?: {
  post?: Record<string, any>
  participants?: FakeParticipant[]
}) {
  const post = {
    id: "dp_1",
    status: "DEAL_APPROVED",
    escrow_account_id: "escrow_1",
    final_unit_price: 10,
    final_total_price: 200,
    total_escrowed: 330,
    ...opts?.post,
  }

  const participants: FakeParticipant[] = opts?.participants ?? [
    {
      id: "part_over",
      demand_post_id: "dp_1",
      customer_id: "cus_over",
      quantity_committed: 10,
      escrow_amount: 150,
      escrow_locked: true,
      status: "ESCROWED",
      surplus_disposition: "REFUND",
    },
    {
      id: "part_exact",
      demand_post_id: "dp_1",
      customer_id: "cus_exact",
      quantity_committed: 10,
      escrow_amount: 100,
      escrow_locked: true,
      status: "ESCROWED",
      surplus_disposition: "REFUND",
    },
    {
      id: "part_short",
      demand_post_id: "dp_1",
      customer_id: "cus_short",
      quantity_committed: 10,
      escrow_amount: 80,
      escrow_locked: true,
      status: "ESCROWED",
      surplus_disposition: "REFUND",
    },
    {
      id: "part_committed",
      demand_post_id: "dp_1",
      customer_id: "cus_committed",
      quantity_committed: 5,
      escrow_amount: 0,
      escrow_locked: false,
      status: "COMMITTED",
      surplus_disposition: "REFUND",
    },
  ]

  const hawala = makeFakeHawala()
  const demandPool: any = {
    listDemandPosts: jest.fn(async () => [post]),
    updateDemandPosts: jest.fn(async (input: any) => {
      Object.assign(post, input)
      return post
    }),
    listDemandParticipants: jest.fn(async () => [...participants]),
    updateDemandParticipants: jest.fn(async (input: any) => {
      const found = participants.find((p) => p.id === input.id)
      if (found) Object.assign(found, input)
      return found
    }),
  }

  const svc = new CollectiveHawalaService(hawala as any, demandPool as any)
  return { hawala, demandPool, svc, post, participants }
}

const run = (svc: CollectiveHawalaService) =>
  svc.processGroupPurchase({
    demand_post_id: "dp_1",
    supplier_id: "sup_1",
    total_amount: 200,
    platform_fee_percentage: 5,
  })

describe("processGroupPurchase — Tier 0 residual return", () => {
  it("leaves the drain legs exactly as before", async () => {
    const { hawala, svc } = makeCompletionFixture()

    await run(svc)

    const fee = hawala.transfers.find(
      (t) => t.idempotency_key === "group-purchase-fee-dp_1"
    )
    const supplier = hawala.transfers.find(
      (t) => t.idempotency_key === "group-purchase-supplier-dp_1"
    )
    expect(fee).toMatchObject({
      amount: 10,
      entry_type: "COMMISSION",
      credit_account_id: "acct_platform_fee",
      reference_type: "ORDER",
    })
    expect(supplier).toMatchObject({
      amount: 190,
      entry_type: "TRANSFER",
      credit_account_id: "acct_sup_1",
      reference_type: "ORDER",
    })
  })

  it("returns the over-escrowed residual on REFUND/ORDER vocabulary", async () => {
    const { hawala, svc } = makeCompletionFixture()

    const result = await run(svc)

    const residual = hawala.transfers.find(
      (t) => t.idempotency_key === "demand-residual-part_over"
    )
    expect(residual).toMatchObject({
      amount: 50,
      entry_type: "REFUND",
      debit_account_id: "escrow_1",
      credit_account_id: "acct_cus_over",
      reference_type: "ORDER",
      reference_id: "dp_1",
    })
    expect(result.residual_total).toBe(50)
    expect(result.residuals).toContainEqual({
      participant_id: "part_over",
      customer_id: "cus_over",
      amount: 50,
      destination: "USER_WALLET",
      entry_id: residual.id,
    })
  })

  it("moves nothing for an exactly-escrowed participant but still closes their bookkeeping", async () => {
    const { hawala, demandPool, svc, participants } = makeCompletionFixture()

    await run(svc)

    expect(
      hawala.transfers.some((t) => t.credit_account_id === "acct_cus_exact")
    ).toBe(false)
    expect(demandPool.updateDemandParticipants).toHaveBeenCalledWith({
      id: "part_exact",
      escrow_amount: 0,
      escrow_locked: false,
      status: "CONFIRMED",
    })
    const exact = participants.find((p) => p.id === "part_exact")!
    expect(exact.escrow_amount).toBe(0)
    expect(exact.status).toBe("CONFIRMED")
  })

  it("clamps a shortfall to zero — no negative transfer, no charge-back", async () => {
    const { hawala, svc } = makeCompletionFixture()

    const result = await run(svc)

    expect(
      hawala.transfers.some((t) => t.credit_account_id === "acct_cus_short")
    ).toBe(false)
    expect(hawala.transfers.every((t) => t.amount >= 0)).toBe(true)
    expect(result.residuals).toContainEqual(
      expect.objectContaining({ participant_id: "part_short", amount: 0 })
    )
  })

  it("does not touch participants who never escrowed", async () => {
    const { demandPool, svc } = makeCompletionFixture()

    await run(svc)

    const updatedIds = demandPool.updateDemandParticipants.mock.calls.map(
      (c: any[]) => c[0].id
    )
    expect(updatedIds).not.toContain("part_committed")
  })

  it("flips the pool to ORDER_PLACED and winds total_escrowed down to zero", async () => {
    const { demandPool, svc, post } = makeCompletionFixture()

    await run(svc)

    // 330 escrowed across the three escrowed participants, all dispersed
    // (drain + residual), so nothing is left attributed to escrow.
    expect(post.status).toBe("ORDER_PLACED")
    expect(post.total_escrowed).toBe(0)
    // The decrement rides with each participant — one step per processed
    // escrow, never negative.
    const totals = demandPool.updateDemandPosts.mock.calls
      .map((c: any[]) => c[0].total_escrowed)
      .filter((t: any) => t !== undefined)
    expect(totals).toEqual([180, 80, 0])
  })

  it("refuses to run at all when final_unit_price is missing", async () => {
    const { hawala, svc } = makeCompletionFixture({
      post: { final_unit_price: null },
    })

    await expect(run(svc)).rejects.toThrow(/final_unit_price not set/)
    // Caught before the drain: nothing moved anywhere.
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })

  it("fails loudly when a residual recipient has no wallet — nothing silently re-strands", async () => {
    const { hawala, svc } = makeCompletionFixture()
    hawala.listLedgerAccounts = jest.fn(async (filter: any) => {
      if (filter.owner_type === "CUSTOMER") return []
      return [{ id: `acct_${filter.owner_id || filter.id || "x"}` }]
    })

    await expect(run(svc)).rejects.toThrow(
      /Customer wallet not found for participant part_over/
    )
  })

  it("is safe to retry after full success: everything dedupes, nothing double-moves", async () => {
    const { hawala, svc } = makeCompletionFixture()

    await run(svc)
    const second = await run(svc)

    // fee + supplier + one residual, created exactly once across both runs.
    expect(hawala.transfers).toHaveLength(3)
    // The retry sees zeroed escrows, so it reports no residuals — the first
    // response is the authoritative account of what was returned.
    expect(second.residuals).toEqual([])
    expect(second.residual_total).toBe(0)
  })

  it("is safe to retry after a crash between the transfer and the bookkeeping", async () => {
    const { hawala, demandPool, svc, participants } = makeCompletionFixture()
    const realUpdate = demandPool.updateDemandParticipants.getMockImplementation()
    demandPool.updateDemandParticipants = jest
      .fn()
      .mockRejectedValueOnce(new Error("db blip"))
      .mockImplementation(realUpdate)

    await expect(run(svc)).rejects.toThrow("db blip")
    // The residual transfer for part_over exists; its bookkeeping does not.
    expect(hawala.transfers).toHaveLength(3)
    expect(participants.find((p) => p.id === "part_over")!.escrow_amount).toBe(
      150
    )

    await run(svc)

    // Same idempotency key → the ledger returned the existing entry instead
    // of paying the residual a second time, and bookkeeping completed.
    expect(hawala.transfers).toHaveLength(3)
    const over = participants.find((p) => p.id === "part_over")!
    expect(over.escrow_amount).toBe(0)
    expect(over.status).toBe("CONFIRMED")
  })

  it("keeps total_escrowed consistent when a crash lands mid-loop", async () => {
    const { hawala, demandPool, svc, post, participants } =
      makeCompletionFixture()
    const realUpdate =
      demandPool.updateDemandParticipants.getMockImplementation()
    // part_over is fully processed; the crash hits part_exact's bookkeeping.
    demandPool.updateDemandParticipants = jest
      .fn()
      .mockImplementationOnce(realUpdate)
      .mockRejectedValueOnce(new Error("db blip"))
      .mockImplementation(realUpdate)

    await expect(run(svc)).rejects.toThrow("db blip")
    // part_over's deduction persisted alongside its zeroed escrow.
    expect(post.total_escrowed).toBe(180)

    await run(svc)

    // The retry skips part_over (already zeroed) without re-deducting it,
    // and the remaining two wind the counter down to exactly zero — the
    // property a single end-of-loop write would get wrong.
    expect(post.total_escrowed).toBe(0)
    expect(post.status).toBe("ORDER_PLACED")
    expect(hawala.transfers).toHaveLength(3)
    expect(participants.every((p) => p.escrow_amount === 0)).toBe(true)
  })
})

describe("processGroupPurchase — residual surplus disposition", () => {
  const FLAG = "FBM_SURPLUS_REDIRECT_LIVE"
  const ACCOUNT = "FBM_MUTUAL_AID_ACCOUNT_ID"
  const priorFlag = process.env[FLAG]
  const priorAccount = process.env[ACCOUNT]

  afterEach(() => {
    if (priorFlag === undefined) delete process.env[FLAG]
    else process.env[FLAG] = priorFlag
    if (priorAccount === undefined) delete process.env[ACCOUNT]
    else process.env[ACCOUNT] = priorAccount
  })

  const donateFixture = () =>
    makeCompletionFixture({
      post: { total_escrowed: 150 },
      participants: [
        {
          id: "part_donor",
          demand_post_id: "dp_1",
          customer_id: "cus_donor",
          quantity_committed: 10,
          escrow_amount: 150,
          escrow_locked: true,
          status: "ESCROWED",
          surplus_disposition: "DONATE",
        },
      ],
    })

  it("redirects the residual to mutual aid once opted in and open", async () => {
    const { hawala, svc } = donateFixture()
    process.env[FLAG] = "1"
    process.env[ACCOUNT] = "acc_mutual_aid"

    const result = await run(svc)

    const residual = hawala.transfers.find(
      (t) => t.idempotency_key === "demand-residual-part_donor"
    )
    expect(residual).toMatchObject({
      amount: 50,
      entry_type: "TRANSFER",
      credit_account_id: "acc_mutual_aid",
      reference_type: "ORDER",
    })
    expect(residual.description).toMatch(/mutual aid/i)
    expect(result.residuals[0].destination).toBe("MUTUAL_AID")
  })

  it("still refunds a DONATE intent while the rail is closed", async () => {
    const { hawala, svc } = donateFixture()
    delete process.env[FLAG]
    process.env[ACCOUNT] = "acc_mutual_aid"

    await run(svc)

    const residual = hawala.transfers.find(
      (t) => t.idempotency_key === "demand-residual-part_donor"
    )
    expect(residual).toMatchObject({
      entry_type: "REFUND",
      credit_account_id: "acct_cus_donor",
    })
  })

  it("refuses to move a redirected residual when the rail is open but unconfigured", async () => {
    const { hawala, svc } = donateFixture()
    process.env[FLAG] = "1"
    delete process.env[ACCOUNT]

    await expect(run(svc)).rejects.toThrow(/FBM_MUTUAL_AID_ACCOUNT_ID/)
    // The drain ran (fee + supplier); the residual leg did not — a loud
    // failure the admin can retry once the destination is configured.
    expect(hawala.transfers).toHaveLength(2)
    expect(
      hawala.transfers.some((t) =>
        String(t.idempotency_key).startsWith("demand-residual-")
      )
    ).toBe(false)
  })
})
