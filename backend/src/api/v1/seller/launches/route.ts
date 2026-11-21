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
import { DemandPostStatus } from "../../../../modules/demand-pool/models/demand-post"
import { CreatorProgramType } from "../../../../modules/creator-program/models/creator-program"
import { PRODUCER_MODULE } from "../../../../modules/producer"
import type ProducerService from "../../../../modules/producer/service"
import { COOPERATIVE_MODULE } from "../../../../modules/cooperative"
import type CooperativeService from "../../../../modules/cooperative/service"
import { fromMinorUnits } from "../../../../shared/minor-units"

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

  // A funded bounty is refused, before anything is written. Its escrow debits
  // the seller's USER_WALLET, which nothing creates for a seller, so the
  // workflow failed for every store ("Contributor wallet not found"); and an
  // escrowed bounty has no way out: its payout route wants a customer equal
  // to the post's creator (a seller here), a panel launch has no milestones,
  // and no cancel path refunds it. Until a wallet, a payout and a refund
  // exist, a launch carries an unfunded bounty or none.
  if ((data.bounty_amount ?? 0) > 0) {
    return res.status(400).json({
      message: "A funded bounty is not available yet. Leave the bounty amount empty to launch.",
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
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Idempotency: a re-POST with the same (seller, slug) returns the existing
  // launch instead of creating a second product/bounty. Only a launch that is
  // still there counts: a post a failed run cancelled, or one whose product
  // is gone, used to answer `idempotent: true` on every retry, so a launch
  // that had failed once could never be made.
  const existing = await demand.listDemandPosts({ launch_id: launchId })
  for (const post of existing) {
    if (post.status === DemandPostStatus.CANCELLED || !post.product_id) continue
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { id: post.product_id },
    })
    if (products.length === 0) continue
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

  // The store's default sales channel, the one a storefront's publishable
  // key is scoped to (as create-ticket-product and blackout-listing-product
  // take it). `subscribers/product-created-sales-channel` links every new
  // product to it a moment after creation; naming it here puts the launch in
  // its channel from the start, and in that channel only.
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
    pagination: { take: 1 },
  })
  const salesChannelId = stores?.[0]?.default_sales_channel_id

  // `price` is minor units (the panel sends 1200 for $12.00); Medusa stores
  // major units, so 1200 handed over as-is published a $1,200.00 product.
  const productInput: CreateProductWorkflowInputDTO = {
    title: data.title,
    status: "published",
    description: data.description ?? undefined,
    options: [{ title: "Default option", values: ["Default"] }],
    variants: [
      {
        title: "Default",
        manage_inventory: false,
        prices: [{ amount: fromMinorUnits(priceCents, currency), currency_code: currency }],
        options: { "Default option": "Default" },
      },
    ],
    // createProductsWorkflow reads `sales_channels: [{ id }]`. The
    // `sales_channel_ids` this used to pass was dropped without an error, so
    // the product reached a channel only through the subscriber, and reached
    // none on a store with no default channel.
    ...(salesChannelId ? { sales_channels: [{ id: salesChannelId }] } : {}),
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
