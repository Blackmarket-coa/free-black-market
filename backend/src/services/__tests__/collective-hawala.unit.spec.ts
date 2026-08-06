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
      // Honour demand_post_id the way the ORM does, so pool-scoping is
      // actually exercised. Fixtures that omit it match any pool.
      const match = (b: any) =>
        filter?.demand_post_id === undefined ||
        b.demand_post_id === undefined ||
        b.demand_post_id === filter.demand_post_id
      if (filter?.id) {
        const found = bounties[filter.id]
        return found && match(found) ? [found] : []
      }
      return Object.values(bounties).filter(match)
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

/**
 * The milestone completion is a committed, irreversible UPDATE that cannot
 * share a transaction with the ledger transfer. So every precondition for the
 * payout has to be checked BEFORE it runs. If it were checked after, a failing
 * payout would leave the bounty marked complete with an inflated
 * `amount_paid_out` and no money moved — which also strands the escrowed
 * remainder, because `refundBountyEscrow` only returns
 * `amount - amount_paid_out`.
 */
describe("completeAndPayMilestone preconditions", () => {
  const payableBounty = (overrides: any = {}) => ({
    id: "b_victim",
    demand_post_id: "dp_owner",
    contributor_id: "user_1",
    assignee_id: "worker_1",
    assignee_type: "CUSTOMER",
    amount: 100,
    amount_paid_out: 0,
    currency_code: "USD",
    milestones: [{ description: "m0", percentage: 100, condition: "x" }],
    ...overrides,
  })

  it("refuses a bounty from another pool without touching the completion", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool({
      post: { id: "dp_attacker", escrow_account_id: "escrow_attacker" },
      bounties: { b_victim: payableBounty() },
    })
    const svc = new CollectiveHawalaService(hawala as any, demandPool as any)

    await expect(
      svc.completeAndPayMilestone({
        demand_post_id: "dp_attacker",
        bounty_id: "b_victim",
        milestone_index: 0,
      })
    ).rejects.toThrow("Bounty not found")

    expect(demandPool.completeBountyMilestone).not.toHaveBeenCalled()
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })

  it("does not complete the milestone when the pool has no escrow account", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool({
      post: { id: "dp_owner", escrow_account_id: null },
      bounties: { b_victim: payableBounty() },
    })
    const svc = new CollectiveHawalaService(hawala as any, demandPool as any)

    await expect(
      svc.completeAndPayMilestone({
        demand_post_id: "dp_owner",
        bounty_id: "b_victim",
        milestone_index: 0,
      })
    ).rejects.toThrow("Escrow account not found")

    expect(demandPool.completeBountyMilestone).not.toHaveBeenCalled()
  })

  it("does not complete the milestone when the bounty has no assignee", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool({
      post: { id: "dp_owner", escrow_account_id: "escrow_1" },
      bounties: { b_victim: payableBounty({ assignee_id: null }) },
    })
    const svc = new CollectiveHawalaService(hawala as any, demandPool as any)

    await expect(
      svc.completeAndPayMilestone({
        demand_post_id: "dp_owner",
        bounty_id: "b_victim",
        milestone_index: 0,
      })
    ).rejects.toThrow("Bounty has no assignee to pay")

    expect(demandPool.completeBountyMilestone).not.toHaveBeenCalled()
  })

  it("does not complete the milestone when the assignee has no ledger account", async () => {
    const hawala = makeFakeHawala()
    hawala.listLedgerAccounts = jest.fn(
      async (_filter: any) => [] as { id: string }[]
    )
    const demandPool = makeFakeDemandPool({
      post: { id: "dp_owner", escrow_account_id: "escrow_1" },
      bounties: { b_victim: payableBounty() },
    })
    const svc = new CollectiveHawalaService(hawala as any, demandPool as any)

    await expect(
      svc.completeAndPayMilestone({
        demand_post_id: "dp_owner",
        bounty_id: "b_victim",
        milestone_index: 0,
      })
    ).rejects.toThrow("Assignee account not found")

    expect(demandPool.completeBountyMilestone).not.toHaveBeenCalled()
  })

  it("completes and pays, scoping the completion to the owning pool", async () => {
    const hawala = makeFakeHawala()
    const demandPool = makeFakeDemandPool({
      post: { id: "dp_owner", escrow_account_id: "escrow_1" },
      bounties: { b_victim: payableBounty() },
    })
    demandPool.completeBountyMilestone = jest.fn(async () => ({
      bounty_id: "b_victim",
      milestone_index: 0,
      payout_amount: 100,
      total_paid_out: 100,
      new_status: "COMPLETED",
      all_completed: true,
    }))
    const svc = new CollectiveHawalaService(hawala as any, demandPool as any)

    const result = await svc.completeAndPayMilestone({
      demand_post_id: "dp_owner",
      bounty_id: "b_victim",
      milestone_index: 0,
    })

    expect(demandPool.completeBountyMilestone).toHaveBeenCalledWith(
      "b_victim",
      0,
      "dp_owner"
    )
    expect(result.ledger_entry_id).toBeDefined()
    expect(hawala.transfers).toHaveLength(1)
  })
})

