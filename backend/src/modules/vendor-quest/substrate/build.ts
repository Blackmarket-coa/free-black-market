import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { featureFlagState } from "../../../shared/feature-flags"
import { isDocumentCurrent } from "../../document-vault/document-status"
import { ORDER_DISPUTE_MODULE } from "../../order-dispute"
import { DisputeStatus } from "../../order-dispute/resolution"
import { PROGRESSION_MODULE } from "../../progression"
import { VENDOR_RULES_MODULE } from "../../vendor-rules"
import { computeRevenueSummary, type LedgerHistoryEntry } from "./revenue"
import {
  channelsFromTiers,
  countWholesaleRelationships,
  summarizeCustomers,
  summarizeOrders,
  type CustomerTierRecord,
  type SellerOrderRecord,
} from "./operating"
import type {
  VendorSubstrate,
  RevenueSummary,
  OperatingHistory,
  CustomerRecord,
  ReputationSummary,
  InventoryValuation,
  ProductionSummary,
  ChannelSummary,
  VaultSummary,
} from "../types"

/**
 * Build the shared vendor operating record (the substrate).
 *
 * Universal fields (revenue, operating, customers, reputation) are ALWAYS
 * returned — with safe zero/empty defaults if a source is unavailable — so a
 * service / digital / practitioner vendor is a first-class citizen. Domain
 * fields (inventory, production, channels, documents) are `null` unless the
 * relevant opt-in module has data, so quests degrade gracefully.
 *
 * Every source read is isolated in try/catch: one subsystem being absent or
 * erroring never breaks the whole substrate (the "aggregate, never duplicate,
 * best-effort" convention shared with `progression.recomputeAggregates`).
 *
 * The seller row, the seller's orders and the seller's customer tiers are each
 * read once and shared by every field that needs them, so a packet's figures
 * all come from the same rows. `asOf` is injectable so callers/tests get
 * deterministic tenure, reliability and revenue windows.
 */
export async function buildSubstrate(
  sellerId: string,
  container: MedusaContainer,
  opts: { asOf?: Date } = {}
): Promise<VendorSubstrate> {
  const query = safeResolve(container, ContainerRegistrationKeys.QUERY)
  const asOf = opts.asOf ?? new Date()

  const [seller, orders, tiers] = await Promise.all([
    loadSeller(sellerId, query),
    loadSellerOrders(sellerId, query),
    loadSellerTiers(sellerId, container),
  ])

  const [revenue, reputation] = await Promise.all([
    buildRevenue(sellerId, container, opts.asOf),
    buildReputation(sellerId, container, seller.member_ids),
  ])
  const operating = buildOperating(seller, orders, asOf)
  const customers = buildCustomers(orders, tiers)

  const [inventory, production, documents] = await Promise.all([
    buildInventory(sellerId, query),
    buildProduction(sellerId, container),
    buildDocuments(sellerId, container),
  ])
  const channels = buildChannels(tiers)

  return {
    seller_id: sellerId,
    generated_at: asOf.toISOString(),
    revenue,
    operating,
    customers,
    reputation,
    inventory,
    production,
    channels,
    documents,
    // An individually-built substrate is never an aggregate.
    collective: null,
  }
}

function safeResolve(container: MedusaContainer, key: string): any {
  try {
    return container.resolve(key)
  } catch {
    return null
  }
}

// ── Shared reads: the seller row, its orders, its customer tiers ────────────
interface SellerSnapshot {
  created_at: string | null
  product_count: number
  /** The seller's members: the progression subjects whose XP is the seller's. */
  member_ids: string[]
}

async function loadSeller(sellerId: string, query: any): Promise<SellerSnapshot> {
  const empty: SellerSnapshot = { created_at: null, product_count: 0, member_ids: [] }
  if (!query) return empty
  try {
    const { data } = await query.graph({
      entity: "seller",
      fields: ["id", "created_at", "products.id", "members.id"],
      filters: { id: sellerId },
    })
    const seller = data?.[0]
    if (!seller) return empty
    const members: any[] = Array.isArray(seller.members) ? seller.members : []
    return {
      created_at: seller.created_at ? new Date(seller.created_at).toISOString() : null,
      product_count: Array.isArray(seller.products) ? seller.products.length : 0,
      member_ids: members.map((m) => m?.id).filter((id): id is string => Boolean(id)),
    }
  } catch {
    return empty
  }
}

