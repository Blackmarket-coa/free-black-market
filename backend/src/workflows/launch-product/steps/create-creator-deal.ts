import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import CreatorProgramService from "../../../modules/creator-program/service"
import { CREATOR_PROGRAM_MODULE } from "../../../modules/creator-program"
import { CreatorProgramType } from "../../../modules/creator-program/models/creator-program"
import { CreatorApplicationStatus } from "../../../modules/creator-program/models/creator-application"
import CreatorAttributionService from "../../../modules/creator-attribution/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../modules/creator-attribution"

export type CreateCreatorDealInput = {
  launch_id: string
  vendor_id: string
  product_id: string
  // Optional pre-matched creator to auto-approve + issue an affiliate link to.
  target_creator_seller_id?: string | null
  program: {
    title: string
    slug: string
    program_type: CreatorProgramType
    commission_percent?: number | null
    commission_flat_cents?: number | null
    description?: string | null
  }
}

export type CreateCreatorDealOutput = {
  program_id: string
  deal_id: string | null
  affiliate_link_id: string | null
  affiliate_short_code: string | null
}

type CreateCreatorDealComp = {
  program_id: string | null
  programCreated: boolean
  deal_id: string | null
}

/**
 * Stands up the creator side of a launch: a marketing program for the product,
 * and (when a creator is pre-matched) an approved deal plus a default affiliate
 * link. This performs the link wiring that `creator-program` intentionally
 * leaves to the caller (it does not depend on `creator-attribution`).
 * Idempotent: program reused by (vendor, slug); deal reused by application.
 */
const createCreatorDealStep = createStep(
  "create-creator-deal-step",
  async (data: CreateCreatorDealInput, { container }) => {
    const programs =
      container.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
    const attribution = container.resolve<CreatorAttributionService>(
      CREATOR_ATTRIBUTION_MODULE
    )

    // Reuse an existing program with this slug for the vendor, else create one.
    const existingPrograms = await programs.listCreatorPrograms({
      vendor_id: data.vendor_id,
      slug: data.program.slug,
    })
    let program = existingPrograms[0]
    let programCreated = false
    if (!program) {
      program = await programs.createProgram({
        vendorId: data.vendor_id,
        title: data.program.title,
        slug: data.program.slug,
        description: data.program.description ?? null,
        programType: data.program.program_type,
        commissionPercent: data.program.commission_percent ?? null,
        commissionFlatCents: data.program.commission_flat_cents ?? null,
        productIds: [data.product_id],
        metadata: { launch_id: data.launch_id },
      })
      programCreated = true
    }
    await programs.publishProgram(program.id)

    // No pre-matched creator: program stands open for applications.
    if (!data.target_creator_seller_id) {
      return new StepResponse<CreateCreatorDealOutput, CreateCreatorDealComp>(
        {
          program_id: program.id as string,
          deal_id: null,
          affiliate_link_id: null,
          affiliate_short_code: null,
        },
        { program_id: program.id as string, programCreated, deal_id: null }
      )
    }

    // Application -> approve -> deal (each idempotent in the service).
    const application = await programs.applyToProgram({
      programId: program.id,
      creatorSellerId: data.target_creator_seller_id,
    })
    if (application.status === CreatorApplicationStatus.PENDING) {
      await programs.decideApplication({
        applicationId: application.id,
        decision: "approve",
        decidedBy: data.vendor_id,
        reason: "Auto-approved by product launch",
      })
    }
    const deal = await programs.openDealForApprovedApp(application.id)

    // Issue the default affiliate link and wire it onto the deal.
    let affiliateLinkId = deal.default_affiliate_link_id as string | null
    let affiliateShortCode: string | null = null
    if (affiliateLinkId) {
      const links = await attribution.listAffiliateLinks({ id: affiliateLinkId })
      affiliateShortCode = (links[0]?.short_code ?? null) as string | null
    } else {
      const link: any = await attribution.generateLink({
        creatorSellerId: data.target_creator_seller_id,
        vendorId: data.vendor_id,
        dealId: deal.id,
        programId: program.id,
        productId: data.product_id,
        utmMedium: "launch",
        utmCampaign: data.launch_id,
      })
      affiliateLinkId = link.id as string
      affiliateShortCode = link.short_code as string
      await programs.attachDefaultLinkToDeal(deal.id, link.id)
    }

    return new StepResponse<CreateCreatorDealOutput, CreateCreatorDealComp>(
      {
        program_id: program.id as string,
        deal_id: deal.id as string,
        affiliate_link_id: affiliateLinkId,
        affiliate_short_code: affiliateShortCode,
      },
      {
        program_id: program.id as string,
        programCreated,
        deal_id: deal.id as string,
      }
    )
  },
  async (comp: CreateCreatorDealComp | undefined, { container }) => {
    if (!comp) {
      return
    }
    const programs =
      container.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
    try {
      if (comp.deal_id) {
        await programs.cancelDeal(comp.deal_id)
      }
      if (comp.programCreated && comp.program_id) {
        await programs.closeProgram(comp.program_id, "launch rolled back")
      }
    } catch {
      // best-effort compensation
    }
  }
)

export default createCreatorDealStep
