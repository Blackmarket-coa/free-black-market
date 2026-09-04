/**
 * Cross-hub allocation — pure, I/O-free.
 *
 * Answers the question a distributed mutual-aid network cannot function
 * without: given what each hub has and what each hub needs, which stock should
 * move where? The existing `agriculture/node-fulfillment` routing splits one
 * order across the growers who own the stock. This is the other problem —
 * rebalancing a network's own inventory between its own hubs, where nobody
 * "owns" the stock and the binding constraints are spoilage and cold chain
 * rather than seller boundaries.
 *
 * Everything here is deterministic: same inputs, same plan, so a suggested
 * transfer list can be reviewed, re-run and diffed.
 */

/** A hub, for distance and cold-chain purposes. */
export interface AllocationNode {
  node_id: string
  latitude?: number | null
  longitude?: number | null
  has_cold_storage?: boolean | null
  /**
   * False means the hub keeps its stock for itself: it may still serve its own
   * demand, but nothing is ever planned out of it to another hub.
   */
  accepts_transfers?: boolean | null
}

/** One lot of stock sitting at a hub. */
export interface SupplyLot {
  stock_id: string
  node_id: string
  /** Shared identity used to match supply to demand across hubs. */
  item_key: string
  quantity: number
  expires_at?: Date | string | null
  requires_cold?: boolean | null
}

/** One hub's need for an item. */
export interface DemandRequest {
  demand_id: string
  node_id: string
  item_key: string
  quantity: number
  needed_by?: Date | string | null
}

export interface AllocationLine {
  demand_id: string
  stock_id: string
  item_key: string
  from_node_id: string
  to_node_id: string
  quantity: number
  /** Null when either hub has no coordinates. */
  distance_km: number | null
  expires_at: string | null
  /** True when the hub is drawing on its own stock; no transfer is needed. */
  is_local: boolean
}

export type UnmetReason =
  | "no_supply"
  | "cold_chain_unavailable"
  | "expires_before_needed"
  | "out_of_range"
  | "transfers_disabled"

export interface UnmetDemand {
  demand_id: string
  node_id: string
  item_key: string
  quantity: number
  /**
   * Why the remainder could not be filled. When several constraints bit, the
   * most specific one is reported — "we have it but cannot keep it cold" is a
   * different problem from "we do not have it", and they get fixed differently.
   */
  reason: UnmetReason
}

export interface AllocationPlan {
  allocations: AllocationLine[]
  unmet: UnmetDemand[]
  /** Stock left over per lot after the plan, for surplus routing. */
  leftover: Array<{ stock_id: string; node_id: string; item_key: string; quantity: number }>
}

export type AllocationStrategy = "local_first" | "expiry_first"

export interface AllocationOptions {
  /**
   * `local_first` (default) fills a hub from its own shelves before moving
   * anything, because a transfer costs handling and adds spoilage risk.
   * `expiry_first` ignores hub boundaries and always burns the soonest-expiring
   * lot in the network — fewer wasted lots, more transport.
   */
  strategy?: AllocationStrategy
  /** Suggest no transfer longer than this. Ignored when either hub lacks coordinates. */
  max_distance_km?: number | null
  /** Evaluation time; lots already expired at this instant are never allocated. */
  now?: Date | string
}

const EARTH_RADIUS_KM = 6371

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Great-circle distance between two hubs in kilometres, or null when either
 * lacks coordinates. Null distances never block an allocation — an unmapped hub
 * should still receive food — they only lose the distance tiebreak.
 */
export function haversineKm(
  a: AllocationNode | null | undefined,
  b: AllocationNode | null | undefined
): number | null {
  if (!a || !b) return null
  const lat1 = a.latitude
  const lon1 = a.longitude
  const lat2 = b.latitude
  const lon2 = b.longitude
  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number"
  ) {
    return null
  }

  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Orders lots first-expired-first-out. A lot with no expiry date has no urgency
 * and sorts last, so dated stock is always burned before undated stock.
 */
export function compareByExpiry(
  a: { expires_at?: Date | string | null },
  b: { expires_at?: Date | string | null }
): number {
  const da = toDate(a.expires_at)
  const db = toDate(b.expires_at)
  if (da && db) return da.getTime() - db.getTime()
  if (da) return -1
  if (db) return 1
  return 0
}

interface Candidate {
  lot: SupplyLot
  remaining: number
  distance_km: number | null
  is_local: boolean
}

/**
 * Builds a transfer plan across hubs.
 *
 * Demands are served in order of urgency (earliest `needed_by` first, undated
 * last, then by `demand_id` for determinism) so that when stock is scarce it
 * goes to whoever needs it soonest rather than to whoever happens to be first
 * in the array.
 */
