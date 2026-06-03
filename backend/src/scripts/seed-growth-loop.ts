import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PRODUCER_MODULE } from "../modules/producer"
import { COOPERATIVE_MODULE } from "../modules/cooperative"
import { CREATOR_PROGRAM_MODULE } from "../modules/creator-program"
import { CreatorProgramType } from "../modules/creator-program/models/creator-program"

/**
 * Seed the growth-loop demo scaffolding so the Launch + matching + coalition
 * surfaces have data to operate on. Idempotent: re-running reuses existing rows.
 *
 * Creates, on top of whatever sellers already exist:
 *  - a producer profile for the first seller (the "Producer")
 *  - a coalition (cooperative) + membership (the "Coalition")
 *  - an open creator program + a pending application from a second seller
 *    (the "Creator") so `/v1/seller/matching/*` returns candidates
 *
 * Run:
 *   pnpm medusa exec ./src/scripts/seed-growth-loop.ts
 */
export default async function seedGrowthLoop({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const producerService: any = container.resolve(PRODUCER_MODULE)
  const cooperativeService: any = container.resolve(COOPERATIVE_MODULE)
  const programService: any = container.resolve(CREATOR_PROGRAM_MODULE)

  logger.info("[seed-growth-loop] starting")

  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "name"],
    pagination: { take: 5 },
  })

  if (!sellers || sellers.length === 0) {
    logger.warn(
      "[seed-growth-loop] no sellers found — run the main seed/onboarding first"
    )
    return
  }

  const producerSeller = sellers[0]
  const creatorSeller = sellers[1] ?? sellers[0]

  // ---------- Producer profile ----------
  const producerHandle = "myrtle-beach-farm"
  let [producer] = await producerService.listProducers({ handle: producerHandle })
  if (!producer) {
    producer = await producerService.createProducers({
      seller_id: producerSeller.id,
      name: "Myrtle Beach Farm",
      handle: producerHandle,
      description: "Compost, seedlings, and muscadine vines.",
      region: "SC",
      state: "South Carolina",
      country_code: "us",
      public_profile_enabled: true,
    })
    logger.info(`[seed-growth-loop] created producer ${producer.id}`)
  }

  // ---------- Coalition (cooperative) + membership ----------
  const coopHandle = "myrtle-beach-gardening"
  let [coop] = await cooperativeService.listCooperatives({ handle: coopHandle })
  if (!coop) {
    coop = await cooperativeService.createCooperatives({
      name: "Myrtle Beach Gardening Coalition",
      handle: coopHandle,
      description: "Local gardening coalition: compost, seedlings, tools.",
      region: "SC",
      state: "South Carolina",
      country_code: "us",
      public_storefront_enabled: true,
    })
    logger.info(`[seed-growth-loop] created cooperative ${coop.id}`)
  }

  const members = await cooperativeService.listCooperativeMembers({
    cooperative_id: coop.id,
    producer_id: producer.id,
  })
  if (members.length === 0) {
    await cooperativeService.createCooperativeMembers({
      cooperative_id: coop.id,
      producer_id: producer.id,
      joined_at: new Date(),
    })
    logger.info("[seed-growth-loop] linked producer to coalition")
  }

  // ---------- Creator program + a pending application ----------
  const programSlug = "compost-creators"
  let [program] = await programService.listCreatorPrograms({
    vendor_id: producerSeller.id,
    slug: programSlug,
  })
  if (!program) {
    program = await programService.createProgram({
      vendorId: producerSeller.id,
      title: "Compost Creators",
      slug: programSlug,
      programType: CreatorProgramType.AFFILIATE_OPEN,
      commissionPercent: 20,
    })
    await programService.publishProgram(program.id)
    logger.info(`[seed-growth-loop] created creator program ${program.id}`)
  }

  if (creatorSeller.id !== producerSeller.id) {
    const existingApps = await programService.listCreatorApplications({
      program_id: program.id,
      creator_seller_id: creatorSeller.id,
    })
    if (existingApps.length === 0) {
      await programService.applyToProgram({
        programId: program.id,
        creatorSellerId: creatorSeller.id,
        proposedPlatforms: ["tiktok", "instagram", "compost", "garden"],
        followerSnapshot: { tiktok: 12000, instagram: 8000 },
      })
      logger.info("[seed-growth-loop] created pending creator application")
    }
  }

  logger.info(
    `[seed-growth-loop] done. producer=${producer.id} coop=${coop.id} program=${program.id}`
  )
}
