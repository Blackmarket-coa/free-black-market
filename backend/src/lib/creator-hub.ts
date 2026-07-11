import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { SUBSCRIPTION_MODULE } from "../modules/subscription"
import type SubscriptionModuleService from "../modules/subscription/service"
import { mapSubscriptionTier } from "../modules/marketplace-webhooks/models/blackout-events"

/**
 * Read-side helpers backing the FBM creator portal (`/vendor/creator/*`).
 *
 * These resolve the creator's real data from the modules that already own it —
 * hawala-ledger (Coalition Credits / CCR rail) and the subscription module
 * (memberships) — so the portal can graduate off its typed mock layer surface
 * by surface, without inventing new persistence. Anything Blackout owns
 * (room-level drift, chat feeds, boosts) is intentionally NOT fabricated here.
 */

const CCR = "CCR"

type LedgerAccount = {
  id: string
  currency_code?: string | null
  available_balance?: number | string | null
  pending_balance?: number | string | null
}

type LedgerEntry = {
  id: string
  debit_account_id?: string | null
  credit_account_id?: string | null
  amount?: number | string | null
  entry_type?: string | null
  description?: string | null
  reference_type?: string | null
  reference_id?: string | null
  created_at?: string | Date | null
  metadata?: Record<string, unknown> | null
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** A creator's Coalition-Credit (CCR rail) ledger accounts, owned by the seller. */
export async function getCreatorCcrAccounts(
  hawala: HawalaLedgerModuleService,
  sellerId: string
): Promise<LedgerAccount[]> {
  const accounts = (await (hawala as any).listLedgerAccounts({
    owner_id: sellerId,
    currency_code: CCR,
  })) as LedgerAccount[]
  return Array.isArray(accounts) ? accounts : []
}

export interface CreditBalance {
  available_credits: number
  pending_credits: number
  lifetime_earned: number
}

/**
 * CCR balance for a creator: available + pending off the wallet accounts, and
 * lifetime-earned as the sum of every credit (incoming) entry to those accounts.
 */
export async function getCreatorCreditBalance(
  hawala: HawalaLedgerModuleService,
  sellerId: string
): Promise<CreditBalance> {
  const accounts = await getCreatorCcrAccounts(hawala, sellerId)
  const available = accounts.reduce((s, a) => s + num(a.available_balance), 0)
  const pending = accounts.reduce((s, a) => s + num(a.pending_balance), 0)

  let lifetime = 0
  const ids = accounts.map((a) => a.id)
  if (ids.length) {
    const incoming = (await (hawala as any).listLedgerEntries({
      credit_account_id: ids,
    })) as LedgerEntry[]
    lifetime = (incoming ?? []).reduce((s, e) => s + num(e.amount), 0)
  }

  return {
    available_credits: Math.round(available),
    pending_credits: Math.round(pending),
    lifetime_earned: Math.round(lifetime),
  }
}

export interface CreditTransaction {
  id: string
  type: string
  amount_credits: number
  counterparty: string | null
  room: string | null
  created_at: string
  blackout_event_id: string | null
}

const ENTRY_TYPE_TO_TXN: Record<string, string> = {
  TRANSFER: "tip",
  COMMISSION: "membership",
  CREATOR_COMMISSION: "membership",
  CREATOR_REWARD: "boost",
  WITHDRAWAL: "withdrawal",
  PURCHASE: "dead_drop",
  FEE: "platform_fee",
  ADJUSTMENT: "xp_conversion",
}

/**
 * CCR transactions for a creator, newest first. Direction is signed relative to
 * the creator's wallets: credit-in is positive, debit-out negative.
 */
export async function listCreatorCreditTransactions(
  hawala: HawalaLedgerModuleService,
  sellerId: string,
  limit = 50
): Promise<CreditTransaction[]> {
  const accounts = await getCreatorCcrAccounts(hawala, sellerId)
  const ids = new Set(accounts.map((a) => a.id))
  if (ids.size === 0) return []

  const idList = [...ids]
  const [credits, debits] = await Promise.all([
    (hawala as any).listLedgerEntries({ credit_account_id: idList }) as Promise<LedgerEntry[]>,
    (hawala as any).listLedgerEntries({ debit_account_id: idList }) as Promise<LedgerEntry[]>,
  ])

  const byId = new Map<string, LedgerEntry>()
  for (const e of [...(credits ?? []), ...(debits ?? [])]) byId.set(e.id, e)

  const rows: CreditTransaction[] = [...byId.values()].map((e) => {
    const incoming = e.credit_account_id ? ids.has(e.credit_account_id) : false
    const amount = Math.round(num(e.amount)) * (incoming ? 1 : -1)
    const meta = (e.metadata ?? {}) as Record<string, unknown>
    return {
      id: e.id,
      type: ENTRY_TYPE_TO_TXN[String(e.entry_type ?? "")] ?? "tip",
      amount_credits: amount,
      counterparty: e.description ?? null,
      room: typeof meta.room_id === "string" ? meta.room_id : null,
      created_at: new Date(e.created_at ?? Date.now()).toISOString(),
      blackout_event_id:
        typeof meta.blackout_event_id === "string" ? meta.blackout_event_id : null,
    }
  })

  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return rows.slice(0, limit)
}

// ── Memberships / members ───────────────────────────────────────────────────

// FBM subscription status → portal MemberStatus.
const SUB_STATUS_TO_MEMBER: Record<string, string> = {
  active: "active",
  paused: "paused",
  canceled: "cancelled",
  expired: "expired",
  failed: "past_due",
}

export interface CreatorMember {
  id: string
  name: string | null
  email: string
  tier_name: string
  status: string
  started_at: string
  next_renewal_at: string | null
  ltv_amount: number
  matrix_id: string | null
  sync_status: "in_sync" | "drift" | "no_mxid"
}

/**
 * The creator's members, derived from their subscriptions, enriched with the
 * customer's email/name + Blackout mxid.
 *
 * Sync status: a member with a linked Blackout account is reported `in_sync`;
 * one without an mxid is `no_mxid`. True `drift` (FBM tier ≠ Space room
 * membership) can only be judged by Blackout, so it is never guessed here.
 */
export async function listCreatorMembers(
  container: MedusaContainer,
  sellerId: string
): Promise<CreatorMember[]> {
  const subscriptionService = container.resolve<SubscriptionModuleService>(
    SUBSCRIPTION_MODULE
  )
  const subs = await subscriptionService.getSellerSubscriptions(sellerId)
  if (!subs.length) return []

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  const customerIds = [...new Set(subs.map((s) => s.customer_id).filter(Boolean))] as string[]
  const productIds = [...new Set(subs.map((s) => s.product_id).filter(Boolean))] as string[]

  const customerById = new Map<string, any>()
  if (customerIds.length) {
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name", "last_name", "metadata"],
      filters: { id: customerIds },
    })
    for (const c of customers ?? []) customerById.set(c.id, c)
  }

  const productTitleById = new Map<string, string>()
  if (productIds.length) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title"],
      filters: { id: productIds },
    })
    for (const p of products ?? []) productTitleById.set(p.id, p.title)
  }

  return subs.map((s) => {
    const c = s.customer_id ? customerById.get(s.customer_id) : null
    const mxid =
      c?.metadata && typeof c.metadata.mxid === "string" ? (c.metadata.mxid as string) : null
    const name = c ? [c.first_name, c.last_name].filter(Boolean).join(" ") || null : null
    return {
      id: s.id,
      name,
      email: c?.email ?? "—",
      tier_name: (s.product_id && productTitleById.get(s.product_id)) || "Membership",
      status: SUB_STATUS_TO_MEMBER[String(s.status)] ?? "active",
      started_at: new Date(s.subscription_date ?? s.created_at ?? Date.now()).toISOString(),
      next_renewal_at: s.next_order_date
        ? new Date(s.next_order_date as any).toISOString()
        : null,
      ltv_amount: 0, // requires order-history aggregation; surfaced as 0 until wired
      matrix_id: mxid,
      sync_status: mxid ? "in_sync" : "no_mxid",
    }
  })
}