/**
 * Surplus redirect at the point the escrow actually moves.
 *
 * The guardrail is that redirecting is explicit, opt-in and reversible until
 * finalization — so the default path must stay a plain refund, and a recorded
 * DONATE intent must not move money while the compliance rail is closed.
 */
describe("releaseParticipantEscrow — surplus disposition", () => {
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

  const build = (surplus_disposition: string) => {
    const hawala = makeFakeHawala()
    const participant = {
      id: "part_1",
      demand_post_id: "dp_1",
      customer_id: "cus_1",
      escrow_amount: 100,
      escrow_locked: true,
      surplus_disposition,
    }
    const demandPool: any = makeFakeDemandPool()
    demandPool.listDemandParticipants = jest.fn(async () => [participant])
    demandPool.updateDemandParticipants = jest.fn(async () => participant)
    const svc = new CollectiveHawalaService(hawala as any, demandPool as any)
    return { hawala, svc }
  }

  const release = (svc: any) =>
    svc.releaseParticipantEscrow({
      demand_post_id: "dp_1",
      participant_id: "part_1",
      customer_id: "cus_1",
    })

  it("refunds to the buyer by default", async () => {
    const { hawala, svc } = build("REFUND")
    process.env[FLAG] = "1"
    process.env[ACCOUNT] = "acc_mutual_aid"

    await release(svc)

    const call = hawala.createTransfer.mock.calls[0][0]
    expect(call.entry_type).toBe("REFUND")
    expect(call.credit_account_id).toBe("acct_cus_1")
    expect(call.idempotency_key).toBe("demand-release-part_1")
  })

  it("still refunds a DONATE intent while the rail is closed", async () => {
    const { hawala, svc } = build("DONATE")
    delete process.env[FLAG]
    process.env[ACCOUNT] = "acc_mutual_aid"

    await release(svc)

    // Intent recorded, money still returned — the safe direction to fail in.
    const call = hawala.createTransfer.mock.calls[0][0]
    expect(call.entry_type).toBe("REFUND")
    expect(call.credit_account_id).toBe("acct_cus_1")
  })

  it("routes to the configured account once opted in and open", async () => {
    const { hawala, svc } = build("DONATE")
    process.env[FLAG] = "1"
    process.env[ACCOUNT] = "acc_mutual_aid"

    await release(svc)

    const call = hawala.createTransfer.mock.calls[0][0]
    expect(call.credit_account_id).toBe("acc_mutual_aid")
    // A distinct key: one escrow must never yield both a refund and a redirect.
    expect(call.idempotency_key).toBe("demand-donate-part_1")
    expect(call.description).toMatch(/mutual aid/i)
  })

  it("refuses to move money when the rail is open but unconfigured", async () => {
    const { hawala, svc } = build("DONATE")
    process.env[FLAG] = "1"
    delete process.env[ACCOUNT]

    await expect(release(svc)).rejects.toThrow(/FBM_MUTUAL_AID_ACCOUNT_ID/)
    // Nothing moved — better a loud failure than a quiet misroute.
    expect(hawala.createTransfer).not.toHaveBeenCalled()
  })
})
