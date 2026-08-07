import { MedusaService } from "@medusajs/framework/utils"
import {
  CottageFoodProfile,
  CottageFoodSalesEntry,
  CottageFoodLabel,
  ALLERGEN_LABELS,
  type MajorAllergen,
  type SalesEntrySource,
} from "./models"
import {
  startOfDayInZone,
  startOfWeekInZone,
  startOfPermitYearInZone,
  daysUntil,
} from "./utils/time"

/** Medusa bigNumber fields come back as numbers, strings, or BigNumber-ish objects. */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (typeof value === "object") {
    const numeric = (value as { numeric?: unknown }).numeric
    if (numeric !== undefined) return toNumber(numeric)
    const raw = (value as { value?: unknown }).value
    if (raw !== undefined) return toNumber(raw)
  }
  return 0
}

/** Null unless the value is a real, positive limit. Zero is not a limit. */
function toLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = toNumber(value)
  return n > 0 ? n : null
}

export interface RecordSaleInput {
  seller_id: string
  source?: SalesEntrySource
  source_id?: string | null
  occurred_at?: Date | string
  amount_cents?: number
  meal_count?: number
  counts_toward_annual?: boolean
  counts_toward_meals?: boolean
  note?: string | null
  metadata?: Record<string, unknown> | null
}

export type ExpiryStatus = "unset" | "ok" | "expiring_soon" | "expired"

export interface MeterView {
  /** Null when the seller hasn't declared this limit — render nothing. */
  cap: number | null
  used: number
  /** Null when there's no cap to be a percentage of. */
  pct: number | null
  remaining: number | null
}

export interface ComplianceSnapshot {
  has_profile: boolean
  profile: Record<string, unknown> | null
  operation_type: string | null
  /** Whether meal meters are meaningful for this operation. */
  tracks_meals: boolean
  annual: MeterView & {
    period_start: string | null
    period_end: string | null
    on_platform_cents: number
    self_reported_cents: number
  }
  today: MeterView & { date: string | null }
  this_week: MeterView & { week_start: string | null }
  permit: { status: ExpiryStatus; expires_at: string | null; days_until: number | null }
  food_handler: { status: ExpiryStatus; expires_at: string | null; days_until: number | null }
  /**
   * Plain-language notes. Advisory only — nothing downstream may treat these
   * as a gate, and this service never returns a "blocked" verdict.
   */
  advisories: string[]
}

/** How far ahead a permit/cert expiry starts being called out. */
const EXPIRY_WARNING_DAYS = 30

/** Percentages of a declared cap at which an advisory is raised. */
const CAP_ADVISORY_THRESHOLDS = [100, 90, 75]

/**
 * Cottage Food service.
 *
 * Owns a home-based food seller's self-declared compliance profile, the ledger
 * of sales counted against the limits they declared, and their product labels.
 *
 * The governing constraint on this module: **it never blocks a sale.** There is
 * no method here that returns a pass/fail verdict, and nothing in it is wired
 * into cart validation. The seller is the authority on their own compliance;
 * FBM counts accurately and shows them the number. Advisories are strings meant
 * for a human to read, not flags for code to branch on.
 *
 * All limits are optional. A seller who declares nothing gets a working profile
 * with every meter hidden, and no advisories.
 */
