import { OrgAdvanceRefusalError, totalOwedMajorUnits } from "../org-advance"
import type { PoolCarrierSnapshot } from "../carrier"
import { PHASE0_FEATURE_FLAGS } from "../../../shared/feature-flags"
import { makeAdvanceLedger, makeOrgAdvance, makeSellerAdvance, type AdvanceLedger, type Row } from "./in-memory-advance-ledger"

/**
 * Verified nonprofit partner_orgs as VendorAdvance recipients, against the
 * REAL `HawalaLedgerModuleService` prototype with only the generated CRUD
 * shadowed in memory (`./in-memory-advance-ledger.ts`).
 * docs/BMC_SURVIVAL_PROGRAMS.md Decision 6a; legal checkpoints L26, L11, L3.
 *
 * Pinned:
 *   - FF_NONPROFIT_PARITY_V1 unset: requestOrgAdvance / approveOrgAdvance /
 *     recordOrgAdvanceRepayment throw feature_disabled before any read or
 *     write;
 *   - flag on: NO hawala_ledger_account and NO hawala_ledger_entry is created
 *     anywhere on the org path — the in-memory ledger tables stay empty across
 *     every org operation; RESERVE is never asked for;
 *   - requestOrgAdvance refuses an unverified / mismatched snapshot, a
 *     malformed eligibility statement, an amount over the operator's limit,
 *     bad terms and a second open advance; writes PENDING_APPROVAL with no
 *     vendor, no ledger account, MANUAL repayment; never auto-approves;
 *   - approveOrgAdvance: PENDING_APPROVAL -> ACTIVE with approver and
 *     disbursement reference, settled IN THE DATABASE by one CAS UPDATE
 *     (`WHERE id = ? AND status = 'PENDING_APPROVAL'`), so of two concurrent
 *     approvals with different references exactly one writes; idempotent on
 *     the reference (same => no-op, different => refused); other statuses
 *     refused; a seller advance refused; the generated selector update is
 *     only the no-connection fallback;
 *   - requestOrgAdvance under two concurrent requests for the same org: the
 *     partial unique index decides, one row, the other open_advance_exists;
 *   - recordOrgAdvanceRepayment: outstanding / total_repaid / fee DERIVED from
 *     the rows (a wrong stored counter is overwritten, not added to); REPAID
 *     when outstanding reaches 0; a replay answers already_recorded; two
 *     concurrent calls with the same external_reference leave exactly one row;
 *   - the vendor eligibility read filters recipient_type SELLER, so an org
 *     advance never blocks or surfaces for a vendor.
 */

const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1
const AS_OF = "2026-09-10T09:18:37.000Z"
const SNAP_AT = "2026-10-04T12:00:00.000Z"
const ORG = "ground_up_liberation_project"

const snapshot = (over: Partial<PoolCarrierSnapshot> = {}): PoolCarrierSnapshot => ({
  org_key: ORG,
  org_type: "irs_501c3",
  verification_status: "pub78_eligible",
  verified_as_of: AS_OF,
  stripe_connect_account_present: true,
  snapshot_at: SNAP_AT,
  ...over,
})

const eligibility = { basis: "Pilot MOU 2026-09; operator-approved working-capital line.", approved_limit: 5000 }

function request(l: AdvanceLedger, over: Record<string, unknown> = {}) {
  return l.service.requestOrgAdvance({
    partner_org_key: ORG,
    recipient_snapshot: snapshot(),
    amount: 1000,
    fee_rate: 1.05,
    term_days: 30,
    eligibility,
    requested_by: "admin_1",
    ...over,
  })
}

async function refusal(p: Promise<unknown>): Promise<OrgAdvanceRefusalError> {
  try {
    await p
  } catch (e) {
    if (e instanceof OrgAdvanceRefusalError) return e
    throw e
  }
  throw new Error("expected an OrgAdvanceRefusalError")
}

function expectNoLedger(l: AdvanceLedger) {
  expect(l.accounts.filter((a) => a.owner_type !== "SELLER")).toEqual([])
  expect(l.entries).toEqual([])
}

afterEach(() => {
  delete process.env[FLAG]
})

