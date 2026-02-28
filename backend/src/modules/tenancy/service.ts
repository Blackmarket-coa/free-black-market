import { MedusaService } from "@medusajs/framework/utils"
import { Membership, Organization, Storefront } from "./models"

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
}

export default TenancyModuleService
