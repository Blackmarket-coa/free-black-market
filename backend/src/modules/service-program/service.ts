import { MedusaService } from "@medusajs/framework/utils"
import ServiceProgram, {
  ServiceCategory,
  ServiceProgramType,
  ServiceProgramStatus,
  ServicePricingModel,
} from "./models/service-program"
import ServiceApplication, {
  ServiceApplicationStatus,
} from "./models/service-application"
import ServiceContract, {
  ServiceContractStatus,
} from "./models/service-contract"
import ServiceReview from "./models/service-review"

export interface CreateServiceProgramInput {
  vendorId: string
  title: string
  slug: string
  description?: string | null
  deliverableSpec?: Record<string, unknown> | null
  acceptanceCriteria?: Record<string, unknown> | null
  serviceCategory: ServiceCategory
  programType: ServiceProgramType
  pricingModel: ServicePricingModel
  unitPriceCents?: number | null
  hourlyRateCents?: number | null
  flatPriceCents?: number | null
  poolTotalCents?: number | null
  currencyCode?: string
  minUnits?: number | null
  maxUnits?: number | null
  deadlineAt?: Date | null
  startsAt?: Date | null
  endsAt?: Date | null
  budgetCapCents?: number | null
  requiresKyc?: boolean
  minVerificationLevel?: string | null
  geoAllowlist?: string[] | null
  metadata?: Record<string, unknown> | null
}

