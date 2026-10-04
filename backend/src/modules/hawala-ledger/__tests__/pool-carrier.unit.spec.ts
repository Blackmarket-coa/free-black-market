import { CarrierRefusalError, type PoolCarrierSnapshot } from "../carrier"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import { makeAccount, makePool, makePoolAccount, makePoolLedger, type Row } from "./in-memory-pool-ledger"

/**
 * Nonprofit-carried pools against the REAL `HawalaLedgerModuleService`
 * prototype with only the generated CRUD shadowed in memory
 * (`./in-memory-pool-ledger.ts`). docs/BMC_SURVIVAL_PROGRAMS.md Decision 6b;
 * legal checkpoints L26, L11, L3.
 *
 * Pinned:
 *   - FF_NONPROFIT_PARITY_V1 unset: an uncarried pool still takes a ledger
 *     investment exactly as before (entry written, wallet debited, pool
 *     credited, totals bumped) — byte-identical;
 *   - flag on: NO code path can post a ledger entry whose debit or credit
 *     account is a pool account — by `investment_pool_id` AND by account id,
 *     uncarried (`no_carrier`) and carried (`carried_pool`) alike; the refusal
 *     happens before any entry is written or balance moves;
 *   - a carried pool is refused by createInvestment, distributeDividends and
 *     createTransfer whatever the flag says (a carrier is a fact about who
 *     holds the money, not a feature);
 *   - assignPoolCarrier: dark with the flag off; shape-validates the snapshot;
 *     refuses a pool with ledger funds; refuses changing the carrier once
 *     CARRIER rows exist; keeps the dormant ledger account;
 *   - recordCarrierContribution / recordCarrierDistribution: no ledger entry,
 *     no account touched, totals DERIVED from the rows, and under two
 *     concurrent calls with the same carrier_reference exactly one is counted;
 *   - the generated createInvestmentPools / updateInvestmentPools strip the
 *     carrier columns on the real prototype.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const AS_OF = "2026-09-10T09:18:37.000Z"
const SNAP_AT = "2026-10-04T12:00:00.000Z"

const snapshot = (over: Partial<PoolCarrierSnapshot> = {}): PoolCarrierSnapshot => ({
  org_key: "ground_up_liberation_project",
  org_type: "irs_501c3",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  stripe_connect_account_present: true,
  snapshot_at: SNAP_AT,
  ...over,
})

const carriedPool = (id = "pool_c", over: Partial<Row> = {}): Row =>
  makePool(id, { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: snapshot(), ...over })

function ledger(opts: { carried?: boolean } = {}) {
  const pool = opts.carried ? carriedPool("pool_1") : makePool("pool_1")
  return makePoolLedger({
    pools: [pool],
    accounts: [makeAccount("acc-wallet"), makePoolAccount("acc-pool_1"), makeAccount("acc-earnings", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", balance: 0, available_balance: 0 })],
  })
}

/** An order's ledger: customer wallet, the two system accounts, a seller; no pool yet. */
function orderLedger() {
  return makePoolLedger({
    accounts: [
      makeAccount("acc-wallet"),
      makeAccount("acc-escrow", { account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-platform", { account_type: "PLATFORM_FEE", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-earnings", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", balance: 0, available_balance: 0 }),
    ],
  })
}

const orderPayment = () => ({
  customer_account_id: "acc-wallet",
  seller_account_id: "acc-earnings",
  order_id: "order_1",
  total_amount: 100,
  platform_fee_amount: 3,
  producer_id: "prod_1",
  auto_invest_percentage: 2,
  idempotency_key: "order_1",
})

async function refusal(p: Promise<unknown>): Promise<CarrierRefusalError> {
  try {
    await p
  } catch (e) {
    if (e instanceof CarrierRefusalError) return e
    throw e
  }
  throw new Error("expected a CarrierRefusalError")
}

afterEach(() => {
  delete process.env[FLAG]
})

describe("FF_NONPROFIT_PARITY_V1 unset — byte-identical pool paths", () => {
  it("an uncarried pool still takes a ledger investment: entry written, wallet debited, pool credited, totals bumped", async () => {
    const l = ledger()
    const inv = await l.service.createInvestment({ pool_id: "pool_1", investor_account_id: "acc-wallet", customer_id: "cust_1", amount: 75 })

    expect(l.entries).toHaveLength(1)
    expect(l.entries[0]).toMatchObject({ debit_account_id: "acc-wallet", credit_account_id: "acc-pool_1", amount: 75, entry_type: "INVESTMENT", investment_pool_id: "pool_1", status: "COMPLETED" })
    expect(l.balanceMoves).toEqual([
      { accountId: "acc-wallet", delta: -75 },
      { accountId: "acc-pool_1", delta: 75 },
    ])
    expect(inv).toMatchObject({ pool_id: "pool_1", investor_account_id: "acc-wallet", ledger_entry_id: "le_1", status: "CONFIRMED" })
    expect(l.pools[0]).toMatchObject({ total_raised: 75, total_investors: 1 })
  })

  it("a WITHDRAWAL leg from an uncarried pool account still posts", async () => {
    const l = ledger()
    l.accounts[1].balance = 200
    l.accounts[1].available_balance = 200
    const entry = await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-earnings", amount: 50, entry_type: "WITHDRAWAL", investment_pool_id: "pool_1" })
    expect(entry).toMatchObject({ status: "COMPLETED", amount: 50 })
    expect(l.entries).toHaveLength(1)
  })

  it("a transfer that touches no pool reads no pools at all", async () => {
    const l = makePoolLedger({ accounts: [makeAccount("a"), makeAccount("b")] })
    const reads = jest.fn(async () => [])
    ;(l.service as unknown as Record<string, unknown>).listInvestmentPools = reads
    await l.service.createTransfer({ debit_account_id: "a", credit_account_id: "b", amount: 10, entry_type: "TRANSFER" })
    expect(reads).not.toHaveBeenCalled()
    expect(l.entries).toHaveLength(1)
  })

  it("assignPoolCarrier, recordCarrierContribution and recordCarrierDistribution are dark: feature_disabled before any read or write", async () => {
    const l = ledger({ carried: true })
    expect((await refusal(l.service.assignPoolCarrier("pool_1", snapshot()))).reason).toBe("feature_disabled")
    expect((await refusal(l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "r1" }))).reason).toBe("feature_disabled")
    expect((await refusal(l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 10, carrier_reference: "d1" }))).reason).toBe("feature_disabled")
    expect(l.poolWrites).toEqual([])
    expect(l.investments).toEqual([])
    expect(l.distributions).toEqual([])
  })
})