describe("FF_NONPROFIT_PARITY_V1 unset — the org path is dark", () => {
  it("requestOrgAdvance, approveOrgAdvance and recordOrgAdvanceRepayment throw feature_disabled before any read or write", async () => {
    const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1", { status: "ACTIVE", disbursement_reference: "tr_1" })] })
    expect((await refusal(request(l))).reason).toBe("feature_disabled")
    expect((await refusal(l.service.approveOrgAdvance("adv_1", { approved_by: "admin_1", disbursement_reference: "tr_1" }))).reason).toBe("feature_disabled")
    expect((await refusal(l.service.recordOrgAdvanceRepayment("adv_1", { amount: 10, external_reference: "r1" }))).reason).toBe("feature_disabled")
    expect(l.advanceReads).toEqual([])
    expect(l.advanceWrites).toEqual([])
    expect(l.repayments).toEqual([])
    expectNoLedger(l)
  })
})

describe("requestOrgAdvance (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  it("writes a PENDING_APPROVAL record with no vendor, no ledger account, MANUAL repayment and the operator's eligibility — and creates no account and no entry", async () => {
    const l = makeAdvanceLedger()
    const adv = await request(l)

    expect(adv).toMatchObject({
      recipient_type: "PARTNER_ORG",
      vendor_id: null,
      ledger_account_id: null,
      partner_org_key: ORG,
      disbursement_reference: null,
      principal_amount: 1000,
      outstanding_balance: 1050,
      total_repaid: 0,
      fee_type: "FACTOR_RATE",
      fee_rate: 1.05,
      repayment_method: "MANUAL",
      repayment_rate: 0,
      term_days: 30,
      status: "PENDING_APPROVAL",
    })
    expect(adv.recipient_snapshot).toEqual(snapshot())
    expect(JSON.stringify(adv.recipient_snapshot)).not.toContain("acct_")
    expect(adv.eligibility_snapshot).toMatchObject({ basis: eligibility.basis, approved_limit: 5000, recorded_by: "admin_1" })
    expect(typeof (adv.eligibility_snapshot as Record<string, unknown>).recorded_at).toBe("string")
    expect(adv.approved_by ?? null).toBeNull()
    // No auto-approve: exactly one write, the create.
    expect(l.advanceWrites.map((w) => w.op)).toEqual(["create"])
    expectNoLedger(l)
  })

  it("total owed is principal * fee_rate rounded once in integer cents (100 * 1.15 is 115, not 114.99999999999999)", async () => {
    expect(totalOwedMajorUnits(100, 1.15)).toBe(115)
    expect(100 * 1.15).not.toBe(115)
    const l = makeAdvanceLedger()
    const adv = await request(l, { amount: 100, fee_rate: 1.15 })
    expect(adv.outstanding_balance).toBe(115)
  })

  it("refuses every snapshot that is not a verified recipient, before any write", async () => {
    const bad: Array<[string, unknown]> = [
      ["revoked", snapshot({ verification_status: "revoked" })],
      ["not_found", snapshot({ verification_status: "not_found" })],
      ["unverified 501c3", snapshot({ verification_status: "unverified" })],
      ["pending", snapshot({ verification_status: "pending" })],
      ["IRS-affirmed without a file date", snapshot({ verified_as_of: null })],
      ["no connected account", snapshot({ stripe_connect_account_present: false })],
      ["names another org", snapshot({ org_key: "someone_else" })],
      ["not an object", "pub78_eligible"],
      ["null", null],
    ]
    for (const [, recipient_snapshot] of bad) {
      const l = makeAdvanceLedger()
      const e = await refusal(request(l, { recipient_snapshot }))
      expect(e.reason).toBe("invalid_recipient_snapshot")
      expect(l.advanceWrites).toEqual([])
      expect(l.advanceReads).toEqual([])
    }
  })

  it("a coop published with the operator's ack is a valid recipient (no IRS file date)", async () => {
    const l = makeAdvanceLedger()
    const adv = await request(l, {
      partner_org_key: "detroit_food_coop",
      recipient_snapshot: snapshot({ org_key: "detroit_food_coop", org_type: "coop", verification_status: "unverified", verified_as_of: null }),
    })
    expect(adv).toMatchObject({ partner_org_key: "detroit_food_coop", status: "PENDING_APPROVAL" })
  })

  it("refuses an amount over the operator's approved_limit, a malformed eligibility and bad terms", async () => {
    const l = makeAdvanceLedger()
    expect((await refusal(request(l, { amount: 5000.01 }))).reason).toBe("over_limit")
    expect((await refusal(request(l, { eligibility: { basis: "   ", approved_limit: 5000 } }))).reason).toBe("invalid_eligibility")
    expect((await refusal(request(l, { eligibility: { basis: "ok", approved_limit: 0 } }))).reason).toBe("invalid_eligibility")
    expect((await refusal(request(l, { eligibility: { approved_limit: 5000 } }))).reason).toBe("invalid_eligibility")
    expect((await refusal(request(l, { amount: 1.005 }))).reason).toBe("invalid_terms")
    expect((await refusal(request(l, { amount: -5 }))).reason).toBe("invalid_terms")
    expect((await refusal(request(l, { fee_rate: 2.5 }))).reason).toBe("invalid_terms")
    expect((await refusal(request(l, { fee_rate: 0.9 }))).reason).toBe("invalid_terms")
    expect((await refusal(request(l, { term_days: 3 }))).reason).toBe("invalid_terms")
    expect((await refusal(request(l, { term_days: 30.5 }))).reason).toBe("invalid_terms")
    expect(l.advanceWrites).toEqual([])
    expect(l.advanceReads).toEqual([])
  })

  it("refuses a second open advance for the same org; a REPAID one and another org's do not block", async () => {
    for (const status of ["PENDING_APPROVAL", "APPROVED", "ACTIVE"]) {
      const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_open", { status, disbursement_reference: status === "ACTIVE" ? "tr" : null })] })
      const e = await refusal(request(l))
      expect(e.reason).toBe("open_advance_exists")
      expect(e.details).toMatchObject({ advance_id: "adv_open", status })
      expect(l.advanceWrites).toEqual([])
    }
    const l = makeAdvanceLedger({
      advances: [
        makeOrgAdvance("adv_done", { status: "REPAID", disbursement_reference: "tr_0", outstanding_balance: 0 }),
        makeOrgAdvance("adv_other", { partner_org_key: "someone_else", status: "ACTIVE", disbursement_reference: "tr_x" }),
      ],
    })
    const adv = await request(l)
    expect(adv.status).toBe("PENDING_APPROVAL")
    expect(l.advances).toHaveLength(3)
  })

  it("two CONCURRENT requests for the same org both pass the open-advance read; the unique index decides, exactly one row, the other open_advance_exists", async () => {
    const l = makeAdvanceLedger()
    const results = await Promise.allSettled([request(l), request(l, { amount: 900 })])
    const ok = results.filter((r) => r.status === "fulfilled")
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    const e = failed[0].reason as OrgAdvanceRefusalError
    expect(e).toBeInstanceOf(OrgAdvanceRefusalError)
    expect(e.reason).toBe("open_advance_exists")
    expect(e.details).toMatchObject({ partner_org_key: ORG, advance_id: l.advances[0].id, status: "PENDING_APPROVAL" })
    expect(l.advances).toHaveLength(1)
    // Both inserts were attempted (the read alone did not stop the second).
    expect(l.advanceWrites.filter((w) => w.op === "create")).toHaveLength(2)
  })
})

