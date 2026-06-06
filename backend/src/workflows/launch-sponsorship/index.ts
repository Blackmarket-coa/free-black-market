import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import createSponsorshipProgramStep from "./steps/create-sponsorship-program"
import escrowSponsorshipStep from "./steps/escrow-sponsorship"
import emitSponsorshipEventsStep from "./steps/emit-sponsorship-events"

export type LaunchSponsorshipWorkflowInput = {
  // Stable per-sponsorship id. The trigger route guards re-entry on this id and
  // each step keys its idempotent artifacts off it.
  launch_id: string
  seller_id: string
  vendor_mxid?: string | null
  target_creator_seller_id?: string | null
  // Sponsorship budget in minor units (cents); the escrow step works in dollars.
  amount_cents: number
  currency_code?: string
  program: {
    title: string
    slug: string
    description?: string | null
  }
}

/**
 * A producer funds a flat-fee sponsorship of a creator. One Launch materializes:
 *  - Creator:  a SPONSORED_BRIEF program + (when the creator has consented) a deal
 *  - Money:    the sponsorship budget escrowed from the producer's wallet
 *  - Bridge:   a sponsorship.created Blackout webhook
 *
 * The 90/10 creator/platform split is taken later at payout
 * (`CollectiveHawalaService.paySponsorship`) once the creator delivers.
 */
const launchSponsorshipWorkflow = createWorkflow(
  "launch-sponsorship",
  (input: LaunchSponsorshipWorkflowInput) => {
    const program = createSponsorshipProgramStep(
      transform({ input }, (d) => ({
        launch_id: d.input.launch_id,
        vendor_id: d.input.seller_id,
        target_creator_seller_id: d.input.target_creator_seller_id ?? null,
        sponsorship_flat_cents: d.input.amount_cents,
        program: d.input.program,
      }))
    )

    const escrow = escrowSponsorshipStep(
      transform({ input }, (d) => ({
        sponsorship_id: d.input.launch_id,
        producer_id: d.input.seller_id,
        amount: d.input.amount_cents / 100,
      }))
    )

    emitSponsorshipEventsStep(
      transform({ input, program, escrow }, (d) => ({
        launch_id: d.input.launch_id,
        vendor_mxid: d.input.vendor_mxid ?? null,
        vendor_id: d.input.seller_id,
        program_id: d.program.program_id,
        deal_id: d.program.deal_id,
        invited_creator_seller_id: d.program.invited_creator_seller_id,
        target_creator_seller_id: d.input.target_creator_seller_id ?? null,
        amount_cents: d.input.amount_cents,
        currency_code: d.input.currency_code ?? "USD",
        escrowed: d.escrow.escrowed,
      }))
    )

    return new WorkflowResponse(
      transform({ input, program, escrow }, (d) => ({
        launch_id: d.input.launch_id,
        program_id: d.program.program_id,
        deal_id: d.program.deal_id,
        invited_creator_seller_id: d.program.invited_creator_seller_id,
        escrowed: d.escrow.escrowed,
        escrow_ledger_entry_id: d.escrow.ledger_entry_id,
        amount_cents: d.input.amount_cents,
      }))
    )
  }
)

export default launchSponsorshipWorkflow
