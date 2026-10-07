import {
  VENDOR_RECEIVABLE_ACCOUNT_TYPE,
  VENDOR_RECEIVABLE_OWNER_ID,
  VENDOR_REFUND_RECOVERY_LEG,
  VENDOR_REFUND_SHORTFALL_LEG,
  VendorReceivableLegError,
  assertVendorReceivableLeg,
} from "../vendor-receivable"

/**
 * The two leg shapes the vendor-receivable account admits (SD-40,
 * `vendor-receivable.ts`), checked by `createTransfer` before anything is
 * written. The balance rule (below zero, never above) is the SQL's, proved on
 * a real database in integration-tests/http/hawala-vendor-refund-receivable.spec.ts.
 */

const receivable = {
  id: "acc-recv",
  account_type: VENDOR_RECEIVABLE_ACCOUNT_TYPE,
  owner_type: "SYSTEM",
  owner_id: VENDOR_RECEIVABLE_OWNER_ID,
  currency_code: "USD",
}
const escrow = { id: "acc-esc", account_type: "ESCROW", owner_type: "SYSTEM", owner_id: "system", currency_code: "USD" }
const seller = { id: "acc-sel", account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", currency_code: "USD" }
const wallet = { id: "acc-wal", account_type: "USER_WALLET", owner_type: "CUSTOMER", owner_id: "cus_1", currency_code: "USD" }

const shortfall = { entry_type: "ADJUSTMENT", order_id: "order_1", metadata: { leg: VENDOR_REFUND_SHORTFALL_LEG } }
const recovery = { entry_type: "ADJUSTMENT", metadata: { leg: VENDOR_REFUND_RECOVERY_LEG } }

describe("assertVendorReceivableLeg", () => {
  it("a leg that does not touch it is not its business", () => {
    expect(assertVendorReceivableLeg({ entry_type: "TRANSFER" }, escrow, seller)).toEqual({
      side: "none",
      receivableAccountId: null,
    })
  })

  it("admits a refund shortfall into the order escrow (debit side) and a recovery from seller earnings (credit side)", () => {
    expect(assertVendorReceivableLeg(shortfall, receivable, escrow)).toEqual({ side: "debit", receivableAccountId: "acc-recv" })
    expect(assertVendorReceivableLeg(recovery, seller, receivable)).toEqual({ side: "credit", receivableAccountId: "acc-recv" })
  })

  it.each([
    ["a shortfall with no order", { ...shortfall, order_id: null }, receivable, escrow],
    ["a shortfall into anything but escrow", shortfall, receivable, seller],
    ["a shortfall into a per-subject escrow", shortfall, receivable, { ...escrow, owner_id: "campaign_1" }],
    ["money out without the shortfall tag", { ...shortfall, metadata: { leg: VENDOR_REFUND_RECOVERY_LEG } }, receivable, escrow],
    ["money out as a TRANSFER", { ...shortfall, entry_type: "TRANSFER" }, receivable, escrow],
    ["money in without the recovery tag", { ...recovery, metadata: { leg: VENDOR_REFUND_SHORTFALL_LEG } }, seller, receivable],
    ["money in from a customer wallet", recovery, wallet, receivable],
    ["money in from a non-USD seller account", recovery, { ...seller, currency_code: "CCR" }, receivable],
    ["a non-SYSTEM receivable account", shortfall, { ...receivable, owner_type: "SELLER" }, escrow],
    ["a receivable account with another owner", shortfall, { ...receivable, owner_id: "system" }, escrow],
    ["a non-USD receivable account", shortfall, { ...receivable, currency_code: "CCR" }, escrow],
    ["both sides the receivable", shortfall, receivable, { ...receivable, id: "acc-recv-2" }],
  ])("refuses %s", (_why, leg, debit, credit) => {
    expect(() => assertVendorReceivableLeg(leg, debit, credit)).toThrow(VendorReceivableLegError)
  })
})