describe("approveOrgAdvance (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  const CAS_SQL = /UPDATE hawala_vendor_advance\s+SET .*\bstatus = \?.*\bapproved_at = \?.*\bapproved_by = \?.*\bdisbursement_reference = \?.*\bstart_date = \?.*\bexpected_end_date = \?.*\bWHERE id = \? AND status = 'PENDING_APPROVAL' AND deleted_at IS NULL\s+RETURNING id/s

  it("PENDING_APPROVAL -> ACTIVE is settled IN THE DATABASE: one CAS UPDATE with the PENDING_APPROVAL predicate and RETURNING, no generated update; stamps approver, reference and the term start; no ledger", async () => {
    const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")], pg: true })
    const out = await l.service.approveOrgAdvance("adv_1", { approved_by: "admin_1", disbursement_reference: "tr_1GULP" })
    expect(out.approved).toBe(true)
    expect(out.approved && out.advance).toMatchObject({ id: "adv_1", status: "ACTIVE", disbursement_reference: "tr_1GULP" })

    expect(l.sql).toHaveLength(1)
    expect(l.sql[0].sql).toMatch(CAS_SQL)
    expect(l.sql[0].bindings).toEqual(["ACTIVE", expect.any(Date), "admin_1", "tr_1GULP", expect.any(Date), expect.any(Date), "adv_1"])
    // The transition went through the CAS, not the generated update.
    expect(l.advanceWrites).toEqual([])

    expect(l.advances[0]).toMatchObject({ status: "ACTIVE", approved_by: "admin_1", disbursement_reference: "tr_1GULP" })
    expect(l.advances[0].approved_at).toBeInstanceOf(Date)
    expect(l.advances[0].start_date).toEqual(l.advances[0].approved_at)
    const expected = new Date(l.advances[0].approved_at as Date)
    expected.setDate(expected.getDate() + 30)
    expect(l.advances[0].expected_end_date).toEqual(expected)
    expectNoLedger(l)
  })

  it("two CONCURRENT approvals with different references: both pass the pre-read, the CAS UPDATE lets exactly one write, the other is reference_mismatch and the first reference is kept", async () => {
    const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")], pg: true })
    const results = await Promise.allSettled([
      l.service.approveOrgAdvance("adv_1", { approved_by: "admin_1", disbursement_reference: "tr_A" }),
      l.service.approveOrgAdvance("adv_1", { approved_by: "admin_2", disbursement_reference: "tr_B" }),
    ])
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof l.service.approveOrgAdvance>>> => r.status === "fulfilled")
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect((failed[0].reason as OrgAdvanceRefusalError).reason).toBe("reference_mismatch")
    // Both reached the database; the statement decided.
    expect(l.sql).toHaveLength(2)
    for (const stmt of l.sql) expect(stmt.sql).toMatch(CAS_SQL)
    const winner = ok[0].value
    expect(winner.approved).toBe(true)
    expect(l.advances[0].disbursement_reference).toBe(winner.approved && winner.advance.disbursement_reference)
    expect(l.advances[0].approved_by).toBe(winner.approved && winner.advance.approved_by)
    expect(l.advanceWrites).toEqual([])
  })

  it("fallback with no pg connection: the generated conditional update runs (the in-memory shadow settles it in one tick — a unit-test convenience, not a database guarantee)", async () => {
    const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] })
    const out = await l.service.approveOrgAdvance("adv_1", { approved_by: "admin_1", disbursement_reference: "tr_1GULP" })
    expect(out.approved).toBe(true)
    expect(l.sql).toEqual([])
    expect(l.advances[0]).toMatchObject({ status: "ACTIVE", approved_by: "admin_1", disbursement_reference: "tr_1GULP" })
    expect(l.advanceWrites).toEqual([{ op: "update", data: expect.objectContaining({ selector: { id: "adv_1", status: "PENDING_APPROVAL" } }) }])
    expectNoLedger(l)
  })

  it("is idempotent on the disbursement reference: same => no-op already_approved (no write), different => reference_mismatch", async () => {
    const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] })
    await l.service.approveOrgAdvance("adv_1", { approved_by: "admin_1", disbursement_reference: "tr_1" })
    const writes = l.advanceWrites.length

    const replay = await l.service.approveOrgAdvance("adv_1", { approved_by: "admin_2", disbursement_reference: "tr_1" })
    expect(replay).toMatchObject({ approved: false, reason: "already_approved" })
    expect(l.advances[0].approved_by).toBe("admin_1")
    expect(l.advanceWrites).toHaveLength(writes)

    const e = await refusal(l.service.approveOrgAdvance("adv_1", { approved_by: "admin_2", disbursement_reference: "tr_2" }))
    expect(e.reason).toBe("reference_mismatch")
    expect(l.advances[0].disbursement_reference).toBe("tr_1")
  })

  it("refuses a REPAID, CANCELED or DEFAULTED advance (invalid_state), a seller advance (not_org_advance), an empty reference, and an unknown id", async () => {
    for (const status of ["REPAID", "CANCELED", "DEFAULTED"]) {
      const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1", { status, disbursement_reference: "tr_0" })] })
      expect((await refusal(l.service.approveOrgAdvance("adv_1", { approved_by: "a", disbursement_reference: "tr_9" }))).reason).toBe("invalid_state")
      expect(l.advanceWrites).toEqual([])
    }
    const seller = makeAdvanceLedger({ advances: [makeSellerAdvance("adv_s", { status: "PENDING_APPROVAL" })] })
    expect((await refusal(seller.service.approveOrgAdvance("adv_s", { approved_by: "a", disbursement_reference: "tr" }))).reason).toBe("not_org_advance")
    expect(seller.advances[0].status).toBe("PENDING_APPROVAL")

    const l = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] })
    expect((await refusal(l.service.approveOrgAdvance("adv_1", { approved_by: "a", disbursement_reference: "  " }))).reason).toBe("invalid_state")
    expect((await refusal(l.service.approveOrgAdvance("adv_1", { approved_by: "", disbursement_reference: "tr" }))).reason).toBe("invalid_state")
    await expect(l.service.approveOrgAdvance("adv_ghost", { approved_by: "a", disbursement_reference: "tr" })).rejects.toThrow("Vendor advance not found")
    expect(l.advances[0].status).toBe("PENDING_APPROVAL")
  })
})

