import { CarrierRefusalError, type PoolCarrierSnapshot } from "../carrier"
import { designatedReturnKey, stripPoolDesignationFields, summariseDesignatedPool } from "../designated"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import { makeAccount, makePool, makePoolAccount, makePoolLedger, type PoolLedger, type Row } from "./in-memory-pool-ledger"

/**
 * Designated legacy pool funds (docs/BMC_SURVIVAL_PROGRAMS.md Decision 8;
 * legal checkpoints L26, L3) against the REAL `HawalaLedgerModuleService`
 * prototype with only the generated CRUD shadowed in memory
 * (`./in-memory-pool-ledger.ts`): `createTransfer`'s guard, `processRefund`,
 * `distributeDividends`, `returnDesignatedFunds` and `listDesignatedPoolFunds`
 * are the code that ships.
 *
 * Pinned:
 *   - FF_NONPROFIT_PARITY_V1 unset: every pool path is byte-identical — the
 *     withdraw-to-earnings leg, the refund reversal and a ledger investment
 *     all post as before, nothing is stamped, and the new report / return are
 *     dark (feature_disabled before any read);
 *   - flag on, an UNCARRIED pool still holding legacy ledger funds:
 *     processRefund's Pool -> Escrow reversal succeeds again (the S12 open
 *     issue); a credit INTO the pool is refused `no_carrier`; a debit to
 *     SELLER_EARNINGS (or any non-contributor account) is refused
 *     `designated_outbound_only`; a debit back to a USER_WALLET is allowed and
 *     stamps `legacy_funds_designated_at` once; a zero-balance uncarried pool
 *     stays refused both ways; carried pools and orphan pool accounts are
 *     unchanged;
 *   - the destination is narrowed to the CONTRIBUTORS, not the account type:
 *     an investor's wallet in THIS pool or the system order escrow — a
 *     stranger's wallet or a per-entity escrow (a two-hop route to earnings)
 *     is refused; the stamp dates a COMPLETED outflow only;
 *   - returnDesignatedFunds: one REFUND leg keyed by the investment id, the
 *     investment then WITHDRAWN; idempotent (replay, concurrent double call,
 *     crash-between repair); `returned` / `already_returned` only on a
 *     COMPLETED entry — a FAILED move or a PENDING in-flight entry is
 *     designated_return_unsettled and the investment stays CONFIRMED; never
 *     touches a carried pool or a CARRIER row; refuses non-CONFIRMED rows and
 *     an account that cannot cover the return;
 *   - listDesignatedPoolFunds: balance, outstanding LEDGER investments,
 *     returnable count and delta per pool, in integer cents;
 *   - the stamp cannot be set through the generated create/update.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

const snapshot = (): PoolCarrierSnapshot => ({
  org_key: "ground_up_liberation_project",
  org_type: "irs_501c3",
  verification_status: "pub78_eligible",
  verified_as_of: "2026-09-10T09:18:37.000Z",
  stripe_connect_account_present: true,
  snapshot_at: "2026-10-04T12:00:00.000Z",
})

const ledgerInvestment = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  pool_id: "pool_1",
  settlement: "LEDGER",
  status: "CONFIRMED",
  amount: 100,
  investor_account_id: "acc-w1",
  customer_id: "cust_1",
  carrier_reference: null,
  actual_return: 0,
  return_distributed: 0,
  metadata: null,
  ...over,
})

/**
 * An uncarried pool funded the legacy way (before the flag): 150 on its
 * PRODUCER_POOL account, two CONFIRMED LEDGER investments (100 + 50), two
 * investor wallets, the producer's earnings, and the system accounts.
 */
