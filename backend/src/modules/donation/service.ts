import type { InferTypeOf } from "@medusajs/framework/types"
import { MedusaService } from "@medusajs/framework/utils"
import { DonationBeneficiary, DonationDisbursement, DonationSettings, DonationSplitRecord } from "./models"
import {
  deriveDonationSettingsFields,
  resolveActiveFiscalSponsor,
} from "./fiscal-sponsors"
import {
  assertDirectSplitInvariants,
  DirectSplitViolationError,
  type DirectChargeIntentShape,
  type DirectSplitFlowTrace,
  type DirectSplitRecordShape,
} from "./direct-split-guard"
import type { DonationSplitKind, DonationSplitStatus } from "./models/donation-split-record"

export type DonationSplitRecordRow = InferTypeOf<typeof DonationSplitRecord>

/** Everything a caller supplies to record a direct charge; the guard reads the same shape. */
export type RecordDirectSplitInput = DirectSplitRecordShape & {
  campaign_id?: string | null
  currency_code?: string
  processor_fee_cents?: number | null
  customer_id?: string | null
  metadata?: Record<string, unknown> | null
}

export type DirectSplitProcessorEvent = "succeeded" | "refunded" | "failed"

export type ApplyDirectSplitProcessorEventInput = {
  stripe_payment_intent_id: string
  /** `event.account` — the connected account Stripe says the event belongs to. */
  stripe_account_id: string
  event: DirectSplitProcessorEvent
  /** From the balance transaction when the payload carried it; otherwise leave the column alone. */
  processor_fee_cents?: number | null
  /**
   * For `refunded`: the charge's `amount_refunded` in integer cents. Below the
   * gross it is a partial refund — the amount is recorded and the status is
   * left alone; at or above the gross (or when the processor gave no figure)
   * the refund is full and the status becomes `refunded`.
   */
  refunded_cents?: number | null
  intent: DirectChargeIntentShape
  flow: DirectSplitFlowTrace
  /**
   * When no record exists for the intent (the checkout wrote the intent but
   * the record write failed, or the webhook arrived first), the caller may
   * supply what a fresh record would have said. Without it the event is
   * ignored and reported as such — never guessed.
   */
  fallback?: RecordDirectSplitInput
}

export type ApplyDirectSplitProcessorEventResult =
  | { outcome: "created"; record: DonationSplitRecordRow }
  | { outcome: "updated"; record: DonationSplitRecordRow }
  | { outcome: "unchanged"; record: DonationSplitRecordRow }
  | { outcome: "ignored_unknown_intent" }

/**
 * Status transitions a processor event may cause. Monotone where it matters:
 * a full refund is terminal, and a succeeded record is only ever moved by a
 * refund. Anything else is "unchanged" rather than a regression — a
 * late-arriving `created`-shaped event cannot un-succeed a payment. A PARTIAL
 * refund is not a status transition at all (the charge still stands); it is
 * handled by the caller before this runs.
 */
const PROCESSOR_EVENT_STATUS: Record<DirectSplitProcessorEvent, DonationSplitStatus> = {
  succeeded: "succeeded",
  refunded: "refunded",
  failed: "failed",
}

function nextStatus(current: DonationSplitStatus, event: DirectSplitProcessorEvent): DonationSplitStatus {
  const target = PROCESSOR_EVENT_STATUS[event]
  if (current === "refunded") return current
  if (current === "succeeded") return target === "refunded" ? target : current
  // created | failed
  return target
}

type DonationAggregate = {
  beneficiary_id: string
  beneficiary_name: string
  total_accrued: number
  total_disbursed: number
  outstanding: number
}

