import type { Context } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  InjectTransactionManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils"
import { randomBytes, createHmac } from "crypto"
import AffiliateLink, {
  AffiliateLinkStatus,
} from "./models/affiliate-link"
import PromoCodeBinding, {
  PromoCodeBindingStatus,
} from "./models/promo-code-binding"
import AttributionClickEvent from "./models/click-event"
import OrderAttribution, {
  AttributionSource,
  AttributionModel,
  CommissionStatus,
} from "./models/order-attribution"
import AnalyticsEvent from "./models/analytics-event"
import {
  allocateCommission,
  capLevels,
  parseLevelSplitsEnv,
  walkReferrerChain,
} from "./utils/referral-chain"
import { AMOUNT_UNIT_MINOR } from "../../shared/minor-units"

const DEFAULT_COOKIE_WINDOW_DAYS = (() => {
  const v = process.env.CREATOR_ATTRIBUTION_DEFAULT_COOKIE_DAYS
  const n = v ? parseInt(v, 10) : 7
  return Number.isFinite(n) && n > 0 ? n : 7
})()

const DEFAULT_HOLD_DAYS = (() => {
  const v = process.env.CREATOR_ATTRIBUTION_DEFAULT_HOLD_DAYS
  const n = v ? parseInt(v, 10) : 7
  return Number.isFinite(n) && n > 0 ? n : 7
})()

const SHORT_CODE_PREFIX = "fbm_"

function generateShortCode(): string {
  const random = randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)
  return `${SHORT_CODE_PREFIX}${random.toLowerCase()}`
}

export interface GenerateLinkInput {
  creatorSellerId: string
  vendorId?: string | null
  dealId?: string | null
  programId?: string | null
  productId?: string | null
  collectionId?: string | null
  destinationPath?: string
  utmMedium?: string | null
  utmCampaign?: string | null
  utmContent?: string | null
  allowedOrigins?: string[] | null
  metadata?: Record<string, unknown> | null
}

export interface RecordClickInput {
  shortCode: string
  visitorToken: string
  ipHash?: string | null
  userAgentHash?: string | null
  referrer?: string | null
  country?: string | null
  customerId?: string | null
  fingerprint?: string | null
  isBotSuspected?: boolean
  occurredAt?: Date
}

export interface AttributeOrderInput {
  orderId: string
  customerId?: string | null
  /**
   * The seller the buying customer belongs to, when they are themselves a
   * seller. Resolved by the caller (which has a container) via mxid, because
   * `customerId` and `creatorSellerId` live in different namespaces and can
   * never be compared directly — see the self-purchase guard below.
   */
  buyerSellerId?: string | null
  visitorToken?: string | null
  shortCode?: string | null
  appliedPromoCodes?: string[] | null
  /**
   * The order subtotal as an integer in the currency's MINOR unit (cents for
   * USD). Medusa's `order.subtotal` is MAJOR units; convert it with
   * `toMinorUnits` (`shared/minor-units.ts`) first. It is stored as-is in
   * `attributed_subtotal_cents` / `commission_basis_cents`, and the
   * commission taken on it is what the payout breakdown, the ledger credit
   * and its refund reversal read as cents (SD-95).
   */
  subtotalCents: number
  currencyCode?: string
  source?: AttributionSource
  metadata?: Record<string, unknown> | null
}

/**
 * One row of the corrective script's write (SD-95,
 * `scripts/fix-creator-commission-minor-units.ts`): the figures the
 * correction was planned from and the ones it writes.
 */
export type AttributionAmountCorrection = {
  id: string
  /** The `commission_status` the correction was planned from. */
  status: string
  from: { subtotal_cents: number; commission_cents: number }
  to: { subtotal_cents: number; commission_cents: number }
  /** Stored under `metadata.amount_units_corrected`. */
  record: Record<string, unknown>
}

/** A row no longer matched what its correction was planned from. */
class StaleAttributionError extends Error {
  constructor(readonly attributionId: string) {
    super(`order_attribution ${attributionId} changed since it was read`)
  }
}

type SqlManager = {
  execute(sql: string, params: unknown[], method: "all"): Promise<unknown[]>
}

/**
 * A bigNumber column's `raw_*` JSONB companion, written from the same bound
 * value as the NUMERIC column (the governance tally's expression), so the ORM
 * reads back what the column holds.
 */
const rawBigNumber = (col: string) =>
  `jsonb_build_object('value', trim_scale(CAST(? AS numeric))::text, ` +
  `'precision', COALESCE(("raw_${col}" ->> 'precision')::int, 20))`