function legacyLedger(opts: { poolBalance?: number; pool?: Partial<Row>; investments?: Row[] } = {}) {
  const balance = opts.poolBalance ?? 150
  return makePoolLedger({
    pools: [makePool("pool_1", { total_raised: 150, total_investors: 2, ...opts.pool })],
    investments: opts.investments ?? [ledgerInvestment("inv_a"), ledgerInvestment("inv_b", { amount: 50, investor_account_id: "acc-w2", customer_id: "cust_2" })],
    accounts: [
      makePoolAccount("acc-pool_1", { balance, available_balance: balance }),
      makeAccount("acc-w1", { balance: 0, available_balance: 0 }),
      makeAccount("acc-w2", { owner_id: "cust_2", balance: 0, available_balance: 0 }),
      makeAccount("acc-earn", { account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "prod_1", balance: 0, available_balance: 0 }),
      makeAccount("acc-escrow", { account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-platform", { account_type: "PLATFORM_FEE", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
      makeAccount("acc-reserve", { account_type: "RESERVE", owner_type: "SYSTEM", owner_id: "system", balance: 0, available_balance: 0 }),
    ],
  })
}

/** An order's ledger with no pool yet (the shape processOrderPayment's auto-invest leg funds). */
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

/** hawala_ledger_entry.idempotency_key is UNIQUE in Postgres; make the shadow enforce it too. */
function enforceUniqueIdempotencyKey(l: PoolLedger): { violations: number } {
  const counter = { violations: 0 }
  const shadow = l.service as unknown as Record<string, (data: Record<string, unknown>) => Promise<Row>>
  const create = shadow.createLedgerEntries
  shadow.createLedgerEntries = async (data: Record<string, unknown>) => {
    if (data.idempotency_key != null && l.entries.some((e) => e.idempotency_key === data.idempotency_key)) {
      counter.violations++
      throw Object.assign(new Error('duplicate key value violates unique constraint "hawala_ledger_entry_idempotency_key_unique"'), { code: "23505" })
    }
    return create(data)
  }
  return counter
}

async function refusal(p: Promise<unknown>): Promise<CarrierRefusalError> {
  try {
    await p
  } catch (e) {
    if (e instanceof CarrierRefusalError) return e
    throw e
  }
  throw new Error("expected a CarrierRefusalError")
}

const poolAccount = (l: PoolLedger) => l.accounts.find((a) => a.id === "acc-pool_1") as Row
const stampWrites = (l: PoolLedger) => l.poolWrites.filter((w) => "legacy_funds_designated_at" in w.data)

afterEach(() => {
  delete process.env[FLAG]
})

describe("FF_NONPROFIT_PARITY_V1 unset — every pool path is byte-identical", () => {
  it("the withdraw-to-earnings leg out of a funded uncarried pool still posts, and nothing is stamped", async () => {
    const l = legacyLedger()
    const entry = await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-earn", amount: 40, entry_type: "WITHDRAWAL", investment_pool_id: "pool_1" })
    expect(entry).toMatchObject({ status: "COMPLETED", amount: 40 })
    expect(l.balanceMoves).toEqual([
      { accountId: "acc-pool_1", delta: -40 },
      { accountId: "acc-earn", delta: 40 },
    ])
    expect(l.poolWrites).toEqual([])
    expect(l.pools[0].legacy_funds_designated_at).toBeUndefined()
  })

  it("a ledger investment INTO an uncarried pool still posts", async () => {
    const l = legacyLedger()
    l.accounts.find((a) => a.id === "acc-w1")!.balance = 500
    l.accounts.find((a) => a.id === "acc-w1")!.available_balance = 500
    await l.service.createInvestment({ pool_id: "pool_1", investor_account_id: "acc-w1", amount: 25 })
    expect(l.entries).toHaveLength(1)
    expect(stampWrites(l)).toEqual([])
  })

  it("processRefund reverses the auto-invest leg (Pool -> Escrow) exactly as before, with no stamp", async () => {
    const l = orderLedger()
    await l.service.processOrderPayment(orderPayment())
    const refunds = await l.service.processRefund({ order_id: "order_1" })
    expect(refunds.map((e) => [e.entry_type, Number(e.amount), e.description])).toContainEqual(["REFUND", 1, "Refund for order order_1 - investment reversal"])
    expect(l.accounts.find((a) => a.id === "acc-escrow")).toMatchObject({ balance: 0 })
    expect(stampWrites(l)).toEqual([])
  })

  it("listDesignatedPoolFunds and returnDesignatedFunds are dark: feature_disabled before any read or write", async () => {
    const l = legacyLedger()
    const shadow = l.service as unknown as Record<string, unknown>
    const poolReads = jest.fn(async () => l.pools)
    shadow.listInvestmentPools = poolReads
    expect((await refusal(l.service.listDesignatedPoolFunds())).reason).toBe("feature_disabled")
    expect((await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))).reason).toBe("feature_disabled")
    expect(poolReads).not.toHaveBeenCalled()
    expect(l.entries).toEqual([])
    expect(l.investments.map((i) => i.status)).toEqual(["CONFIRMED", "CONFIRMED"])
  })
})

