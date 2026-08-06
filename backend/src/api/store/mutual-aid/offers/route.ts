import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/offers")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../modules/mutual-aid/service"
import { toPublicAid } from "../../../../lib/aid-location"

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  unit_of_measure: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locality: z.string().optional(),
  service_radius_km: z.number().positive().optional(),
  available_until: z.string().datetime().optional(),
})

// GET /store/mutual-aid/offers
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const category = req.query.category as string | undefined

    const offers = await service.listMutualAidOffers({
      status: "AVAILABLE",
      ...(category ? { category } : {}),
    })

    // Offerers are volunteering rather than asking, so the privacy stakes are
    // lower — but the same projection covers both, and encoding the asymmetry
    // would mean two serialisation paths to keep correct.
    res.json({
      offers: offers.map((o) => toPublicAid(o as never)),
      count: offers.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed"
    log.error("[GET /store/mutual-aid/offers] Error:", message)
    res.status(500).json({ error: "Failed to retrieve aid offers" })
  }
}

// POST /store/mutual-aid/offers
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = createSchema.parse(req.body)
    const customerId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const [created] = await service.createMutualAidOffers([
      {
        ...body,
        offerer_id: customerId,
        available_until: body.available_until ? new Date(body.available_until) : null,
      } as never,
    ])

    res.status(201).json({ offer: toPublicAid(created as never) })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = error instanceof Error ? error.message : "Failed"
    log.error("[POST /store/mutual-aid/offers] Error:", message)
    res.status(400).json({ error: message })
  }
}
