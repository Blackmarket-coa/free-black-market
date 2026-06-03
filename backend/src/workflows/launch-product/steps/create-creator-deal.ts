import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import CreatorProgramService from "../../../modules/creator-program/service"
import { CREATOR_PROGRAM_MODULE } from "../../../modules/creator-program"
import { CreatorProgramType } from "../../../modules/creator-program/models/creator-program"
import CreatorAttributionService from "../../../modules/creator-attribution/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../../../modules/creator-attribution"
import { decideDealAction } from "./_decide-deal-action"

export type CreateCreatorDealInput = {
  launch_id: string
  vendor_id: string
  product_id: string
  // Optional pre-matched creator. A deal + affiliate link is only opened when
  // the creator has ALREADY consented (an APPROVED application or an existing
  // ACTIVE deal). Otherwise the creator is merely invited — no link is minted
  // on their behalf; they opt in by applying or by claiming the bounty.
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
  // Set when a creator was targeted but had not yet consented: recorded as an
  // invitation on the program instead of an auto-minted deal.
  invited_creator_seller_id: string | null
}

type CreateCreatorDealComp = {
  program_id: string | null
  programCreated: boolean
  // Only deals this step opened may be rolled back; a pre-existing ACTIVE deal
  // (reuse case) must be left untouched.
  deal_id: string | null
  dealCreated: boolean
}

/**
 * Stands up the creator side of a launch: a marketing program for the product,
 * and — only when a pre-matched creator has already consented — an affiliate
 * deal plus a default link. This performs the link wiring that `creator-program`
 * intentionally leaves to the caller (it does not depend on `creator-attribution`).
 *
 * Consent gate (see `_decide-deal-action`): a launch never applies/approves on a
 * creator's behalf. With no consent on record the creator is recorded as an
 * invitee on the program; they opt in later by applying or by claiming the bounty.
 *
 * Idempotent: program reused by (vendor, slug); deal reused by (vendor, creator).
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

    const noDeal = (
      invited: string | null
    ): StepResponse<CreateCreatorDealOutput, CreateCreatorDealComp> =>
      new StepResponse(
        {
          program_id: program.id as string,
          deal_id: null,
          affiliate_link_id: null,
          affiliate_short_code: null,
          invited_creator_seller_id: invited,
        },
        {
          program_id: program.id as string,
          programCreated,
          deal_id: null,
          dealCreated: false,
        }
      )

    // No pre-matched creator: program stands open for applications.
    if (!data.target_creator_seller_id) {
      return noDeal(null)
    }
    const target = data.target_creator_seller_id

    // Consent gate — decide purely from existing records whether this creator
    // has opted in. We never apply/approve on their behalf.
    const [applications, deals] = await Promise.all([
      programs.listCreatorApplications({
        program_id: program.id,
        creator_seller_id: target,
      }),
      programs.listCreatorDeals({
        vendor_id: data.vendor_id,
        creator_seller_id: target,
      }),
    ])
    const decision = decideDealAction(applications as any, deals as any)

    if (decision.action === "invite") {
      // Record the invitation on the program; no deal/link is minted.
      const meta = (program.metadata ?? {}) as Record<string, any>
      const invited: string[] = Array.isArray(meta.invited_creator_seller_ids)
        ? meta.invited_creator_seller_ids
        : []
      if (!invited.includes(target)) {
        await (programs as any).updateCreatorPrograms({
          id: program.id,
          metadata: {
            ...meta,
            invited_creator_seller_ids: [...invited, target],
          },
        })
      }
      return noDeal(target)
    }

    // Consent on record: open a deal (or reuse the existing ACTIVE one).
    let deal: any
    let dealCreated = false
    if (decision.action === "open_deal") {
      deal = await programs.openDealForApprovedApp(decision.applicationId)
      dealCreated = true
    } else {
      const existing = await programs.listCreatorDeals({ id: decision.dealId })
      deal = existing[0]
    }

    // Issue the default affiliate link and wire it onto the deal.
    let affiliateLinkId = deal.default_affiliate_link_id as string | null
    let affiliateShortCode: string | null = null
    if (affiliateLinkId) {
      const links = await attribution.listAffiliateLinks({ id: affiliateLinkId })
      affiliateShortCode = (links[0]?.short_code ?? null) as string | null
    } else {
      const link: any = await attribution.generateLink({
        creatorSellerId: target,
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
        invited_creator_seller_id: null,
      },
      {
        program_id: program.id as string,
        programCreated,
        deal_id: deal.id as string,
        dealCreated,
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
      // Only cancel a deal this step actually opened — never a pre-existing one.
      if (comp.dealCreated && comp.deal_id) {
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