export interface CreatorMembershipTier {
  id: string
  name: string
  price_amount: number
  interval: "monthly" | "yearly"
  blackout_tier: string
  credits_per_period: number
  perks: string[]
  active_members: number
}

/**
 * Membership tiers, derived by grouping the creator's subscriptions by product.
 * Price/perks are not modelled on the subscription record, so they surface as 0
 * / empty until a dedicated tier config exists; counts and tier mapping are real.
 */
export async function listCreatorMembershipTiers(
  container: MedusaContainer,
  sellerId: string
): Promise<CreatorMembershipTier[]> {
  const subscriptionService = container.resolve<SubscriptionModuleService>(
    SUBSCRIPTION_MODULE
  )
  const subs = await subscriptionService.getSellerSubscriptions(sellerId)
  if (!subs.length) return []

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const productIds = [...new Set(subs.map((s) => s.product_id).filter(Boolean))] as string[]
  const productTitleById = new Map<string, string>()
  if (productIds.length) {
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title"],
      filters: { id: productIds },
    })
    for (const p of products ?? []) productTitleById.set(p.id, p.title)
  }

  const groups = new Map<string, CreatorMembershipTier>()
  for (const s of subs) {
    const key = s.product_id || "membership"
    const existing = groups.get(key)
    const isActive = String(s.status) === "active"
    if (existing) {
      if (isActive) existing.active_members++
      continue
    }
    groups.set(key, {
      id: key,
      name: (s.product_id && productTitleById.get(s.product_id)) || "Membership",
      price_amount: 0,
      interval: String(s.interval) === "yearly" ? "yearly" : "monthly",
      blackout_tier: mapSubscriptionTier(s.metadata),
      credits_per_period: 0,
      perks: [],
      active_members: isActive ? 1 : 0,
    })
  }

  return [...groups.values()]
}

