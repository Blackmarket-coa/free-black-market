import { MedusaService } from "@medusajs/framework/utils"
import {
  Membership,
  OnboardingState,
  OnboardingSellingType,
  OnboardingWizardStep,
  Organization,
  Storefront,
} from "./models"

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

  /**
   * Ensure an onboarding row keyed by seller_id (used by the vendor-panel
   * wizard since organization/storefront aren't always available before
   * the seller completes setup).
   */
  async ensureSellerOnboardingState(seller_id: string) {
    const existing = await this.listOnboardingStates({ seller_id })
    if (existing.length) return existing[0]
    const [created] = await this.createOnboardingStates([
      {
        seller_id,
        organization_id: "",
        storefront_id: "",
        wizard_step: OnboardingWizardStep.SIGNUP,
        wizard_started_at: new Date(),
      },
    ])
    return created
  }

  /**
   * Advance the wizard to the supplied step and stamp a completion
   * timestamp for that step. Idempotent — repeated calls update the
   * timestamp without creating duplicates.
   */
  async advanceWizardStep(args: {
    seller_id: string
    step: OnboardingWizardStep
    selling_type?: OnboardingSellingType | null
    payout_deferred_until_first_sale?: boolean
  }) {
    const state = await this.ensureSellerOnboardingState(args.seller_id)
    const completed = (state.wizard_step_completed_at ?? {}) as Record<string, string>
    completed[args.step] = new Date().toISOString()
    const update: Record<string, unknown> = {
      id: state.id,
      wizard_step: args.step,
      wizard_step_completed_at: completed,
    }
    if (args.selling_type !== undefined) update.selling_type = args.selling_type
    if (args.payout_deferred_until_first_sale !== undefined) {
      update.payout_deferred_until_first_sale = args.payout_deferred_until_first_sale
    }
    if (!state.wizard_started_at) {
      update.wizard_started_at = new Date()
    }
    const [updated] = await this.updateOnboardingStates([update as any])
    return updated
  }

  async markFirstListingPublished(args: {
    seller_id: string
    listing_id: string
  }) {
    const state = await this.ensureSellerOnboardingState(args.seller_id)
    const completed = (state.wizard_step_completed_at ?? {}) as Record<string, string>
    completed[OnboardingWizardStep.PUBLISHED] = new Date().toISOString()
    const [updated] = await this.updateOnboardingStates([
      {
        id: state.id,
        wizard_step: OnboardingWizardStep.PUBLISHED,
        wizard_step_completed_at: completed,
        first_listing_created: true,
        first_published_listing_id: args.listing_id,
        first_published_at: new Date(),
      } as any,
    ])
    return updated
  }

  /**
   * A10 funnel: counts of onboarding states grouped by wizard_step.
   */
  async wizardFunnel(): Promise<Record<OnboardingWizardStep, number>> {
    const all = await this.listOnboardingStates({})
    const counts: Record<OnboardingWizardStep, number> = {
      [OnboardingWizardStep.SIGNUP]: 0,
      [OnboardingWizardStep.STEP_1]: 0,
      [OnboardingWizardStep.STEP_2]: 0,
      [OnboardingWizardStep.STEP_3]: 0,
      [OnboardingWizardStep.STEP_4]: 0,
      [OnboardingWizardStep.PUBLISHED]: 0,
    }
    for (const row of all) {
      const step = (row as any).wizard_step as OnboardingWizardStep
      if (step in counts) counts[step] += 1
    }
    return counts
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
