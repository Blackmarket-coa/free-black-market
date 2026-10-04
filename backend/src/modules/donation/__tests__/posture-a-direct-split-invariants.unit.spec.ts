import {
  assertDirectSplitInvariants,
  DirectSplitViolationError,
  donationRecipientRefusal,
  freezeRecipientSnapshot,
  traceResolutions,
  type DirectSplitRecordShape,
} from "../direct-split-guard"
import { HAWALA_LEDGER_MODULE } from "../../hawala-ledger"
import { PARTNER_DIRECTORY_MODULE } from "../../partner-directory"
import { PURCHASE_CONTEXT_REFERENCE_TYPES } from "../../hawala-ledger/posture-a-guard"
import { FORBIDDEN_DIRECT_CHARGE_PARAMS } from "../../../shared/stripe-direct-charge"
import { makeInMemoryDonations } from "./in-memory-donation-splits"

/**
 * Posture A direct-split invariants for donations (docs/POSTURE_A_COMPLIANCE.md
 * rule 10). Runs under `pnpm test:posture-a` (security.yml) alongside the CCR
 * closed-loop spec.
 *
 * What a failure here means: a donation record could be written for money
 * that transited FBM's balance (a destination charge, an application fee, an
 * on_behalf_of override), or with a BMC cut, or without the recipient's dated
 * verification snapshot, or alongside a hawala ledger leg. Each of those is a
 * legal-boundary breach (L11, L24), not a bug to work around.
 *
 * Do NOT loosen these tests without a written compliance review.
 */

const AS_OF = new Date("2026-09-10T09:18:37Z")
const SNAP_AT = new Date("2026-10-04T12:00:00Z")

const record = (overrides: Partial<DirectSplitRecordShape> = {}): DirectSplitRecordShape => ({
  stripe_payment_intent_id: "pi_1",
  stripe_account_id: "acct_1GULP",
  org_key: "ground_up_liberation_project",
  kind: "donation",
  gross_cents: 2500,
  bmc_fee_cents: 0,
  recipient_org_type: "irs_501c3",
  recipient_verification_status: "pub78_eligible",
  recipient_verified_as_of: AS_OF,
  recipient_snapshot_at: SNAP_AT,
  ...overrides,
})

/** A PaymentIntent object as Stripe returns it for a plain direct charge. */
const cleanIntent = () => ({
  id: "pi_1",
  object: "payment_intent",
  amount: 2500,
  currency: "usd",
  transfer_data: null,
  on_behalf_of: null,
  application_fee_amount: null,
  metadata: { fbm_connected_account_id: "acct_1GULP" },
})

const cleanFlow = () => ({ resolved_module_keys: [PARTNER_DIRECTORY_MODULE, "payment", "donation"] })

const violation = (fn: () => void, code: string) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DirectSplitViolationError)
    expect((e as DirectSplitViolationError).code).toBe(code)
    return
  }
  throw new Error(`expected DirectSplitViolationError ${code}`)
}