export function allocateAcrossNodes(
  demands: readonly DemandRequest[],
  supplies: readonly SupplyLot[],
  nodes: readonly AllocationNode[],
  options: AllocationOptions = {}
): AllocationPlan {
  const strategy = options.strategy ?? "local_first"
  const maxDistance = options.max_distance_km ?? null
  const now = toDate(options.now) ?? new Date()

  const nodeById = new Map(nodes.map((n) => [n.node_id, n]))

  // Mutable remaining quantity per lot, so several demands can share a lot.
  const pool: Candidate[] = supplies
    .filter((lot) => Number(lot.quantity) > 0)
    .filter((lot) => {
      const expiry = toDate(lot.expires_at)
      // Already-spoiled stock is not inventory; it never enters the plan.
      return !expiry || expiry > now
    })
    .map((lot) => ({
      lot,
      remaining: Number(lot.quantity),
      distance_km: null,
      is_local: false,
    }))

  const orderedDemands = [...demands]
    .filter((d) => Number(d.quantity) > 0)
    .sort((a, b) => {
      const byUrgency = compareByExpiry(
        { expires_at: a.needed_by },
        { expires_at: b.needed_by }
      )
      if (byUrgency !== 0) return byUrgency
      return a.demand_id.localeCompare(b.demand_id)
    })

  const allocations: AllocationLine[] = []
  const unmet: UnmetDemand[] = []

  for (const demand of orderedDemands) {
    let outstanding = Number(demand.quantity)
    const destination = nodeById.get(demand.node_id)
    const neededBy = toDate(demand.needed_by)

    // Track why candidates were rejected, so an unfilled demand can say which
    // constraint actually bit rather than reporting a bare "no supply".
    let sawColdBlocked = false
    let sawExpiryBlocked = false
    let sawOutOfRange = false
    let sawTransfersDisabled = false

    const candidates: Candidate[] = []
    for (const candidate of pool) {
      if (candidate.lot.item_key !== demand.item_key) continue
      if (candidate.remaining <= 0) continue

      const isLocal = candidate.lot.node_id === demand.node_id
      const origin = nodeById.get(candidate.lot.node_id)

      // A hub that has opted out of transfers still serves its own demand.
      if (!isLocal && origin?.accepts_transfers === false) {
        sawTransfersDisabled = true
        continue
      }

      // A lot that spoils before it is needed cannot serve the demand.
      const expiry = toDate(candidate.lot.expires_at)
      if (neededBy && expiry && expiry < neededBy) {
        sawExpiryBlocked = true
        continue
      }

      // Cold chain: only a hub that can hold it may receive it. A local lot is
      // already being held there, so it is not re-tested.
      if (candidate.lot.requires_cold && !isLocal && destination?.has_cold_storage !== true) {
        sawColdBlocked = true
        continue
      }

      const distance = isLocal ? 0 : haversineKm(origin, destination)

      if (
        !isLocal &&
        maxDistance !== null &&
        distance !== null &&
        distance > maxDistance
      ) {
        sawOutOfRange = true
        continue
      }

      candidates.push({
        ...candidate,
        distance_km: distance,
        is_local: isLocal,
      })
    }

    candidates.sort((a, b) => {
      if (strategy === "local_first" && a.is_local !== b.is_local) {
        return a.is_local ? -1 : 1
      }
      const byExpiry = compareByExpiry(a.lot, b.lot)
      if (byExpiry !== 0) return byExpiry
      // Nearest wins; an unmapped hub loses the tiebreak but stays eligible.
      const da = a.distance_km
      const db = b.distance_km
      if (da !== null && db !== null && da !== db) return da - db
      if (da === null && db !== null) return 1
      if (db === null && da !== null) return -1
      return a.lot.stock_id.localeCompare(b.lot.stock_id)
    })

    for (const candidate of candidates) {
      if (outstanding <= 0) break
      const take = Math.min(outstanding, candidate.remaining)
      if (take <= 0) continue

      allocations.push({
        demand_id: demand.demand_id,
        stock_id: candidate.lot.stock_id,
        item_key: demand.item_key,
        from_node_id: candidate.lot.node_id,
        to_node_id: demand.node_id,
        quantity: take,
        distance_km: candidate.distance_km,
        expires_at: toDate(candidate.lot.expires_at)?.toISOString() ?? null,
        is_local: candidate.is_local,
      })

      outstanding -= take
      // Write the draw back to the shared pool, not the per-demand copy.
      const pooled = pool.find((p) => p.lot.stock_id === candidate.lot.stock_id)
      if (pooled) pooled.remaining -= take
    }

    if (outstanding > 0) {
      unmet.push({
        demand_id: demand.demand_id,
        node_id: demand.node_id,
        item_key: demand.item_key,
        quantity: outstanding,
        reason: sawColdBlocked
          ? "cold_chain_unavailable"
          : sawExpiryBlocked
            ? "expires_before_needed"
            : sawOutOfRange
              ? "out_of_range"
              : sawTransfersDisabled
                ? "transfers_disabled"
                : "no_supply",
      })
    }
  }

  return {
    allocations,
    unmet,
    leftover: pool
      .filter((p) => p.remaining > 0)
      .map((p) => ({
        stock_id: p.lot.stock_id,
        node_id: p.lot.node_id,
        item_key: p.lot.item_key,
        quantity: p.remaining,
      })),
  }
}

/**
 * Surplus that should move before it is wasted: leftover lots that expire
 * within `withinDays`, soonest first. This is the reverse-logistics input —
 * food rescue and gleaning produce stock nobody requested, and the question is
 * not "who asked for it" but "what spoils next".
 */
export function findExpiringSurplus(
  leftover: readonly { stock_id: string; node_id: string; item_key: string; quantity: number }[],
  supplies: readonly SupplyLot[],
  withinDays: number,
  now: Date | string = new Date()
): Array<{
  stock_id: string
  node_id: string
  item_key: string
  quantity: number
  expires_at: string
  days_remaining: number
}> {
  const at = toDate(now) ?? new Date()
  const expiryByStock = new Map(supplies.map((s) => [s.stock_id, toDate(s.expires_at)]))

  return leftover
    .flatMap((lot) => {
      const expiry = expiryByStock.get(lot.stock_id)
      if (!expiry) return []
      const days = (expiry.getTime() - at.getTime()) / 86_400_000
      if (days < 0 || days > withinDays) return []
      return [
        {
          ...lot,
          expires_at: expiry.toISOString(),
          days_remaining: days,
        },
      ]
    })
    .sort((a, b) => a.days_remaining - b.days_remaining)
}
