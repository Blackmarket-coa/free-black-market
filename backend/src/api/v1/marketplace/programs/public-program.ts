import {
  CreatorProgramStatus,
  CreatorProgramType,
} from "../../../../modules/creator-program/models"

/**
 * What an anonymous caller may read of a creator program.
 *
 * `/v1/marketplace/programs` is public discovery: it sits outside /store,
 * /admin and /vendor and nothing authenticates it. The list always projected
 * these fields and only these program types. The detail route returned the
 * whole row of any program that was not a draft, to anyone holding its id:
 * an invite-only program's brief, the vendor's budget cap and what it has
 * spent, the hold period, the referral splits and the free-form metadata
 * (seen on Postgres). Both routes now serve this one projection of the one
 * set of types, so the detail can never show more than the list would.
 */
export const PUBLIC_PROGRAM_TYPES: readonly string[] = [
  CreatorProgramType.AFFILIATE_OPEN,
  CreatorProgramType.ENGAGEMENT_POOL,
  CreatorProgramType.COMMISSION_BOOST,
]

export type PublicProgramSource = {
  id: string
  vendor_id: string
  title: string
  slug: string
  description?: string | null
  program_type: string
  status?: string | null
  commission_percent?: unknown
  commission_flat_cents?: unknown
  sponsorship_flat_cents?: unknown
  pool_total_cents?: unknown
  pool_period?: string | null
  cookie_window_days?: unknown
  currency_code?: string | null
  starts_at?: unknown
  ends_at?: unknown
  requires_kyc?: boolean | null
  min_followers?: unknown
  product_ids?: unknown
}

/** A program of a type the public may discover, past draft. */
export function isPubliclyReadableProgram(
  program: Pick<PublicProgramSource, "program_type" | "status"> | null | undefined
): boolean {
  return (
    !!program &&
    program.status !== CreatorProgramStatus.DRAFT &&
    PUBLIC_PROGRAM_TYPES.includes(program.program_type)
  )
}

export function toPublicProgram(p: PublicProgramSource) {
  return {
    id: p.id,
    vendor_id: p.vendor_id,
    title: p.title,
    slug: p.slug,
    description: p.description,
    program_type: p.program_type,
    commission_percent: p.commission_percent,
    commission_flat_cents: p.commission_flat_cents,
    sponsorship_flat_cents: p.sponsorship_flat_cents,
    pool_total_cents: p.pool_total_cents,
    pool_period: p.pool_period,
    cookie_window_days: p.cookie_window_days,
    currency_code: p.currency_code,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    requires_kyc: p.requires_kyc,
    min_followers: p.min_followers,
    product_ids: p.product_ids ?? [],
  }
}