describe("assertDirectSplitInvariants (strict; there is no other mode)", () => {
  it("passes a zero-fee direct charge on a connected account with a dated IRS snapshot", () => {
    expect(() => assertDirectSplitInvariants({ record: record(), intent: cleanIntent(), flow: cleanFlow() })).not.toThrow()
  })

  it("REJECTS a record whose charge is not on a connected account", () => {
    for (const bad of ["", "cus_123", "pi_123", null as unknown as string]) {
      violation(
        () => assertDirectSplitInvariants({ record: record({ stripe_account_id: bad }), intent: cleanIntent(), flow: cleanFlow() }),
        "not_on_connected_account"
      )
    }
  })

  it("REJECTS every forbidden Connect parameter, at the top level and nested", () => {
    expect([...FORBIDDEN_DIRECT_CHARGE_PARAMS].sort()).toEqual(["application_fee_amount", "on_behalf_of", "transfer_data"])
    for (const param of FORBIDDEN_DIRECT_CHARGE_PARAMS) {
      violation(
        () => assertDirectSplitInvariants({ record: record(), intent: { ...cleanIntent(), [param]: param === "application_fee_amount" ? 75 : "acct_PLATFORM" }, flow: cleanFlow() }),
        "forbidden_intent_param"
      )
      violation(
        () => assertDirectSplitInvariants({ record: record(), intent: { ...cleanIntent(), nested: { deeper: [{ [param]: { destination: "acct_X" } }] } }, flow: cleanFlow() }),
        "forbidden_intent_param"
      )
    }
  })

  it("treats a null forbidden field as absent (that is what Stripe returns for a plain charge)", () => {
    expect(() =>
      assertDirectSplitInvariants({
        record: record(),
        intent: { ...cleanIntent(), transfer_data: null, on_behalf_of: null, application_fee_amount: null },
        flow: cleanFlow(),
      })
    ).not.toThrow()
  })

  it("REJECTS any BMC fee other than exactly 0", () => {
    for (const fee of [1, -1, 0.5, 75]) {
      violation(() => assertDirectSplitInvariants({ record: record({ bmc_fee_cents: fee }), intent: cleanIntent(), flow: cleanFlow() }), "nonzero_bmc_fee")
    }
  })

  it("REJECTS a gross that is not a positive integer number of cents", () => {
    for (const gross of [0, -100, 12.34, Number.NaN]) {
      violation(() => assertDirectSplitInvariants({ record: record({ gross_cents: gross }), intent: cleanIntent(), flow: cleanFlow() }), "gross_not_positive_integer")
    }
  })

  it("REJECTS a kind that is not a donation (a sale or a pledge of goods has its own path)", () => {
    // `pool_contribution` is a direct charge too (DIRECT_CHARGE_KINDS), but a
    // contribution to a carried pool is not a donation: it is recorded on
    // `hawala_investment` (settlement CARRIER), never on donation_split_record.
    for (const kind of ["sale", "pledge", "tip", "pool_contribution"]) {
      violation(
        () => assertDirectSplitInvariants({ record: record({ kind: kind as DirectSplitRecordShape["kind"] }), intent: cleanIntent(), flow: cleanFlow() }),
        "kind_not_donation"
      )
    }
    expect(() => assertDirectSplitInvariants({ record: record({ kind: "donation_pledge" }), intent: cleanIntent(), flow: cleanFlow() })).not.toThrow()
  })

  it("REJECTS a record with no recipient snapshot or an undated one (L11)", () => {
    violation(
      () => assertDirectSplitInvariants({ record: record({ recipient_verification_status: "" as never }), intent: cleanIntent(), flow: cleanFlow() }),
      "recipient_snapshot_missing"
    )
    violation(
      () => assertDirectSplitInvariants({ record: record({ recipient_snapshot_at: new Date("nope") }), intent: cleanIntent(), flow: cleanFlow() }),
      "recipient_snapshot_missing"
    )
  })

  it("REJECTS an IRS-affirmed status that carries no IRS file as-of date (L11)", () => {
    for (const status of ["pub78_eligible", "bmf_only"] as const) {
      violation(
        () => assertDirectSplitInvariants({ record: record({ recipient_verification_status: status, recipient_verified_as_of: null }), intent: cleanIntent(), flow: cleanFlow() }),
        "recipient_as_of_missing"
      )
    }
  })

  it("REJECTS a snapshot that is neither IRS-affirmed nor a non-IRS org type", () => {
    for (const status of ["unverified", "pending", "not_found", "revoked"] as const) {
      violation(
        () => assertDirectSplitInvariants({ record: record({ recipient_verification_status: status }), intent: cleanIntent(), flow: cleanFlow() }),
        "recipient_not_eligible"
      )
    }
    // A coop has no IRS file; its snapshot is dated by the freeze, not a file.
    expect(() =>
      assertDirectSplitInvariants({
        record: record({ recipient_org_type: "coop", recipient_verification_status: "unverified", recipient_verified_as_of: null }),
        intent: cleanIntent(),
        flow: cleanFlow(),
      })
    ).not.toThrow()
  })

  it("REJECTS a flow in which the hawala ledger was resolved (a donation posts no ledger leg)", () => {
    violation(
      () => assertDirectSplitInvariants({ record: record(), intent: cleanIntent(), flow: { resolved_module_keys: [PARTNER_DIRECTORY_MODULE, HAWALA_LEDGER_MODULE] } }),
      "hawala_ledger_resolved"
    )
    // The constant is the real registration key, not a guess.
    expect(HAWALA_LEDGER_MODULE).toBe("hawalaLedger")
  })

  it("has no warn or off mode: the function takes no mode argument", () => {
    expect(assertDirectSplitInvariants.length).toBe(1)
  })
})

describe("the record-only ledger adds nothing to hawala's vocabulary", () => {
  it("PURCHASE_CONTEXT_REFERENCE_TYPES carries no donation entry", () => {
    for (const v of PURCHASE_CONTEXT_REFERENCE_TYPES) {
      expect(v.toLowerCase()).not.toContain("donation")
      expect(v.toLowerCase()).not.toContain("split")
    }
  })
})

describe("traceResolutions", () => {
  it("records every key in order and passes the resolution through", () => {
    const seen: string[] = []
    const scope = { resolve: <T,>(key: string): T => { seen.push(key); return { key } as unknown as T } }
    const flow = traceResolutions(scope)
    expect(flow.resolve<{ key: string }>("a").key).toBe("a")
    flow.resolve("b")
    expect(flow.resolved).toEqual(["a", "b"])
    expect(seen).toEqual(["a", "b"])
  })
})

