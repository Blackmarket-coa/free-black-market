import { MedusaService } from "@medusajs/framework/utils"
import { SellerReferral } from "./models"
import {
  ReferralSource,
  ReferralStatus,
  isReferralEarning,
  isValidAttribution,
  referralExpiryFrom,
} from "./attribution"

export type ReferralRecord = {
  id: string
  referred_seller_id: string
  referrer_seller_id: string
  status: string
  source: string
  attributed_at: Date
  expires_at: Date | null
  metadata: Record<string, unknown> | null
}

export type RecordReferralInput = {
  referred_seller_id: string
  referrer_seller_id: string
  source: ReferralSource
  /** Attribution moment. Defaults to now; injectable for tests and backfills. */
  attributed_at?: Date
  /**
   * Override the earning window's end. Omit for the default window; pass `null`
   * for an operator grant that never lapses on its own.
   */
  expires_at?: Date | null
  metadata?: Record<string, unknown> | null
}

class ReferralService extends MedusaService({
  SellerReferral,
}) {
  /**
   * Record that `referrer` referred `referred`, or return the existing
   * attribution.
   *
   * A seller is referred at most once: the first attribution wins and later
   * ones are replays, never a second referrer. Idempotency is enforced two
   * ways for the same reason `createCharge` does — a pre-check for the common
   * path and the partial-unique index for the race. `created` tells the caller
   * which happened.
   *
   * A self-referral is refused outright rather than recorded and ignored,
   * because the caller supplied bad data and should see it, not have it swallow
   * silently into a row that never pays.
   */
  async recordReferral(
    input: RecordReferralInput
  ): Promise<{ referral: ReferralRecord; created: boolean }> {
    if (
      !isValidAttribution(input.referred_seller_id, input.referrer_seller_id)
    ) {
      throw new Error(
        "invalid referral: a seller cannot be their own referrer and both ids are required"
      )
    }

    const existing = (await this.listSellerReferrals({
      referred_seller_id: input.referred_seller_id,
    })) as unknown as ReferralRecord[]
    if (existing?.length) {
      return { referral: existing[0], created: false }
    }

    const attributedAt = input.attributed_at ?? new Date()
    const expiresAt =
      input.expires_at === undefined
        ? referralExpiryFrom(attributedAt)
        : input.expires_at

    try {
      const created = await this.createSellerReferrals({
        referred_seller_id: input.referred_seller_id,
        referrer_seller_id: input.referrer_seller_id,
        status: ReferralStatus.ACTIVE,
        source: input.source,
        attributed_at: attributedAt,
        expires_at: expiresAt,
        metadata: input.metadata ?? null,
      })
      const referral = (Array.isArray(created) ? created[0] : created) as unknown as ReferralRecord
      return { referral, created: true }
    } catch (err) {
      // A concurrent caller attributed the same seller between the read and
      // this write. That is a replay of the first referral, not a failure.
      if (!isUniqueViolation(err)) throw err
      const raced = (await this.listSellerReferrals({
        referred_seller_id: input.referred_seller_id,
      })) as unknown as ReferralRecord[]
      if (raced?.length) return { referral: raced[0], created: false }
      throw err
    }
  }

  /**
   * The seller currently owed a referral share on `referredSellerId`'s orders,
   * or null.
   *
   * The earning test is applied here in code (`isReferralEarning`) rather than
   * filtered in SQL on `status` alone, so a referral whose window has closed
   * stops paying the instant it lapses — even before the housekeeping job has
   * marked the row `expired`.
   */
  async getActiveReferrer(
    referredSellerId: string,
    now: Date = new Date()
  ): Promise<{ referrer_seller_id: string; referral_id: string } | null> {
    const rows = (await this.listSellerReferrals({
      referred_seller_id: referredSellerId,
    })) as unknown as ReferralRecord[]
    const referral = rows?.[0]
    if (!referral) return null
    if (!isReferralEarning(referral, now)) return null
    return {
      referrer_seller_id: referral.referrer_seller_id,
      referral_id: referral.id,
    }
  }

  /** End a referral early (operator action). Idempotent on an already-ended row. */
  async revokeReferral(referredSellerId: string): Promise<ReferralRecord | null> {
    return this.setStatus(referredSellerId, ReferralStatus.REVOKED)
  }

  /**
   * Mark referrals whose window has closed as `expired`. Housekeeping only —
   * `isReferralEarning` already stops paying a lapsed referral, so this keeps
   * the stored status honest for reporting rather than gating any money.
   * Returns the number of rows flipped.
   */
  async expireLapsedReferrals(now: Date = new Date()): Promise<number> {
    const active = (await this.listSellerReferrals({
      status: ReferralStatus.ACTIVE,
    })) as unknown as ReferralRecord[]

    const lapsed = active.filter(
      (r) =>
        r.expires_at != null &&
        now.getTime() >= new Date(r.expires_at).getTime()
    )
    for (const r of lapsed) {
      await this.updateSellerReferrals({ id: r.id, status: ReferralStatus.EXPIRED })
    }
    return lapsed.length
  }

  private async setStatus(
    referredSellerId: string,
    status: ReferralStatus
  ): Promise<ReferralRecord | null> {
    const rows = (await this.listSellerReferrals({
      referred_seller_id: referredSellerId,
    })) as unknown as ReferralRecord[]
    const referral = rows?.[0]
    if (!referral) return null
    await this.updateSellerReferrals({ id: referral.id, status })
    const refreshed = (await this.listSellerReferrals({
      id: referral.id,
    })) as unknown as ReferralRecord[]
    return refreshed?.[0] ?? null
  }
}

/** Postgres unique-violation. Matches `vendor-billing/service.ts`. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  if (code === "23505") return true
  const message = err instanceof Error ? err.message : String(err)
  return message.includes("23505") || message.includes("duplicate key")
}

export default ReferralService
