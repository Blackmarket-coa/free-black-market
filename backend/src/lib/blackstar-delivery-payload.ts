import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "../shared/logger"
import { ORDER_CYCLE_MODULE } from "../modules/order-cycle"
import type OrderCycleModuleService from "../modules/order-cycle/service"
import { geocodePostalCode, MAX_GEOCODE_DRIFT_MILES } from "./blackout-spatial"
import { distanceMiles } from "./geo-distance"
import { zipToCoords } from "./zip3"

const log = createLogger("lib/blackstar-delivery-payload")

/**
 * The `delivery.option.selected` payload FBM sends Blackstar.
 *
 * Beyond the listing basics, Blackstar's receiver
 * (`api/app/Services/FreeBlackMarket/InboundEventProcessor.php`) reads four
 * optional fields off this event that FBM never used to send:
 *
 *   - `origin_latitude` / `origin_longitude` — numbers, stored as
 *     decimal(10,7). With both set, a node that has a location and a service
 *     radius is matched on distance (`ShipmentEligibilityService::
 *     isWithinServiceRadius` via `App\Support\Geo`, miles); without them the
 *     radius is not applied at all.
 *   - `coalition_ref` / `drive_ref` — opaque Blackout coalition and campaign
 *     ids, stored as strings (varchar 255). A listing carrying a
 *     `coalition_ref` is offered only to nodes with an active membership of
 *     that coalition; without one nothing is narrowed.
 *
 * Each of these narrows who may claim the job, so each is sent only when FBM
 * actually knows it and is omitted otherwise — never defaulted, never
 * inferred. A wrong origin hides the job from the nodes near it; a wrong
 * coalition hides it from everyone else.
 */

export interface BlackstarOrigin {
  latitude: number
  longitude: number
}

export interface BlackstarCoalitionRefs {
  coalition_ref: string
  drive_ref?: string
}

/** Blackstar stores both refs in `string` (varchar 255) columns. */
export const BLACKSTAR_REF_MAX_LENGTH = 255

/** Blackstar's origin columns are decimal(10,7). */
const ORIGIN_DECIMALS = 7

/**
 * Coordinates Blackstar can store: finite, on the globe, rounded to the
 * column's seven decimal places. Null for anything else, so a malformed
 * answer is omitted rather than sent.
 */
export function normalizeOrigin(
  latitude: unknown,
  longitude: unknown
): BlackstarOrigin | null {
  if (typeof latitude !== "number" || typeof longitude !== "number") return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  const factor = 10 ** ORIGIN_DECIMALS
  return {
    latitude: Math.round(latitude * factor) / factor,
    longitude: Math.round(longitude * factor) / factor,
  }
}

/** A ref Blackstar can store, or null. */
function normalizeRef(value: unknown): string | null {
  if (typeof value !== "string") return null
  const ref = value.trim()
  if (!ref || ref.length > BLACKSTAR_REF_MAX_LENGTH) return null
  return ref
}

export function buildDeliveryOptionSelectedPayload(input: {
  orderId: string
  fulfillmentNodeId?: string | null
  pickupPointId?: string | null
  vendingMachineId?: string | null
  origin?: BlackstarOrigin | null
  coalition?: BlackstarCoalitionRefs | null
}): Record<string, unknown> {
  // Re-checked here, not only in the resolvers, so no caller can put a value
  // on the wire that Blackstar's columns cannot hold.
  const origin = input.origin
    ? normalizeOrigin(input.origin.latitude, input.origin.longitude)
    : null
  const coalitionRef = normalizeRef(input.coalition?.coalition_ref)
  const driveRef = coalitionRef ? normalizeRef(input.coalition?.drive_ref) : null

  return {
    delivery_option: "federated_delivery_network",
    source_order_ref: input.orderId,
    claim_policy: "first_claim",
    job_type: "delivery",
    fulfillment_node_id: input.fulfillmentNodeId ?? null,
    pickup_point_id: input.pickupPointId ?? null,
    vending_machine_id: input.vendingMachineId ?? null,
    ...(origin
      ? { origin_latitude: origin.latitude, origin_longitude: origin.longitude }
      : {}),
    ...(coalitionRef ? { coalition_ref: coalitionRef } : {}),
    ...(driveRef ? { drive_ref: driveRef } : {}),
  }
}

/** A US ZIP or ZIP+4. */
const US_ZIP = /^(\d{5})(?:-?\d{4})?$/

/**
 * Where a Blackstar fulfillment starts: the stock location it ships from.
 *
 * Resolved from that location's postal code through the same two lookups as
 * `GET /store/geocode`: the ZIP3 centroid table, refined by Blackout's
 * geocoder when `FBM_BLACKOUT_SPATIAL` is on. Both answers are a postal-code
 * centroid, not the building: that is the precision FBM has for a location.
 * Nothing in FBM stores a stock location's coordinates directly.
 *
 * The ZIP3 centroid is the reference. Blackout's answer is used only when it
 * lies within `MAX_GEOCODE_DRIFT_MILES` of it; otherwise the ZIP3 centroid is
 * sent, which is what FBM sends with the geocoder off. A ZIP with no ZIP3
 * entry sends no origin, since there is nothing to check a remote answer
 * against. So turning the geocoder on can only refine an origin, never move
 * it far or add one.
 *
 * US ZIPs only. Both lookups take a bare postal code with no country, so a
 * non-US code would be read as whichever US ZIP shares its digits. A location
 * with no address, no postal code, a non-US country or a malformed ZIP sends
 * no origin.
 */
