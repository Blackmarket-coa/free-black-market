import { MedusaService } from "@medusajs/framework/utils"
import {
  Campaign,
  MaterialLineItem,
  Backing,
  PurchaseOrder,
  VendorReputation,
  ProductiveAssetToken,
  YieldReport,
  Participant,
  Milestone,
  Contribution,
} from "./models"
import {
  BackingMode,
  CAMPAIGN_GOAL_KIND_SHARED_GOAL,
  CampaignParticipantRole,
  CampaignStatus,
  CampaignType,
  PurchaseOrderStatus,
  VendorReputationTier,
} from "./models"
import {
  campaignAmountToCents,
  centsToCampaignAmount,
  isNonNegativeIntegerCents,
  isPositiveIntegerCents,
} from "./money"

/** The shape `recordParticipantContribution` reports back to its caller. */
export type RecordParticipantContributionResult =
  | {
      recorded: true
      participant_id: string
      campaign_id: string
      contributed_amount_cents: number
      campaign_total_cents: number
      milestones_reached: string[]
      status: CampaignStatus
    }
  | {
      recorded: false
      /**
       * `no_participant`: the org is not on the campaign. `already_recorded`:
       * this intent was counted before (a replay or a concurrent delivery).
       * `campaign_closed`: the campaign is not ACTIVE or FUNDED, so a charge
       * stamped with it is recorded by the donation module but not counted.
       */
      reason: "no_participant" | "already_recorded" | "campaign_closed"
      campaign_id: string
    }

/** The shape `reverseParticipantContribution` reports back to its caller. */
export type ReverseParticipantContributionResult =
  | {
      reversed: true
      participant_id: string
      campaign_id: string
      contributed_amount_cents: number
      campaign_total_cents: number
    }
  | { reversed: false; reason: "not_recorded" | "already_reversed"; campaign_id: string }

/** Statuses in which a shared-goal campaign counts contributions. */
const SHARED_GOAL_OPEN_STATUSES: ReadonlySet<string> = new Set([CampaignStatus.ACTIVE, CampaignStatus.FUNDED])

/**
 * Why a campaign cannot take a `collective_backing` right now, or null when it
 * can. Exported so the escrow-aware backing route can ask BEFORE it opens the
 * campaign escrow: the service refuses in `addBacking` too, but by then the
 * route has already moved funds into a ledger account, and a compensating
 * refund is not a guarantee. One predicate, two call sites, same answer.
 */
export function campaignBackingRefusal(campaign: { goal_kind?: string | null; status: string }): string | null {
  // A shared-goal contribution is a donation on the participant org's own
  // connected account, never a backing: PRE_ORDER is a forward purchase with
  // CONSUMER XP and the escrow purchase context, and the campaign escrow is
  // custodial. Checked before status so a shared goal is refused as what it
  // is, whatever its status.
  if (campaign.goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL) {
    return "Shared-goal campaigns do not take backings; contributions are direct charges to participant organisations"
  }
  if (campaign.status !== CampaignStatus.ACTIVE) {
    return "Backings can only be added to ACTIVE campaigns"
  }
  return null
}

/** What a shared-goal campaign row looks like to the public reads. */
type SharedGoalCampaignRow = {
  id: string
  goal_kind: string | null
  cooperative_id: string | null
  name: string
  description: string
  media: unknown
  status: string
  campaign_goal: unknown
  total_backed_amount: unknown
  metadata: unknown
  created_at?: Date
  updated_at?: Date
}

/**
 * Extra transitions a SHARED_GOAL campaign may make and a production campaign
 * may not: a shared goal has no sourcing, production or selling phases, so
 * it closes straight from FUNDED (goal met) or ACTIVE (deadline-based close).
 */
const SHARED_GOAL_EXTRA_TRANSITIONS: Record<string, string[]> = {
  [CampaignStatus.FUNDED]: [CampaignStatus.COMPLETE],
  [CampaignStatus.ACTIVE]: [CampaignStatus.COMPLETE],
}

