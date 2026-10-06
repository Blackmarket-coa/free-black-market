import HawalaLedgerModuleService from "../service"
import {
  CARD_CLEARING_ACCOUNT_TYPE,
  CARD_CLEARING_OWNER_ID,
  CardClearingLegError,
  assertCardClearingLeg,
  isFbmCardProvider,
} from "../card-clearing"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../../stripe-connect-direct/registration"

/**
 * SD-36: the card-clearing account is the ONE account allowed below zero, so
 * the shape of every leg that touches it is enforced at `createTransfer`
 * (`../card-clearing.ts`). These specs pin the allowed shapes, every refused
 * one, and the SQL each path issues — the non-negative CAS for everything
 * else must be byte-identical to before.
 */

const clearing = {
  id: "acc-clearing",
  account_number: "CCL-1",
  account_type: CARD_CLEARING_ACCOUNT_TYPE,
  owner_type: "SYSTEM",
  owner_id: CARD_CLEARING_OWNER_ID,
  currency_code: "USD",
  balance: 0,
  available_balance: 0,
}
const escrow = {
  id: "acc-escrow",
  account_number: "ESC-1",
  account_type: "ESCROW",
  owner_type: "SYSTEM",
  owner_id: "system",
  currency_code: "USD",
  balance: 100,
  available_balance: 100,
}
const subjectEscrow = { ...escrow, id: "acc-subject-escrow", owner_id: "campaign_1" }
const seller = {
  id: "acc-seller",
  account_number: "SLR-1",
  account_type: "SELLER_EARNINGS",
  owner_type: "SELLER",
  owner_id: "sel_1",
  currency_code: "USD",
  balance: 100,
  available_balance: 100,
}
const wallet = { ...seller, id: "acc-wallet", account_type: "USER_WALLET", owner_type: "CUSTOMER", owner_id: "cus_1" }