class CreatorAttributionService extends MedusaService({
  AffiliateLink,
  PromoCodeBinding,
  AttributionClickEvent,
  OrderAttribution,
  AnalyticsEvent,
}) {
  /**
   * Generate a new affiliate link with a unique short code.
   * Retries on collision; in practice 8 chars of base32 is far more than enough.
   */
  async generateLink(input: GenerateLinkInput): Promise<typeof AffiliateLink> {
    let shortCode = generateShortCode()
    for (let i = 0; i < 5; i++) {
      const existing = await this.listAffiliateLinks({ short_code: shortCode })
      if (existing.length === 0) break
      shortCode = generateShortCode()
    }

    const destinationPath = input.destinationPath ?? this.defaultDestination(input)

    const link = await (this as any).createAffiliateLinks({
      short_code: shortCode,
      creator_seller_id: input.creatorSellerId,
      vendor_id: input.vendorId ?? null,
      deal_id: input.dealId ?? null,
      program_id: input.programId ?? null,
      product_id: input.productId ?? null,
      collection_id: input.collectionId ?? null,
      destination_path: destinationPath,
      utm_source: "creator",
      utm_medium: input.utmMedium ?? null,
      utm_campaign: input.utmCampaign ?? null,
      utm_content: input.utmContent ?? null,
      allowed_origins: input.allowedOrigins ?? null,
      metadata: input.metadata ?? null,
    })
    return link
  }

  private defaultDestination(input: GenerateLinkInput): string {
    if (input.productId) return `/products/${input.productId}`
    if (input.collectionId) return `/collections/${input.collectionId}`
    return "/"
  }

  async resolveShortCode(shortCode: string): Promise<{
    link: any
    redirectUrl: string
  } | null> {
    const links = await this.listAffiliateLinks({ short_code: shortCode })
    if (links.length === 0) return null
    const link = links[0]
    if (link.status !== AffiliateLinkStatus.ACTIVE) return null

    const params = new URLSearchParams()
    if (link.utm_source) params.set("utm_source", link.utm_source)
    if (link.utm_medium) params.set("utm_medium", link.utm_medium)
    if (link.utm_campaign) params.set("utm_campaign", link.utm_campaign)
    if (link.utm_content) params.set("utm_content", link.utm_content)
    params.set("fbm_ref", link.short_code)

    const sep = link.destination_path.includes("?") ? "&" : "?"
    const redirectUrl = `${link.destination_path}${sep}${params.toString()}`

    return { link, redirectUrl }
  }

  async recordClick(input: RecordClickInput): Promise<any> {
    const links = await this.listAffiliateLinks({ short_code: input.shortCode })
    if (links.length === 0) {
      throw new Error(`Affiliate link not found for short code: ${input.shortCode}`)
    }
    const link = links[0]

    const event = await (this as any).createAttributionClickEvents({
      short_code: input.shortCode,
      affiliate_link_id: link.id,
      creator_seller_id: link.creator_seller_id,
      visitor_token: input.visitorToken,
      ip_hash: input.ipHash ?? null,
      user_agent_hash: input.userAgentHash ?? null,
      referrer: input.referrer ?? null,
      country: input.country ?? null,
      customer_id: input.customerId ?? null,
      fingerprint: input.fingerprint ?? null,
      is_bot_suspected: input.isBotSuspected ?? false,
      occurred_at: input.occurredAt ?? new Date(),
    })

    if (!input.isBotSuspected) {
      await this.atomicIncrementAffiliateLink("click_count", link.id)
    }

    return event
  }

  async lastClickForVisitor(visitorToken: string, withinDays: number): Promise<any | null> {
    const since = new Date()
    since.setDate(since.getDate() - withinDays)
    const events = await this.listAttributionClickEvents(
      {
        visitor_token: visitorToken,
        is_bot_suspected: false,
      },
      { order: { occurred_at: "DESC" }, take: 1 }
    )
    const ev = events[0]
    if (!ev) return null
    const occurred = new Date(ev.occurred_at as any)
    if (occurred < since) return null
    return ev
  }

  async firstClickForVisitor(visitorToken: string, withinDays: number): Promise<any | null> {
    const since = new Date()
    since.setDate(since.getDate() - withinDays)
    const events = await this.listAttributionClickEvents(
      {
        visitor_token: visitorToken,
        is_bot_suspected: false,
      },
      { order: { occurred_at: "ASC" }, take: 1 }
    )
    const ev = events[0]
    if (!ev) return null
    const occurred = new Date(ev.occurred_at as any)
    if (occurred < since) return null
    return ev
  }

  async bindPromoCode(args: {
    promotionId: string
    promotionCode: string
    creatorSellerId: string
    dealId?: string | null
    programId?: string | null
    vendorId?: string | null
  }): Promise<any> {
    const existing = await this.listPromoCodeBindings({
      promotion_code: args.promotionCode,
    })
    if (existing.length > 0) {
      return (this as any).updatePromoCodeBindings({
        id: existing[0].id,
        creator_seller_id: args.creatorSellerId,
        deal_id: args.dealId ?? null,
        program_id: args.programId ?? null,
        vendor_id: args.vendorId ?? null,
        status: PromoCodeBindingStatus.ACTIVE,
      })
    }
    return (this as any).createPromoCodeBindings({
      promotion_id: args.promotionId,
      promotion_code: args.promotionCode,
      creator_seller_id: args.creatorSellerId,
      deal_id: args.dealId ?? null,
      program_id: args.programId ?? null,
      vendor_id: args.vendorId ?? null,
    })
  }

  async resolvePromoCodeBinding(code: string): Promise<any | null> {
    const bindings = await this.listPromoCodeBindings({ promotion_code: code })
    const b = bindings[0]
    if (!b) return null
    if (b.status !== PromoCodeBindingStatus.ACTIVE) return null
    return b
  }

  /**
   * Decide the creator attribution for a placed order. Returns the created
   * `OrderAttribution` row, or `null` if no creator is attributable.
   *
   * Attribution priority:
   *  1. PromoCodeBinding with priority OVERRIDE_LINK (a creator-bound coupon
   *     trumps last-click).
   *  2. Last click within the cookie window.
   *  3. PromoCodeBinding with priority FALLBACK or TIE_BREAKER.
   */
  async attributeOrder(input: AttributeOrderInput): Promise<any | null> {
    const existing = await this.listOrderAttributions({ order_id: input.orderId })
    if (existing.length > 0) return existing[0]

    const codes = (input.appliedPromoCodes ?? []).filter(Boolean)
    const bindings: any[] = []
    for (const code of codes) {
      const b = await this.resolvePromoCodeBinding(code)
      if (b) bindings.push(b)
    }

    const overrideBinding = bindings.find(
      (b) => b.attribution_priority === "override_link"
    )

    let lastClick: any | null = null
    if (input.visitorToken) {
      lastClick = await this.lastClickForVisitor(
        input.visitorToken,
        DEFAULT_COOKIE_WINDOW_DAYS
      )
    }

    let chosen: {
      source: AttributionSource
      creatorSellerId: string
      affiliateLinkId: string | null
      promoCodeBindingId: string | null
      dealId: string | null
      programId: string | null
      vendorId: string | null
      clickEventId: string | null
      commissionPercent: number | null
    } | null = null

    if (overrideBinding) {
      chosen = {
        source: AttributionSource.PROMO_CODE,
        creatorSellerId: overrideBinding.creator_seller_id,
        affiliateLinkId: null,
        promoCodeBindingId: overrideBinding.id,
        dealId: overrideBinding.deal_id,
        programId: overrideBinding.program_id,
        vendorId: overrideBinding.vendor_id,
        clickEventId: null,
        commissionPercent: null,
      }
    } else if (lastClick) {
      const links = await this.listAffiliateLinks({ id: lastClick.affiliate_link_id })
      const link = links[0]
      if (link && link.status === AffiliateLinkStatus.ACTIVE) {
        chosen = {
          source: AttributionSource.LINK_CLICK,
          creatorSellerId: link.creator_seller_id,
          affiliateLinkId: link.id,
          promoCodeBindingId: null,
          dealId: link.deal_id,
          programId: link.program_id,
          vendorId: link.vendor_id,
          clickEventId: lastClick.id,
          commissionPercent: null,
        }
      }
    } else if (bindings.length > 0) {
      const fallback = bindings[0]
      chosen = {
        source: AttributionSource.PROMO_CODE,
        creatorSellerId: fallback.creator_seller_id,
        affiliateLinkId: null,
        promoCodeBindingId: fallback.id,
        dealId: fallback.deal_id,
        programId: fallback.program_id,
        vendorId: fallback.vendor_id,
        clickEventId: null,
        commissionPercent: null,
      }
    }

    if (!chosen) return null

    // Self-purchase guard.
    //
    // This compared `input.customerId` (a `cus_*` id) against
    // `chosen.creatorSellerId` (a `sel_*` id) and so could never return true:
    // it read as a control to every reviewer and was none. A creator could
    // attribute their own purchase to themselves and earn the commission.
    //
    // The comparison now runs on `buyerSellerId`, which the caller resolves
    // through `seller_metadata.mxid` — the identity column carrying a
    // partial-unique index. `blackout_user_id` is only indexed, so two seller
    // rows can share it and a check keyed there would be bypassable by
    // registering a second seller against the same Blackout account.
    //
    // A buyer with no resolvable seller identity is not a self-purchase, so
    // attribution proceeds: this guard exists to catch a creator buying
    // through their own link, not to gate anonymous buyers.
    if (input.buyerSellerId && input.buyerSellerId === chosen.creatorSellerId) {
      return null
    }

    // A fraction of a cent is never a minor-unit amount: it is a major-unit
    // figure ($25.50 as 25.5) handed in unconverted, which is how SD-95
    // stored every commission at 1/100. Refused rather than stored, so the
    // mistake is a logged error, not a wrong payout. (A whole-dollar major
    // figure cannot be told apart here; the caller's conversion is the fix.)
    if (!Number.isSafeInteger(input.subtotalCents) || input.subtotalCents <= 0) {
      throw new Error(
        `attributeOrder: subtotalCents must be a positive integer in minor units, got ${String(input.subtotalCents)}`
      )
    }

    const commissionPercent = chosen.commissionPercent ?? this.resolveDefaultCommissionPercent()
    const subtotal = input.subtotalCents
    const commissionAmount = Math.floor((subtotal * commissionPercent) / 100)

    // Multi-level referral chain — only walked when the feature flag is on
    // and a program is associated. Otherwise a single L1 row is written
    // exactly like before.
    const multiLevelEnabled = process.env.FBM_MULTILEVEL_REFERRALS === "1"
    let chain: string[] = [chosen.creatorSellerId]
    let levelSplits = parseLevelSplitsEnv(
      process.env.FBM_REFERRAL_DEFAULT_SPLITS
    )
    let maxLevels = 1
    let programReferralModel: any = null

    if (multiLevelEnabled) {
      programReferralModel = await this.loadProgramReferralConfig(
        chosen.programId
      )
      maxLevels = capLevels(programReferralModel?.max_referral_levels ?? 1)
      if (programReferralModel?.referral_level_splits) {
        levelSplits = programReferralModel.referral_level_splits
      }
      if (maxLevels > 1) {
        chain = await walkReferrerChain({
          primarySellerId: chosen.creatorSellerId,
          maxLevels,
          lookupReferrer: (sellerId) => this.lookupReferrer(sellerId),
        })
      }
    }

    const perLevelCents = allocateCommission({
      totalCents: commissionAmount,
      levels: chain.length,
      splits: levelSplits,
    })

    const baseRow = {
      order_id: input.orderId,
      customer_id: input.customerId ?? null,
      affiliate_link_id: chosen.affiliateLinkId,
      promo_code_binding_id: chosen.promoCodeBindingId,
      deal_id: chosen.dealId,
      program_id: chosen.programId,
      vendor_id: chosen.vendorId,
      source: chosen.source,
      attribution_model: AttributionModel.LAST_CLICK,
      click_event_id: chosen.clickEventId,
      cookie_window_days: DEFAULT_COOKIE_WINDOW_DAYS,
      attribution_decided_at: new Date(),
      attributed_subtotal_cents: subtotal,
      commission_basis_cents: subtotal,
      commission_percent: commissionPercent,
      currency_code: input.currencyCode ?? "usd",
      commission_status: CommissionStatus.PENDING,
      metadata: input.metadata ?? null,
    }

    let parentAttributionId: string | null = null
    let primaryAttribution: any = null

    for (let i = 0; i < chain.length; i++) {
      const level = i + 1
      const levelKey = `L${level}`
      const splitPercent =
        typeof levelSplits[levelKey] === "number"
          ? levelSplits[levelKey]
          : null

      const row = await (this as any).createOrderAttributions({
        ...baseRow,
        creator_seller_id: chain[i],
        commission_amount_cents: perLevelCents[i] ?? 0,
        level,
        parent_attribution_id: parentAttributionId,
        level_split_percent: splitPercent,
      })
      if (level === 1) primaryAttribution = row
      parentAttributionId = row.id
    }

    if (chosen.affiliateLinkId) {
      await this.atomicIncrementAffiliateLink(
        "attributed_order_count",
        chosen.affiliateLinkId
      )
    }

    return primaryAttribution
  }

  /**
   * Atomically increment an integer counter column on the `affiliate_link`
   * row identified by `id`, using a single `col = col + 1` SQL UPDATE so
   * concurrent clicks/orders don't clobber each other (read-modify-write
   * loses increments under concurrency).
   *
   * Resolves a pg connection from the module container (the same container
   * used to resolve `query` in loadProgramReferralConfig). If the connection
   * is not reachable (e.g. in unit tests without a DB), falls back to the
   * MedusaService read-modify-write so behavior degrades gracefully.
   *
   * `column` is restricted to a known allowlist so it can be safely
   * interpolated into the SQL identifier position (bindings can't bind
   * identifiers).
   */
  private async atomicIncrementAffiliateLink(
    column: "click_count" | "attributed_order_count",
    id: string
  ): Promise<void> {
    const container = (this as any).__container__
    let pgConnection:
      | {
          raw: (
            sql: string,
            bindings?: unknown[]
          ) => Promise<{ rows?: Array<Record<string, unknown>> }>
        }
      | undefined
    try {
      // MedusaService stores the container/cradle as `__container__` (not
      // `container_`). Support both a container (`.resolve`) and an awilix
      // cradle (property access); the cradle throws on unknown keys, hence
      // the guard. (Previously read `container_`, which is never set, so the
      // atomic increment silently fell back to read-modify-write.)
      pgConnection =
        container?.resolve?.(ContainerRegistrationKeys.PG_CONNECTION) ??
        container?.[ContainerRegistrationKeys.PG_CONNECTION]
    } catch {
      pgConnection = undefined
    }

    if (pgConnection?.raw) {
      await pgConnection.raw(
        `UPDATE affiliate_link SET ${column} = ${column} + 1 WHERE id = ? AND deleted_at IS NULL`,
        [id]
      )
      return
    }

    // Fallback: no reachable pg connection. Read-modify-write — not safe
    // under concurrency, but preserves functionality where SQL is unavailable.
    const links = await this.listAffiliateLinks({ id })
    const link = links[0]
    if (!link) return
    await (this as any).updateAffiliateLinks({
      id,
      [column]: Number((link as any)[column]) + 1,
    })
  }

  /**
   * Resolve the parent creator for a seller via their primary AffiliateLink's
   * `referrer_creator_seller_id`. Used by the chain walker. Returns null
   * when no link or no parent is configured.
   */
  private async lookupReferrer(sellerId: string): Promise<string | null> {
    const links = await this.listAffiliateLinks(
      { creator_seller_id: sellerId },
      { take: 1 }
    )
    const link = links[0]
    if (!link) return null
    return (link as any).referrer_creator_seller_id ?? null
  }

  /**
   * Load referral-level config from the linked CreatorProgram. The
   * creator-program module isn't a hard dependency of creator-attribution,
   * so we use the module's listing API via the @medusajs query when
   * available, falling back to env-based defaults.
   */
  private async loadProgramReferralConfig(
    programId: string | null
  ): Promise<{
    max_referral_levels?: number
    referral_level_splits?: Record<string, number> | null
  } | null> {
    if (!programId) return null
    const container = (this as any).__container__
    const query = (container?.resolve?.("query") ?? container?.["query"]) as any
    if (!query) return null
    try {
      const { data } = await query.graph({
        entity: "creator_program",
        fields: ["id", "max_referral_levels", "referral_level_splits"],
        filters: { id: programId },
      })
      return data?.[0] ?? null
    } catch {
      return null
    }
  }

  /**
   * Idempotent ingest of a canonical analytics event from the
   * `POST /store/analytics/events` API or from a server-side emitter.
   */
  async recordAnalyticsEvent(input: {
    eventName: string
    visitorToken?: string | null
    customerId?: string | null
    creatorSellerId?: string | null
    affiliateShortCode?: string | null
    affiliateLinkId?: string | null
    orderId?: string | null
    productId?: string | null
    variantId?: string | null
    utmSource?: string | null
    utmMedium?: string | null
    utmCampaign?: string | null
    utmContent?: string | null
    path?: string | null
    referrer?: string | null
    deviceType?: string | null
    country?: string | null
    payload?: Record<string, unknown> | null
    occurredAt?: Date
  }): Promise<any> {
    return (this as any).createAnalyticsEvents({
      event_name: input.eventName,
      visitor_token: input.visitorToken ?? null,
      customer_id: input.customerId ?? null,
      creator_seller_id: input.creatorSellerId ?? null,
      affiliate_short_code: input.affiliateShortCode ?? null,
      affiliate_link_id: input.affiliateLinkId ?? null,
      order_id: input.orderId ?? null,
      product_id: input.productId ?? null,
      variant_id: input.variantId ?? null,
      utm_source: input.utmSource ?? null,
      utm_medium: input.utmMedium ?? null,
      utm_campaign: input.utmCampaign ?? null,
      utm_content: input.utmContent ?? null,
      path: input.path ?? null,
      referrer: input.referrer ?? null,
      device_type: input.deviceType ?? null,
      country: input.country ?? null,
      payload: input.payload ?? null,
      occurred_at: input.occurredAt ?? new Date(),
    })
  }

  /**
   * Move a `pending` attribution to `held` and set its `hold_until` window.
   * Called by the payment subscriber once the order is paid.
   */
  async holdAttribution(
    attributionId: string,
    holdDays: number = DEFAULT_HOLD_DAYS
  ): Promise<any> {
    const holdUntil = new Date()
    holdUntil.setDate(holdUntil.getDate() + holdDays)
    return (this as any).updateOrderAttributions({
      id: attributionId,
      commission_status: CommissionStatus.HELD,
      hold_until: holdUntil,
    })
  }

  /**
   * Mark an attribution `approved` and stamp the resulting ledger entry id.
   * Caller is responsible for the actual ledger write.
   */
  async approveCommission(
    attributionId: string,
    ledgerEntryId: string
  ): Promise<any> {
    return (this as any).updateOrderAttributions({
      id: attributionId,
      commission_status: CommissionStatus.APPROVED,
      ledger_entry_id: ledgerEntryId,
    })
  }

  async markPaid(attributionId: string): Promise<any> {
    return (this as any).updateOrderAttributions({
      id: attributionId,
      commission_status: CommissionStatus.PAID,
    })
  }

  async reverseCommission(
    attributionId: string,
    reason: string
  ): Promise<any> {
    return (this as any).updateOrderAttributions({
      id: attributionId,
      commission_status: CommissionStatus.REVERSED,
      disqualified_reason: reason,
    })
  }

  async disqualifyAttribution(
    attributionId: string,
    reason: string
  ): Promise<any> {
    return (this as any).updateOrderAttributions({
      id: attributionId,
      commission_status: CommissionStatus.DISQUALIFIED,
      disqualified_reason: reason,
    })
  }

  /**
   * The corrective script's one write (SD-95): put an order's attribution
   * rows into minor units, all of them or none.
   *
   * One transaction for the whole chain. Each row is one
   * `UPDATE … WHERE id = ? AND commission_status = ? AND <the three amounts
   * are still the planned "from"> AND <not marked minor, not corrected>`,
   * so the condition and the write are one statement in Postgres: a row the
   * approve-held job approved, or a refund reversed, after the script read it
   * matches nothing. Then the whole chain rolls back and the method returns
   * the row that changed, for the script to list. It used to be one
   * list-then-update per row, which could leave L1 corrected and L2 not when
   * L2 changed in between, and checked the status in a read before the write.
   *
   * Each written row is marked `metadata.amount_unit = "minor"` (as rows the
   * subscriber writes are) and keeps the old and new figures under
   * `metadata.amount_units_corrected`.
   *
   * What this does not close: the approve-held job takes its list of due
   * rows, amounts included, when it starts, so a row corrected while that
   * run is iterating can still be credited the old figure. See the script.
   *
   * Raw SQL because the generated update can only write by id or by a
   * selector it lists first; the column names are this module's own.
   */
  async correctAttributionAmountsIfUnchanged(
    rows: AttributionAmountCorrection[]
  ): Promise<{ written: true } | { written: false; stale_id: string }> {
    try {
      await this.correctAttributionAmountsInTransaction_(rows)
      return { written: true }
    } catch (error) {
      if (error instanceof StaleAttributionError) {
        return { written: false, stale_id: error.attributionId }
      }
      throw error
    }
  }

  @InjectTransactionManager()
  protected async correctAttributionAmountsInTransaction_(
    rows: AttributionAmountCorrection[],
    @MedusaContext() sharedContext: Context = {}
  ): Promise<void> {
    const manager = sharedContext.transactionManager as SqlManager
    for (const row of rows) {
      const written = await manager.execute(
        `UPDATE "order_attribution"
            SET "attributed_subtotal_cents" = CAST(? AS numeric),
                "raw_attributed_subtotal_cents" = ${rawBigNumber("attributed_subtotal_cents")},
                "commission_basis_cents" = CAST(? AS numeric),
                "raw_commission_basis_cents" = ${rawBigNumber("commission_basis_cents")},
                "commission_amount_cents" = CAST(? AS numeric),
                "raw_commission_amount_cents" = ${rawBigNumber("commission_amount_cents")},
                "metadata" = COALESCE("metadata", CAST('{}' AS jsonb))
                  || jsonb_build_object('amount_unit', CAST(? AS text), 'amount_units_corrected', CAST(? AS jsonb)),
                "updated_at" = now()
          WHERE "id" = ?
            AND "commission_status" = ?
            AND "deleted_at" IS NULL
            AND "attributed_subtotal_cents" = CAST(? AS numeric)
            AND "commission_basis_cents" = CAST(? AS numeric)
            AND "commission_amount_cents" = CAST(? AS numeric)
            AND ("metadata" ->> 'amount_unit') IS DISTINCT FROM CAST(? AS text)
            AND ("metadata" -> 'amount_units_corrected') IS NULL
      RETURNING "id"`,
        [
          row.to.subtotal_cents,
          row.to.subtotal_cents,
          row.to.subtotal_cents,
          row.to.subtotal_cents,
          row.to.commission_cents,
          row.to.commission_cents,
          AMOUNT_UNIT_MINOR,
          JSON.stringify(row.record),
          row.id,
          row.status,
          row.from.subtotal_cents,
          row.from.subtotal_cents,
          row.from.commission_cents,
          AMOUNT_UNIT_MINOR,
        ],
        "all"
      )
      if (!Array.isArray(written) || written.length !== 1) {
        // Rolls back the rows of this chain already written.
        throw new StaleAttributionError(row.id)
      }
    }
  }

  async listHeldAttributionsDue(now: Date = new Date()): Promise<any[]> {
    const all = await this.listOrderAttributions({
      commission_status: CommissionStatus.HELD,
    })
    return all.filter((a: any) => {
      const hu = a.hold_until ? new Date(a.hold_until as any) : null
      return hu !== null && hu <= now
    })
  }

  /**
   * Retention helpers for `attribution_click_event` (LEG-8), used by the
   * daily `creator-attribution-retention` job. The selectors return ids only,
   * capped at `limit`, so the job can work a large table in bounded batches;
   * the writers take those ids back. Nothing here touches order_attribution,
   * affiliate_link, promo_code_binding or analytics_event.
   */
  async listClickEventIdsWithIdentifiersBefore(
    cutoff: Date,
    limit: number
  ): Promise<string[]> {
    const rows = await this.listAttributionClickEvents(
      {
        occurred_at: { $lt: cutoff },
        $or: [
          { ip_hash: { $ne: null } },
          { user_agent_hash: { $ne: null } },
          { referrer: { $ne: null } },
        ],
      },
      { select: ["id"], take: limit, order: { occurred_at: "ASC" } }
    )
    return rows.map((r: any) => String(r.id))
  }

  async anonymizeClickEventIdentifiers(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    await (this as any).updateAttributionClickEvents({
      selector: { id: ids },
      data: { ip_hash: null, user_agent_hash: null, referrer: null },
    })
    return ids.length
  }

  async listClickEventIdsBefore(cutoff: Date, limit: number): Promise<string[]> {
    const rows = await this.listAttributionClickEvents(
      { occurred_at: { $lt: cutoff } },
      { select: ["id"], take: limit, order: { occurred_at: "ASC" } }
    )
    return rows.map((r: any) => String(r.id))
  }

  async deleteClickEventsByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    await (this as any).deleteAttributionClickEvents(ids)
    return ids.length
  }

  async creatorEarningsRollup(
    creatorSellerId: string,
    range?: { from?: Date; to?: Date }
  ): Promise<{
    pending_cents: number
    held_cents: number
    approved_cents: number
    paid_cents: number
    reversed_cents: number
    disqualified_cents: number
    total_orders: number
  }> {
    const list = await this.listOrderAttributions({
      creator_seller_id: creatorSellerId,
    })
    const filtered = list.filter((a: any) => {
      const at = new Date(a.attribution_decided_at as any)
      if (range?.from && at < range.from) return false
      if (range?.to && at > range.to) return false
      return true
    })
    const out = {
      pending_cents: 0,
      held_cents: 0,
      approved_cents: 0,
      paid_cents: 0,
      reversed_cents: 0,
      disqualified_cents: 0,
      total_orders: filtered.length,
    }
    for (const a of filtered) {
      const cents = Number(a.commission_amount_cents)
      switch (a.commission_status) {
        case CommissionStatus.PENDING:
          out.pending_cents += cents
          break
        case CommissionStatus.HELD:
          out.held_cents += cents
          break
        case CommissionStatus.APPROVED:
          out.approved_cents += cents
          break
        case CommissionStatus.PAID:
          out.paid_cents += cents
          break
        case CommissionStatus.REVERSED:
          out.reversed_cents += cents
          break
        case CommissionStatus.DISQUALIFIED:
          out.disqualified_cents += cents
          break
      }
    }
    return out
  }

  /**
   * Platform-wide attribution rollup — the founder's single KPI:
   * "how many sales happened because a creator/coalition/bounty/referral
   * generated them?" Aggregates attributed GMV and commission across ALL
   * creators (not scoped to one seller), with a per-source breakdown.
   *
   * `attributed_gmv_cents` is the valid creator-driven sales figure
   * (excludes reversed + disqualified). `gross_attributed_gmv_cents`
   * includes everything for reconciliation.
   */
  async platformAttributionRollup(range?: { from?: Date; to?: Date }): Promise<{
    attributed_gmv_cents: number
    gross_attributed_gmv_cents: number
    commission_pending_cents: number
    commission_approved_cents: number
    commission_paid_cents: number
    total_attributed_orders: number
    valid_attributed_orders: number
    distinct_creators: number
    by_source: Record<string, { orders: number; attributed_gmv_cents: number }>
  }> {
    const list = await this.listOrderAttributions({})
    const filtered = list.filter((a: any) => {
      const at = new Date(a.attribution_decided_at as any)
      if (range?.from && at < range.from) return false
      if (range?.to && at > range.to) return false
      return true
    })

    const creators = new Set<string>()
    const by_source: Record<string, { orders: number; attributed_gmv_cents: number }> = {}
    const out = {
      attributed_gmv_cents: 0,
      gross_attributed_gmv_cents: 0,
      commission_pending_cents: 0,
      commission_approved_cents: 0,
      commission_paid_cents: 0,
      total_attributed_orders: filtered.length,
      valid_attributed_orders: 0,
      distinct_creators: 0,
      by_source,
    }

    for (const a of filtered) {
      const subtotal = Number(a.attributed_subtotal_cents) || 0
      const commission = Number(a.commission_amount_cents) || 0
      const status = a.commission_status
      const invalid =
        status === CommissionStatus.REVERSED ||
        status === CommissionStatus.DISQUALIFIED

      out.gross_attributed_gmv_cents += subtotal
      if (a.creator_seller_id) creators.add(a.creator_seller_id)

      if (!invalid) {
        out.attributed_gmv_cents += subtotal
        out.valid_attributed_orders += 1
        const src = String(a.source ?? "unknown")
        const bucket = by_source[src] ?? (by_source[src] = { orders: 0, attributed_gmv_cents: 0 })
        bucket.orders += 1
        bucket.attributed_gmv_cents += subtotal
      }

      switch (status) {
        case CommissionStatus.PENDING:
          out.commission_pending_cents += commission
          break
        case CommissionStatus.APPROVED:
          out.commission_approved_cents += commission
          break
        case CommissionStatus.PAID:
          out.commission_paid_cents += commission
          break
      }
    }

    out.distinct_creators = creators.size
    return out
  }

  /**
   * Sign a visitor cookie value with HMAC. Used by the storefront and the
   * /r/:shortCode redirector to detect tampering.
   */
  static signCookieValue(value: string, secret: string): string {
    const hmac = createHmac("sha256", secret).update(value).digest("hex").slice(0, 16)
    return `${value}.${hmac}`
  }

  static verifyCookieValue(signed: string, secret: string): string | null {
    const idx = signed.lastIndexOf(".")
    if (idx < 0) return null
    const value = signed.slice(0, idx)
    const sig = signed.slice(idx + 1)
    const expected = createHmac("sha256", secret).update(value).digest("hex").slice(0, 16)
    if (sig.length !== expected.length) return null
    let diff = 0
    for (let i = 0; i < sig.length; i++) {
      diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    }
    return diff === 0 ? value : null
  }

  private resolveDefaultCommissionPercent(): number {
    const v = process.env.CREATOR_ATTRIBUTION_DEFAULT_COMMISSION_PERCENT
    const n = v ? parseFloat(v) : 10
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 10
  }
}

export default CreatorAttributionService
