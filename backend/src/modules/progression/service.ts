import { MedusaService, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CharacterSheet,
  XpEvent,
  ProgressionTitle,
  XpRedemption,
  XpAttestation,
} from "./models"
import { XpRedemptionStatus, XpRewardKind } from "./models/xp-redemption"
import { Stance, isStance } from "./stance"
import { levelForXp, levelProgress, ROLE_XP_WEIGHTS } from "./leveling"
import { unlockedFeatures, nextUnlock } from "./thresholds"
import { getXpReward, XP_REWARDS, type XpReward } from "./rewards"

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

/** Raised when a redemption is attempted with insufficient spendable XP. */
export class InsufficientXpError extends Error {
  constructor(public required: number, public available: number) {
    super(`Insufficient spendable XP: need ${required}, have ${available}`)
    this.name = "InsufficientXpError"
  }
}

/** Raised when an attestation names the same account as subject and attester. */
export class SelfAttestationError extends Error {
  constructor(public customerId: string) {
    super(`Self-attestation is not allowed for customer ${customerId}`)
    this.name = "SelfAttestationError"
  }
}

/** Attestation weight is clamped to this range to bound any single award. */
export const ATTESTATION_WEIGHT_MIN = 0.5
export const ATTESTATION_WEIGHT_MAX = 2