describe("FF_NONPROFIT_PARITY_V1 on — a funded uncarried pool's account is DESIGNATED: outbound to contributors only", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("processRefund's Pool -> Escrow reversal on a legacy-funded uncarried pool SUCCEEDS: escrow nets to zero, the customer is made whole, the pool is stamped", async () => {
    // The order (and its auto-invest leg into a new uncarried pool) happened
    // before the flag; the refund arrives after it.
    delete process.env[FLAG]
    const l = orderLedger()
    await l.service.processOrderPayment(orderPayment())
    const pool = l.pools[0]
    const poolAccountRow = l.accounts.find((a) => a.id === pool.ledger_account_id) as Row
    expect(poolAccountRow).toMatchObject({ account_type: "PRODUCER_POOL", balance: 1 })
    process.env[FLAG] = "true"

    const refunds = await l.service.processRefund({ order_id: "order_1" })
    const reversal = refunds.find((e) => e.description === "Refund for order order_1 - investment reversal")
    expect(reversal).toMatchObject({ entry_type: "REFUND", debit_account_id: pool.ledger_account_id, credit_account_id: "acc-escrow", amount: 1, status: "COMPLETED" })
    expect(refunds.map((e) => e.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"])
    expect(poolAccountRow).toMatchObject({ balance: 0 })
    expect(l.accounts.find((a) => a.id === "acc-escrow")).toMatchObject({ balance: 0 })
    expect(l.accounts.find((a) => a.id === "acc-wallet")).toMatchObject({ balance: 1000 })
    expect(pool.legacy_funds_designated_at).toBeInstanceOf(Date)
  })

  it("a credit INTO the same funded pool is refused no_carrier — by investment_pool_id and by account id — and nothing moves or is stamped", async () => {
    const l = legacyLedger()
    l.accounts.find((a) => a.id === "acc-w1")!.balance = 500
    l.accounts.find((a) => a.id === "acc-w1")!.available_balance = 500
    expect((await refusal(l.service.createInvestment({ pool_id: "pool_1", investor_account_id: "acc-w1", amount: 25 }))).reason).toBe("no_carrier")
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-escrow", credit_account_id: "acc-pool_1", amount: 0, entry_type: "INVESTMENT" }))).reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
    expect(stampWrites(l)).toEqual([])
    expect(poolAccount(l)).toMatchObject({ balance: 150 })
  })

  it("a debit to SELLER_EARNINGS — the producer cashing out investors' money — is refused designated_outbound_only, by investment_pool_id and by account id", async () => {
    const l = legacyLedger()
    const byId = await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-earn", amount: 40, entry_type: "WITHDRAWAL", investment_pool_id: "pool_1" }))
    expect(byId.reason).toBe("designated_outbound_only")
    expect(byId.details).toMatchObject({ pool_id: "pool_1", credit_account_type: "SELLER_EARNINGS" })
    expect(byId.message).toContain("Decision 8")
    const byAccount = await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-earn", amount: 40, entry_type: "WITHDRAWAL" }))
    expect(byAccount.reason).toBe("designated_outbound_only")
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
    expect(stampWrites(l)).toEqual([])
  })

  it("any other non-contributor destination is refused too: PLATFORM_FEE, RESERVE, another pool's account", async () => {
    const l = legacyLedger()
    l.accounts.push(makePoolAccount("acc-pool_2"))
    for (const credit of ["acc-platform", "acc-reserve", "acc-pool_2"]) {
      expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: credit, amount: 10, entry_type: "TRANSFER", investment_pool_id: "pool_1" }))).reason).toBe("designated_outbound_only")
    }
    expect(l.entries).toEqual([])
  })

  it("a debit back to an investor's USER_WALLET is allowed and stamps legacy_funds_designated_at ONCE, through the private writer", async () => {
    const l = legacyLedger()
    await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 10, entry_type: "REFUND" })
    expect(l.entries).toHaveLength(1)
    expect(stampWrites(l)).toHaveLength(1)
    const stamped = l.pools[0].legacy_funds_designated_at
    expect(stamped).toBeInstanceOf(Date)

    await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w2", amount: 5, entry_type: "REFUND", investment_pool_id: "pool_1" })
    expect(l.entries).toHaveLength(2)
    expect(stampWrites(l)).toHaveLength(1)
    expect(l.pools[0].legacy_funds_designated_at).toBe(stamped)
    expect(poolAccount(l)).toMatchObject({ balance: 135 })
  })

  it("the destination must be a CONTRIBUTOR, not merely the right account type: a stranger's wallet and a per-entity (subcontract) escrow are refused designated_outbound_only; the system order escrow is allowed", async () => {
    const l = legacyLedger()
    // A USER_WALLET with no LEDGER investment in this pool.
    l.accounts.push(makeAccount("acc-stranger", { owner_id: "cust_9", balance: 0, available_balance: 0 }))
    // An investor of ANOTHER pool is a stranger to this one.
    l.investments.push(ledgerInvestment("inv_other", { pool_id: "pool_2", investor_account_id: "acc-other", customer_id: "cust_8" }))
    l.accounts.push(makeAccount("acc-other", { owner_id: "cust_8", balance: 0, available_balance: 0 }))
    // A per-subcontract escrow: ESCROW / SYSTEM, but owned by the subject —
    // releaseSubcontractEscrow pays it into SELLER_EARNINGS (a two-hop route).
    l.accounts.push(makeAccount("acc-sub-escrow", { account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "subcontract_1", balance: 0, available_balance: 0 }))
    for (const credit of ["acc-stranger", "acc-other", "acc-sub-escrow"]) {
      const e = await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: credit, amount: 10, entry_type: "REFUND", investment_pool_id: "pool_1" }))
      expect(e.reason).toBe("designated_outbound_only")
    }
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
    expect(stampWrites(l)).toEqual([])

    const toEscrow = await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-escrow", amount: 10, entry_type: "REFUND" })
    expect(toEscrow).toMatchObject({ status: "COMPLETED" })
  })

  it("the stamp dates a COMPLETED outflow only: a leg the guard allows but a later check refuses (balance, cross-rail) never stamps", async () => {
    const l = legacyLedger()
    // More than the designated account holds: createTransfer's balance check refuses after the guard.
    await expect(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 500, entry_type: "REFUND" })).rejects.toThrow("Insufficient balance")
    // A wallet on another rail: the cross-rail check refuses after the guard.
    l.investments.push(ledgerInvestment("inv_ccr", { investor_account_id: "acc-w-ccr" }))
    l.accounts.push(makeAccount("acc-w-ccr", { currency_code: "CCR", balance: 0, available_balance: 0 }))
    await expect(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w-ccr", amount: 10, entry_type: "REFUND" })).rejects.toThrow("Cross-rail transfer rejected")
    expect(l.entries).toEqual([])
    expect(stampWrites(l)).toEqual([])
    expect(l.pools[0].legacy_funds_designated_at).toBeUndefined()

    // The first leg that does complete stamps.
    await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 10, entry_type: "REFUND" })
    expect(stampWrites(l)).toHaveLength(1)
  })

  it("a stamp that fails to write is logged and never blocks the return (reporting only)", async () => {
    const l = legacyLedger()
    const shadow = l.service as unknown as Record<string, unknown>
    shadow.persistInvestmentPools_ = async () => {
      throw new Error("db down")
    }
    const entry = await l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 10, entry_type: "REFUND" })
    expect(entry).toMatchObject({ status: "COMPLETED" })
  })

  it("a ZERO-balance uncarried pool has nothing to designate: refused no_carrier both ways, never stamped", async () => {
    const l = legacyLedger({ poolBalance: 0 })
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 0, entry_type: "REFUND" }))).reason).toBe("no_carrier")
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-escrow", credit_account_id: "acc-pool_1", amount: 0, entry_type: "INVESTMENT" }))).reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
    expect(stampWrites(l)).toEqual([])
  })

  it("a CARRIED pool is unchanged — carried_pool even if its dormant account somehow held money", async () => {
    const l = legacyLedger({ pool: { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: snapshot() } })
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_1", credit_account_id: "acc-w1", amount: 10, entry_type: "REFUND" }))).reason).toBe("carried_pool")
    expect(l.entries).toEqual([])
    expect(stampWrites(l)).toEqual([])
  })

  it("an ORPHAN funded PRODUCER_POOL account (no pool row) is unchanged: no_carrier, even outbound to a wallet", async () => {
    const l = makePoolLedger({ accounts: [makePoolAccount("acc-orphan", { balance: 80, available_balance: 80 }), makeAccount("acc-w1")] })
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-orphan", credit_account_id: "acc-w1", amount: 10, entry_type: "REFUND" }))).reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
  })

  it("only the pool's OWN account is designated: a leg naming pool_1 while debiting another pool's account is no_carrier", async () => {
    const l = legacyLedger()
    l.pools.push(makePool("pool_2"))
    l.accounts.push(makePoolAccount("acc-pool_2", { balance: 60, available_balance: 60 }))
    expect((await refusal(l.service.createTransfer({ debit_account_id: "acc-pool_2", credit_account_id: "acc-w1", amount: 10, entry_type: "REFUND", investment_pool_id: "pool_1" }))).reason).toBe("no_carrier")
    expect(l.entries).toEqual([])
  })

  it("investor returns stay allowed: distributeDividends pays each LEDGER investor's wallet out of the designated account", async () => {
    // An even split, so the pre-existing float share arithmetic in
    // distributeDividends lands on whole cents; the direction rule is what is pinned.
    const l = legacyLedger({
      pool: { total_raised: 200 },
      investments: [ledgerInvestment("inv_a"), ledgerInvestment("inv_b", { investor_account_id: "acc-w2", customer_id: "cust_2" })],
    })
    const paid = await l.service.distributeDividends({ pool_id: "pool_1", total_amount: 30 })
    expect(paid).toEqual([
      { investment_id: "inv_a", amount: 15 },
      { investment_id: "inv_b", amount: 15 },
    ])
    expect(l.entries.map((e) => [e.entry_type, e.debit_account_id, e.credit_account_id, e.amount])).toEqual([
      ["DIVIDEND", "acc-pool_1", "acc-w1", 15],
      ["DIVIDEND", "acc-pool_1", "acc-w2", 15],
    ])
    expect(poolAccount(l)).toMatchObject({ balance: 120 })
  })
})