class DonationModuleService extends MedusaService({
  DonationBeneficiary,
  DonationSettings,
  DonationDisbursement,
  DonationSplitRecord,
}) {
  async getOrCreateDefaultSettings() {
    const sponsorFields = deriveDonationSettingsFields(
      resolveActiveFiscalSponsor()
    )

    const settings = await this.listDonationSettings({ is_default: true })
    if (settings.length) {
      const existing = settings[0]
      // Reconcile the sponsor fields on every fetch so a deploy that
      // flips FBM_FISCAL_SPONSOR_LIVE or rotates the provider key
      // propagates without a manual admin write. The donation widget
      // and the disbursement job both read these columns.
      const needsUpdate =
        existing.fiscal_sponsor_name !== sponsorFields.fiscal_sponsor_name ||
        existing.fiscal_sponsor_url !== sponsorFields.fiscal_sponsor_url ||
        existing.fiscal_sponsor_account_id !==
          sponsorFields.fiscal_sponsor_account_id

      if (needsUpdate) {
        const [updated] = await this.updateDonationSettings([
          { id: existing.id, ...sponsorFields },
        ])
        return updated
      }
      return existing
    }
    return this.createDonationSettings({ is_default: true, ...sponsorFields })
  }

  async upsertDefaultSettings(data: Record<string, unknown>) {
    const settings = await this.getOrCreateDefaultSettings()
    return this.updateDonationSettings({ id: settings.id, ...data })
  }

  async listBeneficiaries(includeUnverified = true) {
    const beneficiaries = await this.listDonationBeneficiaries()
    return includeUnverified
      ? beneficiaries
      : beneficiaries.filter((b) => b.verification_status === "verified")
  }

  async getTransparencySummary(start: Date, end: Date, storefront_id?: string) {
    const disbursements = await this.listDonationDisbursements()
    const beneficiaries = await this.listDonationBeneficiaries()

    const inRange = disbursements.filter((d) => {
      const createdAt = new Date(d.created_at)
      const storefrontMatches = storefront_id ? d.storefront_id === storefront_id : true
      return storefrontMatches && createdAt >= start && createdAt <= end
    })

    const byBeneficiary = new Map<string, DonationAggregate>()

    for (const item of inRange) {
      const match = beneficiaries.find((b) => b.id === item.beneficiary_id)
      const current = byBeneficiary.get(item.beneficiary_id) || {
        beneficiary_id: item.beneficiary_id,
        beneficiary_name: match?.name || "Unknown",
        total_accrued: 0,
        total_disbursed: 0,
        outstanding: 0,
      }

      current.total_accrued += Number(item.amount)
      if (item.status === "sent") {
        current.total_disbursed += Number(item.amount)
      }
      current.outstanding = current.total_accrued - current.total_disbursed
      byBeneficiary.set(item.beneficiary_id, current)
    }

    const aggregates = Array.from(byBeneficiary.values())

    return {
      range: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        accrued: aggregates.reduce((acc, i) => acc + i.total_accrued, 0),
        disbursed: aggregates.reduce((acc, i) => acc + i.total_disbursed, 0),
        outstanding: aggregates.reduce((acc, i) => acc + i.outstanding, 0),
      },
      beneficiaries: aggregates,
    }
  }

  async queueBatchDisbursement(periodStart: Date, periodEnd: Date) {
    const settings = await this.getOrCreateDefaultSettings()
    if (settings.settlement_mode !== "ledger_batch") {
      return { skipped: true, reason: "settlement mode is not ledger_batch" }
    }

    const beneficiaries = await this.listBeneficiaries(false)
    const rows = await Promise.all(
      beneficiaries.map((b) =>
        this.createDonationDisbursements({
          beneficiary_id: b.id,
          amount: Number((b.metadata as any)?.accrued_balance || 0),
          currency_code: String((b.metadata as any)?.currency_code || "usd"),
          status: "pending",
          period_start: periodStart,
          period_end: periodEnd,
          metadata: { source: "scheduled_batch" },
        })
      )
    )

    return { skipped: false, count: rows.length }
  }

  // ── direct-charge donations: record-only ledger ─────────────────────────

  async getDirectSplitByIntentId(stripePaymentIntentId: string): Promise<DonationSplitRecordRow | null> {
    const [row] = await this.listDonationSplitRecords({ stripe_payment_intent_id: stripePaymentIntentId })
    return row ?? null
  }

  /**
   * Record a direct charge that the processor has already created. Processor
   * first, record second: the caller holds a PaymentIntent on the org's
   * connected account before this runs, and the intent id is the record's
   * natural idempotency key — a second call for the same intent returns the
   * existing row and writes nothing.
   *
   * `assertDirectSplitInvariants` runs before the write and is the enforcement
   * point (see `direct-split-guard.ts` for why it is here and not in a hook).
   */
  async recordDirectSplit(
    input: RecordDirectSplitInput,
    intent: DirectChargeIntentShape,
    flow: DirectSplitFlowTrace
  ): Promise<DonationSplitRecordRow> {
    assertDirectSplitInvariants({ record: input, intent, flow })

    const existing = await this.getDirectSplitByIntentId(input.stripe_payment_intent_id)
    if (existing) {
      if (existing.stripe_account_id !== input.stripe_account_id) {
        throw new DirectSplitViolationError(
          "account_mismatch",
          "an existing record for this intent names a different connected account.",
          { stripe_payment_intent_id: input.stripe_payment_intent_id }
        )
      }
      return existing
    }

    const created = await this.createDonationSplitRecords({
      stripe_payment_intent_id: input.stripe_payment_intent_id,
      stripe_account_id: input.stripe_account_id,
      org_key: input.org_key,
      campaign_id: input.campaign_id ?? null,
      kind: input.kind as DonationSplitKind,
      currency_code: input.currency_code ?? "usd",
      gross_cents: input.gross_cents,
      bmc_fee_cents: 0,
      processor_fee_cents: input.processor_fee_cents ?? null,
      recipient_org_type: input.recipient_org_type,
      recipient_verification_status: input.recipient_verification_status,
      recipient_verified_as_of: input.recipient_verified_as_of,
      recipient_snapshot_at: input.recipient_snapshot_at,
      status: input.status ?? "created",
      customer_id: input.customer_id ?? null,
      metadata: input.metadata ?? null,
    })
    return Array.isArray(created) ? created[0] : created
  }

  /**
   * Apply what the processor said about an intent on a connected account.
   * Idempotent by intent id: a re-delivered webhook lands on the same row and
   * the status function is monotone, so the second delivery is "unchanged".
   *
   * The event's `account` must match the record's; a mismatch is a violation,
   * not a correction — Stripe's statement of which account an intent lives on
   * is exactly the fact this ledger exists to record.
   */
  async applyDirectSplitProcessorEvent(
    input: ApplyDirectSplitProcessorEventInput
  ): Promise<ApplyDirectSplitProcessorEventResult> {
    const existing = await this.getDirectSplitByIntentId(input.stripe_payment_intent_id)

    if (!existing) {
      if (!input.fallback) return { outcome: "ignored_unknown_intent" }
      const record = await this.recordDirectSplit(
        {
          ...input.fallback,
          stripe_payment_intent_id: input.stripe_payment_intent_id,
          stripe_account_id: input.stripe_account_id,
          processor_fee_cents: input.processor_fee_cents ?? input.fallback.processor_fee_cents ?? null,
          status: PROCESSOR_EVENT_STATUS[input.event],
        },
        input.intent,
        input.flow
      )
      return { outcome: "created", record }
    }

    const shape: DirectSplitRecordShape = {
      stripe_payment_intent_id: existing.stripe_payment_intent_id,
      stripe_account_id: input.stripe_account_id,
      org_key: existing.org_key,
      kind: existing.kind,
      gross_cents: Number(existing.gross_cents),
      bmc_fee_cents: Number(existing.bmc_fee_cents),
      recipient_org_type: (existing.recipient_org_type ?? null) as DirectSplitRecordShape["recipient_org_type"],
      recipient_verification_status: existing.recipient_verification_status as DirectSplitRecordShape["recipient_verification_status"],
      recipient_verified_as_of: existing.recipient_verified_as_of ?? null,
      recipient_snapshot_at: existing.recipient_snapshot_at,
    }
    assertDirectSplitInvariants({ record: shape, intent: input.intent, flow: input.flow })

    if (existing.stripe_account_id !== input.stripe_account_id) {
      throw new DirectSplitViolationError(
        "account_mismatch",
        "the processor event names a different connected account than the record.",
        {
          stripe_payment_intent_id: input.stripe_payment_intent_id,
          record_account: existing.stripe_account_id,
          event_account: input.stripe_account_id,
        }
      )
    }

    // A refund below the gross is partial: record the amount, keep the status
    // (a partially refunded charge still succeeded). No figure, or a figure at
    // or above the gross, is a full refund.
    const gross = Number(existing.gross_cents)
    const refundKnown = typeof input.refunded_cents === "number" && Number.isInteger(input.refunded_cents) && input.refunded_cents >= 0
    const partialRefund = input.event === "refunded" && refundKnown && (input.refunded_cents as number) < gross
    const status = partialRefund
      ? existing.status === "refunded" || existing.status === "succeeded"
        ? existing.status
        : "succeeded"
      : nextStatus(existing.status, input.event)
    const refundedCents =
      input.event !== "refunded" ? null : refundKnown ? Math.min(input.refunded_cents as number, gross) : status === "refunded" ? gross : null
    const refundChanged = refundedCents !== null && refundedCents !== (existing.refunded_cents ?? null)

    const feeKnown = typeof input.processor_fee_cents === "number" && Number.isInteger(input.processor_fee_cents)
    const feeChanged = feeKnown && input.processor_fee_cents !== existing.processor_fee_cents
    if (status === existing.status && !feeChanged && !refundChanged) {
      return { outcome: "unchanged", record: existing }
    }

    const updated = await this.updateDonationSplitRecords({
      id: existing.id,
      status,
      ...(feeChanged ? { processor_fee_cents: input.processor_fee_cents as number } : {}),
      ...(refundChanged ? { refunded_cents: refundedCents as number } : {}),
    })
    return { outcome: "updated", record: Array.isArray(updated) ? updated[0] : updated }
  }
}

export default DonationModuleService