/**
 * The seller's orders through the MercurJS `seller_order` link, the way the
 * plugin's own `GET /vendor/orders` reads them. The order entity has no
 * `seller_id` column: filtering on one (as this file did until 2026-09-06)
 * throws inside the graph and, swallowed, reported zero customers for every
 * vendor.
 */
async function loadSellerOrders(sellerId: string, query: any): Promise<SellerOrderRecord[]> {
  if (!query) return []
  try {
    const { data: links } = await query.graph({
      entity: "seller_order",
      fields: ["order_id"],
      filters: { seller_id: sellerId, deleted_at: { $eq: null } },
    })
    const orderIds = Array.from(
      new Set(
        ((links ?? []) as Array<{ order_id?: string }>)
          .map((link) => link?.order_id)
          .filter((id): id is string => Boolean(id))
      )
    )
    if (orderIds.length === 0) return []

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "created_at", "canceled_at", "status", "fulfillment_status"],
      filters: { id: orderIds },
    })
    return Array.isArray(orders) ? (orders as SellerOrderRecord[]) : []
  } catch {
    return []
  }
}

async function loadSellerTiers(
  sellerId: string,
  container: MedusaContainer
): Promise<CustomerTierRecord[]> {
  try {
    const svc: any = container.resolve(VENDOR_RULES_MODULE)
    const tiers = await svc.listVendorCustomerTiers({ seller_id: sellerId })
    return Array.isArray(tiers) ? (tiers as CustomerTierRecord[]) : []
  } catch {
    return []
  }
}

// ── Universal: revenue (from the settlement ledger) ─────────────────────────
async function buildRevenue(
  sellerId: string,
  container: MedusaContainer,
  asOf?: Date
): Promise<RevenueSummary> {
  const empty: RevenueSummary = {
    currency: "usd",
    lifetime_revenue: 0,
    last_30d_revenue: 0,
    avg_daily_revenue: 0,
    monthly: [],
    source: "hawala-ledger:CREDIT+PURCHASE",
  }
  try {
    const hawala: any = container.resolve("hawalaLedger")
    const accounts = await hawala.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })
    if (!accounts?.length) return empty

    const entries: LedgerHistoryEntry[] = []
    for (const acct of accounts) {
      const hist = await hawala.getTransactionHistory(acct.id, { limit: 10_000 })
      entries.push(...(hist as LedgerHistoryEntry[]))
    }
    return computeRevenueSummary(entries, { asOf })
  } catch {
    return empty
  }
}

// ── Universal: operating history ────────────────────────────────────────────
function buildOperating(
  seller: SellerSnapshot,
  orders: SellerOrderRecord[],
  asOf: Date
): OperatingHistory {
  const base: OperatingHistory = {
    account_created_at: null,
    account_age_days: 0,
    months_active: 0,
    listing_count: seller.product_count,
    ...summarizeOrders(orders, asOf),
  }
  if (seller.created_at) {
    const created = new Date(seller.created_at)
    base.account_created_at = created.toISOString()
    base.account_age_days = Math.max(
      0,
      Math.floor((asOf.getTime() - created.getTime()) / 86_400_000)
    )
    base.months_active = Math.floor(base.account_age_days / 30)
  }
  return base
}

// ── Universal: customer / client record ─────────────────────────────────────
function buildCustomers(orders: SellerOrderRecord[], tiers: CustomerTierRecord[]): CustomerRecord {
  return {
    ...summarizeCustomers(orders),
    wholesale_relationships: countWholesaleRelationships(tiers),
  }
}

// ── Universal: reputation / XP / disputes ───────────────────────────────────
async function buildReputation(
  sellerId: string,
  container: MedusaContainer,
  memberIds: string[]
): Promise<ReputationSummary> {
  const base: ReputationSummary = {
    trust_score: null,
    tier: null,
    total_xp: 0,
    dispute_count: 0,
    verified_credentials: 0,
  }
  try {
    const verification: any = container.resolve("vendorVerification")
    const summary = await verification.getTrustSummary(sellerId)
    base.trust_score = summary?.trustScore ?? null
    base.tier = summary?.levelLabel ?? null
    // Verified credentials = confirmed badges only (never fabricated).
    base.verified_credentials = Array.isArray(summary?.badges)
      ? summary.badges.length
      : 0
  } catch {
    /* verification module unavailable — keep defaults */
  }
  const [disputes, xp] = await Promise.all([
    countLiveDisputes(sellerId, container),
    sumMemberXp(memberIds, container),
  ])
  base.dispute_count = disputes
  base.total_xp = xp
  return base
}

/**
 * Live cases against the seller in `order-dispute` (open or under review) —
 * the ones "Resolve open disputes" asks the vendor to clear. Decided and
 * withdrawn cases are history, not a hold.
 */