class CottageFoodModuleService extends MedusaService({
  CottageFoodProfile,
  CottageFoodSalesEntry,
  CottageFoodLabel,
}) {
  /** A seller's profile, or null if they haven't set one up. */
  async getProfileForSeller(sellerId: string) {
    const [profile] = await this.listCottageFoodProfiles({ seller_id: sellerId })
    return profile ?? null
  }

  /** Create or update a seller's profile. One profile per seller. */
  async upsertProfileForSeller(
    sellerId: string,
    data: Record<string, unknown>
  ) {
    const existing = await this.getProfileForSeller(sellerId)
    if (existing) {
      return this.updateCottageFoodProfiles({ id: existing.id, ...data })
    }
    return this.createCottageFoodProfiles({ ...data, seller_id: sellerId })
  }

  /**
   * Record a counted sale.
   *
   * Idempotent on `(source, source_id)` for platform sources so a subscriber
   * retry can't double-count. Manual entries carry no source id and are always
   * appended — a seller recording two cash sales of the same amount on the same
   * day is recording two real sales.
   */
  async recordSale(input: RecordSaleInput) {
    const source: SalesEntrySource = input.source ?? "medusa_order"
    const sourceId = input.source_id ?? null

    if (sourceId) {
      const [existing] = await this.listCottageFoodSalesEntries({
        source,
        source_id: sourceId,
      })
      if (existing) return existing
    }

    const profile = await this.getProfileForSeller(input.seller_id)

    return this.createCottageFoodSalesEntries({
      seller_id: input.seller_id,
      profile_id: profile?.id ?? null,
      source,
      source_id: sourceId,
      occurred_at: input.occurred_at
        ? new Date(input.occurred_at)
        : new Date(),
      amount_cents: input.amount_cents ?? 0,
      meal_count: input.meal_count ?? 0,
      counts_toward_annual: input.counts_toward_annual ?? true,
      counts_toward_meals: input.counts_toward_meals ?? true,
      note: input.note ?? null,
      metadata: (input.metadata ?? null) as Record<string, unknown> | null,
    })
  }

  /**
   * Append a compensating entry for a refunded or cancelled order.
   *
   * The original entry is left untouched: the ledger is a history of what was
   * counted, and rewriting it would lose the fact that the sale happened at
   * all. Returns null when there's nothing to reverse, or when the entry has
   * already been reversed.
   */
  async reverseSale(source: SalesEntrySource, sourceId: string) {
    const [original] = await this.listCottageFoodSalesEntries({
      source,
      source_id: sourceId,
    })
    if (!original) return null

    const [alreadyReversed] = await this.listCottageFoodSalesEntries({
      reverses_entry_id: original.id,
    })
    if (alreadyReversed) return alreadyReversed

    return this.createCottageFoodSalesEntries({
      seller_id: original.seller_id,
      profile_id: original.profile_id ?? null,
      source,
      // Null so the unique (source, source_id) index doesn't collide with the
      // entry being reversed; the link is carried by reverses_entry_id.
      source_id: null,
      occurred_at: new Date(),
      amount_cents: -toNumber(original.amount_cents),
      meal_count: -(original.meal_count ?? 0),
      counts_toward_annual: original.counts_toward_annual,
      counts_toward_meals: original.counts_toward_meals,
      reverses_entry_id: original.id,
      note: `Reversal of ${source} ${sourceId}`,
      metadata: null,
    })
  }

  /**
   * The single view model behind every cottage-food surface: the vendor
   * dashboard, the botanical compliance center, and the onboarding recap.
   *
   * Safe to call for a seller with no profile — returns an empty snapshot with
   * every meter hidden rather than throwing.
   */
  async getComplianceSnapshot(
    sellerId: string,
    now: Date = new Date()
  ): Promise<ComplianceSnapshot> {
    const profile = await this.getProfileForSeller(sellerId)

    if (!profile) {
      return {
        has_profile: false,
        profile: null,
        operation_type: null,
        tracks_meals: false,
        annual: {
          cap: null, used: 0, pct: null, remaining: null,
          period_start: null, period_end: null,
          on_platform_cents: 0, self_reported_cents: 0,
        },
        today: { cap: null, used: 0, pct: null, remaining: null, date: null },
        this_week: { cap: null, used: 0, pct: null, remaining: null, week_start: null },
        permit: { status: "unset", expires_at: null, days_until: null },
        food_handler: { status: "unset", expires_at: null, days_until: null },
        advisories: [],
      }
    }

    const tz = profile.timezone || "America/New_York"
    const annualCap = toLimit(profile.annual_sales_cap_cents)
    const dailyCap = toLimit(profile.daily_meal_cap)
    const weeklyCap = toLimit(profile.weekly_meal_cap)

    const periodStart = startOfPermitYearInZone(
      now,
      tz,
      profile.cap_period_start_month || 1
    )
    const periodEnd = startOfPermitYearInZone(
      now,
      tz,
      profile.cap_period_start_month || 1,
      1
    )
    const dayStart = startOfDayInZone(now, tz)
    const weekStart = startOfWeekInZone(now, tz)

    // One read covering every window. The week can start before the permit
    // year does (a permit year that begins mid-week), so take the earliest.
    const fetchFrom = new Date(
      Math.min(periodStart.getTime(), weekStart.getTime(), dayStart.getTime())
    )
    const entries = await this.listCottageFoodSalesEntries(
      { seller_id: sellerId, occurred_at: { $gte: fetchFrom } },
      { order: { occurred_at: "DESC" } }
    )

    let annualUsed = 0
    let onPlatform = 0
    let selfReported = 0
    let todayMeals = 0
    let weekMeals = 0

    for (const entry of entries) {
      const occurredAt = new Date(entry.occurred_at as unknown as string)
      const amount = toNumber(entry.amount_cents)
      const meals = entry.meal_count ?? 0

      if (
        entry.counts_toward_annual &&
        occurredAt >= periodStart &&
        occurredAt < periodEnd
      ) {
        annualUsed += amount
        if (entry.source === "manual") selfReported += amount
        else onPlatform += amount
      }

      if (entry.counts_toward_meals) {
        if (occurredAt >= dayStart) todayMeals += meals
        if (occurredAt >= weekStart) weekMeals += meals
      }
    }

    const permit = expiryView(profile.permit_expires_at, now)
    const foodHandler = expiryView(profile.food_handler_expires_at, now)
    const tracksMeals =
      profile.operation_type === "HOME_KITCHEN" ||
      profile.operation_type === "BOTH"

    const snapshot: ComplianceSnapshot = {
      has_profile: true,
      profile: profile as unknown as Record<string, unknown>,
      operation_type: profile.operation_type,
      tracks_meals: tracksMeals,
      annual: {
        ...meter(annualUsed, annualCap),
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        on_platform_cents: onPlatform,
        self_reported_cents: selfReported,
      },
      today: { ...meter(todayMeals, dailyCap), date: dayStart.toISOString() },
      this_week: {
        ...meter(weekMeals, weeklyCap),
        week_start: weekStart.toISOString(),
      },
      permit,
      food_handler: foodHandler,
      advisories: [],
    }

    snapshot.advisories = buildAdvisories(snapshot)
    return snapshot
  }

  /** A seller's ledger, newest first. */
  async listSalesForSeller(sellerId: string, limit = 100, offset = 0) {
    return this.listCottageFoodSalesEntries(
      { seller_id: sellerId },
      { order: { occurred_at: "DESC" }, take: limit, skip: offset }
    )
  }

  /**
   * Create a label, snapshotting the producer/disclosure lines off the profile
   * as they read right now.
   */
  async createLabelForSeller(sellerId: string, data: Record<string, unknown>) {
    const profile = await this.getProfileForSeller(sellerId)
    return this.createCottageFoodLabels({
      ...data,
      seller_id: sellerId,
      disclosure_text_snapshot: profile?.label_disclosure_text ?? null,
      business_name_snapshot: profile?.label_business_name ?? null,
      address_snapshot: profile?.label_address ?? null,
      permit_number_snapshot: profile?.permit_number ?? null,
    })
  }

  /**
   * Compose a label into the block a seller prints and sticks on the jar.
   *
   * Returns the structured pieces alongside a plain-text rendering. Sections
   * the seller hasn't filled in are omitted rather than stubbed, so the output
   * never invents a disclosure sentence or a permit number.
   */
  async renderLabel(labelId: string) {
    const label = await this.retrieveCottageFoodLabel(labelId)

    const ingredients = Array.isArray(label.ingredients)
      ? (label.ingredients as Array<{ name?: string }>)
          .map((i) => (typeof i === "string" ? i : i?.name))
          .filter((n): n is string => Boolean(n && n.trim()))
      : []

    const allergens = Array.isArray(label.allergens)
      ? (label.allergens as MajorAllergen[])
          .filter((a) => a in ALLERGEN_LABELS)
          .map((a) => ALLERGEN_LABELS[a])
      : []

    const lines: string[] = [label.product_name]
    if (ingredients.length) {
      lines.push(`INGREDIENTS: ${ingredients.join(", ")}.`)
    }
    if (allergens.length) {
      lines.push(`CONTAINS: ${allergens.join(", ")}.`)
    }
    if (label.allergen_cross_contact_note) {
      lines.push(label.allergen_cross_contact_note)
    }
    if (label.net_weight_text) {
      lines.push(`NET WT ${label.net_weight_text}`)
    }
    if (label.business_name_snapshot) {
      lines.push(label.business_name_snapshot)
    }
    if (label.address_snapshot) {
      lines.push(label.address_snapshot)
    }
    if (label.permit_number_snapshot) {
      lines.push(`Permit #${label.permit_number_snapshot}`)
    }
    if (label.disclosure_text_snapshot) {
      lines.push(label.disclosure_text_snapshot)
    }

    // Surface what's missing so the builder UI can prompt — as a checklist for
    // the seller, never as a validation failure.
    const missing: string[] = []
    if (!ingredients.length) missing.push("ingredients")
    if (!label.net_weight_text) missing.push("net weight")
    if (!label.business_name_snapshot) missing.push("business name")
    if (!label.disclosure_text_snapshot) missing.push("home-kitchen disclosure")

    return {
      label,
      ingredients,
      allergens,
      text: lines.join("\n"),
      missing,
    }
  }
}

