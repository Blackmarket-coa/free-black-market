import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import type { SellerAuthRequest } from "../../../middlewares/seller-context-v1"
import launchProductWorkflow from "../../../../workflows/launch-product"
import type { CreateProductWorkflowInputDTO } from "@medusajs/framework/types"
import launchSponsorshipWorkflow from "../../../../workflows/launch-sponsorship"
import { DEMAND_POOL_MODULE } from "../../../../modules/demand-pool"
import type DemandPoolModuleService from "../../../../modules/demand-pool/service"
import { BountyObjective } from "../../../../modules/demand-pool/models/demand-bounty"
import { CreatorProgramType } from "../../../../modules/creator-program/models/creator-program"
import { PRODUCER_MODULE } from "../../../../modules/producer"
import type ProducerService from "../../../../modules/producer/service"
import { COOPERATIVE_MODULE } from "../../../../modules/cooperative"
import type CooperativeService from "../../../../modules/cooperative/service"

const slugRegex = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

const MilestoneSchema = z.object({
  description: z.string().min(1).max(500),
  percentage: z.number().int().min(1).max(100),
  condition: z.string().min(1).max(500),
})

const BusinessSchema = z.object({
  producer_name: z.string().min(2).max(200),
  producer_handle: z.string().regex(slugRegex),
  region: z.string().max(120).optional().nullable(),
})

const LaunchSchema = z.object({
  // Launch type discriminator. PRODUCT (default) and BUSINESS run the
  // product-launch flow (BUSINESS first ensures a producer profile exists);
  // SPONSORSHIP runs the flat-fee creator-sponsorship flow.
  launch_type: z.enum(["PRODUCT", "BUSINESS", "SPONSORSHIP"]).default("PRODUCT"),
  // Product
  title: z.string().min(2).max(200),
  slug: z.string().regex(slugRegex),
  description: z.string().max(4000).optional().nullable(),
  price: z.number().int().min(0).max(100_000_000).optional(), // minor units (cents)
  currency_code: z.string().length(3).optional(),
  // Launch Business — producer profile for the guided onboarding wizard.
  business: BusinessSchema.optional(),
  // Launch Sponsorship — flat sponsorship budget in minor units (cents).
  sponsorship_amount: z.number().int().min(0).max(100_000_000).optional(),
  // Coalition + creator wiring
  cooperative_id: z.string().optional().nullable(),
  target_creator_seller_id: z.string().optional().nullable(),
  // Demand / need
  category: z.string().max(120).optional().nullable(),
  delivery_region: z.string().max(120).optional().nullable(),
  target_quantity: z.number().int().min(1).max(1_000_000).optional(),
  min_quantity: z.number().int().min(1).max(1_000_000).optional(),
  // Marketing bounty
  bounty_objective: z.nativeEnum(BountyObjective).optional(),
  bounty_amount: z.number().min(0).max(1_000_000).optional(),
  bounty_milestones: z.array(MilestoneSchema).max(10).optional(),
  // Creator program
  program_type: z.nativeEnum(CreatorProgramType).optional(),
  commission_percent: z.number().min(0).max(100).optional().nullable(),
})

/** GET — list the authenticated seller's launches (one row per demand-post). */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }
  const demand = req.scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)
  const posts = await demand.listDemandPosts({
    creator_id: sellerId,
  })
  const launches = posts
    .filter((p) => p.launch_id)
    .map((p) => ({
      launch_id: p.launch_id,
      demand_post_id: p.id,
      product_id: p.product_id,
      cooperative_id: p.cooperative_id,
      title: p.title,
      status: p.status,
    }))
  return res.status(200).json({ launches })
}