describe("recordOrgAdvanceRepayment (flag on)", () => {
  beforeEach(() => {
    process.env[FLAG] = "true"
  })

  const active = (over: Partial<Row> = {}) => makeOrgAdvance("adv_1", { status: "ACTIVE", disbursement_reference: "tr_1", ...over })

  it("derives outstanding / total_repaid / fee from the rows, splits principal and fee pro-rata, and goes REPAID at 0", async () => {
    const l = makeAdvanceLedger({ advances: [active()] })
    const first = await l.service.recordOrgAdvanceRepayment("adv_1", { amount: 500, external_reference: "gulp-pay-1", recorded_by: "admin_1" })
    expect(first.recorded).toBe(true)
    expect(first).toMatchObject({ position: { total_owed: 1050, total_repaid: 500, outstanding_balance: 550 } })
    expect(l.repayments[0]).toMatchObject({
      advance_id: "adv_1",
      external_reference: "gulp-pay-1",
      repayment_type: "MANUAL",
      status: "COMPLETED",
      ledger_entry_id: null,
      order_id: null,
      total_amount: 500,
      outstanding_balance_after: 550,
    })
    expect(Number(l.repayments[0].principal_amount)).toBeCloseTo(476.19047619, 6)
    expect(Number(l.repayments[0].fee_amount)).toBeCloseTo(23.80952381, 6)
    expect(l.advances[0]).toMatchObject({ status: "ACTIVE", outstanding_balance: 550, total_repaid: 500, actual_end_date: null })
    expect(Number(l.advances[0].total_fee_charged)).toBeCloseTo(23.80952381, 8)

    const second = await l.service.recordOrgAdvanceRepayment("adv_1", { amount: 550, external_reference: "gulp-pay-2" })
    expect(second.recorded).toBe(true)
    expect(l.advances[0]).toMatchObject({ status: "REPAID", outstanding_balance: 0, total_repaid: 1050, total_fee_charged: 50 })
    expect(l.advances[0].actual_end_date).toBeInstanceOf(Date)
    // The closing payment is trued up so principal sums to exactly the principal.
    expect(Number(l.repayments[0].principal_amount) + Number(l.repayments[1].principal_amount)).toBeCloseTo(1000, 6)
    expectNoLedger(l)
  })

  it("a wrong stored counter is overwritten by the derivation, never added to", async () => {
    const l = makeAdvanceLedger({
      advances: [active({ total_repaid: 999, outstanding_balance: 51 })],
      repayments: [{ id: "rep_0", advance_id: "adv_1", external_reference: "old", status: "COMPLETED", total_amount: 100, principal_amount: 95.23809524, fee_amount: 4.76190476 }],
    })
    const out = await l.service.recordOrgAdvanceRepayment("adv_1", { amount: 50, external_reference: "new" })
    expect(out).toMatchObject({ position: { total_repaid: 150, outstanding_balance: 900 } })
    expect(l.advances[0]).toMatchObject({ total_repaid: 150, outstanding_balance: 900, status: "ACTIVE" })
  })

  it("a replay of the same external_reference is already_recorded: one row, nothing re-derived differently", async () => {
    const l = makeAdvanceLedger({ advances: [active()] })
    await l.service.recordOrgAdvanceRepayment("adv_1", { amount: 100, external_reference: "ref-1" })
    const replay = await l.service.recordOrgAdvanceRepayment("adv_1", { amount: 100, external_reference: "ref-1" })
    expect(replay).toEqual({ recorded: false, reason: "already_recorded", repayment_id: "rep_1" })
    expect(l.repayments).toHaveLength(1)
    expect(l.advances[0]).toMatchObject({ total_repaid: 100, outstanding_balance: 950 })
  })

  it("two concurrent calls with the same external_reference leave exactly one row and derived totals of one amount", async () => {
    const l = makeAdvanceLedger({ advances: [active()] })
    const [a, b] = await Promise.all([
      l.service.recordOrgAdvanceRepayment("adv_1", { amount: 100, external_reference: "same" }),
      l.service.recordOrgAdvanceRepayment("adv_1", { amount: 100, external_reference: "same" }),
    ])
    expect([a.recorded, b.recorded].sort()).toEqual([false, true])
    expect(l.repayments).toHaveLength(1)
    expect(l.advances[0]).toMatchObject({ total_repaid: 100, outstanding_balance: 950 })
  })

  it("refuses a repayment above the derived outstanding, a bad amount, an empty reference, a non-ACTIVE advance and a seller advance; a replay on a REPAID advance still answers already_recorded", async () => {
    const l = makeAdvanceLedger({ advances: [active()] })
    expect((await refusal(l.service.recordOrgAdvanceRepayment("adv_1", { amount: 1050.01, external_reference: "big" }))).reason).toBe("invalid_repayment")
    expect((await refusal(l.service.recordOrgAdvanceRepayment("adv_1", { amount: 1.005, external_reference: "frac" }))).reason).toBe("invalid_repayment")
    expect((await refusal(l.service.recordOrgAdvanceRepayment("adv_1", { amount: 10, external_reference: " " }))).reason).toBe("invalid_repayment")
    expect(l.repayments).toEqual([])

    const pending = makeAdvanceLedger({ advances: [makeOrgAdvance("adv_1")] })
    expect((await refusal(pending.service.recordOrgAdvanceRepayment("adv_1", { amount: 10, external_reference: "r" }))).reason).toBe("invalid_state")
    expect(pending.repayments).toEqual([])

    const seller = makeAdvanceLedger({ advances: [makeSellerAdvance("adv_s")] })
    expect((await refusal(seller.service.recordOrgAdvanceRepayment("adv_s", { amount: 10, external_reference: "r" }))).reason).toBe("not_org_advance")
    await expect(seller.service.recordOrgAdvanceRepayment("adv_ghost", { amount: 10, external_reference: "r" })).rejects.toThrow("Vendor advance not found")

    const repaid = makeAdvanceLedger({
      advances: [active({ status: "REPAID", outstanding_balance: 0, total_repaid: 1050 })],
      repayments: [{ id: "rep_1", advance_id: "adv_1", external_reference: "final", status: "COMPLETED", total_amount: 1050, principal_amount: 1000, fee_amount: 50 }],
    })
    expect(await repaid.service.recordOrgAdvanceRepayment("adv_1", { amount: 1050, external_reference: "final" })).toEqual({ recorded: false, reason: "already_recorded", repayment_id: "rep_1" })
    expect((await refusal(repaid.service.recordOrgAdvanceRepayment("adv_1", { amount: 1, external_reference: "late" }))).reason).toBe("invalid_state")
  })
})

describe("the vendor surface never sees an org advance", () => {
  it("calculateAdvanceEligibility reads active advances with recipient_type SELLER, so an org row carrying a vendor_id cannot block the vendor", async () => {
    const l = makeAdvanceLedger({
      // Pathological row (the DDL CHECK forbids it); the filter, not the
      // schema, is what keeps it off the vendor surface.
      advances: [makeOrgAdvance("adv_org", { status: "ACTIVE", disbursement_reference: "tr", vendor_id: "sel_1" })],
      accounts: [{ id: "acc-earn", account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: "sel_1", currency_code: "USD", balance: 0, pending_balance: 0, available_balance: 0 }],
    })
    const out = await l.service.calculateAdvanceEligibility("sel_1")
    expect(out.reason).not.toBe("Active advance exists")
    expect(l.advanceReads).toEqual([{ vendor_id: "sel_1", recipient_type: "SELLER", status: "ACTIVE" }])
  })
})