describe("a carried pool never gets a ledger leg — flag on or off", () => {
  for (const flag of ["unset", "true"] as const) {
    describe(`FF_NONPROFIT_PARITY_V1 ${flag}`, () => {
      beforeEach(() => {
        if (flag === "true") process.env[FLAG] = "true"
      })

      it("createInvestment is refused with carried_pool before any entry or balance move", async () => {
        const l = ledger({ carried: true })
        const e = await refusal(l.service.createInvestment({ pool_id: "pool_1", investor_account_id: "acc-wallet", amount: 75 }))
        expect(e.reason).toBe("carried_pool")
        expect(l.entries).toEqual([])
        expect(l.balanceMoves).toEqual([])
        expect(l.investments).toEqual([])
        expect(l.pools[0].total_raised).toBe(0)
      })

      it("createTransfer by investment_pool_id (INVESTMENT, DIVIDEND, WITHDRAWAL) is refused", async () => {
        const l = ledger({ carried: true })
        for (const [entry_type, debit, credit] of [
          ["INVESTMENT", "acc-wallet", "acc-pool_1"],
          ["DIVIDEND", "acc-pool_1", "acc-wallet"],
          ["WITHDRAWAL", "acc-pool_1", "acc-earnings"],
        ] as const) {
          const e = await refusal(l.service.createTransfer({ debit_account_id: debit, credit_account_id: credit, amount: 10, entry_type, investment_pool_id: "pool_1" }))
          expect(e.reason).toBe("carried_pool")
        }
        expect(l.entries).toEqual([])
        expect(l.balanceMoves).toEqual([])
      })

      it("createTransfer by PRODUCER_POOL account id with NO investment_pool_id (the refund reversal shape) is refused", async () => {
        const l = ledger({ carried: true })
        l.accounts[1].balance = 100
        l.accounts[1].available_balance = 100
        const e = await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-wallet", amount: 10, entry_type: "REFUND" }))
        expect(e.reason).toBe("carried_pool")
        expect(l.entries).toEqual([])
      })

      it("distributeDividends is refused with carried_pool and pays nothing", async () => {
        const l = ledger({ carried: true })
        l.investments.push({ id: "inv_x", pool_id: "pool_1", status: "CONFIRMED", amount: 50, investor_account_id: "acc-wallet", settlement: "LEDGER", actual_return: 0, return_distributed: 0 })
        const e = await refusal(l.service.distributeDividends({ pool_id: "pool_1", total_amount: 10 }))
        expect(e.reason).toBe("carried_pool")
        expect(l.entries).toEqual([])
        expect(l.pools[0].total_distributed).toBe(0)
      })
    })
  }
})

