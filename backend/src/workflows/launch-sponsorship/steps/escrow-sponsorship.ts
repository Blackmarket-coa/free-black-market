import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { getCollectiveHawalaService } from "../../../services/collective-hawala"

export type EscrowSponsorshipInput = {
  // Stable per-sponsorship id (the launch_id), used as the escrow key.
  sponsorship_id: string
  // The producer funding the sponsorship.
  producer_id: string
  // Sponsorship budget in dollars (the ledger's working unit).
  amount: number
}

export type EscrowSponsorshipOutput = {
  escrowed: boolean
  ledger_entry_id: string | null
}

/**
 * Locks the producer's sponsorship budget into a per-sponsorship escrow so the
 * committed amount is real money set aside. Idempotent on the sponsorship id;
 * a no-op when the amount is zero. The 90/10 split to creator/platform happens
 * later at payout time (`CollectiveHawalaService.paySponsorship`), once the
 * creator has delivered — mirroring how bounty escrow and milestone payout are
 * separate phases.
 */
const escrowSponsorshipStep = createStep(
  "escrow-sponsorship-step",
  async (data: EscrowSponsorshipInput, { container }) => {
    if (!(Number(data.amount) > 0)) {
      return new StepResponse<EscrowSponsorshipOutput>({
        escrowed: false,
        ledger_entry_id: null,
      })
    }

    const hawala = getCollectiveHawalaService(container)
    const entry = await hawala.escrowSponsorshipFunds({
      sponsorship_id: data.sponsorship_id,
      producer_id: data.producer_id,
      amount: Number(data.amount),
    })

    return new StepResponse<EscrowSponsorshipOutput>({
      escrowed: true,
      ledger_entry_id: entry.id as string,
    })
  }
)

export default escrowSponsorshipStep