async function countLiveDisputes(sellerId: string, container: MedusaContainer): Promise<number> {
  try {
    const svc: any = container.resolve(ORDER_DISPUTE_MODULE)
    const rows = await svc.listOrderDisputes(
      { seller_id: sellerId, status: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      { select: ["id"] }
    )
    return Array.isArray(rows) ? rows.length : 0
  } catch {
    return 0
  }
}

/**
 * A seller's XP is the XP its people earned: `progression` keys character
 * sheets by member, so the seller's members' lifetime `total_xp` is summed —
 * the same seller→member bridge `grower-karma` uses. Read with the list
 * method, never `getOrCreateCharacterSheet`, so building a substrate creates
 * nothing.
 */
async function sumMemberXp(memberIds: string[], container: MedusaContainer): Promise<number> {
  if (memberIds.length === 0) return 0
  try {
    const svc: any = container.resolve(PROGRESSION_MODULE)
    const sheets = await svc.listCharacterSheets(
      { customer_id: memberIds },
      { select: ["customer_id", "total_xp"] }
    )
    const rows: Array<{ total_xp?: number | string | null }> = Array.isArray(sheets) ? sheets : []
    return rows.reduce((sum, sheet) => sum + Math.max(0, Number(sheet?.total_xp ?? 0) || 0), 0)
  } catch {
    return 0
  }
}

// ── Domain-optional: inventory & asset valuation ────────────────────────────
async function buildInventory(
  sellerId: string,
  query: any
): Promise<InventoryValuation | null> {
  if (!query) return null
  try {
    const { data } = await query.graph({
      entity: "harvest_batch",
      fields: ["id", "seller_id", "total_quantity", "sold_quantity", "reserved_quantity", "batch_price"],
      filters: { seller_id: sellerId },
    })
    if (!data?.length) return null
    let onHand = 0
    let retail = 0
    for (const b of data as any[]) {
      const avail =
        Number(b.total_quantity ?? 0) -
        Number(b.sold_quantity ?? 0) -
        Number(b.reserved_quantity ?? 0)
      const units = Math.max(0, avail)
      onHand += units
      retail += units * Number(b.batch_price ?? 0)
    }
    return { on_hand_units: onHand, retail_value: round2(retail), cost_value: null }
  } catch {
    return null
  }
}

// ── Domain-optional: production ledger (opt-in) ─────────────────────────────
async function buildProduction(
  sellerId: string,
  container: MedusaContainer
): Promise<ProductionSummary | null> {
  if (!featureFlagState.isEnabled("PRODUCTION_LEDGER_V1")) return null
  try {
    const svc: any = container.resolve("productionLedgerModuleService")
    const s = await svc.getProductionSummary(sellerId)
    if (!s || s.batch_count === 0) return null
    return {
      batch_count: s.batch_count,
      total_started: s.total_started,
      total_yield: s.total_yield,
      methods: s.methods,
    }
  } catch {
    return null
  }
}

// ── Domain-optional: channels (per-channel pricing tiers) ───────────────────
// Until 2026-09-06 this resolved a container key that does not exist
// (`vendorRulesModuleService`; the module registers as `vendorRules`), so the
// throw was swallowed and every vendor's `channels` was `null`.
function buildChannels(tiers: CustomerTierRecord[]): ChannelSummary | null {
  return channelsFromTiers(tiers)
}

// ── Domain-optional: document vault (opt-in) ────────────────────────────────
async function buildDocuments(
  sellerId: string,
  container: MedusaContainer
): Promise<VaultSummary | null> {
  if (!featureFlagState.isEnabled("DOCUMENT_VAULT_V1")) return null
  try {
    const svc: any = container.resolve("documentVaultModuleService")
    const docs = await svc.listForSeller(sellerId)
    if (!docs?.length) return null
    const now = new Date()
    return {
      documents: docs.map((d: any) => ({
        id: d.id,
        doc_type: d.doc_type,
        label: d.label,
        // Expiry-aware at the boundary, so every predicate downstream that
        // reads `verified` (verifiedDocsAtLeast, hasVerifiedDocType, the
        // compliance-tracker gates) gets "checked AND in date" without each
        // being taught about dates. The raw column is a stored fact about a
        // past check; a lapsed certificate must not count as evidence.
        verified: isDocumentCurrent(d, now),
        expires_at: d.expires_at ? new Date(d.expires_at).toISOString() : null,
      })),
    }
  } catch {
    return null
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