class ServiceProgramService extends MedusaService({
  ServiceProgram,
  ServiceApplication,
  ServiceContract,
  ServiceReview,
}) {
  async createProgram(input: CreateServiceProgramInput): Promise<any> {
    const existing = await this.listServicePrograms({
      vendor_id: input.vendorId,
      slug: input.slug,
    })
    if (existing.length > 0) {
      throw new Error(`Service program with slug "${input.slug}" already exists`)
    }
    return (this as any).createServicePrograms({
      vendor_id: input.vendorId,
      title: input.title,
      slug: input.slug,
      description: input.description ?? null,
      deliverable_spec: input.deliverableSpec ?? null,
      acceptance_criteria: input.acceptanceCriteria ?? null,
      service_category: input.serviceCategory,
      program_type: input.programType,
      pricing_model: input.pricingModel,
      unit_price_cents: input.unitPriceCents ?? null,
      hourly_rate_cents: input.hourlyRateCents ?? null,
      flat_price_cents: input.flatPriceCents ?? null,
      pool_total_cents: input.poolTotalCents ?? null,
      currency_code: input.currencyCode ?? "usd",
      min_units: input.minUnits ?? null,
      max_units: input.maxUnits ?? null,
      deadline_at: input.deadlineAt ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      budget_cap_cents: input.budgetCapCents ?? null,
      requires_kyc: input.requiresKyc ?? false,
      min_verification_level: input.minVerificationLevel ?? null,
      geo_allowlist: input.geoAllowlist ?? null,
      metadata: input.metadata ?? null,
    })
  }

  async publishProgram(programId: string): Promise<any> {
    return (this as any).updateServicePrograms({
      id: programId,
      status: ServiceProgramStatus.ACTIVE,
    })
  }

  async closeProgram(programId: string, reason?: string): Promise<any> {
    return (this as any).updateServicePrograms({
      id: programId,
      status: ServiceProgramStatus.CLOSED,
      metadata: reason ? { close_reason: reason } : undefined,
    })
  }

  async listOpenPrograms(filters: {
    serviceCategory?: ServiceCategory
    programType?: ServiceProgramType
    vendorId?: string
  } = {}): Promise<any[]> {
    const all = await this.listServicePrograms({
      status: ServiceProgramStatus.ACTIVE,
      ...(filters.vendorId ? { vendor_id: filters.vendorId } : {}),
      ...(filters.serviceCategory ? { service_category: filters.serviceCategory } : {}),
      ...(filters.programType ? { program_type: filters.programType } : {}),
    })
    const now = new Date()
    return all.filter((p: any) => {
      if (p.starts_at && new Date(p.starts_at) > now) return false
      if (p.ends_at && new Date(p.ends_at) < now) return false
      return true
    })
  }

  async applyToProgram(args: {
    programId: string
    serviceSellerId: string
    proposedUnitPriceCents?: number | null
    proposedCapacity?: number | null
    proposedLeadTimeDays?: number | null
    samplePortfolioUrls?: string[] | null
    pitch?: string | null
  }): Promise<any> {
    const programs = await this.listServicePrograms({ id: args.programId })
    const program = programs[0]
    if (!program) throw new Error("Program not found")
    if (program.status !== ServiceProgramStatus.ACTIVE) {
      throw new Error(`Program not open (status=${program.status})`)
    }
    const existing = await this.listServiceApplications({
      program_id: args.programId,
      service_seller_id: args.serviceSellerId,
    })
    if (existing.length > 0) {
      const e = existing[0]
      if (e.status === ServiceApplicationStatus.WITHDRAWN) {
        return (this as any).updateServiceApplications({
          id: e.id,
          status: ServiceApplicationStatus.PENDING,
          proposed_unit_price_cents: args.proposedUnitPriceCents ?? e.proposed_unit_price_cents,
          proposed_capacity: args.proposedCapacity ?? e.proposed_capacity,
          proposed_lead_time_days: args.proposedLeadTimeDays ?? e.proposed_lead_time_days,
          sample_portfolio_urls: args.samplePortfolioUrls ?? e.sample_portfolio_urls,
          pitch: args.pitch ?? e.pitch,
          decided_at: null,
          decided_by: null,
          decision_reason: null,
        })
      }
      return e
    }
    return (this as any).createServiceApplications({
      program_id: args.programId,
      service_seller_id: args.serviceSellerId,
      proposed_unit_price_cents: args.proposedUnitPriceCents ?? null,
      proposed_capacity: args.proposedCapacity ?? null,
      proposed_lead_time_days: args.proposedLeadTimeDays ?? null,
      sample_portfolio_urls: args.samplePortfolioUrls ?? null,
      pitch: args.pitch ?? null,
    })
  }

  async withdrawApplication(applicationId: string, serviceSellerId: string): Promise<any> {
    const apps = await this.listServiceApplications({
      id: applicationId,
      service_seller_id: serviceSellerId,
    })
    const app = apps[0]
    if (!app) throw new Error("Application not found")
    if (app.status !== ServiceApplicationStatus.PENDING) {
      throw new Error(`Cannot withdraw application in status ${app.status}`)
    }
    return (this as any).updateServiceApplications({
      id: applicationId,
      status: ServiceApplicationStatus.WITHDRAWN,
    })
  }

  async decideApplication(args: {
    applicationId: string
    decision: "approve" | "reject"
    decidedBy: string
    reason?: string | null
  }): Promise<any> {
    const apps = await this.listServiceApplications({ id: args.applicationId })
    const app = apps[0]
    if (!app) throw new Error("Application not found")
    if (app.status !== ServiceApplicationStatus.PENDING) {
      throw new Error(`Application already decided (status=${app.status})`)
    }
    return (this as any).updateServiceApplications({
      id: args.applicationId,
      status:
        args.decision === "approve"
          ? ServiceApplicationStatus.APPROVED
          : ServiceApplicationStatus.REJECTED,
      decided_at: new Date(),
      decided_by: args.decidedBy,
      decision_reason: args.reason ?? null,
    })
  }

  /**
   * Open a service contract for an approved application. Caller is
   * responsible for funding the escrow via hawala-ledger and patching
   * `escrow_ledger_entry_id` + `escrow_amount_cents` back via
   * `attachEscrowToContract`.
   */
  async openContractForApprovedApp(applicationId: string): Promise<any> {
    const apps = await this.listServiceApplications({ id: applicationId })
    const app = apps[0]
    if (!app) throw new Error("Application not found")
    if (app.status !== ServiceApplicationStatus.APPROVED) {
      throw new Error(`Cannot open contract for application in status ${app.status}`)
    }
    const programs = await this.listServicePrograms({ id: app.program_id })
    const program = programs[0]
    if (!program) throw new Error("Program not found")

    const existing = await this.listServiceContracts({ application_id: applicationId })
    if (existing.length > 0) return existing[0]

    const termsSnapshot = {
      service_category: program.service_category,
      program_type: program.program_type,
      pricing_model: program.pricing_model,
      unit_price_cents:
        app.proposed_unit_price_cents ?? program.unit_price_cents ?? null,
      hourly_rate_cents: program.hourly_rate_cents,
      flat_price_cents: program.flat_price_cents,
      currency_code: program.currency_code,
      min_units: program.min_units,
      max_units: program.max_units,
      deadline_at: program.deadline_at,
      acceptance_criteria: program.acceptance_criteria ?? null,
      deliverable_spec: program.deliverable_spec ?? null,
      proposed_capacity: app.proposed_capacity,
      proposed_lead_time_days: app.proposed_lead_time_days,
      requires_kyc: program.requires_kyc,
      min_verification_level: program.min_verification_level,
      snapshot_at: new Date().toISOString(),
    }

    return (this as any).createServiceContracts({
      program_id: app.program_id,
      application_id: applicationId,
      service_seller_id: app.service_seller_id,
      vendor_id: program.vendor_id,
      status: ServiceContractStatus.ACTIVE,
      effective_from: new Date(),
      effective_until: program.deadline_at ?? program.ends_at ?? null,
      terms_snapshot: termsSnapshot,
    })
  }

  async attachEscrowToContract(args: {
    contractId: string
    escrowLedgerEntryId: string
    escrowAmountCents: number
  }): Promise<any> {
    return (this as any).updateServiceContracts({
      id: args.contractId,
      escrow_ledger_entry_id: args.escrowLedgerEntryId,
      escrow_amount_cents: args.escrowAmountCents,
    })
  }

  async markContractInProgress(contractId: string): Promise<any> {
    return (this as any).updateServiceContracts({
      id: contractId,
      status: ServiceContractStatus.IN_PROGRESS,
    })
  }

  async markContractDelivered(args: {
    contractId: string
    unitsDelivered?: number
  }): Promise<any> {
    const updates: Record<string, unknown> = {
      id: args.contractId,
      status: ServiceContractStatus.DELIVERED,
    }
    if (args.unitsDelivered !== undefined) {
      const list = await this.listServiceContracts({ id: args.contractId })
      const c = list[0]
      if (c) {
        updates.total_units_delivered = Number(c.total_units_delivered) + args.unitsDelivered
      }
    }
    return (this as any).updateServiceContracts(updates)
  }

  async markContractAccepted(contractId: string): Promise<any> {
    return (this as any).updateServiceContracts({
      id: contractId,
      status: ServiceContractStatus.ACCEPTED,
    })
  }

  async markContractDisputed(contractId: string, reason: string): Promise<any> {
    return (this as any).updateServiceContracts({
      id: contractId,
      status: ServiceContractStatus.DISPUTED,
      dispute_reason: reason,
    })
  }

  async cancelContract(contractId: string): Promise<any> {
    return (this as any).updateServiceContracts({
      id: contractId,
      status: ServiceContractStatus.CANCELED,
    })
  }

  async incrementContractPayout(contractId: string, deltaCents: number): Promise<void> {
    const list = await this.listServiceContracts({ id: contractId })
    const c = list[0]
    if (!c) return
    await (this as any).updateServiceContracts({
      id: contractId,
      total_paid_cents: Number(c.total_paid_cents) + Math.max(0, deltaCents),
    })
  }

  // Service reviews were absorbed into the consolidated `reviews` module in
  // W4 (subject_type: service_contract; rows copied by
  // Migration20260830ReviewsAbsorption). The `ServiceReview` model stays
  // registered so the historical table survives, but it is read-only by
  // convention — eligibility lives in `review-rules.ts` (consumed by the
  // vendor route) and writes go through the reviews module.
}

export default ServiceProgramService
