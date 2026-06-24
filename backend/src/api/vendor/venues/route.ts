import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"
import { createVenueWorkflow } from "../../../workflows/create-venue"
import { RowType } from "../../../modules/ticket-booking/models/venue-row"
import { z } from "zod"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const {
      data: venues,
      metadata
    } = await query.graph({
      entity: "venue",
      fields: ["id", "name", "address", "created_at", "updated_at", "rows.*"],
    })

    res.json({
      venues,
      count: metadata?.count,
      limit: metadata?.take,
      offset: metadata?.skip,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch venues", error: error.message })
  }
}

export const CreateVenueSchema = z.object({
  name: z.string(),
  address: z.string().optional(),
  rows: z.array(z.object({
    row_number: z.string(),
    row_type: z.nativeEnum(RowType),
    seat_count: z.number()
  }))
})

type CreateVenueSchema = z.infer<typeof CreateVenueSchema>

export async function POST(
  req: MedusaRequest<CreateVenueSchema>,
  res: MedusaResponse
) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const { result } = await createVenueWorkflow(req.scope).run({
      input: req.body
    })

    res.status(201).json(result)
  } catch (error) {
    res.status(500).json({ message: "Failed to create venue", error: error.message })
  }
}