describe("donationRecipientRefusal / freezeRecipientSnapshot", () => {
  const eligible = { published: true, stripe_connect_account_id: "acct_1", org_type: "irs_501c3" as const, verification_status: "pub78_eligible" as const }

  it("admits a published, verified org with a connected account", () => {
    expect(donationRecipientRefusal(eligible)).toBeNull()
    expect(donationRecipientRefusal({ ...eligible, verification_status: "bmf_only" })).toBeNull()
    expect(donationRecipientRefusal({ ...eligible, org_type: "coop", verification_status: "unverified" })).toBeNull()
  })

  it("refuses the missing, the unpublished, the account-less and the unverified, each by name", () => {
    expect(donationRecipientRefusal(null)).toBe("not_found")
    expect(donationRecipientRefusal({ ...eligible, published: false })).toBe("not_published")
    expect(donationRecipientRefusal({ ...eligible, stripe_connect_account_id: null })).toBe("no_connected_account")
    expect(donationRecipientRefusal({ ...eligible, stripe_connect_account_id: "cus_1" })).toBe("no_connected_account")
    expect(donationRecipientRefusal({ ...eligible, verification_status: "unverified" })).toBe("not_verified")
    expect(donationRecipientRefusal({ ...eligible, verification_status: "revoked" })).toBe("not_verified")
    expect(donationRecipientRefusal({ ...eligible, org_type: null, verification_status: "unverified" })).toBe("not_verified")
  })

  it("freezes status, file date and type at the given time", () => {
    expect(freezeRecipientSnapshot({ org_type: "irs_501c4", verification_status: "bmf_only", verified_as_of: AS_OF }, SNAP_AT)).toEqual({
      recipient_org_type: "irs_501c4",
      recipient_verification_status: "bmf_only",
      recipient_verified_as_of: AS_OF,
      recipient_snapshot_at: SNAP_AT,
    })
  })
})

