import { MedusaService } from "@medusajs/framework/utils"
import { Membership, OnboardingState, Organization, Storefront } from "./models"

export type TenancyRole = "org_owner" | "storefront_admin" | "catalog_manager" | "finance_viewer"
export type TierFlag = "tier0_public" | "tier1_verified" | "tier2_aligned_org"

const tierRank: Record<TierFlag, number> = {
  tier0_public: 0,
  tier1_verified: 1,
  tier2_aligned_org: 2,
}

class TenancyModuleService extends MedusaService({
  Organization,
  Storefront,
  Membership,
  OnboardingState,
}) {
  async resolveContext(input: { user_id?: string; organization_id?: string; storefront_id?: string }) {
    const { user_id, organization_id, storefront_id } = input

    const storefront = storefront_id
      ? await this.retrieveStorefront(storefront_id).catch(() => null)
      : null

    if (!storefront) {
      return {
        storefront: null,
        membership: null,
        tier: "tier0_public" as TierFlag,
      }
    }

    const membership = user_id
      ? (await this.listMemberships({ user_id, storefront_id, organization_id: organization_id || storefront.organization_id }))[0] || null
      : null

    return {
      storefront,
      membership,
      tier: storefront.tier as TierFlag,
    }
  }

  hasMinimumTier(actual: TierFlag, required: TierFlag) {
    return tierRank[actual] >= tierRank[required]
  }

  canAccessRole(role: TenancyRole, required: TenancyRole[]) {
    const matrix: Record<TenancyRole, TenancyRole[]> = {
      org_owner: ["org_owner", "storefront_admin", "catalog_manager", "finance_viewer"],
      storefront_admin: ["storefront_admin", "catalog_manager", "finance_viewer"],
      catalog_manager: ["catalog_manager"],
      finance_viewer: ["finance_viewer"],
    }

    return required.some((needed) => matrix[role]?.includes(needed))
  }

  featureGatesForTier(tier: TierFlag) {
    return {
      donation_routing: this.hasMinimumTier(tier, "tier1_verified"),
      advanced_automation: this.hasMinimumTier(tier, "tier2_aligned_org"),
    }
  }
  starterTemplates() {
    return [
      {
        key: "food_coop",
        name: "Food Cooperative",
        tier: "tier1_verified" as TierFlag,
        defaults: { donation_default_percentage: 2, settlement_mode: "split_processor" },
      },
      {
        key: "restaurant_collective",
        name: "Restaurant Collective",
        tier: "tier1_verified" as TierFlag,
        defaults: { donation_default_percentage: 1, settlement_mode: "split_processor" },
      },
      {
        key: "nonprofit_marketplace",
        name: "Nonprofit Marketplace",
        tier: "tier2_aligned_org" as TierFlag,
        defaults: { donation_default_percentage: 5, settlement_mode: "ledger_batch" },
      },
    ]
  }

  async ensureOnboardingState(organization_id: string, storefront_id: string) {
    const existing = await this.listOnboardingStates({ organization_id, storefront_id })
    if (existing.length) return existing[0]
    return this.createOnboardingStates({ organization_id, storefront_id })
  }

  async setSandboxMode(storefront_id: string, enabled: boolean) {
    const storefront = await this.retrieveStorefront(storefront_id)
    return this.updateStorefronts({
      id: storefront.id,
      metadata: {
        ...(storefront.metadata as Record<string, unknown>),
        sandbox_mode: enabled,
      },
    })
  }

  parseCsvRows(csv: string) {
    const lines = csv.split(/\r?\n/).filter(Boolean)
    if (!lines.length) return { headers: [], rows: [] as string[][] }
    const headers = lines[0].split(",").map((h) => h.trim())
    const rows = lines.slice(1).map((line) => line.split(",").map((v) => v.trim()))
    return { headers, rows }
  }

  validateMappedRows(
    headers: string[],
    rows: string[][],
    mapping: Record<string, string>
  ) {
    const idx = (name: string) => headers.findIndex((h) => h === name)
    const required = ["title", "price", "handle"]

    const errors: Array<{ row: number; field: string; message: string }> = []
    const preview: Array<Record<string, string>> = []

    rows.forEach((row, i) => {
      const mapped: Record<string, string> = {}
      for (const [target, source] of Object.entries(mapping)) {
        const sourceIdx = idx(source)
        mapped[target] = sourceIdx >= 0 ? row[sourceIdx] || "" : ""
      }

      required.forEach((field) => {
        if (!mapped[field]) {
          errors.push({ row: i + 2, field, message: `${field} is required` })
        }
      })

      if (mapped.price && Number.isNaN(Number(mapped.price))) {
        errors.push({ row: i + 2, field: "price", message: "price must be numeric" })
      }

      preview.push(mapped)
    })

    return { errors, preview }
  }

}

export default TenancyModuleService
