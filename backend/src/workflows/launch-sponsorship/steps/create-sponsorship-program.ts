import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import CreatorProgramService from "../../../modules/creator-program/service"
import { CREATOR_PROGRAM_MODULE } from "../../../modules/creator-program"
import { CreatorProgramType } from "../../../modules/creator-program/models/creator-program"
import { decideDealAction } from "../../launch-product/steps/_decide-deal-action"

export type CreateSponsorshipProgramInput = {
  launch_id: string
  vendor_id: string
  // The creator the producer wants to sponsor. A flat-fee deal is only opened
  // when the creator has already consented (APPROVED application or ACTIVE
  // deal); otherwise they are merely invited — no deal is minted on their
  // behalf, and no funds should be paid out until they opt in.
  target_creator_seller_id?: string | null
  // Flat sponsorship amount, in minor units (cents), recorded on the program.
  sponsorship_flat_cents: number
  program: {
    title: string
    slug: string
    description?: string | null
  }
}

export type CreateSponsorshipProgramOutput = {
  program_id: string
  deal_id: string | null
  invited_creator_seller_id: string | null
}

type CreateSponsorshipProgramComp = {
  program_id: string | null
  programCreated: boolean
  deal_id: string | null
  dealCreated: boolean
}

/**
 * Stands up the creator side of a sponsorship: a SPONSORED_BRIEF program
 * carrying the flat sponsorship amount, and — only when a pre-matched creator
 * has already consented — an active deal binding producer↔creator. Reuses the
 * same consent gate as the product launch (`decideDealAction`) so a sponsorship
 * never applies/approves on a creator's behalf.
 *
 * Idempotent: program reused by (vendor, slug); deal reused by (vendor, creator).
 */
const createSponsorshipProgramStep = createStep(
  "create-sponsorship-program-step",
  async (data: CreateSponsorshipProgramInput, { container }) => {
    const programs =
      container.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)

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
        programType: CreatorProgramType.SPONSORED_BRIEF,
        sponsorshipFlatCents: data.sponsorship_flat_cents,
        metadata: { launch_id: data.launch_id },
      })
      programCreated = true
    }
    await programs.publishProgram(program.id)

    const noDeal = (
      invited: string | null
    ): StepResponse<
      CreateSponsorshipProgramOutput,
      CreateSponsorshipProgramComp
    > =>
      new StepResponse(
        {
          program_id: program.id as string,
          deal_id: null,
          invited_creator_seller_id: invited,
        },
        {
          program_id: program.id as string,
          programCreated,
          deal_id: null,
          dealCreated: false,
        }
      )

    if (!data.target_creator_seller_id) {
      return noDeal(null)
    }
    const target = data.target_creator_seller_id

    // Consent gate — decide purely from existing records. Never apply/approve
    // on the creator's behalf.
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

    return new StepResponse<
      CreateSponsorshipProgramOutput,
      CreateSponsorshipProgramComp
    >(
      {
        program_id: program.id as string,
        deal_id: deal.id as string,
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
  async (comp: CreateSponsorshipProgramComp | undefined, { container }) => {
    if (!comp) {
      return
    }
    const programs =
      container.resolve<CreatorProgramService>(CREATOR_PROGRAM_MODULE)
    try {
      if (comp.dealCreated && comp.deal_id) {
        await programs.cancelDeal(comp.deal_id)
      }
      if (comp.programCreated && comp.program_id) {
        await programs.closeProgram(comp.program_id, "sponsorship rolled back")
      }
    } catch {
      // best-effort compensation
    }
  }
)

export default createSponsorshipProgramStep
