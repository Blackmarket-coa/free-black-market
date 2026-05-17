import { MedusaService } from "@medusajs/framework/utils"
import CreatorProgram, {
  CreatorProgramStatus,
  CreatorProgramType,
  CreatorProgramAttributionModel,
} from "./models/creator-program"
import CreatorApplication, {
  CreatorApplicationStatus,
} from "./models/creator-application"
import CreatorDeal, { CreatorDealStatus } from "./models/creator-deal"

export interface CreateProgramInput {
  vendorId: string
  title: string
  slug: string
  description?: string | null
  briefMarkdown?: string | null
  programType: CreatorProgramType
  // Financial
  commissionPercent?: number | null
  commissionFlatCents?: number | null
  sponsorshipFlatCents?: number | null
  poolTotalCents?: number | null
  poolPeriod?: string | null
  cookieWindowDays?: number
  holdDays?: number
  attributionModel?: CreatorProgramAttributionModel
  currencyCode?: string
  // Targeting
  productIds?: string[] | null
  collectionIds?: string[] | null
  categoryIds?: string[] | null
  requiredPlatforms?: string[] | null
  minFollowers?: number | null
  geoAllowlist?: string[] | null
  // Lifecycle
  startsAt?: Date | null
  endsAt?: Date | null
  budgetCapCents?: number | null
  // Gating
  requiresKyc?: boolean
  minVerificationLevel?: string | null
  metadata?: Record<string, unknown> | null
}

