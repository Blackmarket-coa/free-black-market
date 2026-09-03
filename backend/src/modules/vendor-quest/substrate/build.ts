import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { featureFlagState } from "../../../shared/feature-flags"
import { isDocumentCurrent } from "../../document-vault/document-status"
import { computeRevenueSummary, type LedgerHistoryEntry } from "./revenue"
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
 * `asOf` is injectable so callers/tests get deterministic revenue windows.
 */
export async function buildSubstrate(
  sellerId: string,
  container: MedusaContainer,
  opts: { asOf?: Date } = {}
): Promise<VendorSubstrate> {
  const query = safeResolve(container, ContainerRegistrationKeys.QUERY)

  const [revenue, operating, customers, reputation] = await Promise.all([
    buildRevenue(sellerId, container, opts.asOf),
    buildOperating(sellerId, query),
    buildCustomers(sellerId, query),
    buildReputation(sellerId, container),
  ])

  const [inventory, production, channels, documents] = await Promise.all([
    buildInventory(sellerId, query),
    buildProduction(sellerId, container),
    buildChannels(sellerId, container),
    buildDocuments(sellerId, container),
  ])

  return {
    seller_id: sellerId,
    generated_at: (opts.asOf ?? new Date()).toISOString(),
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
async function buildOperating(sellerId: string, query: any): Promise<OperatingHistory> {
  const base: OperatingHistory = {
    account_created_at: null,
    account_age_days: 0,
    months_active: 0,
    listing_count: 0,
    orders_fulfilled: 0,
    fulfillment_reliability: null,
  }
  if (!query) return base
  try {
    const { data } = await query.graph({
      entity: "seller",
      fields: ["id", "created_at", "products.id"],
      filters: { id: sellerId },
    })
    const seller = data?.[0]
    if (seller?.created_at) {
      const created = new Date(seller.created_at)
      base.account_created_at = created.toISOString()
      base.account_age_days = Math.max(
        0,
        Math.floor((Date.now() - created.getTime()) / 86_400_000)
      )
      base.months_active = Math.floor(base.account_age_days / 30)
    }
    base.listing_count = Array.isArray(seller?.products) ? seller.products.length : 0
  } catch {
    /* seller graph unavailable — keep defaults */
  }
  return base
}

// ── Universal: customer / client record ─────────────────────────────────────
async function buildCustomers(sellerId: string, query: any): Promise<CustomerRecord> {
  const base: CustomerRecord = {
    distinct_customers: 0,
    repeat_customers: 0,
    repeat_rate: null,
    wholesale_relationships: 0,
  }
  if (!query) return base
  try {
    // Orders linked to this seller; count distinct + repeat customers.
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "seller_id"],
      filters: { seller_id: sellerId },
    })
    const byCustomer = new Map<string, number>()
    for (const o of data ?? []) {
      const c = (o as any).customer_id
      if (!c) continue
      byCustomer.set(c, (byCustomer.get(c) ?? 0) + 1)
    }
    base.distinct_customers = byCustomer.size
    base.repeat_customers = [...byCustomer.values()].filter((n) => n > 1).length
    base.repeat_rate =
      byCustomer.size > 0 ? round2(base.repeat_customers / byCustomer.size) : null
  } catch {
    /* order graph unavailable — keep defaults */
  }
  return base
}

// ── Universal: reputation / XP ──────────────────────────────────────────────
async function buildReputation(
  sellerId: string,
  container: MedusaContainer
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
  return base
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
async function buildChannels(
  sellerId: string,
  container: MedusaContainer
): Promise<ChannelSummary | null> {
  try {
    const svc: any = container.resolve("vendorRulesModuleService")
    const tiers = await svc.listVendorCustomerTiers?.({ seller_id: sellerId })
    if (!tiers?.length) return null
    return {
      channels: tiers.map((t: any) => ({
        key: t.tier_type ?? t.id,
        label: t.name ?? t.tier_type ?? "channel",
      })),
    }
  } catch {
    return null
  }
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