describe("FF_NONPROFIT_PARITY_V1 on — a pool with no carrier cannot accept money", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("createInvestment on an uncarried pool is refused inside createTransfer with no_carrier; nothing is written", async () => {
    const l = ledger()
    const e = await refusal(l.service.createInvestment({ pool_id: "pool_1", investor_account_id: "acc-wallet", amount: 75 }))
    expect(e.reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
    expect(l.investments).toEqual([])
    expect(l.pools[0]).toMatchObject({ total_raised: 0, total_investors: 0 })
  })

  it("createTransfer by investment_pool_id and by PRODUCER_POOL account id are both refused with no_carrier", async () => {
    const l = ledger()
    l.accounts[1].balance = 100
    l.accounts[1].available_balance = 100
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-wallet", credit_account_id: "acc-pool_1", amount: 10, entry_type: "INVESTMENT", investment_pool_id: "pool_1" }))).reason).toBe("no_carrier")
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-wallet", amount: 10, entry_type: "REFUND" }))).reason).toBe("no_carrier")
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-earnings", amount: 10, entry_type: "WITHDRAWAL" }))).reason).toBe("no_carrier")
    // A leg naming a pool id no pool has is a pool leg with no carrier.
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-wallet", credit_account_id: "acc-earnings", amount: 10, entry_type: "INVESTMENT", investment_pool_id: "pool_ghost" }))).reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
  })

  it("a transfer between two non-pool accounts still posts", async () => {
    const l = ledger()
    const entry = await l.service.createTransfer({ debit_account_id: "acc-wallet", credit_account_id: "acc-earnings", amount: 10, entry_type: "TRANSFER" })
    expect(entry).toMatchObject({ status: "COMPLETED" })
  })

  it("an ORPHAN PRODUCER_POOL account (no pool row owns it) is refused with no_carrier on either leg; the account type is the custody shape", async () => {
    const l = makePoolLedger({ accounts: [makeAccount("acc-wallet"), makePoolAccount("acc-orphan", { balance: 100, available_balance: 100 }), makeAccount("acc-earnings", { account_type: "SELLER_EARNINGS", owner_type: "SELLER" })] })
    const credit = await refusal(l.service.createTransfer({ debit_account_id: "acc-wallet", credit_account_id: "acc-orphan", amount: 10, entry_type: "INVESTMENT" }))
    expect(credit.reason).toBe("no_carrier")
    expect(credit.details).toMatchObject({ pool_id: null, investment_pool_id: null, pool_account_ids: ["acc-orphan"] })
    const debit = await refusal(l.service.createTransfer({ debit_account_id: "acc-orphan", credit_account_id: "acc-earnings", amount: 10, entry_type: "WITHDRAWAL" }))
    expect(debit.reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
  })

  it("processOrderPayment with auto-invest configured does NOT carve out an investment: three legs, the seller leg carries the full net, no pool and no pool account are created", async () => {
    const l = orderLedger()
    const entries = await l.service.processOrderPayment(orderPayment())
    expect(entries.map((e) => [e.entry_type, Number(e.amount)])).toEqual([["PURCHASE", 100], ["COMMISSION", 3], ["TRANSFER", 97]])
    expect(l.entries.every((e) => e.status === "COMPLETED")).toBe(true)
    expect(l.pools).toEqual([])
    expect(l.accounts.filter((a) => a.account_type === "PRODUCER_POOL")).toEqual([])
    // Nothing stranded in escrow.
    expect(l.accounts.find((a) => a.id === "acc-escrow")).toMatchObject({ balance: 0 })
    expect(l.accounts.find((a) => a.id === "acc-earnings")).toMatchObject({ balance: 97 })
  })
})

describe("FF_NONPROFIT_PARITY_V1 unset — processOrderPayment's auto-invest leg is byte-identical", () => {
  it("carves out the investment, creates the uncarried pool and posts the fourth leg exactly as before", async () => {
    const l = orderLedger()
    const entries = await l.service.processOrderPayment(orderPayment())
    expect(entries.map((e) => [e.entry_type, Number(e.amount)])).toEqual([["PURCHASE", 100], ["COMMISSION", 3], ["TRANSFER", 96], ["INVESTMENT", 1]])
    expect(l.pools).toHaveLength(1)
    expect(l.pools[0]).toMatchObject({ producer_id: "prod_1", carrier_org_key: null })
    expect(l.accounts.filter((a) => a.account_type === "PRODUCER_POOL")).toHaveLength(1)
    expect(l.accounts.find((a) => a.id === "acc-escrow")).toMatchObject({ balance: 0 })
    expect(l.accounts.find((a) => a.id === "acc-earnings")).toMatchObject({ balance: 96 })
  })
})

describe("assignPoolCarrier (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("writes carrier_org_key + the validated snapshot through the private path, keeps the dormant ledger account, and the carrier then projects", async () => {
    const l = ledger()
    const pool = await l.service.assignPoolCarrier("pool_1", snapshot())
    expect(pool).toMatchObject({ id: "pool_1", carrier_org_key: "ground_up_liberation_project", ledger_account_id: "acc-pool_1" })
    expect(pool.carrier_snapshot).toEqual(snapshot())
    expect(l.poolWrites).toEqual([{ op: "update", data: { id: "pool_1", carrier_org_key: "ground_up_liberation_project", carrier_snapshot: snapshot() } }])

    const [details] = await l.service.getVendorPoolsWithDetails("prod_1")
    expect(details.carrier).toEqual({ org_key: "ground_up_liberation_project", verification_status: "pub78_eligible", verified_as_of: AS_OF })
    expect(details.current_balance).toBeNull()
  })

  it("refuses an invalid or unverified snapshot before reading the pool", async () => {
    const l = ledger()
    const reads = jest.fn(async () => l.pools)
    ;(l.service as unknown as Record<string, unknown>).listInvestmentPools = reads
    for (const bad of [
      snapshot({ verification_status: "revoked" }),
      snapshot({ verification_status: "not_found" }),
      snapshot({ verification_status: "unverified" }),
      snapshot({ stripe_connect_account_present: false }),
      snapshot({ verified_as_of: null }),
      { is_charity: true },
      null,
    ]) {
      expect((await refusal(l.service.assignPoolCarrier("pool_1", bad))).reason).toBe("invalid_carrier_snapshot")
    }
    expect(reads).not.toHaveBeenCalled()
    expect(l.poolWrites).toEqual([])
  })

  it("refuses a pool with total_raised, a ledger balance, or a LEDGER-settled investment (pool_has_ledger_funds)", async () => {
    const raised = ledger()
    raised.pools[0].total_raised = 25
    expect((await refusal(raised.service.assignPoolCarrier("pool_1", snapshot()))).reason).toBe("pool_has_ledger_funds")

    const balance = ledger()
    balance.accounts[1].balance = 0.01
    expect((await refusal(balance.service.assignPoolCarrier("pool_1", snapshot()))).reason).toBe("pool_has_ledger_funds")

    const rows = ledger()
    rows.investments.push({ id: "inv_old", pool_id: "pool_1", settlement: "LEDGER", amount: 5, status: "CONFIRMED" })
    expect((await refusal(rows.service.assignPoolCarrier("pool_1", snapshot()))).reason).toBe("pool_has_ledger_funds")

    for (const l of [raised, balance, rows]) {
      expect(l.poolWrites).toEqual([])
      expect(l.pools[0].carrier_org_key).toBeNull()
    }
  })

  it("refuses changing the carrier once CARRIER records exist, but re-freezes the same carrier's snapshot", async () => {
    const l = ledger({ carried: true })
    l.investments.push({ id: "inv_c", pool_id: "pool_1", settlement: "CARRIER", amount: 20, carrier_reference: "gulp-1", status: "CONFIRMED" })
    expect((await refusal(l.service.assignPoolCarrier("pool_1", snapshot({ org_key: "another_org" })))).reason).toBe("pool_has_carrier_records")
    expect(l.pools[0].carrier_org_key).toBe("ground_up_liberation_project")

    const refreshed = snapshot({ verified_as_of: "2026-10-01T00:00:00.000Z", snapshot_at: "2026-10-04T13:00:00.000Z" })
    await l.service.assignPoolCarrier("pool_1", refreshed)
    expect(l.pools[0].carrier_snapshot).toEqual(refreshed)
  })

  it("an unknown pool is 'Investment pool not found'", async () => {
    const l = ledger()
    await expect(l.service.assignPoolCarrier("pool_ghost", snapshot())).rejects.toThrow("Investment pool not found")
  })
})

