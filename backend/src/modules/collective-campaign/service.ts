import { MedusaService } from "@medusajs/framework/utils"
import {
  Campaign,
  MaterialLineItem,
  Backing,
  PurchaseOrder,
  VendorReputation,
  ProductiveAssetToken,
  YieldReport,
} from "./models"
import {
  BackingMode,
  CampaignStatus,
  CampaignType,
  PurchaseOrderStatus,
  VendorReputationTier,
} from "./models"

class CollectiveCampaignModuleService extends MedusaService({
  Campaign,
  MaterialLineItem,
  Backing,
  PurchaseOrder,
  VendorReputation,
  ProductiveAssetToken,
  YieldReport,
}) {
  private readonly CAMPAIGN_TRANSITIONS: Record<string, string[]> = {
    [CampaignStatus.DRAFT]: [CampaignStatus.ACTIVE],
    [CampaignStatus.ACTIVE]: [CampaignStatus.FUNDED, CampaignStatus.FAILED],
    [CampaignStatus.FUNDED]: [CampaignStatus.SOURCING, CampaignStatus.ASSET_ACQUISITION, CampaignStatus.DISPUTED],
    [CampaignStatus.SOURCING]: [CampaignStatus.MATERIALS_RECEIVED, CampaignStatus.DISPUTED],
    [CampaignStatus.MATERIALS_RECEIVED]: [CampaignStatus.PRODUCING, CampaignStatus.DISPUTED],
    [CampaignStatus.PRODUCING]: [CampaignStatus.FULFILLING, CampaignStatus.SELLING, CampaignStatus.YIELDING, CampaignStatus.DISPUTED],
    [CampaignStatus.FULFILLING]: [CampaignStatus.SELLING, CampaignStatus.COMPLETE, CampaignStatus.DISPUTED],
    [CampaignStatus.SELLING]: [CampaignStatus.COMPLETE, CampaignStatus.DISPUTED],
    [CampaignStatus.ASSET_ACQUISITION]: [CampaignStatus.ESTABLISHMENT, CampaignStatus.DISPUTED],
    [CampaignStatus.ESTABLISHMENT]: [CampaignStatus.PRODUCING, CampaignStatus.YIELDING, CampaignStatus.DISPUTED],
    [CampaignStatus.YIELDING]: [CampaignStatus.MATURE, CampaignStatus.DISPUTED],
    [CampaignStatus.DISPUTED]: [CampaignStatus.WIND_DOWN],
  }

  async createCampaign(input: {
    vendor_id: string
    name: string
    description: string
    media?: Record<string, unknown>
    campaign_type: CampaignType
    batch_minimum?: number
    funding_goal_override?: number
    maker_fee: number
    estimated_production_days?: number
    shipping_per_unit?: number
    pickup_enabled?: boolean
    return_cap_multiplier?: number
    asset_type?: string
    productive_lifespan?: string
    yield_per_cycle?: number
    cycle_frequency?: string
    time_to_first_yield_days?: number
    compounding_profile?: string
    projected_return_curve?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }) {
    const [campaign] = await this.createCampaigns([
      {
        ...input,
        status: CampaignStatus.DRAFT,
        shipping_per_unit: input.shipping_per_unit ?? 0,
        return_cap_multiplier: input.return_cap_multiplier ?? 2,
      },
    ])

    await this.recalculateCampaignFinancials(campaign.id)
    const [updated] = await this.listCampaigns({ id: campaign.id })
    return updated
  }

  async createCampaignWithMaterialLineItems(input: {
    campaign: {
      vendor_id: string
      name: string
      description: string
      media?: Record<string, unknown>
      campaign_type: CampaignType
      batch_minimum?: number
      funding_goal_override?: number
      maker_fee: number
      estimated_production_days?: number
      shipping_per_unit?: number
      pickup_enabled?: boolean
      return_cap_multiplier?: number
      asset_type?: string
      productive_lifespan?: string
      yield_per_cycle?: number
      cycle_frequency?: string
      time_to_first_yield_days?: number
      compounding_profile?: string
      projected_return_curve?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
    material_line_items: Array<{
      item_name: string
      supplier_url: string
      unit_cost_at_listing: number
      quantity_per_output_unit?: number
      quantity_per_full_campaign: number
      auto_purchase_supported?: boolean
      metadata?: Record<string, unknown>
    }>
  }) {
    const campaign = await this.createCampaign(input.campaign)

    try {
      for (const lineItem of input.material_line_items) {
        await this.addMaterialLineItem({ campaign_id: campaign.id, ...lineItem })
      }

      const [hydrated] = await this.listCampaigns({ id: campaign.id })
      return hydrated
    } catch (error) {
      const lineItems = await this.listMaterialLineItems({ campaign_id: campaign.id })
      for (const lineItem of lineItems) {
        await this.deleteMaterialLineItems(lineItem.id)
      }
      await this.deleteCampaigns(campaign.id)
      throw error
    }
  }

  async addMaterialLineItem(input: {
    campaign_id: string
    item_name: string
    supplier_url: string
    unit_cost_at_listing: number
    quantity_per_output_unit?: number
    quantity_per_full_campaign: number
    auto_purchase_supported?: boolean
    metadata?: Record<string, unknown>
  }) {
    const lineTotalEstimate = input.unit_cost_at_listing * input.quantity_per_full_campaign
    const [lineItem] = await this.createMaterialLineItems([
      {
        ...input,
        quantity_per_output_unit: input.quantity_per_output_unit ?? 1,
        auto_purchase_supported: input.auto_purchase_supported ?? false,
        line_total_estimate: lineTotalEstimate,
      },
    ])

    await this.recalculateCampaignFinancials(input.campaign_id)
    return lineItem
  }

  async recalculateCampaignFinancials(campaignId: string) {
    const [campaign] = await this.listCampaigns({ id: campaignId })
    if (!campaign) {
      throw new Error("Campaign not found")
    }

    const lineItems = await this.listMaterialLineItems({ campaign_id: campaignId })
    const materialTotal = lineItems.reduce((sum, li) => sum + Number(li.line_total_estimate), 0)
    const makerFeeSubtotal = Number(campaign.maker_fee)
    const platformFeeSubtotal = (materialTotal + makerFeeSubtotal) * 0.03
    const shippingSubtotal =
      Number(campaign.shipping_per_unit) * Number(campaign.batch_minimum || 0)

    const calculatedGoal =
      campaign.funding_goal_override != null
        ? Number(campaign.funding_goal_override)
        : materialTotal + makerFeeSubtotal + platformFeeSubtotal + shippingSubtotal

    const perUnitCost = Number(campaign.batch_minimum)
      ? calculatedGoal / Number(campaign.batch_minimum)
      : calculatedGoal

    await this.updateCampaigns({
      id: campaignId,
      material_total: materialTotal,
      maker_fee_subtotal: makerFeeSubtotal,
      platform_fee_subtotal: platformFeeSubtotal,
      shipping_subtotal: shippingSubtotal,
      campaign_goal: calculatedGoal,
      per_unit_backer_cost: perUnitCost,
    })
  }

  async transitionCampaignStatus(campaignId: string, nextStatus: CampaignStatus) {
    const [campaign] = await this.listCampaigns({ id: campaignId })
    if (!campaign) {
      throw new Error("Campaign not found")
    }

    const validTargets = this.CAMPAIGN_TRANSITIONS[campaign.status] || []
    if (!validTargets.includes(nextStatus)) {
      throw new Error(`Invalid transition from ${campaign.status} to ${nextStatus}`)
    }

    await this.updateCampaigns({ id: campaignId, status: nextStatus })
    const [updated] = await this.listCampaigns({ id: campaignId })
    return updated
  }

  async addBacking(input: {
    // Optional pre-generated id: the escrow-aware backing route mints the id
    // up front so the ledger idempotency key can reference it before the row
    // exists (escrow-then-persist ordering).
    id?: string
    campaign_id: string
    backer_id: string
    mode: BackingMode
    amount: number
    units_reserved?: number
    metadata?: Record<string, unknown>
  }) {
    const [campaign] = await this.listCampaigns({ id: input.campaign_id })
    if (!campaign) {
      throw new Error("Campaign not found")
    }
    if (campaign.status !== CampaignStatus.ACTIVE) {
      throw new Error("Backings can only be added to ACTIVE campaigns")
    }

    const [backing] = await this.createBackings([
      {
        ...input,
        payout_cap_amount:
          input.mode === BackingMode.MICRO_INVESTOR
            ? input.amount * Number(campaign.return_cap_multiplier)
            : null,
      },
    ])

    const backings = await this.listBackings({ campaign_id: input.campaign_id, status: "PLEDGED" })
    const preOrderBackedAmount = backings
      .filter((entry) => entry.mode === BackingMode.PRE_ORDER)
      .reduce((sum, entry) => sum + Number(entry.amount), 0)
    const investorBackedAmount = backings
      .filter((entry) => entry.mode === BackingMode.MICRO_INVESTOR)
      .reduce((sum, entry) => sum + Number(entry.amount), 0)

    const totalBackedAmount = preOrderBackedAmount + investorBackedAmount

    await this.updateCampaigns({
      id: input.campaign_id,
      pre_order_backed_amount: preOrderBackedAmount,
      investor_backed_amount: investorBackedAmount,
      total_backed_amount: totalBackedAmount,
    })

    if (totalBackedAmount >= Number(campaign.campaign_goal)) {
      const [latestCampaign] = await this.listCampaigns({ id: input.campaign_id })
      if (latestCampaign?.status === CampaignStatus.ACTIVE) {
        await this.updateCampaigns({ id: input.campaign_id, status: CampaignStatus.FUNDED })
      }
      await this.createPurchaseOrdersFromMaterialLines(input.campaign_id)
    }

    return backing
  }

  async createPurchaseOrdersFromMaterialLines(campaignId: string) {
    const [campaign] = await this.listCampaigns({ id: campaignId })
    if (!campaign) {
      throw new Error("Campaign not found")
    }

    const existingPurchaseOrders = await this.listPurchaseOrders({ campaign_id: campaignId })
    if (existingPurchaseOrders.length > 0) {
      return existingPurchaseOrders
    }

    const lineItems = await this.listMaterialLineItems({ campaign_id: campaignId })
    if (!lineItems.length) {
      return []
    }

    const payload = lineItems.map((line) => ({
      campaign_id: campaignId,
      material_line_item_id: line.id,
      supplier_url: line.supplier_url,
      budget_amount: line.line_total_estimate,
      status: line.auto_purchase_supported
        ? PurchaseOrderStatus.AUTO_EXECUTED
        : PurchaseOrderStatus.MANUAL_ACTION_REQUIRED,
      delivery_status: "PENDING",
    }))

    let pos
    try {
      pos = await this.createPurchaseOrders(payload)
    } catch (error) {
      const recovered = await this.listPurchaseOrders({ campaign_id: campaignId })
      if (recovered.length > 0) {
        return recovered
      }
      throw error
    }

    await this.updateCampaigns({
      id: campaignId,
      status:
        campaign.campaign_type === CampaignType.PRODUCTION_RUN
          ? CampaignStatus.SOURCING
          : CampaignStatus.ASSET_ACQUISITION,
    })

    return pos
  }

  async releaseMakerFeeByMilestone(campaignId: string, milestone: "MATERIALS_RECEIVED" | "FULFILLMENT") {
    const [campaign] = await this.listCampaigns({ id: campaignId })
    if (!campaign) {
      throw new Error("Campaign not found")
    }

    const [reputation] = await this.listVendorReputations({ vendor_id: campaign.vendor_id })
    const tier = reputation?.tier || VendorReputationTier.TIER_1
    const payoutPlan: Record<VendorReputationTier, { materials: number; fulfillment: number }> = {
      [VendorReputationTier.TIER_1]: { materials: 0.15, fulfillment: 0.85 },
      [VendorReputationTier.TIER_2]: { materials: 0.5, fulfillment: 0.5 },
      [VendorReputationTier.TIER_3]: { materials: 0.75, fulfillment: 0.25 },
      [VendorReputationTier.TIER_4]: { materials: 1, fulfillment: 0 },
    }

    const split = payoutPlan[tier]
    const targetPercentage = milestone === "MATERIALS_RECEIVED" ? split.materials : split.fulfillment
    const requestedReleaseAmount = Number(campaign.maker_fee) * targetPercentage
    const releasableAmount = Math.max(
      0,
      Math.min(
        requestedReleaseAmount,
        Number(campaign.maker_fee) - Number(campaign.maker_fee_released_amount)
      )
    )

    await this.updateCampaigns({
      id: campaignId,
      maker_fee_released_amount: Number(campaign.maker_fee_released_amount) + releasableAmount,
    })

    return { campaign_id: campaignId, tier, milestone, release_amount: releasableAmount }
  }

  async markCampaignFailed(campaignId: string) {
    await this.updateCampaigns({ id: campaignId, status: CampaignStatus.FAILED })
    const backings = await this.listBackings({ campaign_id: campaignId, status: "PLEDGED" })
    for (const backing of backings) {
      await this.updateBackings({ id: backing.id, status: "REFUNDED" })
    }

    return { campaign_id: campaignId, refunded_backings: backings.length }
  }

  async getCampaignDashboard(campaignId: string) {
    const [campaign] = await this.listCampaigns({ id: campaignId })
    if (!campaign) {
      throw new Error("Campaign not found")
    }

    const lineItems = await this.listMaterialLineItems({ campaign_id: campaignId })
    const purchaseOrders = await this.listPurchaseOrders({ campaign_id: campaignId })
    const backings = await this.listBackings({ campaign_id: campaignId })
    const yieldReports = await this.listYieldReports({ campaign_id: campaignId })

    return {
      campaign,
      allocation_breakdown: {
        material_total: campaign.material_total,
        maker_fee_subtotal: campaign.maker_fee_subtotal,
        platform_fee_subtotal: campaign.platform_fee_subtotal,
        shipping_subtotal: campaign.shipping_subtotal,
      },
      material_line_items: lineItems,
      sourcing_timeline: purchaseOrders,
      backing_summary: {
        total_backed_amount: campaign.total_backed_amount,
        pre_order_backed_amount: campaign.pre_order_backed_amount,
        investor_backed_amount: campaign.investor_backed_amount,
        investor_payout_cap_progress:
          backings
            .filter((entry) => entry.mode === BackingMode.MICRO_INVESTOR)
            .map((entry) => ({
              backing_id: entry.id,
              cap_amount: entry.payout_cap_amount,
              released_amount: entry.payout_released_amount,
            })),
      },
      yield_reports: yieldReports,
    }
  }
}

export default CollectiveCampaignModuleService
