import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCER_MODULE } from "../../../modules/producer"
import { forbidden } from "../../../shared/community-read-access"
import { getSellerId } from "../quests/_helpers"

/**
 * Who may touch which farm record: one store's farm profile (a `producer`),
 * its harvests (`harvest.producer_id`) and their lots (`lot.harvest_id`).
 *
 * The farm routes found the caller's producer by querying the seller-producer
 * link as `producer_seller`. No such alias exists (the link's entry point is
 * `seller_producer`), so every farm route answered 500 before reaching its
 * own logic, measured on Postgres; and the lot routes, had they got further,
 * checked only that the caller had some farm profile, not that the lot was
 * its own, so any store with a profile could edit or delete another's lots.
 *
 * The store's producer is the one whose `seller_id` is the store: the column
 * is NOT NULL and unique, and both writers set it (POST /vendor/farm/profile
 * and the v1 launch flow, which links nothing). A record that is missing and
 * a record of another farm get the same answer, `forbidden()`: 403, never 404,
 * so the status says nothing about which ids exist.
 */

type QueryGraph = {
  graph: (args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> }>
}

type ProducerLister = {
  listProducers: (filters: Record<string, unknown>, config?: Record<string, unknown>) => Promise<Array<{ id: string }>>
}

type Res = Pick<MedusaResponse, "status">

export type FarmCaller = { sellerId: string; producerId: string }

/** The store's farm profile (its producer's id), or null when it has none. */
export async function storeProducerId(req: MedusaRequest, sellerId: string): Promise<string | null> {
  const producers = req.scope.resolve<ProducerLister>(PRODUCER_MODULE)
  const [producer] = await producers.listProducers({ seller_id: sellerId }, { take: 1, select: ["id"] })
  return producer?.id ?? null
}

/**
 * The caller's store and its farm profile. Without a store the answer is 401;
 * without a profile it is `noProfile` (403 "No farm profile found" unless the
 * route says otherwise). Null means the answer was sent.
 */
export async function farmCaller(
  req: MedusaRequest,
  res: Res,
  noProfile: { status: number; message: string } = { status: 403, message: "No farm profile found" }
): Promise<FarmCaller | null> {
  const sellerId = await getSellerId(req)
  if (!sellerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }
  const producerId = await storeProducerId(req, sellerId)
  if (!producerId) {
    res.status(noProfile.status).json({ message: noProfile.message })
    return null
  }
  return { sellerId, producerId }
}

export type OwnedHarvest = { id: string; producer_id: string }

/** A harvest of the caller's farm, or `forbidden()` for one that is missing or another farm's. */
export async function ownedHarvest(
  req: MedusaRequest,
  res: Res,
  harvestId: string
): Promise<{ caller: FarmCaller; harvest: OwnedHarvest } | null> {
  const caller = await farmCaller(req, res)
  if (!caller) return null
  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "harvest",
    fields: ["id", "producer_id"],
    filters: { id: harvestId },
  })
  const harvest = data?.[0] as OwnedHarvest | undefined
  if (!harvest || harvest.producer_id !== caller.producerId) {
    forbidden(res)
    return null
  }
  return { caller, harvest }
}

export type OwnedLot = { id: string; harvest_id: string }

/**
 * A lot of the caller's farm, through its harvest, or `forbidden()` for one
 * that is missing or another farm's.
 */
export async function ownedLot(
  req: MedusaRequest,
  res: Res,
  lotId: string
): Promise<{ caller: FarmCaller; lot: OwnedLot; harvest: OwnedHarvest } | null> {
  const caller = await farmCaller(req, res)
  if (!caller) return null
  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data: lots } = await query.graph({
    entity: "lot",
    fields: ["id", "harvest_id"],
    filters: { id: lotId },
  })
  const lot = lots?.[0] as OwnedLot | undefined
  if (!lot) {
    forbidden(res)
    return null
  }
  const { data: harvests } = await query.graph({
    entity: "harvest",
    fields: ["id", "producer_id"],
    filters: { id: lot.harvest_id },
  })
  const harvest = harvests?.[0] as OwnedHarvest | undefined
  if (!harvest || harvest.producer_id !== caller.producerId) {
    forbidden(res)
    return null
  }
  return { caller, lot, harvest }
}

/**
 * Each harvest's lots, by harvest id.
 *
 * The agriculture models define no relations (`lot.harvest_id` and
 * `harvest.producer_id` are plain columns), so asking query.graph for
 * `harvest.lots.*` or `lot.harvest.*` is refused ("Entity 'Harvest' does not
 * have property 'lots'", measured). Read the lots on their own instead.
 */
export async function lotsByHarvest(
  req: MedusaRequest,
  harvestIds: string[]
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const byHarvest = new Map<string, Array<Record<string, unknown>>>()
  if (!harvestIds.length) return byHarvest
  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "lot", fields: ["*"], filters: { harvest_id: harvestIds } })
  for (const lot of data ?? []) {
    const harvestId = String(lot.harvest_id)
    byHarvest.set(harvestId, [...(byHarvest.get(harvestId) ?? []), lot])
  }
  return byHarvest
}

/** What a farm DELETE answers: Medusa's deletion body, which the panel's SDK parses. */
export function deletedBody(object: "lot" | "harvest", id: string): { id: string; object: string; deleted: true } {
  return { id, object, deleted: true }
}