describe("isFbmCardProvider", () => {
  it.each([
    ["pp_stripe_stripe", true],
    ["pp_stripe-bancontact_stripe", true],
    ["pp_stripe-ideal_stripe", true],
    [STRIPE_CONNECT_DIRECT_PROVIDER_ID, false],
    ["pp_system_default", false],
    ["pp_stripe_stripe2", false],
    ["pp_stripe_other", false],
    ["stripe", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%s -> %s", (id, expected) => {
    expect(isFbmCardProvider(id)).toBe(expected)
  })
})

describe("assertCardClearingLeg", () => {
  const purchase = { entry_type: "PURCHASE", order_id: "order_1" }
  const refund = { entry_type: "REFUND", order_id: "order_1" }

  it("a leg that touches no clearing account is not its business", () => {
    expect(assertCardClearingLeg({ entry_type: "TRANSFER" }, escrow, seller)).toEqual({
      debitIsClearing: false,
      clearingAccountId: null,
    })
  })

  it("allows a PURCHASE out of clearing into the order escrow, and a REFUND back", () => {
    expect(assertCardClearingLeg(purchase, clearing, escrow)).toEqual({
      debitIsClearing: true,
      clearingAccountId: "acc-clearing",
    })
    expect(assertCardClearingLeg(refund, escrow, clearing)).toEqual({
      debitIsClearing: false,
      clearingAccountId: "acc-clearing",
    })
  })

  it.each([
    ["no order", { entry_type: "PURCHASE" }, clearing, escrow, /must name its order/],
    ["a TRANSFER out", { entry_type: "TRANSFER", order_id: "o" }, clearing, escrow, /only as a PURCHASE/],
    ["a WITHDRAWAL out", { entry_type: "WITHDRAWAL", order_id: "o" }, clearing, escrow, /only as a PURCHASE/],
    ["a PURCHASE in", { entry_type: "PURCHASE", order_id: "o" }, escrow, clearing, /only as a REFUND/],
    ["a DEPOSIT in", { entry_type: "DEPOSIT", order_id: "o" }, escrow, clearing, /only as a REFUND/],
    ["straight to a seller", purchase, clearing, seller, /must be the order escrow/],
    ["into a customer wallet", purchase, clearing, wallet, /must be the order escrow/],
    ["from a seller", refund, seller, clearing, /must be the order escrow/],
    ["a per-subject escrow", purchase, clearing, subjectEscrow, /must be the order escrow/],
    ["both sides", purchase, clearing, { ...clearing, id: "acc-clearing-2" }, /both sides/],
    ["a clearing account another owner holds", purchase, { ...clearing, owner_id: "someone" }, escrow, /SYSTEM-owned USD/],
    ["a non-SYSTEM clearing account", purchase, { ...clearing, owner_type: "SELLER" }, escrow, /SYSTEM-owned USD/],
    ["a CCR clearing account", purchase, { ...clearing, currency_code: "CCR" }, escrow, /SYSTEM-owned USD/],
  ])("refuses %s", (_label, leg, debit, credit, message) => {
    expect(() => assertCardClearingLeg(leg as never, debit, credit)).toThrow(CardClearingLegError)
    expect(() => assertCardClearingLeg(leg as never, debit, credit)).toThrow(message as RegExp)
  })
})

type RawCall = { sql: string; bindings: unknown[] }

function buildService(accounts: Array<Record<string, unknown>>) {
  const svc = Object.create(HawalaLedgerModuleService.prototype) as Record<string, any>
  const byId = new Map(accounts.map((a) => [a.id as string, { ...a }]))
  svc.listLedgerEntries = jest.fn(async () => [])
  svc.retrieveLedgerAccount = jest.fn(async (id: string) => byId.get(id))
  svc.createLedgerEntries = jest.fn(async (data: Record<string, unknown>) => ({ id: "entry-1", ...data }))
  svc.updateLedgerEntries = jest.fn(async (data: Record<string, unknown>) => data)
  svc.evaluateMonitorsForAccounts = jest.fn(async () => undefined)
  const rawCalls: RawCall[] = []
  const pgConnection = {
    raw: jest.fn(async (sql: string, bindings: unknown[]) => {
      rawCalls.push({ sql, bindings })
      return { rowCount: 1 }
    }),
  }
  return { svc, pgConnection, rawCalls, byId }
}

const isNonNegativeCas = (sql: string) => /balance \+ \? >= 0/.test(sql) && /available_balance \+ \? >= 0/.test(sql)

describe("createTransfer with the card-clearing account (atomic path)", () => {
  it("a card PURCHASE skips the balance pre-check and lets ONLY the clearing row go below zero", async () => {
    const { svc, pgConnection, rawCalls } = buildService([clearing, escrow])
    const entry = await svc.createTransfer({
      debit_account_id: "acc-clearing",
      credit_account_id: "acc-escrow",
      amount: 40,
      entry_type: "PURCHASE",
      order_id: "order_1",
      pgConnection,
    })
    expect(entry.status).toBe("COMPLETED")
    const clearingSql = rawCalls.find((c) => c.bindings[2] === "acc-clearing")!
    const escrowSql = rawCalls.find((c) => c.bindings[2] === "acc-escrow")!
    expect(isNonNegativeCas(clearingSql.sql)).toBe(false)
    expect(clearingSql.sql).toMatch(/AND account_type = \?/)
    expect(clearingSql.sql).toMatch(/AND owner_type = 'SYSTEM'/)
    expect(clearingSql.bindings).toEqual([-40, -40, "acc-clearing", CARD_CLEARING_ACCOUNT_TYPE, CARD_CLEARING_OWNER_ID])
    expect(isNonNegativeCas(escrowSql.sql)).toBe(true)
    expect(escrowSql.bindings).toEqual([40, 40, "acc-escrow", 40, 40])
  })

  it("inside a DB transaction (production's path) only the clearing row gets the clearing statement", async () => {
    const { svc, rawCalls } = buildService([clearing, escrow])
    const trx = {
      raw: jest.fn(async (sql: string, bindings: unknown[]) => {
        rawCalls.push({ sql, bindings })
        return { rowCount: 1 }
      }),
    }
    const pgConnection = { raw: trx.raw, transaction: async (work: (t: typeof trx) => Promise<unknown>) => work(trx) }
    await svc.createTransfer({
      debit_account_id: "acc-clearing",
      credit_account_id: "acc-escrow",
      amount: 40,
      entry_type: "PURCHASE",
      order_id: "order_1",
      pgConnection,
    })
    expect(rawCalls).toHaveLength(2)
    expect(isNonNegativeCas(rawCalls.find((c) => c.bindings[2] === "acc-clearing")!.sql)).toBe(false)
    expect(isNonNegativeCas(rawCalls.find((c) => c.bindings[2] === "acc-escrow")!.sql)).toBe(true)
  })

  it("a card REFUND back into a negative clearing account uses the clearing statement for that row", async () => {
    const { svc, pgConnection, rawCalls } = buildService([{ ...clearing, balance: -40, available_balance: -40 }, escrow])
    await svc.createTransfer({
      debit_account_id: "acc-escrow",
      credit_account_id: "acc-clearing",
      amount: 40,
      entry_type: "REFUND",
      order_id: "order_1",
      pgConnection,
    })
    const clearingSql = rawCalls.find((c) => c.bindings[2] === "acc-clearing")!
    expect(isNonNegativeCas(clearingSql.sql)).toBe(false)
    expect(clearingSql.bindings).toEqual([40, 40, "acc-clearing", CARD_CLEARING_ACCOUNT_TYPE, CARD_CLEARING_OWNER_ID])
    expect(isNonNegativeCas(rawCalls.find((c) => c.bindings[2] === "acc-escrow")!.sql)).toBe(true)
  })

  it("a refused shape writes no entry and runs no SQL", async () => {
    const { svc, pgConnection, rawCalls } = buildService([clearing, seller])
    await expect(
      svc.createTransfer({
        debit_account_id: "acc-clearing",
        credit_account_id: "acc-seller",
        amount: 40,
        entry_type: "TRANSFER",
        order_id: "order_1",
        pgConnection,
      })
    ).rejects.toThrow(CardClearingLegError)
    expect(svc.createLedgerEntries).not.toHaveBeenCalled()
    expect(rawCalls).toEqual([])
  })

  it("a leg between ordinary accounts issues exactly the old non-negative CAS on both rows", async () => {
    const { svc, pgConnection, rawCalls } = buildService([escrow, seller])
    await svc.createTransfer({
      debit_account_id: "acc-escrow",
      credit_account_id: "acc-seller",
      amount: 10,
      entry_type: "TRANSFER",
      order_id: "order_1",
      pgConnection,
    })
    expect(rawCalls).toHaveLength(2)
    for (const call of rawCalls) expect(isNonNegativeCas(call.sql)).toBe(true)
  })

  it("an ordinary account still cannot be overdrawn by a PURCHASE (the pre-check stands)", async () => {
    const { svc, pgConnection } = buildService([{ ...wallet, balance: 0, available_balance: 0 }, escrow])
    await expect(
      svc.createTransfer({
        debit_account_id: "acc-wallet",
        credit_account_id: "acc-escrow",
        amount: 40,
        entry_type: "PURCHASE",
        order_id: "order_1",
        pgConnection,
      })
    ).rejects.toThrow(/Insufficient balance/)
  })
})

describe("the legacy read-modify-write path (no pg connection)", () => {
  it("lets the clearing account go negative and still refuses any other account, even if asked", async () => {
    const { svc, byId } = buildService([clearing, escrow, wallet])
    svc.listLedgerAccounts = jest.fn(async ({ id }: { id: string }) => [byId.get(id)])
    svc.updateLedgerAccounts = jest.fn(async (data: { id: string; balance: number; available_balance: number }) => {
      Object.assign(byId.get(data.id)!, data)
    })
    await svc.updateBalances("acc-clearing", -40, 1, true)
    expect(byId.get("acc-clearing")!.balance).toBe(-40)

    byId.get("acc-wallet")!.balance = 0
    await expect(svc.updateBalances("acc-wallet", -40, 1, true)).rejects.toThrow(/Insufficient balance/)
    await expect(svc.updateBalances("acc-clearing", -1, 1, false)).rejects.toThrow(/Insufficient balance/)
  })
})
