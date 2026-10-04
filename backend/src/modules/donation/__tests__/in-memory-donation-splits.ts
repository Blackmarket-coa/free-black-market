import DonationModuleService from "../service"

/**
 * In-memory stand-in for the generated MedusaService CRUD on
 * `donation_split_record`, built off the prototype (the
 * `partner-directory/__tests__/in-memory-partner-orgs.ts` pattern) so the REAL
 * `recordDirectSplit` / `applyDirectSplitProcessorEvent` / guard run and only
 * persistence is shadowed. `new` is not used because the MedusaService
 * constructor needs a container.
 *
 * Not a `*.spec.ts`, so Jest never collects it as a suite.
 */

export type SplitRow = {
  id: string
  stripe_payment_intent_id: string
  stripe_account_id: string
  org_key: string
  campaign_id: string | null
  kind: "donation" | "donation_pledge"
  currency_code: string
  gross_cents: number
  bmc_fee_cents: number
  processor_fee_cents: number | null
  refunded_cents?: number | null
  recipient_org_type: string | null
  recipient_verification_status: string
  recipient_verified_as_of: Date | null
  recipient_snapshot_at: Date
  status: "created" | "succeeded" | "refunded" | "failed"
  customer_id: string | null
  metadata: Record<string, unknown> | null
}

export type InMemoryDonations = {
  service: DonationModuleService
  rows: SplitRow[]
  calls: { create: Record<string, unknown>[]; update: Record<string, unknown>[] }
}

export function makeInMemoryDonations(seed: SplitRow[] = []): InMemoryDonations {
  const rows: SplitRow[] = seed.map((r) => ({ ...r }))
  const calls: InMemoryDonations["calls"] = { create: [], update: [] }

  const service = Object.create(DonationModuleService.prototype) as DonationModuleService
  const shadow = service as unknown as Record<string, unknown>

  shadow.listDonationSplitRecords = async (filter: Record<string, unknown> = {}) =>
    rows.filter((r) => Object.entries(filter).every(([k, v]) => (r as Record<string, unknown>)[k] === v))

  shadow.createDonationSplitRecords = async (data: Record<string, unknown>) => {
    calls.create.push({ ...data })
    // The DB CHECK (`bmc_fee_cents = 0`, `gross_cents > 0`) is mirrored so a
    // guard bypass would fail here too instead of passing silently.
    if (data.bmc_fee_cents !== 0) throw new Error("CHECK donation_split_record_bmc_fee_zero_check")
    if (typeof data.gross_cents !== "number" || data.gross_cents <= 0) {
      throw new Error("CHECK donation_split_record_gross_positive_check")
    }
    if (rows.some((r) => r.stripe_payment_intent_id === data.stripe_payment_intent_id)) {
      throw new Error("UNIQUE IDX_donation_split_record_intent_unique")
    }
    const row = { id: `dsr_${rows.length + 1}`, ...data } as SplitRow
    rows.push(row)
    return row
  }

  shadow.updateDonationSplitRecords = async (data: Record<string, unknown> & { id: string }) => {
    calls.update.push({ ...data })
    const row = rows.find((r) => r.id === data.id)
    if (!row) throw new Error(`DonationSplitRecord with id ${data.id} not found`)
    const rest: Record<string, unknown> = { ...data }
    delete rest.id
    if ("bmc_fee_cents" in rest && rest.bmc_fee_cents !== 0) throw new Error("CHECK donation_split_record_bmc_fee_zero_check")
    if ("refunded_cents" in rest && rest.refunded_cents !== null) {
      const r = rest.refunded_cents
      if (typeof r !== "number" || r < 0 || r > row.gross_cents) throw new Error("CHECK donation_split_record_refunded_bounded_check")
    }
    Object.assign(row, rest)
    return row
  }

  return { service, rows, calls }
}
