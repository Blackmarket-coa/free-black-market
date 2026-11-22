import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { PRODUCER_MODULE } from "../../../../modules/producer"
import { daysUntil } from "../../../../shared/expiry"
import { createLogger } from "../../../../shared/logger"
import { getSellerId } from "../../quests/_helpers"
import { farmFailure, storeLinkedToProducer, storeProducerId } from "../_access"
import { definedFields } from "../../../../shared/defined-fields"

interface ProducerServiceType {
  createProducers: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateProducers: (data: Record<string, unknown>) => Promise<{ id: string }>
  deleteProducers: (id: string) => Promise<void>
}

type LinkService = { create: (data: Record<string, unknown>) => Promise<unknown> }

const log = createLogger("api/vendor/farm/profile")

/**
 * The columns Medusa names when a create breaks a unique constraint.
 *
 * No constraint name reaches the route: Medusa's dbErrorMapper turns
 * Postgres's 23505 into a MedusaError reading
 * "Producer with <column>: <value>, already exists." and keeps neither the
 * constraint nor Postgres's detail. The column comes from that detail
 * (`Key (handle)=(...)`), is an identifier, and stands before the value, so it
 * is read from the message's fixed prefix, never searched for in the whole
 * text: the value is a handle the caller chose, and a taken handle containing
 * "seller_id" read as a second profile (SD-145 review).
 */
const UNIQUE_CLASH = /^Producer with ([a-z_]+(?:, [a-z_]+)*): [\s\S]*, already exists\.$/

/**
 * Which unique column a create collided on, or null for any other error.
 * `seller_id` means the store already has a profile (two creates racing past
 * the check below); `handle` means another farm uses the address (a removed
 * farm's included: the constraint covers soft-deleted rows).
 */
const uniqueClash = (error: unknown): "seller_id" | "handle" | "other" | null => {
  const match = UNIQUE_CLASH.exec(error instanceof Error ? error.message : "")
  if (!match) return null
  if (match[1] === "seller_id") return "seller_id"
  if (match[1] === "handle") return "handle"
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
    farmFailure(req, res, "Failed to fetch farm profile", error)
  }
}

/**
 * POST /vendor/farm/profile
 * Create the store's farm profile: a producer owned by the store, linked to it.
 *
 * It created the producer without the store (`seller_id` is required, so the
 * insert failed: 500), and then linked it with a shape Medusa's Link cannot
 * read (`{ producer_seller: ... }` throws a TypeError, measured). Had the
 * insert worked, every attempt would have left a producer behind, published
 * by GET /store/producers (it lists every public producer) although the
 * create had answered 500, and the panel's retry would have collided with the
 * first one's handle. The producer is now the store's (`seller_id`), created
 * not public, linked by module key, and made public only once linked; if the
 * link cannot be made it is removed again, and if even that fails the answer
 * says so (the producer stays unlinked and not public, listed nowhere, until
 * a PUT makes it public, which links it first). A store that already has a
 * profile gets 409, as does a handle another farm uses, each with its own
 * message, including when two creates race past the check. No error's own
 * text is answered: it is logged (`farmFailure`).
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
      // would be published although its create answered 500.
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
    if (clash) {
      return res.status(409).json({ message: "A farm profile with these details already exists" })
    }
    return farmFailure(req, res, "Failed to create farm profile", error)
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
      })
    }
    return farmFailure(req, res, "Failed to create farm profile", linkError)
  }

  // Linked: the profile is the store's, and now public.
  try {
    producer = await producerService.updateProducers({ id: producer.id, public_profile_enabled: true })
  } catch (error) {
    log.warn(`[farm/profile] producer ${producer.id} of store ${sellerId} is linked but could not be made public: ${(error as Error).message}`)
    return res.status(201).json({
      producer,
      // The vendor panel has no control for this and does not read `warning`:
      // it is for a caller of the API.
      warning:
        "The farm profile was created but is not public yet; PUT /vendor/farm/profile with public_profile_enabled: true publishes it.",
    })
  }

  res.status(201).json({ producer })
}

/**
 * PUT /vendor/farm/profile
 * Update the producer profile for the current seller.
 *
 * A profile is made public only once it is linked to the store, as POST makes
 * it. A producer whose create failed and whose undo failed too is left
 * unlinked and not public; this made it public anyway and GET
 * /store/producers listed it (SD-145 review). `public_profile_enabled: true`
 * on a producer the store's link does not name now makes that link first,
 * with the call POST makes, and makes it public only if the link was made;
 * otherwise 409 and nothing changes. Linking rather than refusing: the
 * producer is the store's own (`seller_id`), a refusal would leave it
 * unpublishable short of support, and the v1 launch flow makes every
 * producer without the link (public by default), so a refusal would also
 * stop those from being made public again once turned off.
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const producerService = req.scope.resolve<ProducerServiceType>(PRODUCER_MODULE)
  const link = req.scope.resolve<LinkService>(ContainerRegistrationKeys.LINK)
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

    if (public_profile_enabled !== undefined && typeof public_profile_enabled !== "boolean") {
      return res.status(400).json({ message: "public_profile_enabled must be true or false", type: "invalid_data" })
    }
    if (public_profile_enabled === true && !(await storeLinkedToProducer(req, sellerId, producerId))) {
      try {
        await link.create({
          [SELLER_MODULE]: { seller_id: sellerId },
          [PRODUCER_MODULE]: { producer_id: producerId },
        })
      } catch (linkError) {
        log.error(
          `[farm/profile] producer ${producerId} of store ${sellerId} is not linked to it and could not be linked now (${(linkError as Error).message}); it was not made public`
        )
        return res.status(409).json({
          message:
            "This farm profile is not linked to your store yet and could not be linked now, so it was not made public. Try again, or contact support.",
        })
      }
    }

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
    // The error's text is no longer answered, so a taken handle says so.
    if (uniqueClash(error) === "handle") {
      return res.status(409).json({ message: "That farm handle is already taken" })
    }
    farmFailure(req, res, "Failed to update farm profile", error)
  }
}