export async function resolveBlackstarOrigin(
  container: MedusaContainer,
  locationId: string | null | undefined
): Promise<BlackstarOrigin | null> {
  if (!locationId) return null
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as {
      graph: (q: Record<string, unknown>) => Promise<{ data?: any[] }>
    }
    const { data } = await query.graph({
      entity: "stock_location",
      fields: ["id", "address.postal_code", "address.country_code"],
      filters: { id: locationId },
    })
    const address = data?.[0]?.address as
      | { postal_code?: string | null; country_code?: string | null }
      | null
      | undefined
    if (String(address?.country_code ?? "").trim().toLowerCase() !== "us") return null

    const zip = US_ZIP.exec(String(address?.postal_code ?? "").trim())?.[1]
    if (!zip) return null

    const local = zipToCoords(zip)
    if (!local) return null

    const remote = await geocodePostalCode(zip)
    const refined = remote ? normalizeOrigin(remote.latitude, remote.longitude) : null
    if (refined) {
      const drift = distanceMiles(local.lat, local.lng, refined.latitude, refined.longitude)
      if (drift <= MAX_GEOCODE_DRIFT_MILES) return refined
      log.warn(
        `[blackstar-payload] geocoder answer for location ${locationId} is ${Math.round(drift)} mi from its ZIP3 area; sending the ZIP3 centroid`
      )
    }

    return normalizeOrigin(local.lat, local.lng)
  } catch (err) {
    log.warn(
      `[blackstar-payload] origin lookup failed for location ${locationId}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/**
 * The coalition refs for an order that sold through coalition ordering
 * windows, or null.
 *
 * A coalition goods drive's shared window is an order cycle stamped with the
 * Blackout coalition and campaign that opened it
 * (`/v1/integrations/blackout/coalitions/:id/order-cycles`), so
 * `coalition_ref` is the cycle's `blackout_coalition_id` and `drive_ref` its
 * `blackout_campaign_id`.
 *
 * Sent only when every cycle the order sold through names the same
 * coalition. An order that also bought through an ordinary window, or through
 * two coalitions' windows, is not one coalition's drive, and narrowing its
 * delivery to one coalition's nodes would be a guess. `drive_ref` likewise
 * only when every cycle names the same campaign.
 */
export function pickCoalitionRefs(
  cycles: ReadonlyArray<{
    blackout_coalition_id?: string | null
    blackout_campaign_id?: string | null
  }>
): BlackstarCoalitionRefs | null {
  if (cycles.length === 0) return null

  const coalitions = new Set<string | null>(
    cycles.map((c) => normalizeRef(c.blackout_coalition_id))
  )
  if (coalitions.size !== 1) return null
  const [coalitionRef] = coalitions
  if (!coalitionRef) return null

  const campaigns = new Set<string | null>(
    cycles.map((c) => normalizeRef(c.blackout_campaign_id))
  )
  const [driveRef] = campaigns
  return campaigns.size === 1 && driveRef
    ? { coalition_ref: coalitionRef, drive_ref: driveRef }
    : { coalition_ref: coalitionRef }
}

/**
 * Resolve an order's coalition refs from the order-cycle sale ledger.
 *
 * The ledger, not metadata: an `order_cycle_sale` row is written by
 * `recordSale` only for a variant that really is a product of that cycle
 * (`subscribers/order-cycle-order-placed.ts`). Cart and line-item metadata —
 * where the tag the ledger was built from, and the embedded drive checkout's
 * `coalitionId` / `campaignId` echo, both ride — can be written by the buyer
 * through the store cart API, so they are not read here.
 *
 * A sale that names a cycle which no longer resolves makes the answer
 * unknown, and unknown is omitted.
 */
export async function resolveBlackstarCoalitionRefs(
  container: MedusaContainer,
  orderId: string
): Promise<BlackstarCoalitionRefs | null> {
  try {
    const orderCycles = container.resolve<OrderCycleModuleService>(ORDER_CYCLE_MODULE)
    const sales = (await orderCycles.listOrderCycleSales({
      source: "medusa_order",
      source_id: orderId,
    })) as unknown as { order_cycle_id?: string | null }[]

    const cycleIds = [
      ...new Set(
        (sales ?? [])
          .map((s) => s.order_cycle_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      ),
    ]
    if (cycleIds.length === 0) return null

    const cycles = (await orderCycles.listOrderCycles({
      id: cycleIds,
    })) as unknown as {
      id: string
      blackout_coalition_id?: string | null
      blackout_campaign_id?: string | null
    }[]
    if ((cycles ?? []).length !== cycleIds.length) return null

    return pickCoalitionRefs(cycles)
  } catch (err) {
    log.warn(
      `[blackstar-payload] coalition lookup failed for order ${orderId}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}