describe("DonationModuleService.recordDirectSplit / applyDirectSplitProcessorEvent (real prototype, shadowed CRUD)", () => {
  it("writes exactly one row for a clean direct charge, with bmc_fee_cents 0 and the snapshot", async () => {
    const dons = makeInMemoryDonations()
    const row = await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    expect(dons.calls.create).toHaveLength(1)
    expect(row).toMatchObject({
      stripe_payment_intent_id: "pi_1",
      stripe_account_id: "acct_1GULP",
      bmc_fee_cents: 0,
      gross_cents: 2500,
      status: "created",
      recipient_verification_status: "pub78_eligible",
      recipient_verified_as_of: AS_OF,
    })
  })

  it("is idempotent by intent id: a second call returns the row and writes nothing", async () => {
    const dons = makeInMemoryDonations()
    const a = await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    const b = await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    expect(b.id).toBe(a.id)
    expect(dons.calls.create).toHaveLength(1)
  })

  it("a pool_contribution never reaches donation_split_record: the service refuses it by kind before any write", async () => {
    const dons = makeInMemoryDonations()
    await expect(
      dons.service.recordDirectSplit(record({ kind: "pool_contribution" as DirectSplitRecordShape["kind"] }), cleanIntent(), cleanFlow())
    ).rejects.toMatchObject({ code: "kind_not_donation" })
    expect(dons.calls.create).toEqual([])
    expect(dons.rows).toEqual([])
  })

  it("the guard runs BEFORE the write: a destination charge leaves no row", async () => {
    const dons = makeInMemoryDonations()
    await expect(
      dons.service.recordDirectSplit(record(), { ...cleanIntent(), transfer_data: { destination: "acct_1GULP" } }, cleanFlow())
    ).rejects.toMatchObject({ code: "forbidden_intent_param" })
    await expect(dons.service.recordDirectSplit(record({ bmc_fee_cents: 75 }), cleanIntent(), cleanFlow())).rejects.toMatchObject({ code: "nonzero_bmc_fee" })
    await expect(
      dons.service.recordDirectSplit(record(), cleanIntent(), { resolved_module_keys: [HAWALA_LEDGER_MODULE] })
    ).rejects.toMatchObject({ code: "hawala_ledger_resolved" })
    expect(dons.calls.create).toEqual([])
    expect(dons.rows).toEqual([])
  })

  it("refuses to re-attach an existing intent to a different connected account", async () => {
    const dons = makeInMemoryDonations()
    await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    await expect(
      dons.service.recordDirectSplit(record({ stripe_account_id: "acct_OTHER" }), cleanIntent(), cleanFlow())
    ).rejects.toMatchObject({ code: "account_mismatch" })
  })

  it("applies processor events monotonically and idempotently", async () => {
    const dons = makeInMemoryDonations()
    await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    const base = { stripe_payment_intent_id: "pi_1", stripe_account_id: "acct_1GULP", intent: cleanIntent(), flow: cleanFlow() }

    const s1 = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "succeeded", processor_fee_cents: 103 })
    expect(s1.outcome).toBe("updated")
    expect(dons.rows[0]).toMatchObject({ status: "succeeded", processor_fee_cents: 103 })

    const s2 = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "succeeded", processor_fee_cents: 103 })
    expect(s2.outcome).toBe("unchanged")

    // A late failure cannot un-succeed a payment.
    const f = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "failed" })
    expect(f.outcome).toBe("unchanged")
    expect(dons.rows[0].status).toBe("succeeded")

    const r = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "refunded" })
    expect(r.outcome).toBe("updated")
    expect(dons.rows[0].status).toBe("refunded")

    // Refunded is terminal.
    const r2 = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "succeeded" })
    expect(r2.outcome).toBe("unchanged")
    expect(dons.rows[0].status).toBe("refunded")
    expect(dons.calls.update).toHaveLength(2)
  })

  it("records a partial refund as refunded_cents without moving the status; the full refund is terminal and never exceeds the gross", async () => {
    const dons = makeInMemoryDonations()
    await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    const base = { stripe_payment_intent_id: "pi_1", stripe_account_id: "acct_1GULP", intent: cleanIntent(), flow: cleanFlow() }
    await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "succeeded" })

    const partial = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "refunded", refunded_cents: 1000 })
    expect(partial.outcome).toBe("updated")
    expect(dons.rows[0]).toMatchObject({ status: "succeeded", refunded_cents: 1000 })

    const again = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "refunded", refunded_cents: 1000 })
    expect(again.outcome).toBe("unchanged")

    // Stripe can never refund more than it collected; the record is clamped to the gross.
    const full = await dons.service.applyDirectSplitProcessorEvent({ ...base, event: "refunded", refunded_cents: 2500 })
    expect(full.outcome).toBe("updated")
    expect(dons.rows[0]).toMatchObject({ status: "refunded", refunded_cents: 2500 })

    // A refund event with no figure on a fresh record is a full refund.
    const dons2 = makeInMemoryDonations()
    await dons2.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    await dons2.service.applyDirectSplitProcessorEvent({ ...base, event: "refunded" })
    expect(dons2.rows[0]).toMatchObject({ status: "refunded", refunded_cents: 2500 })
  })

  it("refuses a processor event whose account differs from the record's", async () => {
    const dons = makeInMemoryDonations()
    await dons.service.recordDirectSplit(record(), cleanIntent(), cleanFlow())
    await expect(
      dons.service.applyDirectSplitProcessorEvent({
        stripe_payment_intent_id: "pi_1",
        stripe_account_id: "acct_OTHER",
        event: "succeeded",
        intent: cleanIntent(),
        flow: cleanFlow(),
      })
    ).rejects.toMatchObject({ code: "account_mismatch" })
    expect(dons.calls.update).toEqual([])
  })

  it("ignores an unknown intent without a fallback, and creates from a fallback under the same guard", async () => {
    const dons = makeInMemoryDonations()
    const none = await dons.service.applyDirectSplitProcessorEvent({
      stripe_payment_intent_id: "pi_unknown",
      stripe_account_id: "acct_1GULP",
      event: "succeeded",
      intent: cleanIntent(),
      flow: cleanFlow(),
    })
    expect(none).toEqual({ outcome: "ignored_unknown_intent" })

    const created = await dons.service.applyDirectSplitProcessorEvent({
      stripe_payment_intent_id: "pi_unknown",
      stripe_account_id: "acct_1GULP",
      event: "succeeded",
      intent: cleanIntent(),
      flow: cleanFlow(),
      fallback: record({ stripe_payment_intent_id: "pi_unknown" }),
    })
    expect(created.outcome).toBe("created")
    expect(dons.rows[0]).toMatchObject({ stripe_payment_intent_id: "pi_unknown", status: "succeeded", bmc_fee_cents: 0 })

    await expect(
      dons.service.applyDirectSplitProcessorEvent({
        stripe_payment_intent_id: "pi_bad",
        stripe_account_id: "acct_1GULP",
        event: "succeeded",
        intent: { ...cleanIntent(), application_fee_amount: 10 },
        flow: cleanFlow(),
        fallback: record({ stripe_payment_intent_id: "pi_bad" }),
      })
    ).rejects.toMatchObject({ code: "forbidden_intent_param" })
    expect(dons.rows).toHaveLength(1)
  })
})