describe("returnDesignatedFunds — the wind-down primitive (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("returns ONE confirmed LEDGER investment to its investor's wallet: a REFUND leg keyed by the investment id, then the investment is WITHDRAWN; the pool's historical counters are not touched", async () => {
    const l = legacyLedger()
    const out = await l.service.returnDesignatedFunds("pool_1", "inv_a", { returned_by: "user_admin" })
    expect(out.returned).toBe(true)
    if (!out.returned) throw new Error("unreachable")

    expect(l.entries).toHaveLength(1)
    expect(l.entries[0]).toMatchObject({
      entry_type: "REFUND",
      debit_account_id: "acc-pool_1",
      credit_account_id: "acc-w1",
      amount: 100,
      investment_pool_id: "pool_1",
      idempotency_key: "designated-return-inv_a",
      status: "COMPLETED",
    })
    expect(designatedReturnKey("inv_a")).toBe("designated-return-inv_a")
    expect(l.balanceMoves).toEqual([
      { accountId: "acc-pool_1", delta: -100 },
      { accountId: "acc-w1", delta: 100 },
    ])
    expect(out.investment).toMatchObject({ id: "inv_a", status: "WITHDRAWN", metadata: { designated_return_entry_id: "le_1", returned_by: "user_admin" } })
    expect(l.investments[0].withdrawn_at).toBeInstanceOf(Date)
    expect(l.investments[1]).toMatchObject({ id: "inv_b", status: "CONFIRMED" })
    expect(poolAccount(l)).toMatchObject({ balance: 50 })
    expect(l.pools[0]).toMatchObject({ total_raised: 150, total_investors: 2 })
    expect(l.pools[0].legacy_funds_designated_at).toBeInstanceOf(Date)
  })

  it("is idempotent by investment id: a replay answers already_returned and moves nothing", async () => {
    const l = legacyLedger()
    await l.service.returnDesignatedFunds("pool_1", "inv_a")
    const again = await l.service.returnDesignatedFunds("pool_1", "inv_a")
    expect(again).toEqual({ returned: false, reason: "already_returned", investment_id: "inv_a", entry_id: "le_1" })
    expect(l.entries).toHaveLength(1)
    expect(l.balanceMoves).toHaveLength(2)
    expect(poolAccount(l)).toMatchObject({ balance: 50 })
  })

  it("two CONCURRENT returns of the same investment move the money exactly once; the loser, handed the winner's still-PENDING entry, is refused designated_return_unsettled — never answered as a return", async () => {
    const l = legacyLedger()
    const unique = enforceUniqueIdempotencyKey(l)
    const results = await Promise.allSettled([l.service.returnDesignatedFunds("pool_1", "inv_a"), l.service.returnDesignatedFunds("pool_1", "inv_a")])
    // Both calls passed every pre-read; the second insert hit the unique key
    // while the winner's entry was still PENDING (its balances not yet
    // moved) — the race path, not the replay path.
    expect(unique.violations).toBe(1)
    const won = results.filter((r) => r.status === "fulfilled")
    const lost = results.filter((r) => r.status === "rejected")
    expect(won).toHaveLength(1)
    expect((won[0] as PromiseFulfilledResult<{ returned: boolean }>).value.returned).toBe(true)
    expect(lost).toHaveLength(1)
    const refusalErr = (lost[0] as PromiseRejectedResult).reason as CarrierRefusalError
    expect(refusalErr).toBeInstanceOf(CarrierRefusalError)
    expect(refusalErr.reason).toBe("designated_return_unsettled")
    expect(refusalErr.details).toMatchObject({ entry_id: "le_1", entry_status: "PENDING" })
    expect(l.entries.filter((e) => e.idempotency_key === "designated-return-inv_a")).toHaveLength(1)
    expect(l.balanceMoves).toEqual([
      { accountId: "acc-pool_1", delta: -100 },
      { accountId: "acc-w1", delta: 100 },
    ])
    expect(l.investments[0].status).toBe("WITHDRAWN")
    expect(poolAccount(l)).toMatchObject({ balance: 50 })
    // The loser's retry reads the settled outcome.
    expect(await l.service.returnDesignatedFunds("pool_1", "inv_a")).toEqual({ returned: false, reason: "already_returned", investment_id: "inv_a", entry_id: "le_1" })
  })

  it("the loser of the unique key that lands AFTER the winner completed answers already_returned and leaves the winner's operator on the record", async () => {
    const l = legacyLedger()
    const unique = enforceUniqueIdempotencyKey(l)
    // The winner moved the money and marked the investment.
    l.entries.push({ id: "le_win", idempotency_key: "designated-return-inv_a", status: "COMPLETED", amount: 100 })
    Object.assign(l.investments[0], { status: "WITHDRAWN", metadata: { designated_return_entry_id: "le_win", returned_by: "user_winner" } })
    // ... but this caller's reads ran before either write was visible.
    const shadow = l.service as unknown as Record<string, unknown>
    const realEntries = shadow.listLedgerEntries as (f: Record<string, unknown>) => Promise<Row[]>
    let entryReads = 0
    shadow.listLedgerEntries = async (f: Record<string, unknown>) => (++entryReads <= 2 ? [] : realEntries(f))
    const realInvestments = shadow.listInvestments as (f: Record<string, unknown>) => Promise<Row[]>
    let firstInvestmentRead = true
    shadow.listInvestments = async (f: Record<string, unknown>) => {
      if (firstInvestmentRead && f.id === "inv_a") {
        firstInvestmentRead = false
        return [{ ...l.investments[0], status: "CONFIRMED", metadata: null }]
      }
      return realInvestments(f)
    }
    const out = await l.service.returnDesignatedFunds("pool_1", "inv_a", { returned_by: "user_loser" })
    expect(unique.violations).toBe(1)
    expect(out).toEqual({ returned: false, reason: "already_returned", investment_id: "inv_a", entry_id: "le_win" })
    expect(l.investments[0]).toMatchObject({ status: "WITHDRAWN", metadata: { returned_by: "user_winner" } })
    expect(l.balanceMoves).toEqual([])
  })

  it("a ledger failure DURING the move is not a return: designated_return_unsettled (409 at the route), the entry FAILED, the investment still CONFIRMED, no balance moved; the retry refuses too", async () => {
    const l = legacyLedger()
    const shadow = l.service as unknown as Record<string, unknown>
    const realMove = shadow.updateBalances as (accountId: string, delta: number) => Promise<void>
    // The debit lands, the credit throws; createTransfer compensates the
    // debit, marks its PENDING entry FAILED and rethrows.
    shadow.updateBalances = async (accountId: string, delta: number) => {
      if (accountId === "acc-w1") throw new Error("credit leg failed")
      return realMove(accountId, delta)
    }
    const e = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))
    expect(e.reason).toBe("designated_return_unsettled")
    expect(e.details).toMatchObject({ entry_id: "le_1", entry_status: "FAILED", cause: "credit leg failed" })
    expect(l.entries).toHaveLength(1)
    expect(l.entries[0]).toMatchObject({ idempotency_key: "designated-return-inv_a", status: "FAILED" })
    expect(l.investments[0]).toMatchObject({ status: "CONFIRMED" })
    expect(l.investments[0].withdrawn_at).toBeUndefined()
    expect(poolAccount(l)).toMatchObject({ balance: 150, available_balance: 150 })
    expect(l.accounts.find((a) => a.id === "acc-w1")).toMatchObject({ balance: 0 })

    const again = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))
    expect(again.reason).toBe("designated_return_unsettled")
    expect(again.details).toMatchObject({ entry_status: "FAILED" })
    expect(l.investments[0].status).toBe("CONFIRMED")
  })

  it("an entry createTransfer's own idempotency read hands back still PENDING (a concurrent return mid-flight) is refused, and the investment is not marked", async () => {
    const l = legacyLedger()
    l.entries.push({ id: "le_inflight", idempotency_key: "designated-return-inv_a", status: "PENDING", amount: 100 })
    // returnDesignatedFunds's own pre-read ran before the other caller's insert.
    const shadow = l.service as unknown as Record<string, unknown>
    const realEntries = shadow.listLedgerEntries as (f: Record<string, unknown>) => Promise<Row[]>
    let entryReads = 0
    shadow.listLedgerEntries = async (f: Record<string, unknown>) => (++entryReads === 1 ? [] : realEntries(f))
    const e = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))
    expect(e.reason).toBe("designated_return_unsettled")
    expect(e.details).toMatchObject({ entry_id: "le_inflight", entry_status: "PENDING" })
    expect(e.message).toContain("in flight")
    expect(l.investments[0]).toMatchObject({ status: "CONFIRMED", metadata: null })
    expect(l.balanceMoves).toEqual([])
  })

  it("a crash between money and record is repaired: a COMPLETED prior return marks the investment WITHDRAWN without a second leg", async () => {
    const l = legacyLedger()
    l.entries.push({ id: "le_prior", idempotency_key: "designated-return-inv_a", status: "COMPLETED", amount: 100 })
    const out = await l.service.returnDesignatedFunds("pool_1", "inv_a")
    expect(out).toEqual({ returned: false, reason: "already_returned", investment_id: "inv_a", entry_id: "le_prior" })
    expect(l.investments[0]).toMatchObject({ status: "WITHDRAWN", metadata: { designated_return_entry_id: "le_prior" } })
    expect(l.entries).toHaveLength(1)
    expect(l.balanceMoves).toEqual([])
  })

  it("a prior return that did NOT complete is never re-attempted under the same key: designated_return_unsettled", async () => {
    const l = legacyLedger()
    l.entries.push({ id: "le_failed", idempotency_key: "designated-return-inv_a", status: "FAILED", amount: 100 })
    const e = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))
    expect(e.reason).toBe("designated_return_unsettled")
    expect(e.details).toMatchObject({ entry_id: "le_failed", entry_status: "FAILED" })
    expect(l.balanceMoves).toEqual([])
    expect(l.investments[0].status).toBe("CONFIRMED")
  })

  it("never touches a CARRIED pool: carried_pool before the investment is read, nothing moves", async () => {
    const l = legacyLedger({ pool: { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: snapshot() } })
    const shadow = l.service as unknown as Record<string, unknown>
    const investmentReads = jest.fn(async () => l.investments)
    shadow.listInvestments = investmentReads
    expect((await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))).reason).toBe("carried_pool")
    expect(investmentReads).not.toHaveBeenCalled()
    expect(l.entries).toEqual([])
    expect(l.balanceMoves).toEqual([])
  })

  it("never touches a CARRIER row: not_ledger_investment, nothing moves", async () => {
    const l = legacyLedger({
      investments: [ledgerInvestment("inv_c", { settlement: "CARRIER", investor_account_id: null, carrier_reference: "pi_1", carrier_org_key: "ground_up_liberation_project" })],
    })
    const e = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_c"))
    expect(e.reason).toBe("not_ledger_investment")
    expect(l.entries).toEqual([])
    expect(l.investments[0].status).toBe("CONFIRMED")
  })

  it("refuses any investment that is not CONFIRMED: investment_not_confirmed, nothing moves", async () => {
    for (const status of ["PENDING", "EARNING", "MATURED", "WITHDRAWN", "CANCELLED"]) {
      const l = legacyLedger({ investments: [ledgerInvestment("inv_a", { status })] })
      const e = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))
      expect(e.reason).toBe("investment_not_confirmed")
      expect(l.entries).toEqual([])
    }
  })

  it("refuses when the designated account cannot cover the return: insufficient_designated_balance, nothing moves", async () => {
    const l = legacyLedger({ poolBalance: 30 })
    const e = await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))
    expect(e.reason).toBe("insufficient_designated_balance")
    expect(e.details).toMatchObject({ available_balance: 30, amount: 100 })
    expect(l.entries).toEqual([])
    expect(l.investments[0].status).toBe("CONFIRMED")
  })

  it("an investment of another pool is 'Investment not found'; an unknown pool is 'Investment pool not found'", async () => {
    const l = legacyLedger({ investments: [ledgerInvestment("inv_x", { pool_id: "pool_other" })] })
    await expect(l.service.returnDesignatedFunds("pool_1", "inv_x")).rejects.toThrow("Investment not found")
    await expect(l.service.returnDesignatedFunds("pool_ghost", "inv_x")).rejects.toThrow("Investment pool not found")
    expect(l.entries).toEqual([])
  })

  it("the return still passes createTransfer's direction rule: an investor account that is not a USER_WALLET is refused designated_outbound_only", async () => {
    // RESERVE rather than SELLER_EARNINGS so this pins "the guard applies to
    // returns", independently of the SELLER_EARNINGS refusal pinned above.
    const l = legacyLedger({ investments: [ledgerInvestment("inv_a", { investor_account_id: "acc-reserve" })] })
    expect((await refusal(l.service.returnDesignatedFunds("pool_1", "inv_a"))).reason).toBe("designated_outbound_only")
    expect(l.entries).toEqual([])
    expect(l.investments[0].status).toBe("CONFIRMED")
  })
})

