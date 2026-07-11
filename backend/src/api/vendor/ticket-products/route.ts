import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { VendorRequest } from "../types"
import { createTicketProductWorkflow } from "../../../workflows/create-ticket-product"
import { resolveSellerId } from "../../../shared/listing-type-guard"
import { RowType } from "../../../modules/ticket-booking/models/venue-row"
import { z } from "zod"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve("query")
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)

  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized" })
  }

  try {
    // `ticket_product` has no `seller_id` column — ownership is expressed by
    // the `seller_product` link created alongside the ticket's Medusa product
    // (see create-ticket-product workflow). Scope by that link so a vendor
    // only ever sees their own ticket products.
    const { data: sellerProducts } = await query.graph({
      entity: "seller_product",
      fields: ["product_id"],
      filters: { seller_id: sellerId },
    })

    const productIds = sellerProducts
      .map((sp: { product_id?: string }) => sp.product_id)
      .filter((id: string | undefined): id is string => Boolean(id))

    if (productIds.length === 0) {
      return res.json({
        ticket_products: [],
        count: 0,
        limit: undefined,
        offset: undefined,
      })
    }

    const { data: ticketProducts, metadata } = await query.graph({
      entity: "ticket_product",
      fields: ["id", "product_id", "venue_id", "dates", "venue.*"],
      filters: { product_id: productIds },
    })

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
  const actorId = (req as VendorRequest)._seller_id || (req as VendorRequest).auth_context?.actor_id
  const sellerId = await resolveSellerId(req, actorId)

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
