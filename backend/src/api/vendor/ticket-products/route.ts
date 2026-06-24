import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"
import { createTicketProductWorkflow } from "../../../workflows/create-ticket-product"
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
    // Try with seller_id filter first, fall back to no filter if column doesn't exist
    let ticketProducts: unknown[] = []
    let metadata: { count?: number; take?: number; skip?: number } | undefined = {}
    
    try {
      const result = await query.graph({
        entity: "ticket_product",
        fields: ["id", "product_id", "venue_id", "dates", "venue.*"],
        filters: {
          seller_id: sellerId
        } as Record<string, unknown>, // seller_id may not be in the generated types yet
      })
      ticketProducts = result.data
      metadata = result.metadata
    } catch (filterError) {
      // If seller_id column doesn't exist, fetch all (temporary)
      if (filterError.message?.includes("seller_id")) {
        const result = await query.graph({
          entity: "ticket_product",
          fields: ["id", "product_id", "venue_id", "dates", "venue.*"],
        })
        ticketProducts = result.data
        metadata = result.metadata
      } else {
        throw filterError
      }
    }

    res.json({
      ticket_products: ticketProducts,
      count: metadata?.count,
      limit: metadata?.take,
      offset: metadata?.skip,
    })
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch ticket products", error: error.message })
  }
}

export const CreateTicketProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  venue_id: z.string().min(1, "Venue ID is required"),
  dates: z.array(z.string()).min(1, "At least one date is required"),
  variants: z.array(z.object({
    row_type: z.nativeEnum(RowType),
    seat_count: z.number().min(1, "Seat count must be at least 1"),
    prices: z.array(z.object({
      currency_code: z.string().min(1, "Currency code is required"),
      amount: z.number().min(0, "Amount must be non-negative"),
      rules: z.object({
        region_id: z.string()
      }).optional(),
      min_quantity: z.number().optional(),
      max_quantity: z.number().optional()
    })).min(1, "At least one price is required")
  })).min(1, "At least one variant is required")
})

type CreateTicketProductSchema = z.infer<typeof CreateTicketProductSchema>

export async function POST(
  req: MedusaRequest<CreateTicketProductSchema>,
  res: MedusaResponse
) {
  const sellerId = (req as VendorRequest).auth_context?.actor_id

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    const { result } = await createTicketProductWorkflow(req.scope).run({
      input: {
        ...req.body,
        seller_id: sellerId
      }
    })

    res.status(201).json(result)
  } catch (error) {
    res.status(500).json({
      message: "Failed to create ticket product",
      error: error.message,
    })
  }
}