describe("listDesignatedPoolFunds (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("lists uncarried pools that hold legacy funds or are stamped, with balance, outstanding LEDGER investments, returnable count and the delta; carried and empty unstamped pools are left out", async () => {
    const l = makePoolLedger({
      pools: [
        makePool("pool_1"),
        makePool("pool_empty"),
        makePool("pool_stamped", { legacy_funds_designated_at: new Date("2026-10-04T10:00:00Z") }),
        makePool("pool_c", { carrier_org_key: "ground_up_liberation_project", carrier_snapshot: snapshot() }),
      ],
      investments: [
        ledgerInvestment("inv_a", { amount: 0.1 }),
        ledgerInvestment("inv_b", { amount: 0.2 }),
        ledgerInvestment("inv_w", { amount: 5, status: "WITHDRAWN" }),
        ledgerInvestment("inv_p", { amount: 1, status: "PENDING" }),
        ledgerInvestment("inv_carrier", { settlement: "CARRIER", investor_account_id: null, carrier_reference: "r", amount: 9 }),
      ],
      accounts: [
        // 0.3 of investments + 1 PENDING + an auto-invest surplus of 2.05 with no Investment row.
        makePoolAccount("acc-pool_1", { balance: 3.35, available_balance: 3.35 }),
        makePoolAccount("acc-pool_empty"),
        makePoolAccount("acc-pool_stamped"),
        makePoolAccount("acc-pool_c", { balance: 7, available_balance: 7 }),
      ],
    })
    const report = await l.service.listDesignatedPoolFunds()
    expect(report.pools.map((p) => p.pool_id)).toEqual(["pool_1", "pool_stamped"])
    expect(report.pools[0]).toEqual({
      pool_id: "pool_1",
      name: "Pool pool_1",
      producer_id: "prod_1",
      status: "ACTIVE",
      ledger_account_id: "acc-pool_1",
      legacy_funds_designated_at: null,
      account_balance: 3.35,
      outstanding_ledger_investments: { count: 3, total: 1.3 },
      returnable_investments: 2,
      delta: 2.05,
    })
    expect(report.pools[1]).toMatchObject({ pool_id: "pool_stamped", legacy_funds_designated_at: "2026-10-04T10:00:00.000Z", account_balance: 0, outstanding_ledger_investments: { count: 0, total: 0 }, delta: 0 })
    expect(report.totals).toEqual({ pools: 2, account_balance: 3.35, outstanding_ledger_investments: 1.3, delta: 2.05 })
  })

  it("follows the wind-down: after every investment is returned the stamped pool shows a zero balance and nothing outstanding", async () => {
    const l = legacyLedger()
    await l.service.returnDesignatedFunds("pool_1", "inv_a")
    await l.service.returnDesignatedFunds("pool_1", "inv_b")
    const report = await l.service.listDesignatedPoolFunds()
    expect(report.pools).toHaveLength(1)
    expect(report.pools[0]).toMatchObject({ pool_id: "pool_1", account_balance: 0, outstanding_ledger_investments: { count: 0, total: 0 }, returnable_investments: 0, delta: 0 })
    expect(report.pools[0].legacy_funds_designated_at).not.toBeNull()
    expect(report.totals).toMatchObject({ pools: 1, account_balance: 0 })
  })

  it("an empty book is an empty report", async () => {
    const l = makePoolLedger({ pools: [makePool("pool_1")], accounts: [makePoolAccount("acc-pool_1")] })
    expect(await l.service.listDesignatedPoolFunds()).toEqual({ pools: [], totals: { pools: 0, account_balance: 0, outstanding_ledger_investments: 0, delta: 0 } })
  })
})