class ProgressionModuleService extends MedusaService({
  CharacterSheet,
  XpEvent,
  ProgressionTitle,
  XpRedemption,
  XpAttestation,
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

    // Spendable balance accrues alongside lifetime XP. Earning lifts both;
    // a clawback (negative amount) also reduces the spendable balance, floored
    // at 0 so it can never go negative from an earn event.
    const newSpendableXp = Math.max(
      0,
      Number(sheet.spendable_xp ?? 0) + weighted
    )

    await this.updateCharacterSheets({
      id: sheet.id,
      [col.xp]: newRoleXp,
      [col.level]: levelForXp(newRoleXp),
      total_xp: newTotalXp,
      spendable_xp: newSpendableXp,
    })

    await this.checkAndGrantTitles(data.customer_id)

    return this.getOrCreateCharacterSheet(data.customer_id)
  }

  /**
   * Record an XP event vouched for by a *trusted peer* (the attester), writing
   * an `xp_attestation` row and awarding `base × weight`.
   *
   * This is the anti-karma-farming control: high-trust XP is granted only when
   * someone other than the subject confirms the value. Self-attestation is
   * rejected. The weight (default 1) is clamped to [ATTESTATION_WEIGHT_MIN,
   * ATTESTATION_WEIGHT_MAX] so no single attestation can over-inflate an award.
   *
   * @throws SelfAttestationError when attester and subject are the same account.
   */
  async recordAttestedXpEvent(
    data: {
      customer_id: string
      role: Stance
      amount: number
      reason: string
      source_module?: string
      source_id?: string
      metadata?: Record<string, unknown>
    },
    opts: {
      attesterId: string
      weight?: number
    }
  ) {
    if (!opts.attesterId || opts.attesterId === data.customer_id) {
      throw new SelfAttestationError(data.customer_id)
    }

    const clamped = Math.min(
      ATTESTATION_WEIGHT_MAX,
      Math.max(ATTESTATION_WEIGHT_MIN, opts.weight ?? 1)
    )

    await this.createXpAttestations({
      subject_customer_id: data.customer_id,
      attester_customer_id: opts.attesterId,
      source_module: data.source_module ?? null,
      source_id: data.source_id ?? null,
      weight: clamped,
      reason: data.reason,
      metadata: (data.metadata as Record<string, unknown>) ?? null,
    })

    return this.recordXpEvent({
      ...data,
      amount: Math.max(1, Math.round(data.amount * clamped)),
      metadata: { ...(data.metadata ?? {}), attested_by: opts.attesterId, weight: clamped },
    })
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

    // Collective-campaign backings → capital deployed.
    try {
      const { data } = await query.graph({
        entity: "collective_backing",
        fields: ["amount"],
        filters: { backer_id: customerId },
      })
      if (Array.isArray(data)) {
        patch.capital_deployed_cents = data.reduce(
          (sum, b) => sum + Number(b.amount ?? 0),
          0
        )
      }
    } catch {
      /* module absent — leave snapshot as-is */
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

  /** The current spendable-XP balance for a customer. */
  async getSpendableXp(customerId: string): Promise<number> {
    const sheet = await this.getOrCreateCharacterSheet(customerId)
    return Number(sheet.spendable_xp ?? 0)
  }

  /**
   * Apply demurrage to a single sheet: reduce the **spendable** balance only.
   *
   * Unlike `recordXpEvent`'s negative path, this NEVER touches `total_xp`, role
   * XP, levels, or titles — lifetime status is permanent (ADR-0003). Writes an
   * audited `xp_event` (`reason: "demurrage"`) so the decay is reversible.
   * `amount` is the positive decay magnitude; the balance is floored at 0.
   */
  async recordDemurrage(customerId: string, amount: number) {
    const decay = Math.max(0, Math.round(amount))
    if (decay === 0) return this.getOrCreateCharacterSheet(customerId)

    const sheet = await this.getOrCreateCharacterSheet(customerId)
    const current = Number(sheet.spendable_xp ?? 0)
    const next = Math.max(0, current - decay)
    const applied = current - next // never more than the balance

    if (applied <= 0) return sheet

    await this.createXpEvents({
      customer_id: customerId,
      // Demurrage is balance-level, not role-level; attribute to the active
      // stance for the audit trail without affecting any role track.
      role: (sheet.active_stance as Stance) ?? Stance.CONSUMER,
      amount: -applied,
      reason: "demurrage",
      source_module: "demurrage-job",
      source_id: null,
      occurred_at: new Date(),
      metadata: { kind: "demurrage" },
    })

    await this.updateCharacterSheets({ id: sheet.id, spendable_xp: next })
    return this.getOrCreateCharacterSheet(customerId)
  }

  /**
   * Sweep all sheets and decay spendable XP above a grace floor.
   *
   * Only the portion of `spendable_xp` *above* `minBalance` decays, so small
   * balances never erode below the floor. `rate` is a fraction (e.g. 0.02 = 2%
   * per period). Each sheet is processed in its own try/catch so one failure
   * can't abort the sweep. Returns a per-sheet summary for logging.
   */
  async applyDemurrage(opts: {
    rate: number
    minBalance?: number
  }): Promise<Array<{ customer_id: string; decayed: number; error?: string }>> {
    const rate = Math.min(1, Math.max(0, opts.rate))
    const minBalance = Math.max(0, opts.minBalance ?? 0)
    const results: Array<{ customer_id: string; decayed: number; error?: string }> = []
    if (rate === 0) return results

    const sheets = await this.listCharacterSheets({
      spendable_xp: { $gt: minBalance },
    })

    for (const sheet of sheets) {
      const customerId = sheet.customer_id as string
      try {
        const spendable = Number(sheet.spendable_xp ?? 0)
        const decay = Math.round((spendable - minBalance) * rate)
        if (decay <= 0) {
          results.push({ customer_id: customerId, decayed: 0 })
          continue
        }
        await this.recordDemurrage(customerId, decay)
        results.push({ customer_id: customerId, decayed: decay })
      } catch (error: any) {
        results.push({ customer_id: customerId, decayed: 0, error: error?.message })
      }
    }

    return results
  }

  /** The redeemable reward catalog, annotated with affordability for a balance. */
  listRewards(balance = 0): Array<XpReward & { affordable: boolean }> {
    return XP_REWARDS.map((r) => ({ ...r, affordable: balance >= r.xpCost }))
  }

  /**
   * Resolve a knex-style pg connection with a `.raw` method, for atomic
   * conditional updates that MedusaService's generated CRUD can't express.
   * Mirrors the resolver in modules/hawala-ledger/service.ts. Returns undefined
   * when no connection is reachable (e.g. unit tests without DI).
   */
  private resolvePgConnection():
    | { raw: (sql: string, bindings?: any[]) => Promise<any> }
    | undefined {
    const container = (this as any).__container__
    try {
      const pg =
        container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]
      if (pg?.raw) return pg
    } catch {
      // fall through
    }
    try {
      const em =
        (this as any).baseRepository_?.getActiveManager?.() ??
        container?.manager
      const knex = em?.getConnection?.()?.getKnex?.()
      if (knex?.raw) return knex
    } catch {
      // no reachable connection
    }
    return undefined
  }

  /**
   * Atomically debit spendable XP via a single conditional UPDATE
   * (`spendable_xp = spendable_xp - cost WHERE spendable_xp >= cost`). This is a
   * true DB-level compare-and-swap that prevents the redemption double-spend.
   *
   * @returns `true` when the debit committed, `false` when the balance was
   * insufficient (0 rows updated), or `null` when no pg connection is reachable
   * so the caller can fall back to a read-modify-write.
   */
  private async atomicDebitSpendableXp(
    sheetId: string,
    cost: number
  ): Promise<boolean | null> {
    const pg = this.resolvePgConnection()
    if (!pg) return null

    const result = await pg.raw(
      `UPDATE character_sheet
          SET spendable_xp = spendable_xp - ?,
              updated_at = NOW()
        WHERE id = ?
          AND deleted_at IS NULL
          AND spendable_xp >= ?`,
      [cost, sheetId, cost]
    )

    const rowCount =
      typeof result?.rowCount === "number"
        ? result.rowCount
        : typeof result?.rows?.length === "number" && result.rowCount === undefined
          ? result.rows.length
          : result?.rowCount

    return !!rowCount
  }

  /**
   * Debit spendable XP and open a `pending` redemption for a catalog reward.
   *
   * This is the money-movement half of a redemption; the caller (an API route
   * or workflow) is responsible for granting the entitlement and then calling
   * `completeRedemption` — or `refundRedemption` if granting fails. Splitting
   * it this way keeps the cross-module entitlement grant out of this module
   * while guaranteeing XP is never spent without an audit row.
   *
   * @throws InsufficientXpError when the balance can't cover the reward.
   */
  async beginRedemption(customerId: string, rewardKey: string) {
    const reward = getXpReward(rewardKey)
    if (!reward) {
      throw new Error(`Unknown reward: ${rewardKey}`)
    }

    const sheet = await this.getOrCreateCharacterSheet(customerId)

    // Debit with a DB-level compare-and-swap so concurrent redemptions can't
    // double-spend. The previous read-check-then-write let two simultaneous
    // requests both pass the balance check and both write `balance - cost`,
    // granting two entitlements for a single debit (TOCTOU lost update).
    const debited = await this.atomicDebitSpendableXp(sheet.id, reward.xpCost)
    if (debited === false) {
      throw new InsufficientXpError(reward.xpCost, Number(sheet.spendable_xp ?? 0))
    }
    if (debited === null) {
      // No pg connection reachable (e.g. unit tests without DI). Fall back to
      // the legacy read-modify-write, which is still correct single-threaded.
      const balance = Number(sheet.spendable_xp ?? 0)
      if (balance < reward.xpCost) {
        throw new InsufficientXpError(reward.xpCost, balance)
      }
      await this.updateCharacterSheets({
        id: sheet.id,
        spendable_xp: balance - reward.xpCost,
      })
    }

    const [redemption] = await this.createXpRedemptions([
      {
        customer_id: customerId,
        reward_key: reward.key,
        reward_name: reward.name,
        reward_kind: reward.kind,
        xp_cost: reward.xpCost,
        feature_key: reward.featureKey,
        status: XpRedemptionStatus.PENDING,
        metadata: { entitlement_kind: reward.entitlementKind },
      },
    ])

    return { redemption, reward }
  }

  /**
   * Debit an arbitrary amount of spendable XP and open a `pending` redemption
   * row for a NON-catalog spend (e.g. the creator XP → Coalition Credits
   * conversion, where the debit amount is a whole-block multiple, not a fixed
   * reward price).
   *
   * Same split as `beginRedemption`: the caller performs the downstream effect
   * (minting credits) and then calls `completeRedemption` — or
   * `refundRedemption` if that effect fails — so XP is never spent without an
   * audit row and is never lost on a downstream failure. The returned
   * `redemption.id` is a stable handle the caller can use as an idempotency key.
   *
   * Only spendable XP is touched; lifetime `total_xp`, role tracks, levels, and
   * titles are untouched (dual-balance, ADR-0003).
   *
   * @throws InsufficientXpError when the balance can't cover `xpAmount`.
   */
  async beginXpConversion(customerId: string, xpAmount: number) {
    const cost = Math.floor(xpAmount)
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new Error(`xpAmount must be a positive number (got ${xpAmount})`)
    }

    const sheet = await this.getOrCreateCharacterSheet(customerId)

    // Same DB-level compare-and-swap as beginRedemption so concurrent debits
    // can't double-spend the balance (TOCTOU lost update).
    const debited = await this.atomicDebitSpendableXp(sheet.id, cost)
    if (debited === false) {
      throw new InsufficientXpError(cost, Number(sheet.spendable_xp ?? 0))
    }
    if (debited === null) {
      // No pg connection reachable (unit tests without DI): fall back to the
      // read-modify-write, still correct single-threaded.
      const balance = Number(sheet.spendable_xp ?? 0)
      if (balance < cost) {
        throw new InsufficientXpError(cost, balance)
      }
      await this.updateCharacterSheets({ id: sheet.id, spendable_xp: balance - cost })
    }

    const [redemption] = await this.createXpRedemptions([
      {
        customer_id: customerId,
        reward_key: "creator-credit-conversion",
        reward_name: "XP → Coalition Credits",
        reward_kind: XpRewardKind.ENTITLEMENT,
        xp_cost: cost,
        feature_key: null,
        status: XpRedemptionStatus.PENDING,
        metadata: { kind: "xp_credit_conversion" },
      },
    ])

    return { redemption }
  }

  /** Mark a redemption fulfilled and record the granted entitlement. */
  async completeRedemption(redemptionId: string, entitlementId?: string) {
    const [updated] = await this.updateXpRedemptions([
      {
        id: redemptionId,
        status: XpRedemptionStatus.FULFILLED,
        entitlement_id: entitlementId ?? null,
        fulfilled_at: new Date(),
      },
    ])
    return updated
  }

  /**
   * Refund a redemption: credit the XP back and mark it refunded. Used when the
   * downstream entitlement grant fails so XP is never lost.
   */
  async refundRedemption(redemptionId: string) {
    const [redemption] = await this.listXpRedemptions({ id: redemptionId })
    if (!redemption) {
      throw new Error(`Unknown redemption: ${redemptionId}`)
    }
    if (redemption.status === XpRedemptionStatus.REFUNDED) {
      return redemption
    }

    const sheet = await this.getOrCreateCharacterSheet(redemption.customer_id)
    await this.updateCharacterSheets({
      id: sheet.id,
      spendable_xp: Number(sheet.spendable_xp ?? 0) + Number(redemption.xp_cost),
    })

    const [updated] = await this.updateXpRedemptions([
      { id: redemptionId, status: XpRedemptionStatus.REFUNDED },
    ])
    return updated
  }

  /** A customer's redemption history, newest first. */
  async listRedemptionsForCustomer(customerId: string) {
    const items = await this.listXpRedemptions({ customer_id: customerId })
    return items.sort(
      (a, b) =>
        new Date(b.created_at as unknown as string).getTime() -
        new Date(a.created_at as unknown as string).getTime()
    )
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

    const totalXp = Number(sheet.total_xp ?? 0)
    const trackSnapshots = tracks.map((t) => ({ role: t.role, level: t.level, xp: t.xp }))
    const next = nextUnlock(trackSnapshots, totalXp)

    return {
      customerId: sheet.customer_id,
      activeStance: sheet.active_stance,
      totalXp,
      spendableXp: Number(sheet.spendable_xp ?? 0),
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
      // Threshold privileges are derived (auto-lapsing): the keys unlocked now,
      // plus the closest upcoming unlock for just-in-time "you're close" guidance.
      unlockedFeatures: unlockedFeatures(trackSnapshots, totalXp),
      nextUnlock: next
        ? { featureKey: next.featureKey, label: next.label, blurb: next.blurb, xpToGo: next.xpToGo }
        : null,
      lastRecomputedAt: sheet.last_recomputed_at,
    }
  }

  /** The internal-benefit featureKeys a customer has currently unlocked. */
  async getUnlockedFeatures(customerId: string): Promise<string[]> {
    const summary = await this.getCharacterSheetSummary(customerId)
    return summary.unlockedFeatures
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