describe("recordCarrierContribution (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("writes a CARRIER row with no account and no ledger entry, touches no ledger, and derives the totals", async () => {
    const l = ledger({ carried: true })
    const out = await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 40.5, carrier_reference: "gulp-txn-1", customer_id: "cust_1" })
    expect(out.recorded).toBe(true)
    if (!out.recorded) throw new Error("unreachable")
    expect(out.investment).toMatchObject({
      pool_id: "pool_1",
      settlement: "CARRIER",
      investor_account_id: null,
      ledger_entry_id: null,
      carrier_org_key: "ground_up_liberation_project",
      carrier_reference: "gulp-txn-1",
      customer_id: "cust_1",
      amount: 40.5,
      status: "CONFIRMED",
      source: "DIRECT",
      currency_code: "USD",
    })
    expect(out.totals).toEqual({ total_raised: 40.5, total_investors: 1, total_distributed: 0 })
    expect(l.pools[0]).toMatchObject({ total_raised: 40.5, total_investors: 1, total_distributed: 0 })
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
    expect(l.accounts[1]).toMatchObject({ balance: 0, available_balance: 0 })
  })

  it("totals are DERIVED: the sum of the rows, distinct contributors, never a counter", async () => {
    const l = ledger({ carried: true })
    await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "a", customer_id: "cust_1" })
    await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 20.25, carrier_reference: "b", customer_id: "cust_1" })
    await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 0.1, carrier_reference: "c" })
    await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 0.2, carrier_reference: "d" })
    expect(l.pools[0]).toMatchObject({ total_raised: 30.55, total_investors: 3 })
    // Only derivations wrote the totals — no `+=` on a stale read.
    const totalWrites = l.poolWrites.filter((w) => "total_raised" in w.data)
    expect(totalWrites.map((w) => w.data.total_raised)).toEqual([10, 30.25, 30.35, 30.55])
  })

  it("a replayed carrier_reference answers already_recorded and writes nothing", async () => {
    const l = ledger({ carried: true })
    await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "dup" })
    const again = await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 999, carrier_reference: "dup" })
    expect(again).toEqual({ recorded: false, reason: "already_recorded", investment_id: "inv_1" })
    expect(l.investments).toHaveLength(1)
    expect(l.pools[0].total_raised).toBe(10)
  })

  it("two CONCURRENT calls with the same carrier_reference: both pass the pre-read, the unique index decides, exactly one is counted", async () => {
    const l = ledger({ carried: true })
    const [a, b] = await Promise.all([
      l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "race" }),
      l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "race" }),
    ])
    expect([a.recorded, b.recorded].sort()).toEqual([false, true])
    const loser = a.recorded ? b : a
    expect(loser).toEqual({ recorded: false, reason: "already_recorded", investment_id: "inv_1" })
    expect(l.investments).toHaveLength(1)
    expect(l.pools[0]).toMatchObject({ total_raised: 10, total_investors: 1 })
  })

  it("refuses an uncarried pool (no_carrier) and a bad amount or reference (invalid_carrier_record), writing nothing", async () => {
    const l = ledger()
    expect((await refusal(l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "x" }))).reason).toBe("no_carrier")
    const c = ledger({ carried: true })
    for (const amount of [0, -5, 1.005, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect((await refusal(c.service.recordCarrierContribution({ pool_id: "pool_1", amount, carrier_reference: "x" }))).reason).toBe("invalid_carrier_record")
    }
    expect((await refusal(c.service.recordCarrierContribution({ pool_id: "pool_1", amount: 10, carrier_reference: "  " }))).reason).toBe("invalid_carrier_record")
    expect(l.investments).toEqual([])
    expect(c.investments).toEqual([])
  })
})