/** Build a meter view; an absent cap yields no percentage and no remainder. */
function meter(used: number, cap: number | null): MeterView {
  if (!cap) return { cap: null, used, pct: null, remaining: null }
  return {
    cap,
    used,
    pct: Math.round((used / cap) * 1000) / 10,
    remaining: cap - used,
  }
}

function expiryView(
  expiresAt: Date | string | null | undefined,
  now: Date
): { status: ExpiryStatus; expires_at: string | null; days_until: number | null } {
  if (!expiresAt) return { status: "unset", expires_at: null, days_until: null }
  const date = new Date(expiresAt as string)
  if (Number.isNaN(date.getTime())) {
    return { status: "unset", expires_at: null, days_until: null }
  }
  const days = daysUntil(date, now)
  const status: ExpiryStatus =
    days < 0 ? "expired" : days <= EXPIRY_WARNING_DAYS ? "expiring_soon" : "ok"
  return { status, expires_at: date.toISOString(), days_until: days }
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

/**
 * Plain-language notes for the seller.
 *
 * Deliberately non-directive: these report a number the seller declared and
 * where they stand against it. They do not tell the seller to stop selling,
 * and nothing consumes them as a gate.
 */
function buildAdvisories(s: ComplianceSnapshot): string[] {
  const out: string[] = []

  if (s.annual.cap && s.annual.pct !== null) {
    const threshold = CAP_ADVISORY_THRESHOLDS.find((t) => s.annual.pct! >= t)
    if (threshold === 100) {
      out.push(
        `You've recorded ${formatUsd(s.annual.used)} against the ${formatUsd(
          s.annual.cap
        )} annual cap you declared — you're over it.`
      )
    } else if (threshold) {
      out.push(
        `You've recorded ${formatUsd(s.annual.used)} of the ${formatUsd(
          s.annual.cap
        )} annual cap you declared (${s.annual.pct}%).`
      )
    }
  }

  if (s.tracks_meals && s.today.cap && s.today.pct !== null) {
    if (s.today.pct >= 100) {
      out.push(
        `Today's meals are at ${s.today.used} against the ${s.today.cap} you declared.`
      )
    } else if (s.today.pct >= 75) {
      out.push(
        `${s.today.used} of ${s.today.cap} meals recorded for today — ${s.today.remaining} left against your declared limit.`
      )
    }
  }

  if (s.tracks_meals && s.this_week.cap && s.this_week.pct !== null && s.this_week.pct >= 75) {
    out.push(
      `${s.this_week.used} of ${s.this_week.cap} meals recorded this week.`
    )
  }

  if (s.permit.status === "expired") {
    out.push(`Your permit's recorded expiry date has passed.`)
  } else if (s.permit.status === "expiring_soon") {
    out.push(`Your permit expires in ${s.permit.days_until} days.`)
  }

  if (s.food_handler.status === "expired") {
    out.push(`Your food handler certification's recorded expiry date has passed.`)
  } else if (s.food_handler.status === "expiring_soon") {
    out.push(
      `Your food handler certification expires in ${s.food_handler.days_until} days.`
    )
  }

  return out
}

export default CottageFoodModuleService