describe("the designation stamp cannot be set through the generated create/update", () => {
  it("createInvestmentPools and updateInvestmentPools strip legacy_funds_designated_at on the real prototype, in every input shape", async () => {
    const l = makePoolLedger()
    const at = new Date("2026-10-04T00:00:00Z")
    await l.service.createInvestmentPools({ name: "P", producer_id: "prod_1", ledger_account_id: "acc", target_amount: 1, legacy_funds_designated_at: at })
    expect(l.poolWrites[0].data).not.toHaveProperty("legacy_funds_designated_at")
    await l.service.updateInvestmentPools({ id: "pool_1", status: "ACTIVE", legacy_funds_designated_at: at })
    expect(l.poolWrites[1].data).toEqual({ id: "pool_1", status: "ACTIVE" })
    await l.service.createInvestmentPools([{ name: "Q", producer_id: "prod_1", ledger_account_id: "acc2", target_amount: 1, legacy_funds_designated_at: at }])
    expect((l.poolWrites[2].data as unknown as Record<string, unknown>[])[0]).not.toHaveProperty("legacy_funds_designated_at")
    await l.service.updateInvestmentPools({ selector: { id: "pool_1" }, data: { name: "R", legacy_funds_designated_at: at } })
    expect((l.poolWrites[3].data as { data: Record<string, unknown> }).data).toEqual({ name: "R" })
    expect(l.pools.every((p) => p.legacy_funds_designated_at === undefined)).toBe(true)
  })

  it("the strip helper copies; the caller's object is untouched", () => {
    const input = { id: "p", legacy_funds_designated_at: new Date() }
    expect(stripPoolDesignationFields(input)).toEqual({ id: "p" })
    expect(input).toHaveProperty("legacy_funds_designated_at")
  })

  it("summariseDesignatedPool works in integer cents (0.1 + 0.2 is 0.3, not 0.30000000000000004)", () => {
    const line = summariseDesignatedPool({ id: "p" }, { balance: 0.3 }, [{ amount: 0.1, status: "CONFIRMED" }, { amount: 0.2, status: "CONFIRMED" }])
    expect(line).toMatchObject({ account_balance: 0.3, outstanding_ledger_investments: { count: 2, total: 0.3 }, delta: 0 })
  })
})
