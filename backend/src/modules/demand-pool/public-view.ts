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
