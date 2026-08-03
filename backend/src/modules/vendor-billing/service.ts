import { MedusaService } from "@medusajs/framework/utils"
import { VendorCharge } from "./models"
import {
  VendorChargeKind,
  VendorChargeStatus,
  canTransition,
  chargeIdempotencyKey,
  outstandingBalance,
} from "./charges"

export type CreateChargeInput = {
  seller_id: string
  kind: VendorChargeKind
  /** Minor units. */
  amount: number
  currency_code?: string
  description: string
  /** Whatever makes this charge unique — a period, a plan code, a tier. */
  discriminator: string
  period_start?: Date | null
  period_end?: Date | null
  metadata?: Record<string, unknown> | null
}

export type ChargeRecord = {
  id: string
  seller_id: string
  kind: string
  status: string
  amount: number
  currency_code: string
  description: string
  idempotency_key: string
  stripe_payment_intent_id: string | null
  failure_reason: string | null
  paid_at: Date | null
  period_start: Date | null
  period_end: Date | null
}

class VendorBillingService extends MedusaService({
  VendorCharge,
}) {
  /**
   * Record a charge, or return the one already recorded.
   *
   * Idempotent by construction: the key is derived from what the charge *is*
   * rather than generated, so a replayed webhook or a re-fired cron produces
   * the same key and finds the existing row. Checked before insert and, more
   * importantly, backed by a unique index — the check alone loses a race
   * between two concurrent renewals, the index does not.
   *
   * `replayed` tells the caller which happened, so a retry does not re-run the
   * side effects it already performed.
   */
  async createCharge(
    input: CreateChargeInput
  ): Promise<{ charge: ChargeRecord; replayed: boolean }> {
    const idempotency_key = chargeIdempotencyKey({
      kind: input.kind,
      sellerId: input.seller_id,
      discriminator: input.discriminator,
    })

    const existing = (await this.listVendorCharges({
      idempotency_key,
    })) as unknown as ChargeRecord[]
    if (existing?.length) {
      return { charge: existing[0], replayed: true }
    }

    try {
      const created = await this.createVendorCharges({
        seller_id: input.seller_id,
        kind: input.kind,
        status: VendorChargeStatus.PENDING,
        amount: Math.max(0, Math.round(input.amount)),
        currency_code: (input.currency_code ?? "usd").toLowerCase(),
        description: input.description,
        idempotency_key,
        period_start: input.period_start ?? null,
        period_end: input.period_end ?? null,
        metadata: input.metadata ?? null,
      })
      const charge = (Array.isArray(created) ? created[0] : created) as unknown as ChargeRecord
      return { charge, replayed: false }
    } catch (err) {
      // A 23505 here means a concurrent caller inserted the same logical
      // charge between the read above and this write. That is a replay, not a
      // failure — re-read and return theirs rather than surfacing a duplicate
      // key error to a billing path.
      if (!isUniqueViolation(err)) throw err

      const raced = (await this.listVendorCharges({
        idempotency_key,
      })) as unknown as ChargeRecord[]
      if (raced?.length) return { charge: raced[0], replayed: true }
      throw err
    }
  }

  /**
   * Move a charge's status, refusing moves the state machine does not allow.
   *
   * Returns null when the move is illegal rather than throwing: webhooks
   * arrive out of order, and a `processing` event landing after the `paid`
   * event it preceded is normal traffic, not an error worth failing on.
   */
  async transitionCharge(
    id: string,
    to: VendorChargeStatus,
    fields: {
      stripe_payment_intent_id?: string | null
      failure_reason?: string | null
    } = {}
  ): Promise<ChargeRecord | null> {
    const rows = (await this.listVendorCharges({ id })) as unknown as ChargeRecord[]
    const charge = rows?.[0]
    if (!charge) return null

    if (!canTransition(charge.status as VendorChargeStatus, to)) {
      return null
    }

    const updates: Record<string, unknown> = { id, status: to }
    if (fields.stripe_payment_intent_id !== undefined) {
      updates.stripe_payment_intent_id = fields.stripe_payment_intent_id
    }
    if (fields.failure_reason !== undefined) {
      updates.failure_reason = fields.failure_reason
    }
    if (to === VendorChargeStatus.PAID) {
      updates.paid_at = new Date()
      // Clear a prior failure so a retried-then-paid charge does not read as
      // both paid and failed to anyone looking at the row.
      updates.failure_reason = null
    }

    await this.updateVendorCharges(updates)
    const refreshed = (await this.listVendorCharges({ id })) as unknown as ChargeRecord[]
    return refreshed?.[0] ?? null
  }

  /** Find the charge a Stripe webhook is talking about. */
  async findByPaymentIntent(
    paymentIntentId: string
  ): Promise<ChargeRecord | null> {
    const rows = (await this.listVendorCharges({
      stripe_payment_intent_id: paymentIntentId,
    })) as unknown as ChargeRecord[]
    return rows?.[0] ?? null
  }

  async listForSeller(
    seller_id: string,
    filters: { status?: VendorChargeStatus[] } = {}
  ): Promise<ChargeRecord[]> {
    const where: Record<string, unknown> = { seller_id }
    if (filters.status?.length) where.status = filters.status
    return (await this.listVendorCharges(where, {
      order: { created_at: "DESC" },
    })) as unknown as ChargeRecord[]
  }

  /** What this vendor currently owes, in minor units. */
  async getOutstandingBalance(
    seller_id: string
  ): Promise<{ amount: number; currency_code: string | null }> {
    const charges = await this.listForSeller(seller_id)
    return outstandingBalance(
      charges.map((c) => ({
        amount: c.amount,
        currency_code: c.currency_code,
        status: c.status,
      }))
    )
  }
}

/** Postgres unique-violation. Matches the check in `vendor-plan/service.ts`. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === "23505") return true
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("23505") || message.includes("duplicate key")
}

export default VendorBillingService
