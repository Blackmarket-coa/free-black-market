import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { daysUntil } from "../../../../shared/expiry"

interface ProducerServiceType {
  createProducers: (data: Record<string, unknown>) => Promise<{ id: string }>
  updateProducers: (data: Record<string, unknown>) => Promise<{ id: string }>
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
 * Get the producer profile for the current seller
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Check if producer exists for this seller via producer_seller link
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer.*"],
      filters: {
        seller_id: sellerId
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      // No producer profile yet
      return res.json({ producer: null })
    }

    const producer = producerLinks[0]?.producer
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
 * Create a new producer profile for the current seller
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const producerService = req.scope.resolve("producer") as ProducerServiceType
  const linkService = req.scope.resolve("link") as unknown as { create: (data: Record<string, unknown>) => Promise<unknown[]> }
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
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

    // Create the producer
    const producer = await producerService.createProducers({
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
      public_profile_enabled: true,
    })

    // Link producer to seller
    await linkService.create({
      producer_seller: {
        producer_id: producer.id,
        seller_id: sellerId,
      }
    })

    res.status(201).json({ producer })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to create farm profile", 
      error: error.message 
    })
  }
}

/**
 * PUT /vendor/farm/profile
 * Update the producer profile for the current seller
 */
export async function PUT(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const producerService = req.scope.resolve("producer") as ProducerServiceType
  const sellerId = (req as unknown as { auth_context?: { actor_id: string } }).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // Get existing producer
    const { data: producerLinks } = await query.graph({
      entity: "producer_seller",
      fields: ["producer_id"],
      filters: {
        seller_id: sellerId
      },
    })

    if (!producerLinks || producerLinks.length === 0) {
      return res.status(404).json({ message: "Farm profile not found" })
    }

    const producerId = producerLinks[0].producer_id

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

    // Update the producer
    const producer = await producerService.updateProducers({
      id: producerId,
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
    })

    res.json({ producer })
  } catch (error) {
    res.status(500).json({ 
      message: "Failed to update farm profile", 
      error: error.message 
    })
  }
}
