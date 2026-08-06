import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/mutual-aid/requests")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MUTUAL_AID_MODULE } from "../../../../modules/mutual-aid"
import type MutualAidModuleService from "../../../../modules/mutual-aid/service"
import { toPublicAid } from "../../../../lib/aid-location"

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  urgency: z.enum(["ROUTINE", "SOON", "URGENT"]).optional(),
  quantity: z.number().int().positive().optional(),
  unit_of_measure: z.string().optional(),
  // Optional on purpose: demanding coordinates from someone asking for help,
  // to make matching tidier, is the wrong trade.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  locality: z.string().optional(),
  needed_by: z.string().datetime().optional(),
})

/**
 * GET /store/mutual-aid/requests — open requests, publicly readable.
 *
 * Every row goes through `toPublicAid`, which whitelists fields and never emits
 * coordinates or the requester's id. A public aid board is the easiest place to
 * leak where vulnerable people live, so the projection is not optional here.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const category = req.query.category as string | undefined

    const requests = await service.listMutualAidRequests({
      status: "OPEN",
      ...(category ? { category } : {}),
    })

    res.json({
      requests: requests.map((r) => toPublicAid(r as never)),
      count: requests.length,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed"
    log.error("[GET /store/mutual-aid/requests] Error:", message)
    res.status(500).json({ error: "Failed to retrieve aid requests" })
  }
}

// POST /store/mutual-aid/requests
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = createSchema.parse(req.body)
    const customerId = (req as unknown as { auth_context?: { actor_id?: string } })
      .auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const service = req.scope.resolve<MutualAidModuleService>(MUTUAL_AID_MODULE)
    const [created] = await service.createMutualAidRequests([
      {
        ...body,
        requester_id: customerId,
        needed_by: body.needed_by ? new Date(body.needed_by) : null,
      } as never,
    ])

    // The creator sees their own row back, still through the public
    // projection — there is nothing here they need that it withholds, and a
    // second serialisation path is a second thing to get wrong.
    res.status(201).json({ request: toPublicAid(created as never) })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = error instanceof Error ? error.message : "Failed"
    log.error("[POST /store/mutual-aid/requests] Error:", message)
    res.status(400).json({ error: message })
  }
}
