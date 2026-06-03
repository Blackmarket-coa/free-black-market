import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import CooperativeService from "../../../modules/cooperative/service"
import { COOPERATIVE_MODULE } from "../../../modules/cooperative"

export type AttachCoalitionListingInput = {
  // Empty string => no coalition for this launch (step no-ops).
  cooperative_id: string
  product_id: string
  name: string
  launch_id: string
  unified_price?: number | null
  currency_code?: string
}

/**
 * Surfaces the launched product on a coalition (cooperative) storefront by
 * creating a `cooperative_listing`. No-ops when the launch has no coalition.
 * Idempotent per `launch_id` (reuses a listing already stamped with it).
 */
const attachCoalitionListingStep = createStep(
  "attach-coalition-listing-step",
  async (data: AttachCoalitionListingInput, { container }) => {
    if (!data.cooperative_id) {
      return new StepResponse(
        { cooperative_listing_id: null as string | null },
        { created: false, id: null as string | null }
      )
    }

    const service = container.resolve<CooperativeService>(COOPERATIVE_MODULE)

    const existing = await service.listCooperativeListings({
      cooperative_id: data.cooperative_id,
      product_id: data.product_id,
    })
    const match = existing.find(
      (l: any) => (l?.metadata as any)?.launch_id === data.launch_id
    )
    if (match) {
      return new StepResponse(
        { cooperative_listing_id: match.id as string },
        { created: false, id: match.id as string }
      )
    }

    const created = await (service as any).createCooperativeListings([
      {
        cooperative_id: data.cooperative_id,
        product_id: data.product_id,
        name: data.name,
        unified_price: data.unified_price ?? null,
        currency_code: data.currency_code ?? "usd",
        metadata: { launch_id: data.launch_id },
      },
    ])
    const listing = Array.isArray(created) ? created[0] : created

    return new StepResponse(
      { cooperative_listing_id: listing.id as string },
      { created: true, id: listing.id as string }
    )
  },
  async (comp, { container }) => {
    if (!comp || !comp.created || !comp.id) {
      return
    }
    const service = container.resolve<CooperativeService>(COOPERATIVE_MODULE)
    await (service as any).deleteCooperativeListings(comp.id)
  }
)

export default attachCoalitionListingStep
