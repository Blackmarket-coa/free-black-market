import { MedusaService } from "@medusajs/framework/utils"
import { CharacterSheet, XpEvent, ProgressionTitle } from "./models"
import { Stance, isStance } from "./stance"
import { levelForXp, levelProgress, ROLE_XP_WEIGHTS } from "./leveling"

/**
 * Per-role XP column names on the character sheet, keyed by stance.
 */
const XP_COLUMN: Record<Stance, { xp: string; level: string }> = {
  [Stance.PRODUCER]: { xp: "producer_xp", level: "producer_level" },
  [Stance.CONSUMER]: { xp: "consumer_xp", level: "consumer_level" },
  [Stance.INVESTOR]: { xp: "investor_xp", level: "investor_level" },
  [Stance.COALITION]: { xp: "coalition_xp", level: "coalition_level" },
  [Stance.CREATOR]: { xp: "creator_xp", level: "creator_level" },
}

/**
 * Default titles seeded into the `progression_title` catalog. Mirrors the
 * `DEFAULT_BUYER_BADGES` seed convention in impact-metrics.
 */
export const DEFAULT_TITLES: Array<{
  slug: string
  role: Stance
  name: string
  description: string
  min_level: number
  icon: string
  color: string
  display_order: number
}> = [
  { slug: "village-farmer", role: Stance.PRODUCER, name: "Village Farmer", description: "Started producing for your community.", min_level: 1, icon: "leaf", color: "#22C55E", display_order: 10 },
  { slug: "regional-supplier", role: Stance.PRODUCER, name: "Regional Supplier", description: "A dependable producer at regional scale.", min_level: 5, icon: "truck", color: "#16A34A", display_order: 20 },
  { slug: "master-manufacturer", role: Stance.PRODUCER, name: "Master Manufacturer", description: "An elite producer trusted across the network.", min_level: 10, icon: "trophy", color: "#15803D", display_order: 30 },
  { slug: "market-trader", role: Stance.CONSUMER, name: "Market Trader", description: "An active supporter of producers.", min_level: 1, icon: "shopping-bag", color: "#3B82F6", display_order: 40 },
  { slug: "loyal-patron", role: Stance.CONSUMER, name: "Loyal Patron", description: "A steadfast patron of the market.", min_level: 5, icon: "heart", color: "#2563EB", display_order: 50 },
  { slug: "community-investor", role: Stance.INVESTOR, name: "Community Investor", description: "Deployed capital into community projects.", min_level: 1, icon: "dollar", color: "#F59E0B", display_order: 60 },
  { slug: "guild-builder", role: Stance.INVESTOR, name: "Guild Builder", description: "A major backer of productive assets.", min_level: 5, icon: "award", color: "#D97706", display_order: 70 },
  { slug: "coalition-steward", role: Stance.COALITION, name: "Coalition Steward", description: "Steps up to help the community thrive.", min_level: 1, icon: "users", color: "#8B5CF6", display_order: 80 },
  { slug: "guild-leader", role: Stance.COALITION, name: "Guild Leader", description: "A pillar of coalition mutual aid.", min_level: 5, icon: "star", color: "#7C3AED", display_order: 90 },
  { slug: "master-artisan", role: Stance.CREATOR, name: "Master Artisan", description: "A recognized creator in the Commons.", min_level: 5, icon: "edit", color: "#EC4899", display_order: 100 },
]

export type EarnedTitle = { title_slug: string; role: string; earned_at: Date }