describe("recordCarrierDistribution (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("writes a record, no per-investor allocation, no ledger leg; total_distributed is derived", async () => {
    const l = ledger({ carried: true })
    await l.service.recordCarrierContribution({ pool_id: "pool_1", amount: 100, carrier_reference: "in-1" })
    const when = new Date("2026-10-03T00:00:00Z")
    const out = await l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 7.5, carrier_reference: "out-1", distributed_at: when })
    expect(out.recorded).toBe(true)
    if (!out.recorded) throw new Error("unreachable")
    expect(out.distribution).toMatchObject({ pool_id: "pool_1", carrier_org_key: "ground_up_liberation_project", carrier_reference: "out-1", amount: 7.5, distributed_at: when })
    expect(out.totals).toEqual({ total_raised: 100, total_investors: 1, total_distributed: 7.5 })

    await l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 2.5, carrier_reference: "out-2" })
    expect(l.pools[0].total_distributed).toBe(10)
    expect(l.entries).toEqual([])
    expect(l.investments.map((i) => i.actual_return ?? 0)).toEqual([0])
  })

  it("is idempotent on the carrier's reference, under concurrency too", async () => {
    const l = ledger({ carried: true })
    const [a, b] = await Promise.all([
      l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 5, carrier_reference: "d" }),
      l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 5, carrier_reference: "d" }),
    ])
    expect([a.recorded, b.recorded].sort()).toEqual([false, true])
    expect(l.distributions).toHaveLength(1)
    expect(l.pools[0].total_distributed).toBe(5)
    const again = await l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 5, carrier_reference: "d" })
    expect(again).toEqual({ recorded: false, reason: "already_recorded", distribution_id: "dist_1" })
  })

  it("refuses an uncarried pool", async () => {
    const l = ledger()
    expect((await refusal(l.service.recordCarrierDistribution({ pool_id: "pool_1", amount: 5, carrier_reference: "d" }))).reason).toBe("no_carrier")
    expect(l.distributions).toEqual([])
  })
})

