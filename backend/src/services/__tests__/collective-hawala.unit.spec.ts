import { CollectiveHawalaService } from "../collective-hawala"

/**
 * Fake hawala ledger: createTransfer is idempotent by idempotency_key
 * (returns the existing entry on a key collision), mirroring the real
 * service's contract.
 */
function makeFakeHawala() {
  const transfers: any[] = []
  const byKey = new Map<string, any>()
  let seq = 0

  return {
    transfers,
    listLedgerAccounts: jest.fn(async (filter: any) => {
      // Always return a single matching account.
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
    getOrCreateSystemAccount: jest.fn(),
  }
}

function makeFakeDemandPool(overrides: Partial<any> = {}) {
  const post = {
    id: "dp_1",
    escrow_account_id: "escrow_1",
    total_escrowed: 0,
    ...overrides.post,
  }
  const bounties: Record<string, any> = overrides.bounties || {}

  return {
    post,
    bounties,
    listDemandPosts: jest.fn(async () => [post]),
    updateDemandPosts: jest.fn(async () => post),
    listDemandBounties: jest.fn(async (filter: any) => {
      if (filter?.id) {
        return bounties[filter.id] ? [bounties[filter.id]] : []
      }
      return Object.values(bounties)
    }),
    updateDemandBounties: jest.fn(async (input: any) => {
      Object.assign(bounties[input.id], input)
      return bounties[input.id]
    }),
    completeBountyMilestone: jest.fn(),
  }
}

describe("CollectiveHawalaService", () => {
  it("payBountyMilestone is idempotent per (bounty_id, milestone_index)", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool()
    const svc = new CollectiveHawalaService(
      hawala as any,
      demandPool as any
    )

    const input = {
      demand_post_id: "dp_1",
      bounty_id: "b_1",
      milestone_index: 0,
      assignee_id: "user_1",
      amount: 50,
      milestone_description: "ms",
    }

    const first = await svc.payBountyMilestone(input)
    const second = await svc.payBountyMilestone(input)

    expect(first.id).toBe(second.id)
    expect(hawala.transfers).toHaveLength(1)
  })

  it("payBountyMilestone uses reference_type DEMAND_BOUNTY (not ORDER)", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool()
    const svc = new CollectiveHawalaService(
      hawala as any,
      demandPool as any
    )

    await svc.payBountyMilestone({
      demand_post_id: "dp_1",
      bounty_id: "b_1",
      milestone_index: 1,
      assignee_id: "user_1",
      amount: 25,
      milestone_description: "ms",
    })

    const call = hawala.createTransfer.mock.calls[0][0]
    expect(call.reference_type).toBe("DEMAND_BOUNTY")
    expect(call.reference_id).toBe("b_1")
    expect(call.idempotency_key).toBe("bounty-payout-b_1-m1")
  })

  it("refundBountyEscrow refunds the unpaid remainder", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool({
      bounties: {
        b_1: {
          id: "b_1",
          contributor_id: "user_1",
          amount: 100,
          amount_paid_out: 40,
          status: "MILESTONE_PARTIAL",
        },
      },
    })
    const svc = new CollectiveHawalaService(
      hawala as any,
      demandPool as any
    )

    const entry = await svc.refundBountyEscrow({
      demand_post_id: "dp_1",
      bounty_id: "b_1",
    })

    expect(entry).not.toBeNull()
    const call = hawala.createTransfer.mock.calls[0][0]
    expect(call.amount).toBe(60)
    expect(call.entry_type).toBe("REFUND")
    expect(call.reference_type).toBe("DEMAND_BOUNTY")
    expect(demandPool.bounties.b_1.status).toBe("CANCELLED")
  })

  it("refundBountyEscrow is a no-op when fully paid out", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool({
      bounties: {
        b_1: {
          id: "b_1",
          contributor_id: "user_1",
          amount: 100,
          amount_paid_out: 100,
          status: "COMPLETED",
        },
      },
    })
    const svc = new CollectiveHawalaService(
      hawala as any,
      demandPool as any
    )

    const entry = await svc.refundBountyEscrow({
      demand_post_id: "dp_1",
      bounty_id: "b_1",
    })

    expect(entry).toBeNull()
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })
})
