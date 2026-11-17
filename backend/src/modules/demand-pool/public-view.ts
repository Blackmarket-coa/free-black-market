/**
 * What a stranger may see of a demand post (SD-118).
 *
 * `GET /store/collective/demand-pools` and `/:id` need no customer, and
 * returned the `demand_post` row as stored: the account that created it
 * (`creator_id`), the address it is to be delivered to (`delivery_address`,
 * whatever the creator typed in: a home, for a household group buy), the
 * ledger account holding its escrow, the supplier chosen and the price agreed
 * with them. The detail route added every participant's row (their customer
 * id and commitment), every supplier's proposal and every bounty.
 *
 * The storefront reads the title, description, category, the quantities, the
 * unit, the status and the three counts, and never sends an address. So this
 * is an allow-list of what describes the buy to someone deciding whether to
 * join or supply it, and the creator still gets their whole row.
 *
 * An allow-list, not a deny-list: a column added to `demand_post` tomorrow is
 * private until it is added here.
 */
const PUBLIC_DEMAND_POST_FIELDS = [
  "id",
  "title",
  "description",
  "category",
  "specs",
  "target_quantity",
  "min_quantity",
  "committed_quantity",
  "unit_of_measure",
  "target_price",
  "currency_code",
  // The region a supplier must be able to deliver to, as the creator named
  // it ("Chicago South Side"); the address itself is not published.
  "delivery_region",
  "delivery_window_start",
  "delivery_window_end",
  "deadline",
  "deadline_type",
  "status",
  "visibility",
  "total_bounty_amount",
  "attractiveness_score",
  "cooperative_id",
  "product_id",
  "created_at",
  "updated_at",
] as const

export function publicDemandPostView(post: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PUBLIC_DEMAND_POST_FIELDS) {
    if (field in post) out[field] = post[field]
  }
  return out
}

/** `publicDemandPostView` over a list. */
export function publicDemandPostViewAll(posts: readonly Record<string, unknown>[]): Array<Record<string, unknown>> {
  return (posts ?? []).map((post) => publicDemandPostView(post))
}

type Counted = { list?: unknown } & Record<string, unknown>

/**
 * The detail route's answer for someone who is not the creator: the public
 * view of the post, and the counts of its participants, proposals and
 * bounties without the rows behind them.
 */
export function publicDemandPoolDetails(details: Record<string, unknown>): Record<string, unknown> {
  const counts = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== "object") return undefined
    const { list: _rows, ...rest } = value as Counted
    return rest
  }
  return {
    ...publicDemandPostView(details),
    participants: counts(details.participants),
    proposals: counts(details.proposals),
    bounties: counts(details.bounties),
  }
}

/**
 * What a pool's rows say to someone who is neither the pool's creator nor
 * on the row (SD-118 follow-up).
 *
 * `GET /store/collective/demand-pools/:id/proposals`, `/bounties` and
 * `/barter` need no customer, and returned their rows as stored, for any
 * pool whatever its visibility (measured on Postgres): a supplier's notes,
 * payment terms, compliance notes, counter-offer and metadata; the customer
 * who put up a bounty, the one who claimed it and the escrow entry holding
 * it; the customer who offered a trade, the creator who accepted it and the
 * ledger entry recording it. The detail route had stopped serving those
 * rows to strangers, so these were the way round it.
 *
 * Each list below is what describes the offer to someone deciding whether
 * to vote, claim or trade: the price and quantities a supplier offers, what
 * a bounty pays and for what, what a trade offers and wants. Allow-lists,
 * so a column added tomorrow is private until it is named here. Nothing
 * here names a person, a note, a term of payment, a ledger entry or
 * metadata.
 */
const PUBLIC_SUPPLIER_PROPOSAL_FIELDS = [
  "id",
  "demand_post_id",
  "status",
  "unit_price",
  "currency_code",
  "min_quantity",
  "max_quantity",
  "volume_tiers",
  "fulfillment_timeline_days",
  "delivery_method",
  "delivery_cost",
  "certifications",
  "votes_for",
  "votes_against",
  "vote_weight_for",
  "vote_weight_against",
  "submitted_at",
] as const

const PUBLIC_DEMAND_BOUNTY_FIELDS = [
  "id",
  "demand_post_id",
  "objective",
  "amount",
  "currency_code",
  "milestones",
  "milestones_completed",
  "status",
  "visibility",
] as const

/** A bounty's milestones are free JSON; each is cut to the terms it states. */
const PUBLIC_MILESTONE_FIELDS = ["description", "percentage", "condition", "completed"] as const

const PUBLIC_BARTER_PROPOSAL_FIELDS = [
  "id",
  "demand_post_id",
  "offering",
  "wanting",
  "estimated_hours",
  "status",
] as const

function pick(row: object, fields: readonly string[]): Record<string, unknown> {
  const source = row as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (field in source) out[field] = source[field]
  }
  return out
}

/** A supplier's proposal as anyone but the pool's creator reads it. */
export function publicSupplierProposalView(proposal: object): Record<string, unknown> {
  return pick(proposal, PUBLIC_SUPPLIER_PROPOSAL_FIELDS)
}

/** A bounty as anyone but the pool's creator and the bounty's own people reads it. */
export function publicDemandBountyView(bounty: object): Record<string, unknown> {
  const out = pick(bounty, PUBLIC_DEMAND_BOUNTY_FIELDS)
  if ("milestones" in out) {
    out.milestones = Array.isArray(out.milestones)
      ? out.milestones.map((milestone: unknown) =>
          milestone && typeof milestone === "object" ? pick(milestone, PUBLIC_MILESTONE_FIELDS) : null
        )
      : null
  }
  return out
}

/** An offer of a trade as anyone but the pool's creator and its proposer reads it. */
export function publicBarterProposalView(proposal: object): Record<string, unknown> {
  return pick(proposal, PUBLIC_BARTER_PROPOSAL_FIELDS)
}