describe("the generated create/update cannot set a carrier", () => {
  it("createInvestmentPools and updateInvestmentPools strip carrier_org_key / carrier_snapshot on the real prototype, in every input shape", async () => {
    const l = makePoolLedger()
    const created = await l.service.createInvestmentPools({ name: "P", producer_id: "prod_1", ledger_account_id: "acc", target_amount: 1, carrier_org_key: "smuggled", carrier_snapshot: snapshot() })
    expect(created.carrier_org_key).toBeNull()
    expect(l.poolWrites[0].data).not.toHaveProperty("carrier_org_key")
    expect(l.poolWrites[0].data).not.toHaveProperty("carrier_snapshot")
    expect(l.poolWrites[0].data).toMatchObject({ name: "P", producer_id: "prod_1" })

    await l.service.updateInvestmentPools({ id: created.id, status: "ACTIVE", carrier_org_key: "smuggled", carrier_snapshot: snapshot() })
    expect(l.poolWrites[1].data).toEqual({ id: created.id, status: "ACTIVE" })
    expect(l.pools[0].carrier_org_key).toBeNull()

    await l.service.createInvestmentPools([{ name: "Q", producer_id: "prod_1", ledger_account_id: "acc2", target_amount: 1, carrier_org_key: "smuggled" }])
    const listWrite = l.poolWrites[2].data as unknown as Record<string, unknown>[]
    expect(listWrite[0]).not.toHaveProperty("carrier_org_key")
    expect(listWrite[0]).toMatchObject({ name: "Q" })

    await l.service.updateInvestmentPools({ selector: { id: created.id }, data: { name: "R", carrier_org_key: "smuggled" } })
    expect((l.poolWrites[3].data as { data: Record<string, unknown> }).data).toEqual({ name: "R" })
    expect(l.pools.every((p) => p.carrier_org_key === null)).toBe(true)
  })

  it("getOrCreateProducerPool creates an uncarried pool through the stripping override", async () => {
    const l = makePoolLedger()
    ;(l.service as unknown as Record<string, unknown>).createAccount = async () => ({ id: "acc-new" })
    const pool = await l.service.getOrCreateProducerPool("prod_9")
    expect(pool).toMatchObject({ producer_id: "prod_9", ledger_account_id: "acc-new", carrier_org_key: null })
    expect(l.poolWrites).toHaveLength(1)
    expect(l.poolWrites[0].op).toBe("create")
  })
})

describe("payload projections", () => {
  it("getVendorPoolsWithDetails: carried pools show the carrier and a null balance; uncarried pools are unchanged", async () => {
    const l = makePoolLedger({
      pools: [makePool("pool_u", { total_raised: 50 }), carriedPool("pool_c", { total_raised: 20 })],
      accounts: [makePoolAccount("acc-pool_u", { balance: 50, available_balance: 50 }), makePoolAccount("acc-pool_c")],
    })
    const out = await l.service.getVendorPoolsWithDetails("prod_1")
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: "pool_u", carrier: null, current_balance: 50 })
    expect(out[1]).toMatchObject({ id: "pool_c", carrier: { org_key: "ground_up_liberation_project", verification_status: "pub78_eligible", verified_as_of: AS_OF }, current_balance: null })
  })
})
