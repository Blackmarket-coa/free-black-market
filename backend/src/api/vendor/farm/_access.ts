import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { z } from "zod"
import { AGRICULTURE_MODULE } from "../../../modules/agriculture"
import { PRODUCER_MODULE } from "../../../modules/producer"
import { forbidden } from "../../../shared/community-read-access"
import { createLogger } from "../../../shared/logger"
import { getSellerId } from "../quests/_helpers"

const log = createLogger("api/vendor/farm")

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

/**
 * One record id, from a path or a body: a non-empty string.
 *
 * The farm routes check ownership with query.graph filters, and a filter
 * given an array reads it as IN. So `product_id: [the store's, another
 * store's]` passed link-product's seller_product check, and the write after it
 * failed with the SQL INSERT in its 500 (SD-145 review, measured); a DELETE
 * with an array `availability_window_id` failed the same way. Every farm route
 * that takes an id parses it with this before any check, and refuses anything
 * else with 400.
 */
export const farmId = z.string().min(1).max(200)

/** An id that may be left out; null and "" mean left out, as the routes always read them. */
export const optionalFarmId = z.preprocess((value) => (value === null || value === "" ? undefined : value), farmId.optional())

/**
 * Parse a farm route's ids (`req.params` or `req.body`) with `shape`, before
 * any check. Anything but one id per field answers 400, naming the fields and
 * never echoing what was sent. Null means the answer was sent.
 */
export function farmIds<S extends z.ZodRawShape>(res: Res, input: unknown, shape: S): z.output<z.ZodObject<S>> | null {
  const given = (input ?? {}) as Record<string, unknown>
  const parsed = z.object(shape).safeParse(given)
  if (parsed.success) return parsed.data
  const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")))]
  const message = fields.includes("")
    ? "The request body must be an object"
    : fields.map((field) => (given[field] === undefined ? `${field} is required` : `${field} must be one id`)).join("; ")
  res.status(400).json({ message, type: "invalid_data" })
  return null
}

/**
 * A farm route's 500: what failed, and never the error's own text, which can
 * carry the SQL of the statement that failed (link-product's did). The error
 * is logged instead. The production error sanitizer does not cover this: it
 * rewrites only errors that reach Medusa's error handler, and a route that
 * answers its own 500 never does, in any environment.
 */
export function farmFailure(req: MedusaRequest, res: Res, message: string, error: unknown): void {
  log.error(`${req.method ?? ""} ${req.originalUrl ?? req.url ?? ""}: ${message}`, error)
  res.status(500).json({ message })
}

export type FarmCaller = { sellerId: string; producerId: string }

/**
 * Whether the store's seller-producer link names this producer. POST
 * /vendor/farm/profile makes it; a producer can lack it when that create's
 * undo failed, and the v1 launch flow makes producers without it.
 */
export async function storeLinkedToProducer(req: MedusaRequest, sellerId: string, producerId: string): Promise<boolean> {
  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "seller_producer",
    fields: ["producer_id"],
    filters: { seller_id: sellerId, producer_id: producerId },
  })
  return (data ?? []).length > 0
}

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

type LinkDismisser = { dismiss: (links: Record<string, unknown> | Array<Record<string, unknown>>) => Promise<unknown> }

/**
 * Dismiss the link rows a delete would leave behind.
 *
 * Deleting a harvest deletes its lots, and deleting a lot deletes its
 * availability windows, in the database itself (`lot_harvest_fk` and
 * `availability_window_lot_fk` are ON DELETE CASCADE; measured in review).
 * The producer-harvest and product-window link rows live in their own tables
 * and are not touched by that, so they are dismissed first: none is left
 * naming a record that is gone.
 *
 * Not atomic, and recorded as such (SD-145 review): the links are dismissed
 * in the link module's transaction and the record is deleted after it, in
 * the agriculture module's. If that delete fails, the record stays and its
 * link rows are gone. The order is the safer of the two (the other leaves
 * links naming a deleted record), and nothing reads these link rows today:
 * a window carries its `product_id` and a harvest its `producer_id`. Making
 * the pair atomic takes a workflow whose steps compensate (the dismiss
 * restored when the delete fails), which this is not.
 */
export async function dismissLinksBeforeDelete(
  req: MedusaRequest,
  scope: { harvest?: OwnedHarvest; lotIds: string[] }
): Promise<void> {
  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve<LinkDismisser>(ContainerRegistrationKeys.LINK)
  if (scope.lotIds.length) {
    const { data: windows } = await query.graph({
      entity: "availability_window",
      fields: ["id", "product_id"],
      filters: { lot_id: scope.lotIds },
    })
    const productLinks = (windows ?? [])
      .filter((w) => typeof w.product_id === "string" && w.product_id)
      .map((w) => ({
        [Modules.PRODUCT]: { product_id: String(w.product_id) },
        [AGRICULTURE_MODULE]: { availability_window_id: String(w.id) },
      }))
    if (productLinks.length) await link.dismiss(productLinks)
  }
  if (scope.harvest) {
    await link.dismiss({
      [PRODUCER_MODULE]: { producer_id: scope.harvest.producer_id },
      [AGRICULTURE_MODULE]: { harvest_id: scope.harvest.id },
    })
  }
}

/** What a farm DELETE answers: Medusa's deletion body, which the panel's SDK parses. */
export function deletedBody(object: "lot" | "harvest", id: string): { id: string; object: string; deleted: true } {
  return { id, object, deleted: true }
}