/** Interval → payments-per-month normalization for MRR math. */
const MONTHLY_FACTOR: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
}

/**
 * MRR movement over the trailing 7 days, in cents: monthly-normalized value of
 * memberships that STARTED this week minus those CANCELED this week.
 * Subscriptions carry no price of their own — each is priced off its variant's
 * USD price (first price as fallback). Best-effort: 0 when nothing moved or
 * pricing can't be resolved.
 */
export async function getCreatorMrrChangeThisWeekCents(
  container: MedusaContainer,
  sellerId: string
): Promise<number> {
  try {
    const subscriptionService = container.resolve<SubscriptionModuleService>(
      SUBSCRIPTION_MODULE
    )
    const subs = await subscriptionService.getSellerSubscriptions(sellerId)
    if (!subs.length) return 0

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const startedThisWeek = subs.filter(
      (s) => s.subscription_date && new Date(s.subscription_date).getTime() >= weekAgo
    )
    const canceledThisWeek = subs.filter(
      (s) => s.canceled_at && new Date(s.canceled_at).getTime() >= weekAgo
    )
    if (!startedThisWeek.length && !canceledThisWeek.length) return 0

    const variantIds = [
      ...new Set(
        [...startedThisWeek, ...canceledThisWeek]
          .map((s) => s.variant_id)
          .filter((v): v is string => !!v)
      ),
    ]
    const priceByVariant = new Map<string, number>()
    if (variantIds.length) {
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "prices.amount", "prices.currency_code"],
        filters: { id: variantIds },
      })
      for (const v of variants ?? []) {
        const prices = (v.prices ?? []) as { amount?: unknown; currency_code?: string }[]
        const usd = prices.find((p) => p.currency_code === "usd") ?? prices[0]
        if (usd) priceByVariant.set(v.id, num(usd.amount))
      }
    }

    const monthlyCents = (s: {
      variant_id?: string | null
      interval?: unknown
      quantity?: unknown
    }): number => {
      const price = s.variant_id ? (priceByVariant.get(s.variant_id) ?? 0) : 0
      const factor = MONTHLY_FACTOR[String(s.interval)] ?? 1
      return Math.round(price * num(s.quantity ?? 1) * factor)
    }

    const added = startedThisWeek.reduce((sum, s) => sum + monthlyCents(s), 0)
    const lost = canceledThisWeek.reduce((sum, s) => sum + monthlyCents(s), 0)
    return added - lost
  } catch {
    return 0
  }
}

export const _internal = { ENTRY_TYPE_TO_TXN, SUB_STATUS_TO_MEMBER, num }