const CAMPAIGN_TRANSITIONS: Record<string, string[]> = {
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


/**
 * Module-level rather than private methods: the unit specs call the real
 * prototype methods on a ctx that shadows only the generated CRUD, so anything
 * a method needs besides CRUD has to be reachable without an instance.
 */
async function getSharedGoalCampaignOrThrow(
  service: { listCampaigns: (filter: { id: string }) => Promise<Array<{ goal_kind?: string | null } & Record<string, unknown>>> },
  campaignId: string
) {
  const [campaign] = await service.listCampaigns({ id: campaignId })
  if (!campaign || campaign.goal_kind !== CAMPAIGN_GOAL_KIND_SHARED_GOAL) {
    throw new Error("Campaign not found")
  }
  return campaign
}

type ContributionRowLike = { participant_id: string; amount_cents: unknown; reversed_at?: Date | null }
type ParticipantRowLike = { id: string; contributed_amount_cents: unknown }

/**
 * Re-derive every participant's `contributed_amount_cents` and the campaign's
 * `total_backed_amount` (major units) from the un-reversed contribution rows.
 * The cached columns are a projection of those rows, so a stale value — two
 * deliveries that both summed before the other's insert was visible — is
 * corrected by the next write rather than carried forever. Only rows whose
 * cached value differs are written.
 */
async function recomputeSharedGoalTotals(
  service: {
    listContributions: (filter: Record<string, unknown>) => Promise<ContributionRowLike[]>
    listParticipants: (filter: Record<string, unknown>) => Promise<ParticipantRowLike[]>
    updateParticipants: (data: { id: string; contributed_amount_cents: number }) => Promise<unknown>
    updateCampaigns: (data: { id: string; total_backed_amount: number }) => Promise<unknown>
  },
  campaignId: string
): Promise<{ perParticipant: Map<string, number>; totalCents: number }> {
  const rows = await service.listContributions({ campaign_id: campaignId, reversed_at: null })
  const perParticipant = new Map<string, number>()
  let totalCents = 0
  for (const row of rows) {
    const cents = Number(row.amount_cents)
    perParticipant.set(row.participant_id, (perParticipant.get(row.participant_id) ?? 0) + cents)
    totalCents += cents
  }

  for (const participant of await service.listParticipants({ campaign_id: campaignId })) {
    const derived = perParticipant.get(participant.id) ?? 0
    if (Number(participant.contributed_amount_cents ?? 0) !== derived) {
      await service.updateParticipants({ id: participant.id, contributed_amount_cents: derived })
    }
  }
  await service.updateCampaigns({ id: campaignId, total_backed_amount: centsToCampaignAmount(totalCents) })

  return { perParticipant, totalCents }
}

function projectSharedGoalCampaign(campaign: SharedGoalCampaignRow) {
  const goalCents = campaignAmountToCents(Number(campaign.campaign_goal ?? 0))
  const totalCents = campaignAmountToCents(Number(campaign.total_backed_amount ?? 0))
  return {
    id: campaign.id,
    goal_kind: campaign.goal_kind,
    cooperative_id: campaign.cooperative_id,
    name: campaign.name,
    description: campaign.description,
    media: campaign.media ?? null,
    status: campaign.status,
    goal_amount_cents: goalCents,
    contributed_total_cents: totalCents,
    percent_complete: goalCents > 0 ? Math.min(100, Math.floor((totalCents / goalCents) * 100)) : 0,
  }
}

function projectParticipant(row: {
  id: string
  role: string
  partner_org_key: string | null
  seller_id: string | null
  pledged_amount_cents: unknown
  contributed_amount_cents: unknown
}) {
  return {
    id: row.id,
    role: row.role,
    partner_org_key: row.partner_org_key,
    seller_id: row.seller_id,
    pledged_amount_cents: Number(row.pledged_amount_cents ?? 0),
    contributed_amount_cents: Number(row.contributed_amount_cents ?? 0),
  }
}

function projectMilestone(row: {
  id: string
  title: string
  target_amount_cents: unknown
  unit: string
  sort_order: unknown
  reached_at: Date | null
  impact_summary: string | null
}) {
  return {
    id: row.id,
    title: row.title,
    target_amount_cents: Number(row.target_amount_cents ?? 0),
    unit: row.unit,
    sort_order: Number(row.sort_order ?? 0),
    reached_at: row.reached_at ?? null,
    impact_summary: row.impact_summary ?? null,
  }
}

class CollectiveCampaignModuleService extends MedusaService({
  Campaign,
  MaterialLineItem,
  Backing,
  PurchaseOrder,
  VendorReputation,
  ProductiveAssetToken,
  YieldReport,
  Participant,
  Milestone,
  Contribution,
}) {
  async createCampaign(input: {
    vendor_id: string
    name: string
    description: string
    media?: Record<string, unknown>
    campaign_type: CampaignType
    /** `"SHARED_GOAL"` for a coalition shared goal (no material lines, no maker fee, 0 platform fee). */
    goal_kind?: typeof CAMPAIGN_GOAL_KIND_SHARED_GOAL | null
    cooperative_id?: string | null
    batch_minimum?: number
    funding_goal_override?: number
    /** Required for a production campaign; must be absent or 0 for a shared goal. */
    maker_fee?: number
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
    const isSharedGoal = input.goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL
    if (isSharedGoal && (input.maker_fee ?? 0) !== 0) {
      throw new Error("A shared-goal campaign has no maker fee")
    }
    if (!isSharedGoal && typeof input.maker_fee !== "number") {
      throw new Error("maker_fee is required for a production campaign")
    }

    const [campaign] = await this.createCampaigns([
      {
        ...input,
        goal_kind: isSharedGoal ? CAMPAIGN_GOAL_KIND_SHARED_GOAL : null,
        cooperative_id: input.cooperative_id ?? null,
        maker_fee: input.maker_fee ?? 0,
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
    // Decision 1 (docs/BMC_SURVIVAL_PROGRAMS.md): BMC takes 0 on a donation, and
    // a shared-goal campaign's money is donations on each participant org's own
    // connected account. The 0.03 literal for production campaigns is untouched
    // here — that it bypasses shared/platform-fee.ts is a pre-existing finding.
    const platformFeeSubtotal =
      campaign.goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL
        ? 0
        : (materialTotal + makerFeeSubtotal) * 0.03
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

    const validTargets = [
      ...(CAMPAIGN_TRANSITIONS[campaign.status] || []),
      ...(campaign.goal_kind === CAMPAIGN_GOAL_KIND_SHARED_GOAL
        ? SHARED_GOAL_EXTRA_TRANSITIONS[campaign.status] || []
        : []),
    ]
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
    // Refused here, in the service, so no route can persist one; the escrow
    // route asks the same predicate before it moves anything.
    const refusal = campaignBackingRefusal(campaign)
    if (refusal) {
      throw new Error(refusal)
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

  // ── Shared-goal Coalition campaigns ───────────────────────────────────────
  //
  // Everything below is INTEGER CENTS at the API and converts to the campaign's
  // major-unit columns through `./money`. None of it moves money: the only money
  // path for a shared goal is the donation module's direct charge (S9), and the
  // Connect webhook reports each succeeded charge here.

  /**
   * Create a shared-goal campaign: no material lines, no maker fee, a 0
   * platform fee, the goal from `goal_amount_cents`, and a HOST participant for
   * the creating seller so the host-only routes have someone to check against.
   * Rolls the campaign back if a participant or milestone write fails.
   */
  async createSharedGoalCampaign(input: {
    vendor_id: string
    name: string
    description: string
    media?: Record<string, unknown>
    cooperative_id?: string | null
    /** Integer cents. Becomes `funding_goal_override` in major units. */
    goal_amount_cents: number
    /** Legacy NOT NULL column; a shared goal is neither, PRODUCTION_RUN is the neutral default. */
    campaign_type?: CampaignType
    host_partner_org_key?: string | null
    milestones?: Array<{
      title: string
      target_amount_cents: number
      unit?: string
      sort_order?: number
      impact_summary?: string | null
    }>
    metadata?: Record<string, unknown>
  }) {
    if (!isPositiveIntegerCents(input.goal_amount_cents)) {
      throw new Error("goal_amount_cents must be a positive integer number of cents")
    }

    const campaign = await this.createCampaign({
      vendor_id: input.vendor_id,
      name: input.name,
      description: input.description,
      media: input.media,
      campaign_type: input.campaign_type ?? CampaignType.PRODUCTION_RUN,
      goal_kind: CAMPAIGN_GOAL_KIND_SHARED_GOAL,
      cooperative_id: input.cooperative_id ?? null,
      funding_goal_override: centsToCampaignAmount(input.goal_amount_cents),
      maker_fee: 0,
      metadata: input.metadata,
    })

    try {
      await this.createParticipants([
        {
          campaign_id: campaign.id,
          role: CampaignParticipantRole.HOST,
          seller_id: input.vendor_id,
          partner_org_key: input.host_partner_org_key ?? null,
          pledged_amount_cents: 0,
          contributed_amount_cents: 0,
        },
      ])
      for (const milestone of input.milestones ?? []) {
        await this.addMilestone({ campaign_id: campaign.id, ...milestone })
      }
      const [hydrated] = await this.listCampaigns({ id: campaign.id })
      return hydrated
    } catch (error) {
      for (const row of await this.listMilestones({ campaign_id: campaign.id })) {
        await this.deleteMilestones(row.id)
      }
      for (const row of await this.listParticipants({ campaign_id: campaign.id })) {
        await this.deleteParticipants(row.id)
      }
      await this.deleteCampaigns(campaign.id)
      throw error
    }
  }

  /** The campaign's HOST participant, or null. The host-only routes check the actor against its `seller_id`. */
  async getHostParticipant(campaignId: string) {
    const [host] = await this.listParticipants({
      campaign_id: campaignId,
      role: CampaignParticipantRole.HOST,
    })
    return host ?? null
  }

  async addParticipant(input: {
    campaign_id: string
    partner_org_key?: string | null
    seller_id?: string | null
    role: CampaignParticipantRole
    pledged_amount_cents?: number
    metadata?: Record<string, unknown>
  }) {
    await getSharedGoalCampaignOrThrow(this, input.campaign_id)
    if (!input.partner_org_key && !input.seller_id) {
      throw new Error("A participant needs a partner_org_key or a seller_id")
    }
    if (input.role === CampaignParticipantRole.HOST) {
      throw new Error("A shared-goal campaign has one host, set when it is created")
    }
    const pledged = input.pledged_amount_cents ?? 0
    if (!isNonNegativeIntegerCents(pledged)) {
      throw new Error("pledged_amount_cents must be a non-negative integer number of cents")
    }
    if (input.partner_org_key) {
      const [existing] = await this.listParticipants({
        campaign_id: input.campaign_id,
        partner_org_key: input.partner_org_key,
      })
      if (existing) {
        throw new Error("That organisation is already a participant on this campaign")
      }
    } else {
      // Seller-only rows: the org index treats nulls as distinct, so the
      // duplicate check (and UQ_..._campaign_seller) is on the seller instead.
      const [existing] = await this.listParticipants({
        campaign_id: input.campaign_id,
        seller_id: input.seller_id,
        partner_org_key: null,
      })
      if (existing) {
        throw new Error("That seller is already a participant on this campaign")
      }
    }

    const [participant] = await this.createParticipants([
      {
        campaign_id: input.campaign_id,
        partner_org_key: input.partner_org_key ?? null,
        seller_id: input.seller_id ?? null,
        role: input.role,
        pledged_amount_cents: pledged,
        contributed_amount_cents: 0,
        metadata: input.metadata ?? null,
      },
    ])
    return participant
  }

  async addMilestone(input: {
    campaign_id: string
    title: string
    target_amount_cents: number
    unit?: string
    sort_order?: number
    impact_summary?: string | null
    metadata?: Record<string, unknown>
  }) {
    const campaign = await getSharedGoalCampaignOrThrow(this, input.campaign_id)
    if (!isPositiveIntegerCents(input.target_amount_cents)) {
      throw new Error("target_amount_cents must be a positive integer number of cents")
    }
    // A milestone added after the total already passed it is reached now, not never.
    const totalCents = campaignAmountToCents(Number(campaign.total_backed_amount ?? 0))
    const [milestone] = await this.createMilestones([
      {
        campaign_id: input.campaign_id,
        title: input.title,
        target_amount_cents: input.target_amount_cents,
        unit: input.unit ?? "USD",
        sort_order: input.sort_order ?? 0,
        reached_at: totalCents >= input.target_amount_cents ? new Date() : null,
        impact_summary: input.impact_summary ?? null,
        metadata: input.metadata ?? null,
      },
    ])
    return milestone
  }

  /**
   * Report a succeeded direct charge on a participant org's connected account.
   *
   * Called by the Connect webhook when a `donation_split_record` carrying
   * `campaign_id` transitions to `succeeded`; `partner_org_key` is that record's
   * `org_key` and `stripe_payment_intent_id` the intent it was charged on.
   *
   * Exactly once per intent, by construction: a `collective_campaign_contribution`
   * row is inserted first under a DB unique index on (campaign_id, intent), so a
   * replay or a concurrent second delivery is reported as `already_recorded`
   * rather than counted. Totals are then DERIVED from the un-reversed rows (never
   * `+= amount`), the campaign total written in major units via `./money`,
   * `reached_at` stamped on every milestone the new total meets, and an ACTIVE
   * campaign moved to FUNDED at the goal. Never opens escrow, never creates a
   * backing, never creates a purchase order. An org that is not a participant,
   * and a campaign that is not open (ACTIVE | FUNDED), are reported, not guessed.
   */
  async recordParticipantContribution(input: {
    campaign_id: string
    partner_org_key: string
    amount_cents: number
    stripe_payment_intent_id: string
  }): Promise<RecordParticipantContributionResult> {
    const campaign = await getSharedGoalCampaignOrThrow(this, input.campaign_id)
    if (!isPositiveIntegerCents(input.amount_cents)) {
      throw new Error("amount_cents must be a positive integer number of cents")
    }
    if (typeof input.stripe_payment_intent_id !== "string" || input.stripe_payment_intent_id.length === 0) {
      throw new Error("stripe_payment_intent_id is required: the contribution is keyed by the intent it came from")
    }
    if (!SHARED_GOAL_OPEN_STATUSES.has(String(campaign.status))) {
      return { recorded: false, reason: "campaign_closed", campaign_id: input.campaign_id }
    }

    const [participant] = await this.listParticipants({
      campaign_id: input.campaign_id,
      partner_org_key: input.partner_org_key,
    })
    if (!participant) {
      return { recorded: false, reason: "no_participant", campaign_id: input.campaign_id }
    }

    const intentFilter = {
      campaign_id: input.campaign_id,
      stripe_payment_intent_id: input.stripe_payment_intent_id,
    }
    const [seen] = await this.listContributions(intentFilter)
    if (seen) {
      return { recorded: false, reason: "already_recorded", campaign_id: input.campaign_id }
    }
    try {
      await this.createContributions([
        {
          ...intentFilter,
          participant_id: participant.id,
          partner_org_key: input.partner_org_key,
          amount_cents: input.amount_cents,
          reversed_at: null,
        },
      ])
    } catch (error) {
      // The unique index is the arbiter between two deliveries that both passed
      // the read above. Whatever shape the driver gives the violation, the row
      // either exists now (the other delivery won) or this was a real failure.
      const [raced] = await this.listContributions(intentFilter)
      if (raced) {
        return { recorded: false, reason: "already_recorded", campaign_id: input.campaign_id }
      }
      throw error
    }

    const totals = await recomputeSharedGoalTotals(this, input.campaign_id)
    const contributed = totals.perParticipant.get(participant.id) ?? 0
    const totalCents = totals.totalCents

    const reached: string[] = []
    const now = new Date()
    for (const milestone of await this.listMilestones({ campaign_id: input.campaign_id })) {
      if (milestone.reached_at == null && Number(milestone.target_amount_cents) <= totalCents) {
        await this.updateMilestones({ id: milestone.id, reached_at: now })
        reached.push(milestone.id)
      }
    }

    let status = campaign.status as CampaignStatus
    const goalCents = campaignAmountToCents(Number(campaign.campaign_goal ?? 0))
    if (status === CampaignStatus.ACTIVE && goalCents > 0 && totalCents >= goalCents) {
      await this.updateCampaigns({ id: input.campaign_id, status: CampaignStatus.FUNDED })
      status = CampaignStatus.FUNDED
    }

    return {
      recorded: true,
      participant_id: participant.id,
      campaign_id: input.campaign_id,
      contributed_amount_cents: contributed,
      campaign_total_cents: totalCents,
      milestones_reached: reached,
      status,
    }
  }

  /**
   * Reverse a counted contribution after the processor reports a FULL refund of
   * its intent (the donation module moves the split record to `refunded` only
   * then; a partial refund keeps the status and is not reversed here).
   *
   * Marks the contribution row `reversed_at` and re-derives the participant and
   * campaign totals from the rows that still count — so the public figures stop
   * overstating, with a floor of 0 by construction. Idempotent: a second refund
   * event is `already_reversed`, an intent never counted is `not_recorded`.
   * `reached_at` on milestones is left as stamped: a milestone reached is a
   * fact about the past, and un-reaching it is a semantics decision recorded in
   * docs/AUDIT_DEBT.md rather than taken silently here. Status is untouched.
   */
  async reverseParticipantContribution(input: {
    campaign_id: string
    stripe_payment_intent_id: string
  }): Promise<ReverseParticipantContributionResult> {
    await getSharedGoalCampaignOrThrow(this, input.campaign_id)
    const [contribution] = await this.listContributions({
      campaign_id: input.campaign_id,
      stripe_payment_intent_id: input.stripe_payment_intent_id,
    })
    if (!contribution) {
      return { reversed: false, reason: "not_recorded", campaign_id: input.campaign_id }
    }
    if (contribution.reversed_at != null) {
      return { reversed: false, reason: "already_reversed", campaign_id: input.campaign_id }
    }

    await this.updateContributions({ id: contribution.id, reversed_at: new Date() })
    const totals = await recomputeSharedGoalTotals(this, input.campaign_id)

    return {
      reversed: true,
      participant_id: contribution.participant_id,
      campaign_id: input.campaign_id,
      contributed_amount_cents: totals.perParticipant.get(contribution.participant_id) ?? 0,
      campaign_total_cents: totals.totalCents,
    }
  }

  /**
   * Public progress read: the campaign, its milestones and its participants with
   * role and totals. Computed, not authored, and it never touches
   * `collective_backing` — there are no donor identities on this path at all.
   */
  async getCoalitionProgress(campaignId: string) {
    const campaign = await getSharedGoalCampaignOrThrow(this, campaignId)
    const milestones = await this.listMilestones({ campaign_id: campaignId })
    const participants = await this.listParticipants({ campaign_id: campaignId })

    return {
      campaign: projectSharedGoalCampaign(campaign as unknown as SharedGoalCampaignRow),
      milestones: milestones
        .map((row) => projectMilestone(row))
        .sort((a, b) => a.sort_order - b.sort_order || a.target_amount_cents - b.target_amount_cents),
      participants: participants.map((row) => projectParticipant(row)),
    }
  }

  /**
   * Public joint impact report: reached milestones, per-org totals, the
   * campaign's yield reports and the host's impact summary
   * (`campaign.metadata.impact_summary`). Computed from the same rows as the
   * progress read; nothing here is a second source of truth.
   */
  async getJointImpactReport(campaignId: string) {
    const campaign = await getSharedGoalCampaignOrThrow(this, campaignId)
    const milestones = await this.listMilestones({ campaign_id: campaignId })
    const participants = await this.listParticipants({ campaign_id: campaignId })
    const yieldReports = await this.listYieldReports({ campaign_id: campaignId })

    const metadata = (campaign.metadata ?? {}) as Record<string, unknown>
    const impactSummary = typeof metadata.impact_summary === "string" ? metadata.impact_summary : null

    return {
      campaign: projectSharedGoalCampaign(campaign as unknown as SharedGoalCampaignRow),
      reached_milestones: milestones
        .filter((row) => row.reached_at != null)
        .map((row) => projectMilestone(row))
        .sort((a, b) => a.sort_order - b.sort_order || a.target_amount_cents - b.target_amount_cents),
      per_org_totals: participants
        .map((row) => projectParticipant(row))
        .map(({ id, role, partner_org_key, seller_id, contributed_amount_cents, pledged_amount_cents }) => ({
          participant_id: id,
          role,
          partner_org_key,
          seller_id,
          pledged_amount_cents,
          contributed_amount_cents,
        })),
      yield_reports: yieldReports,
      impact_summary: impactSummary,
      generated_at: new Date(),
    }
  }
}

export default CollectiveCampaignModuleService