class CreatorProgramService extends MedusaService({
  CreatorProgram,
  CreatorApplication,
  CreatorDeal,
}) {
  async createProgram(input: CreateProgramInput): Promise<any> {
    const existing = await this.listCreatorPrograms({
      vendor_id: input.vendorId,
      slug: input.slug,
    })
    if (existing.length > 0) {
      throw new Error(`Program with slug "${input.slug}" already exists for this vendor`)
    }

    return (this as any).createCreatorPrograms({
      vendor_id: input.vendorId,
      title: input.title,
      slug: input.slug,
      description: input.description ?? null,
      brief_markdown: input.briefMarkdown ?? null,
      program_type: input.programType,
      commission_percent: input.commissionPercent ?? null,
      commission_flat_cents: input.commissionFlatCents ?? null,
      sponsorship_flat_cents: input.sponsorshipFlatCents ?? null,
      pool_total_cents: input.poolTotalCents ?? null,
      pool_period: input.poolPeriod ?? null,
      cookie_window_days: input.cookieWindowDays ?? 7,
      hold_days: input.holdDays ?? 7,
      attribution_model: input.attributionModel ?? CreatorProgramAttributionModel.LAST_CLICK,
      currency_code: input.currencyCode ?? "usd",
      product_ids: input.productIds ?? null,
      collection_ids: input.collectionIds ?? null,
      category_ids: input.categoryIds ?? null,
      required_platforms: input.requiredPlatforms ?? null,
      min_followers: input.minFollowers ?? null,
      geo_allowlist: input.geoAllowlist ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      budget_cap_cents: input.budgetCapCents ?? null,
      requires_kyc: input.requiresKyc ?? false,
      min_verification_level: input.minVerificationLevel ?? null,
      metadata: input.metadata ?? null,
    })
  }

  async publishProgram(programId: string): Promise<any> {
    return (this as any).updateCreatorPrograms({
      id: programId,
      status: CreatorProgramStatus.ACTIVE,
    })
  }

  async pauseProgram(programId: string): Promise<any> {
    return (this as any).updateCreatorPrograms({
      id: programId,
      status: CreatorProgramStatus.PAUSED,
    })
  }

  async closeProgram(programId: string, reason?: string): Promise<any> {
    return (this as any).updateCreatorPrograms({
      id: programId,
      status: CreatorProgramStatus.CLOSED,
      metadata: reason ? { close_reason: reason } : undefined,
    })
  }

  /**
   * List programs that are currently open for applications.
   *
   * Filters: only `ACTIVE` programs that fall within `[starts_at, ends_at]`.
   * Optional `vendorId` / `programType` filters narrow further.
   */
  async listOpenPrograms(filters: {
    vendorId?: string
    programType?: CreatorProgramType
    productId?: string
  } = {}): Promise<any[]> {
    const all = await this.listCreatorPrograms({
      status: CreatorProgramStatus.ACTIVE,
      ...(filters.vendorId ? { vendor_id: filters.vendorId } : {}),
      ...(filters.programType ? { program_type: filters.programType } : {}),
    })
    const now = new Date()
    return all.filter((p: any) => {
      if (p.starts_at && new Date(p.starts_at) > now) return false
      if (p.ends_at && new Date(p.ends_at) < now) return false
      if (filters.productId && Array.isArray(p.product_ids)) {
        return p.product_ids.includes(filters.productId)
      }
      return true
    })
  }

  async applyToProgram(args: {
    programId: string
    creatorSellerId: string
    pitch?: string | null
    proposedPlatforms?: string[] | null
    followerSnapshot?: Record<string, number> | null
  }): Promise<any> {
    const programs = await this.listCreatorPrograms({ id: args.programId })
    const program = programs[0]
    if (!program) throw new Error("Program not found")
    if (program.status !== CreatorProgramStatus.ACTIVE) {
      throw new Error(`Program is not open (status=${program.status})`)
    }

    const existing = await this.listCreatorApplications({
      program_id: args.programId,
      creator_seller_id: args.creatorSellerId,
    })
    if (existing.length > 0) {
      // Idempotent: re-applying after withdrawal reopens; otherwise return existing
      const e = existing[0]
      if (e.status === CreatorApplicationStatus.WITHDRAWN) {
        return (this as any).updateCreatorApplications({
          id: e.id,
          status: CreatorApplicationStatus.PENDING,
          pitch: args.pitch ?? e.pitch,
          proposed_platforms: args.proposedPlatforms ?? e.proposed_platforms,
          follower_snapshot: args.followerSnapshot ?? e.follower_snapshot,
          decided_at: null,
          decided_by: null,
          decision_reason: null,
        })
      }
      return e
    }

    return (this as any).createCreatorApplications({
      program_id: args.programId,
      creator_seller_id: args.creatorSellerId,
      pitch: args.pitch ?? null,
      proposed_platforms: args.proposedPlatforms ?? null,
      follower_snapshot: args.followerSnapshot ?? null,
    })
  }

  async withdrawApplication(applicationId: string, creatorSellerId: string): Promise<any> {
    const apps = await this.listCreatorApplications({
      id: applicationId,
      creator_seller_id: creatorSellerId,
    })
    const app = apps[0]
    if (!app) throw new Error("Application not found")
    if (app.status !== CreatorApplicationStatus.PENDING) {
      throw new Error(`Cannot withdraw application in status ${app.status}`)
    }
    return (this as any).updateCreatorApplications({
      id: applicationId,
      status: CreatorApplicationStatus.WITHDRAWN,
    })
  }

  async decideApplication(args: {
    applicationId: string
    decision: "approve" | "reject"
    decidedBy: string
    reason?: string | null
  }): Promise<any> {
    const apps = await this.listCreatorApplications({ id: args.applicationId })
    const app = apps[0]
    if (!app) throw new Error("Application not found")
    if (app.status !== CreatorApplicationStatus.PENDING) {
      throw new Error(`Application is already decided (status=${app.status})`)
    }
    return (this as any).updateCreatorApplications({
      id: args.applicationId,
      status:
        args.decision === "approve"
          ? CreatorApplicationStatus.APPROVED
          : CreatorApplicationStatus.REJECTED,
      decided_at: new Date(),
      decided_by: args.decidedBy,
      decision_reason: args.reason ?? null,
    })
  }

  /**
   * Open a deal for an approved application. Caller is responsible for
   * generating the auto-default `AffiliateLink` and patching it into
   * `default_affiliate_link_id` (this module does not depend on
   * creator-attribution to avoid a circular module dependency).
   */
  async openDealForApprovedApp(applicationId: string): Promise<any> {
    const apps = await this.listCreatorApplications({ id: applicationId })
    const app = apps[0]
    if (!app) throw new Error("Application not found")
    if (app.status !== CreatorApplicationStatus.APPROVED) {
      throw new Error(`Cannot open deal for application in status ${app.status}`)
    }

    const programs = await this.listCreatorPrograms({ id: app.program_id })
    const program = programs[0]
    if (!program) throw new Error("Program not found")

    const existingDeals = await this.listCreatorDeals({
      application_id: applicationId,
    })
    if (existingDeals.length > 0) return existingDeals[0]

    const termsSnapshot = {
      program_type: program.program_type,
      commission_percent: program.commission_percent,
      commission_flat_cents: program.commission_flat_cents,
      sponsorship_flat_cents: program.sponsorship_flat_cents,
      cookie_window_days: program.cookie_window_days,
      hold_days: program.hold_days,
      attribution_model: program.attribution_model,
      currency_code: program.currency_code,
      product_ids: program.product_ids ?? null,
      collection_ids: program.collection_ids ?? null,
      requires_kyc: program.requires_kyc,
      min_verification_level: program.min_verification_level,
      snapshot_at: new Date().toISOString(),
    }

    return (this as any).createCreatorDeals({
      program_id: app.program_id,
      application_id: applicationId,
      creator_seller_id: app.creator_seller_id,
      vendor_id: program.vendor_id,
      status: CreatorDealStatus.ACTIVE,
      effective_from: new Date(),
      effective_until: program.ends_at ?? null,
      terms_snapshot: termsSnapshot,
    })
  }

  async attachDefaultLinkToDeal(dealId: string, affiliateLinkId: string): Promise<any> {
    return (this as any).updateCreatorDeals({
      id: dealId,
      default_affiliate_link_id: affiliateLinkId,
    })
  }

  async incrementDealAttribution(dealId: string, deltaCents: number): Promise<void> {
    const deals = await this.listCreatorDeals({ id: dealId })
    const deal = deals[0]
    if (!deal) return
    await (this as any).updateCreatorDeals({
      id: dealId,
      total_attributed_cents:
        Number(deal.total_attributed_cents) + Math.max(0, deltaCents),
    })
  }

  async incrementDealPayout(dealId: string, deltaCents: number): Promise<void> {
    const deals = await this.listCreatorDeals({ id: dealId })
    const deal = deals[0]
    if (!deal) return
    await (this as any).updateCreatorDeals({
      id: dealId,
      total_paid_out_cents:
        Number(deal.total_paid_out_cents) + Math.max(0, deltaCents),
    })
  }

  async violateDeal(dealId: string, reason: string): Promise<any> {
    return (this as any).updateCreatorDeals({
      id: dealId,
      status: CreatorDealStatus.VIOLATED,
      violation_reason: reason,
    })
  }

  async cancelDeal(dealId: string): Promise<any> {
    return (this as any).updateCreatorDeals({
      id: dealId,
      status: CreatorDealStatus.CANCELED,
    })
  }
}

export default CreatorProgramService
