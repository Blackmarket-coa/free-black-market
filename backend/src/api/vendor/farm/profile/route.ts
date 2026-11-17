import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PRODUCER_MODULE } from "../../../../modules/producer"
import { daysUntil } from "../../../../shared/expiry"
import { createLogger } from "../../../../shared/logger"
import { getSellerId } from "../../quests/_helpers"
import { storeProducerId } from "../_access"
import { definedFields } from "../../../../shared/defined-fields"

interface ProducerServiceType {
  createProducers: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateProducers: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteProducers: (id: string) => Promise<void>
}

type LinkService = { create: (data: Record<string, unknown>) => Promise<unknown> }

const log = createLogger("api/vendor/farm/profile")

/**
 * Which unique column a create collided on: Medusa maps Postgres's 23505 to
 * "Producer with handle: x, already exists." (or `seller_id: …`), and the
 * raw error names the constraint. `seller_id` means the store already has a
 * profile (two creates racing past the check below); `handle` means another
 * farm uses the address.
 */
const uniqueClash = (error: unknown): "seller_id" | "handle" | "other" | null => {
  const e = error as { code?: string; message?: string; detail?: string; constraint?: string } | null
  const text = `${e?.message ?? ""} ${e?.detail ?? ""} ${e?.constraint ?? ""}`
  if (e?.code !== "23505" && !/already exists|duplicate key/i.test(text)) return null
  if (/seller_id/.test(text)) return "seller_id"
  if (/handle/.test(text)) return "handle"
  return "other"
}

const RECERTIFICATION_NOTICE_DAYS = 30

