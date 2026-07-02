import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  NURSERY_CHANNELS,
  NURSERY_CHANNEL_LABELS,
  buildChannelTierInput,
  type NurseryChannel,
} from "../../../../modules/nursery-vertical/channels"
import { getSellerId } from "../../quests/_helpers"

/**
 * GET /vendor/nursery/channels
 *
 * The available nursery channels + this vendor's existing per-channel pricing
 * tiers (from the shared vendor_customer_tier mechanism — no separate pricing
 * table). Only WHOLESALE tiers tagged with a nursery channel are returned.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const vendorRules: any = req.scope.resolve("vendorRules")
  const tiers = await vendorRules.listVendorCustomerTiers({ seller_id: sellerId })
  const channelTiers = (tiers ?? []).filter(
    (t: any) => (t.metadata as any)?.vertical === "nursery"
  )

  res.json({
    channels: Object.values(NURSERY_CHANNELS).map((key) => ({
      key,
      label: NURSERY_CHANNEL_LABELS[key as NurseryChannel],
    })),
    tiers: channelTiers,
  })
}

interface CreateChannelBody {
  channel: NurseryChannel
  discountPercent: number
  paymentTermsDays?: number
  minMonthlyOrder?: number
}

/**
 * POST /vendor/nursery/channels
 *
 * Create a per-channel wholesale pricing tier. Wires straight into the existing
 * vendor_customer_tier mechanism via buildChannelTierInput — no new pricing
 * system.
 */
export const POST = async (
  req: MedusaRequest<CreateChannelBody>,
  res: MedusaResponse
) => {
  const sellerId = getSellerId(req)
  if (!sellerId) return res.status(401).json({ message: "Unauthorized" })

  const b = req.body ?? ({} as CreateChannelBody)
  const valid = Object.values(NURSERY_CHANNELS) as string[]
  if (!b.channel || !valid.includes(b.channel)) {
    return res.status(400).json({ message: "valid channel is required" })
  }
  if (typeof b.discountPercent !== "number") {
    return res.status(400).json({ message: "discountPercent is required" })
  }

  const vendorRules: any = req.scope.resolve("vendorRules")
  const input = buildChannelTierInput(sellerId, {
    channel: b.channel,
    discountPercent: b.discountPercent,
    paymentTermsDays: b.paymentTermsDays,
    minMonthlyOrder: b.minMonthlyOrder,
  })
  const tier = await vendorRules.createVendorCustomerTiers(input)
  res.status(201).json({ tier })
}
