import { createLogger } from "../../../../shared/logger"
const log = createLogger("api/store/collective/demand-pools")
import { z } from "zod"
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DEMAND_POOL_MODULE } from "../../../../modules/demand-pool"
import DemandPoolModuleService from "../../../../modules/demand-pool/service"
import { BUYER_ARCHETYPE_CODES } from "../../../../modules/demand-pool/buyer-archetype"
import { BUYER_NETWORK_MODULE } from "../../../../modules/buyer-network"
import type BuyerNetworkModuleService from "../../../../modules/buyer-network/service"
import { NetworkMemberStatus } from "../../../../modules/buyer-network/models/network-member"

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  return "Unknown error"
}

const createDemandPostSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  category: z.string().optional(),
  specs: z.record(z.string(), z.unknown()).optional(),
  target_quantity: z.number().int().positive(),
  // Optional: derived from the buyer archetype's threshold ratio when absent.
  min_quantity: z.number().int().positive().optional(),
  unit_of_measure: z.string().optional(),
  buyer_archetype: z.enum(BUYER_ARCHETYPE_CODES).optional(),
  target_price: z.number().positive().optional(),
  currency_code: z.string().default("USD"),
  delivery_region: z.string().optional(),
  delivery_address: z.record(z.string(), z.unknown()).optional(),
  delivery_window_start: z.string().datetime().optional(),
  delivery_window_end: z.string().datetime().optional(),
  deadline: z.string().datetime().optional(),
  deadline_type: z.enum(["HARD", "SOFT"]).optional(),
  visibility: z.enum(["PUBLIC", "NETWORK_ONLY", "INVITE_ONLY"]).optional(),
  parent_demand_id: z.string().optional(),
  recurring_rule: z.string().optional(),
  // Attach the post to a buyer network the creator belongs to. This is what
  // populates the demand-post <-> buyer-network module link — without it the
  // link (and everything downstream, like network savings recording) has no
  // rows.
  buyer_network_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const listDemandPostsSchema = z.object({
  category: z.string().optional(),
  delivery_region: z.string().optional(),
  min_bounty: z.coerce.number().optional(),
  sort_by: z.enum(["attractiveness", "deadline", "quantity", "bounty"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

// GET /store/collective/demand-pools
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const query = listDemandPostsSchema.parse(req.query)
    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    const pools = await demandPoolService.getOpenDemandPools({
      category: query.category,
      delivery_region: query.delivery_region,
      min_bounty: query.min_bounty,
      sort_by: query.sort_by,
      limit: query.limit,
      offset: query.offset,
    })

    res.json({ demand_pools: pools, count: pools.length, offset: query.offset, limit: query.limit })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = getErrorMessage(error)
    log.error("[GET /store/collective/demand-pools] Error:", message)
    res.status(500).json({ error: "Failed to retrieve demand pools", details: message })
  }
}

// POST /store/collective/demand-pools
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = createDemandPostSchema.parse(req.body)
    const customerId = (req as any).auth_context?.actor_id
    if (!customerId) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    const demandPoolService = req.scope.resolve<DemandPoolModuleService>(
      DEMAND_POOL_MODULE
    )

    // Validate network membership BEFORE creating anything: attaching a post
    // to a network credits that network's stats when the pool completes, so
    // only an active member of the network may do it — and failing here
    // leaves nothing half-created.
    if (body.buyer_network_id) {
      const buyerNetworkService =
        req.scope.resolve<BuyerNetworkModuleService>(BUYER_NETWORK_MODULE)
      const membership = await buyerNetworkService.listNetworkMembers({
        network_id: body.buyer_network_id,
        customer_id: customerId,
        status: NetworkMemberStatus.ACTIVE,
      })
      if (membership.length === 0) {
        return res.status(400).json({
          error: "Not an active member of the specified buyer network",
        })
      }
    }

    const post = await demandPoolService.createDemandPost({
      creator_id: customerId,
      creator_type: "CUSTOMER",
      title: body.title,
      description: body.description,
      category: body.category,
      specs: body.specs,
      target_quantity: body.target_quantity,
      min_quantity: body.min_quantity,
      buyer_archetype: body.buyer_archetype,
      unit_of_measure: body.unit_of_measure,
      target_price: body.target_price,
      currency_code: body.currency_code,
      delivery_region: body.delivery_region,
      delivery_address: body.delivery_address,
      delivery_window_start: body.delivery_window_start
        ? new Date(body.delivery_window_start)
        : undefined,
      delivery_window_end: body.delivery_window_end
        ? new Date(body.delivery_window_end)
        : undefined,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      deadline_type: body.deadline_type,
      visibility: body.visibility,
      parent_demand_id: body.parent_demand_id,
      recurring_rule: body.recurring_rule,
      metadata: body.metadata,
    })

    // Populate the demand-post <-> buyer-network module link. Membership was
    // validated above, so a failure here is infrastructure, not policy — and
    // the post already exists. Surfacing it as an error would invite a retry
    // that creates a duplicate post, so report the partial outcome instead.
    if (body.buyer_network_id) {
      try {
        const remoteLink = req.scope.resolve(
          ContainerRegistrationKeys.REMOTE_LINK
        )
        await remoteLink.create({
          [BUYER_NETWORK_MODULE]: { buyer_network_id: body.buyer_network_id },
          [DEMAND_POOL_MODULE]: { demand_post_id: post.id },
        })
      } catch (linkError: unknown) {
        const message = getErrorMessage(linkError)
        log.error(
          `[POST /store/collective/demand-pools] Post ${post.id} created but network link to ${body.buyer_network_id} failed:`,
          message
        )
        return res.status(201).json({
          demand_post: post,
          buyer_network_id: null,
          network_link_failed: true,
        })
      }
      return res
        .status(201)
        .json({ demand_post: post, buyer_network_id: body.buyer_network_id })
    }

    res.status(201).json({ demand_post: post })
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: error.issues })
    }
    const message = getErrorMessage(error)
    log.error("[POST /store/collective/demand-pools] Error:", message)
    res.status(400).json({ error: message })
  }
}