const parseDateValue = (value: unknown): Date | null => {
  if (!value || typeof value !== "string") {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Exported for test. The 24-hour window in which a lapsed certification used to
 * report itself as still valid had no regression guard, which is how a `ceil`
 * survived here while two other copies of this arithmetic used `floor`.
 */
export const buildRecertificationAlerts = (certifications: unknown): Array<{
  certification_name: string
  valid_until: string
  days_remaining: number
  status: "expired" | "expiring_soon"
}> => {
  if (!Array.isArray(certifications)) {
    return []
  }

  const now = new Date()
  return certifications
    .map((cert) => {
      if (!cert || typeof cert !== "object") {
        return null
      }

      const certRecord = cert as Record<string, unknown>
      const validUntilRaw = certRecord.valid_until
      const validUntilDate = parseDateValue(validUntilRaw)
      if (!validUntilDate || typeof certRecord.name !== "string" || !certRecord.name.trim()) {
        return null
      }

      // `Math.floor`, via the shared convention. This was `Math.ceil`, which
      // mapped every instant in the 24 hours *after* a certification lapsed to
      // `-0` — and `-0 < 0` is false, so a certificate that expired earlier
      // today, or yesterday evening, was reported as
      // `days_remaining: 0, status: "expiring_soon"` rather than expired, for
      // a full day after it stopped being worth anything.
      const daysRemaining = daysUntil(validUntilDate, now)

      if (daysRemaining > RECERTIFICATION_NOTICE_DAYS) {
        return null
      }

      return {
        certification_name: certRecord.name,
        valid_until: validUntilDate.toISOString(),
        days_remaining: daysRemaining,
        status: daysRemaining < 0 ? "expired" as const : "expiring_soon" as const,
      }
    })
    .filter((item): item is { certification_name: string; valid_until: string; days_remaining: number; status: "expired" | "expiring_soon" } => !!item)
}

/**
 * GET /vendor/farm/profile
 * The store's farm profile: the producer whose `seller_id` is the store, so
 * every member of the store sees the same one. This read the seller-producer
 * link under an alias that does not exist (`producer_seller`) and answered 500
 * every time (SD-145, measured on Postgres).
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const sellerId = await getSellerId(req)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const producerId = await storeProducerId(req, sellerId)
    if (!producerId) {
      // No producer profile yet
      return res.json({ producer: null })
    }

    const { data: producers } = await query.graph({
      entity: "producer",
      fields: ["*"],
      filters: { id: producerId },
    })
    const producer = producers?.[0] as { certifications?: unknown } | undefined
    const recertification_alerts = buildRecertificationAlerts(producer?.certifications)

    res.json({ producer, recertification_alerts })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to fetch farm profile", 
      error: error.message 
    })
  }
}

/**
 * POST /vendor/farm/profile
 * Create the store's farm profile: a producer owned by the store, linked to it.
 *
 * It created the producer without the store (`seller_id` is required, so the
 * insert failed: 500), and then linked it with a shape Medusa's Link cannot
 * read (`{ producer_seller: ... }` throws a TypeError, measured). Had the
 * insert worked, every attempt would have left a producer with no store link,
 * listed by GET /store/producers (it lists every public producer), and the
 * panel's retry would have collided with the first one's handle. The producer
 * is now the store's (`seller_id`), created not public, linked by module key,
 * and made public only once linked; if the link cannot be made it is removed
 * again, and if even that fails the answer says so (the producer stays
 * unlinked and not public, listed nowhere). A store that already has a
 * profile gets 409, as does a handle another farm uses, each with its own
 * message, including when two creates race past the check.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const producerService = req.scope.resolve<ProducerServiceType>(PRODUCER_MODULE)
  const link = req.scope.resolve<LinkService>(ContainerRegistrationKeys.LINK)
  const sellerId = await getSellerId(req)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  if (await storeProducerId(req, sellerId)) {
    return res.status(409).json({ message: "This store already has a farm profile" })
  }

  const {
    name,
    handle,
    description,
    region,
    state,
    country_code,
    farm_size_acres,
    year_established,
    practices,
    certifications,
    story,
    website,
    photo,
    cover_image,
  } = req.body as Record<string, unknown>

  let producer: { id: string }
  try {
    producer = await producerService.createProducers({
      seller_id: sellerId,
      name,
      handle,
      description,
      region,
      state,
      country_code,
      farm_size_acres,
      year_established,
      practices,
      certifications,
      story,
      website,
      photo,
      cover_image,
      // Not public until it is linked to the store: GET /store/producers
      // lists every public producer, so one left behind by a failure below
      // would be listed with no store behind it.
      public_profile_enabled: false,
    })
  } catch (error) {
    const clash = uniqueClash(error)
    if (clash === "seller_id") {
      return res.status(409).json({ message: "This store already has a farm profile" })
    }
    if (clash === "handle") {
      return res.status(409).json({ message: "That farm handle is already taken" })
    }
    return res.status(clash ? 409 : 500).json({
      message: clash ? "A farm profile with these details already exists" : "Failed to create farm profile",
      error: (error as Error).message,
    })
  }

  try {
    await link.create({
      [SELLER_MODULE]: { seller_id: sellerId },
      [PRODUCER_MODULE]: { producer_id: producer.id },
    })
  } catch (linkError) {
    // Nothing is left behind: a producer without its store link would block
    // the retry on its handle.
    try {
      await producerService.deleteProducers(producer.id)
    } catch (undoError) {
      // Said plainly rather than as a bare 500: the producer stays, unlinked,
      // and (created not public) is listed nowhere.
      log.error(
        `[farm/profile] producer ${producer.id} of store ${sellerId} could not be linked (${(linkError as Error).message}) ` +
          `nor removed (${(undoError as Error).message}); it is left unlinked and not public`
      )
      return res.status(500).json({
        message:
          "Failed to create farm profile. A producer record was left behind, unlinked and not public; contact support to remove it.",
        producer_id: producer.id,
        error: (linkError as Error).message,
        undo_error: (undoError as Error).message,
      })
    }
    return res.status(500).json({
      message: "Failed to create farm profile",
      error: (linkError as Error).message,
    })
  }

  // Linked: the profile is the store's, and now public.
  try {
    producer = await producerService.updateProducers({ id: producer.id, public_profile_enabled: true })
  } catch (error) {
    log.warn(`[farm/profile] producer ${producer.id} of store ${sellerId} is linked but could not be made public: ${(error as Error).message}`)
    return res.status(201).json({
      producer,
      warning: "The farm profile was created but is not public yet; turn on its public profile in the farm settings.",
    })
  }

  res.status(201).json({ producer })
}

/**
 * PUT /vendor/farm/profile
 * Update the producer profile for the current seller
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const producerService = req.scope.resolve<ProducerServiceType>(PRODUCER_MODULE)
  const sellerId = await getSellerId(req)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // The store's own producer: never one named in the request.
    const producerId = await storeProducerId(req, sellerId)
    if (!producerId) {
      return res.status(404).json({ message: "Farm profile not found" })
    }

    const {
      name,
      handle,
      description,
      region,
      state,
      country_code,
      farm_size_acres,
      year_established,
      practices,
      certifications,
      story,
      website,
      photo,
      cover_image,
      public_profile_enabled,
    } = req.body as Record<string, unknown>

    // Only the fields given (`shared/defined-fields.ts`): an omitted one,
    // passed as undefined, made every partial update a 500.
    const producer = await producerService.updateProducers({
      id: producerId,
      ...definedFields({
        name,
        handle,
        description,
        region,
        state,
        country_code,
        farm_size_acres,
        year_established,
        practices,
        certifications,
        story,
        website,
        photo,
        cover_image,
        public_profile_enabled,
      }),
    })

    res.json({ producer })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to update farm profile", 
      error: error.message 
    })
  }
}