class ProgressionModuleService extends MedusaService({
  CharacterSheet,
  XpEvent,
  ProgressionTitle,
}) {
  /**
   * Get or create the character sheet for a customer.
   */
  async getOrCreateCharacterSheet(customerId: string) {
    const existing = await this.listCharacterSheets({ customer_id: customerId })
    if (existing.length > 0) {
      return existing[0]
    }
    return this.createCharacterSheets({ customer_id: customerId })
  }

  /**
   * Record an XP event and apply it to the character sheet.
   *
   * Writes an append-only `xp_event`, bumps the matching role track + total XP
   * (XP floored at 0), recomputes the role level, then checks for newly-earned
   * titles. The role-weight multiplier from `leveling.ts` is applied here.
   */
  async recordXpEvent(data: {
    customer_id: string
    role: Stance
    amount: number
    reason: string
    source_module?: string
    source_id?: string
    metadata?: Record<string, unknown>
  }) {
    const weighted = Math.round(data.amount * (ROLE_XP_WEIGHTS[data.role] ?? 1))

    await this.createXpEvents({
      customer_id: data.customer_id,
      role: data.role,
      amount: weighted,
      reason: data.reason,
      source_module: data.source_module ?? null,
      source_id: data.source_id ?? null,
      occurred_at: new Date(),
      metadata: (data.metadata as Record<string, unknown>) ?? null,
    })

    const sheet = await this.getOrCreateCharacterSheet(data.customer_id)
    const col = XP_COLUMN[data.role]

    const currentRoleXp = Number((sheet as Record<string, unknown>)[col.xp] ?? 0)
    const newRoleXp = Math.max(0, currentRoleXp + weighted)
    const newTotalXp = Math.max(0, Number(sheet.total_xp ?? 0) + weighted)

    await this.updateCharacterSheets({
      id: sheet.id,
      [col.xp]: newRoleXp,
      [col.level]: levelForXp(newRoleXp),
      total_xp: newTotalXp,
    })

    await this.checkAndGrantTitles(data.customer_id)

    return this.getOrCreateCharacterSheet(data.customer_id)
  }

  /**
   * Set the customer's active stance (the role they're currently "playing").
   */
  async setStance(customerId: string, stance: Stance) {
    const sheet = await this.getOrCreateCharacterSheet(customerId)
    await this.updateCharacterSheets({ id: sheet.id, active_stance: stance })
    return this.getOrCreateCharacterSheet(customerId)
  }

  /**
   * Recompute the derived aggregate-stat snapshot from the owning modules.
   *
   * This is the anti-duplication core: rather than maintaining its own copies,
   * progression reads the source-of-truth modules via the container's query
   * graph and snapshots the values for fast reads. Each source is wrapped in
   * try/catch so a missing/disabled module never breaks the whole recompute.
   *
   * @param query the container's `query` service (ContainerRegistrationKeys.QUERY)
   */
  async recomputeAggregates(
    customerId: string,
    query: { graph: (args: Record<string, unknown>) => Promise<{ data: any[] }> },
    sellerId?: string
  ) {
    const sheet = await this.getOrCreateCharacterSheet(customerId)
    const patch: Record<string, unknown> = { id: sheet.id }

    // Buyer impact → orders completed.
    try {
      const { data } = await query.graph({
        entity: "buyer_impact",
        fields: ["total_orders"],
        filters: { customer_id: customerId },
      })
      if (data?.[0]) patch.orders_completed = Number(data[0].total_orders ?? 0)
    } catch {
      /* module absent — leave snapshot as-is */
    }

    // Karma events → karma sum.
    try {
      const { data } = await query.graph({
        entity: "karma_event",
        fields: ["delta"],
        filters: { owner_id: customerId },
      })
      if (Array.isArray(data)) {
        patch.karma = data.reduce((sum, e) => sum + Number(e.delta ?? 0), 0)
      }
    } catch {
      /* ignore */
    }

    // Volunteer time credits → contributions + credit sum.
    try {
      const { data } = await query.graph({
        entity: "time_credit",
        fields: ["credit_amount"],
        filters: { customer_id: customerId },
      })
      if (Array.isArray(data)) {
        patch.time_credits = data.reduce(
          (sum, c) => sum + Number(c.credit_amount ?? 0),
          0
        )
        patch.mutual_aid_contributions = data.length
      }
    } catch {
      /* ignore */
    }

    // Seller-scoped aggregates (producer trust + revenue) when a seller id is known.
    if (sellerId) {
      try {
        const { data } = await query.graph({
          entity: "vendor_verification",
          fields: ["trust_score"],
          filters: { seller_id: sellerId },
        })
        if (data?.[0]) patch.trust_score = Number(data[0].trust_score ?? 0)
      } catch {
        /* ignore */
      }
      try {
        const { data } = await query.graph({
          entity: "producer_impact",
          fields: ["total_revenue"],
          filters: { seller_id: sellerId },
        })
        if (data?.[0]) patch.food_produced_cents = Number(data[0].total_revenue ?? 0)
      } catch {
        /* ignore */
      }
    }

    patch.last_recomputed_at = new Date()
    await this.updateCharacterSheets(patch)
    return this.getOrCreateCharacterSheet(customerId)
  }

  /**
   * Grant any titles whose role-level threshold the customer now meets.
   * Returns the slugs newly granted. Mirrors `checkAndGrantBuyerBadges`.
   */
  async checkAndGrantTitles(customerId: string): Promise<string[]> {
    const sheet = await this.getOrCreateCharacterSheet(customerId)
    let titles = await this.listProgressionTitles({ active: true })

    // Lazily seed the default catalog the first time it's needed. The repo
    // seeds on-demand rather than via a startup loader, so do the same here.
    if (titles.length === 0) {
      await this.seedDefaultTitles()
      titles = await this.listProgressionTitles({ active: true })
    }

    const earnedRaw = sheet.earned_titles as unknown
    const earned: EarnedTitle[] = Array.isArray(earnedRaw)
      ? (earnedRaw as EarnedTitle[])
      : []
    const earnedSlugs = new Set(earned.map((t) => t.title_slug))

    const newlyEarned: string[] = []
    for (const title of titles) {
      if (earnedSlugs.has(title.slug)) continue
      const col = XP_COLUMN[title.role as Stance]
      if (!col) continue
      const roleLevel = Number((sheet as Record<string, unknown>)[col.level] ?? 0)
      if (roleLevel >= title.min_level) {
        earned.push({ title_slug: title.slug, role: title.role, earned_at: new Date() })
        newlyEarned.push(title.slug)
      }
    }

    if (newlyEarned.length > 0) {
      await this.updateCharacterSheets({
        id: sheet.id,
        earned_titles: earned as unknown as Record<string, unknown>,
      })
    }
    return newlyEarned
  }

  /**
   * Display shape for the storefront `/character` page and `/store/character`.
   */
  async getCharacterSheetSummary(customerId: string) {
    const sheet = await this.getOrCreateCharacterSheet(customerId)
    const titles = await this.listProgressionTitles({ active: true })
    const titleBySlug = new Map(titles.map((t) => [t.slug, t]))

    const tracks = (Object.keys(XP_COLUMN) as Stance[]).map((stance) => {
      const col = XP_COLUMN[stance]
      const xp = Number((sheet as Record<string, unknown>)[col.xp] ?? 0)
      const progress = levelProgress(xp)
      return {
        role: stance,
        xp,
        level: progress.level,
        xpIntoLevel: progress.xpIntoLevel,
        xpForNextLevel: progress.xpForNextLevel,
        pct: progress.pct,
      }
    })

    const earnedRaw = sheet.earned_titles as unknown
    const earned: EarnedTitle[] = Array.isArray(earnedRaw)
      ? (earnedRaw as EarnedTitle[])
      : []
    const earnedTitles = earned.map((e) => {
      const def = titleBySlug.get(e.title_slug)
      return {
        slug: e.title_slug,
        role: e.role,
        name: def?.name ?? e.title_slug,
        description: def?.description ?? "",
        icon: def?.icon ?? "award",
        color: def?.color ?? "#6B7280",
        earnedAt: e.earned_at,
      }
    })

    return {
      customerId: sheet.customer_id,
      activeStance: sheet.active_stance,
      totalXp: Number(sheet.total_xp ?? 0),
      tracks,
      stats: {
        foodProducedCents: Number(sheet.food_produced_cents ?? 0),
        ordersCompleted: Number(sheet.orders_completed ?? 0),
        capitalDeployedCents: Number(sheet.capital_deployed_cents ?? 0),
        mutualAidContributions: Number(sheet.mutual_aid_contributions ?? 0),
        trustScore: Number(sheet.trust_score ?? 0),
        karma: Number(sheet.karma ?? 0),
        timeCredits: Number(sheet.time_credits ?? 0),
      },
      titles: earnedTitles,
      lastRecomputedAt: sheet.last_recomputed_at,
    }
  }

  /**
   * Seed the default title catalog (idempotent).
   */
  async seedDefaultTitles(): Promise<void> {
    for (const title of DEFAULT_TITLES) {
      const existing = await this.listProgressionTitles({ slug: title.slug })
      if (existing.length === 0) {
        await this.createProgressionTitles(title)
      }
    }
  }
}

export default ProgressionModuleService
export { isStance }