/** POST — run the launch-product workflow (Producer + Coalition + Creator). */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const sellerId = (req as SellerAuthRequest).seller_id
  if (!sellerId) {
    return res.status(401).json({ message: "Unauthorized", type: "unauthorized" })
  }

  const parsed = LaunchSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid launch payload",
      type: "invalid_request",
      errors: parsed.error.flatten(),
    })
  }
  const data = parsed.data
  const currency = (data.currency_code ?? "usd").toLowerCase()
  const launchId = `launch_${sellerId}_${data.slug}`
  const launchType = data.launch_type ?? "PRODUCT"

  // ── Launch Sponsorship ──────────────────────────────────────────────────
  // A producer funds a flat-fee creator sponsorship. No product/demand-post is
  // created; idempotency is handled by the workflow's deterministic keys
  // (program slug reuse + sponsorship escrow key).
  if (launchType === "SPONSORSHIP") {
    try {
      const { result } = await launchSponsorshipWorkflow(req.scope).run({
        input: {
          launch_id: launchId,
          seller_id: sellerId,
          target_creator_seller_id: data.target_creator_seller_id ?? null,
          amount_cents: data.sponsorship_amount ?? 0,
          currency_code: (data.currency_code ?? "USD").toUpperCase(),
          program: {
            title: `${data.title} — creator sponsorship`,
            slug: data.slug,
            description: data.description ?? null,
          },
        },
      })
      return res.status(201).json({ sponsorship: result })
    } catch (err) {
      return res
        .status(409)
        .json({ message: (err as Error).message, type: "launch_failed" })
    }
  }

  // PRODUCT and BUSINESS both launch a first product, which requires a price.
  const priceCents = data.price
  if (priceCents == null) {
    return res.status(400).json({
      message: "price is required for product and business launches",
      type: "invalid_request",
    })
  }

  // ── Launch Business ───────────────────────────────────────────────────────
  // Guided onboarding: make sure a producer profile exists (idempotent), then
  // fall through to the standard product-launch flow for the first listing.
  if (launchType === "BUSINESS" && data.business) {
    const producers = req.scope.resolve<ProducerService>(PRODUCER_MODULE)
    const existingProducer = (
      await producers.listProducers({ seller_id: sellerId })
    )[0]
    if (!existingProducer) {
      await producers.createProducers({
        seller_id: sellerId,
        name: data.business.producer_name,
        handle: data.business.producer_handle,
        region: data.business.region ?? null,
      })
    }
  }

  const demand = req.scope.resolve<DemandPoolModuleService>(DEMAND_POOL_MODULE)

  // Idempotency: a re-POST with the same (seller, slug) returns the existing
  // launch instead of creating a second product/bounty.
  const existing = await demand.listDemandPosts({ launch_id: launchId })
  if (existing.length > 0) {
    const post = existing[0]
    const bounties = await demand.listDemandBounties({ demand_post_id: post.id })
    return res.status(200).json({
      launch: {
        launch_id: launchId,
        product_id: post.product_id,
        demand_post_id: post.id,
        cooperative_id: post.cooperative_id,
        bounty_id: bounties[0]?.id ?? null,
      },
      idempotent: true,
    })
  }

  // Coalition guard: a launch may only attach a listing to a cooperative the
  // seller actually belongs to. Requires a producer profile that is an active
  // member of the named cooperative.
  if (data.cooperative_id) {
    const producers = req.scope.resolve<ProducerService>(PRODUCER_MODULE)
    const coops = req.scope.resolve<CooperativeService>(COOPERATIVE_MODULE)

    const producer = (await producers.listProducers({ seller_id: sellerId }))[0]
    if (!producer) {
      return res.status(403).json({
        message: "A producer profile is required to launch into a cooperative",
        type: "not_allowed",
      })
    }
    const coop = (await coops.listCooperatives({ id: data.cooperative_id }))[0]
    if (!coop) {
      return res.status(404).json({
        message: "Cooperative not found",
        type: "not_found",
      })
    }
    const memberships = await coops.listCooperativeMembers({
      cooperative_id: data.cooperative_id,
      producer_id: producer.id,
      is_active: true,
    })
    if (memberships.length === 0) {
      return res.status(403).json({
        message: "You are not an active member of this cooperative",
        type: "not_allowed",
      })
    }
  }

  // Resolve a default sales channel so the product is purchasable.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id"],
    pagination: { take: 1 },
  })
  const salesChannelId = channels?.[0]?.id

  const productInput: CreateProductWorkflowInputDTO = {
    title: data.title,
    status: "published",
    description: data.description ?? undefined,
    options: [{ title: "Default option", values: ["Default"] }],
    variants: [
      {
        title: "Default",
        manage_inventory: false,
        prices: [{ amount: priceCents, currency_code: currency }],
        options: { "Default option": "Default" },
      },
    ],
    ...(salesChannelId ? { sales_channel_ids: [salesChannelId] } : {}),
    metadata: { launch_id: launchId },
  }

  try {
    const { result } = await launchProductWorkflow(req.scope).run({
      input: {
        launch_id: launchId,
        seller_id: sellerId,
        product: productInput,
        cooperative_id: data.cooperative_id ?? null,
        target_creator_seller_id: data.target_creator_seller_id ?? null,
        demand: {
          title: `${data.title} — marketing bounty`,
          description:
            data.description ?? `Promote ${data.title} and earn the bounty.`,
          category: data.category ?? null,
          delivery_region: data.delivery_region ?? null,
          target_quantity: data.target_quantity ?? 100,
          min_quantity: data.min_quantity ?? 1,
        },
        bounty: {
          objective: data.bounty_objective ?? BountyObjective.RECRUIT_BUYERS,
          amount: data.bounty_amount ?? 0,
          currency_code: (data.currency_code ?? "USD").toUpperCase(),
          milestones: data.bounty_milestones,
        },
        program: {
          title: `${data.title} creators`,
          slug: data.slug,
          program_type: data.program_type ?? CreatorProgramType.AFFILIATE_OPEN,
          commission_percent: data.commission_percent ?? null,
        },
      },
    })

    return res.status(201).json({ launch: result })
  } catch (err) {
    return res.status(409).json({
      message: (err as Error).message,
      type: "launch_failed",
    })
  }
}
