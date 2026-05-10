import { MedusaService } from "@medusajs/framework/utils"
import { emitMetric } from "../../lib/instrumentation"
import {
  VendorVerification,
  VerificationCheck,
  VendorBadge,
  VerificationLevel,
  VerificationType,
  BadgeType,
  CheckStatus,
  BadgeStatus,
} from "./models"

/**
 * Badge Configuration
 * Defines what each badge means and how it's displayed
 */
export const BADGE_CONFIG: Record<BadgeType, {
  name: string
  description: string
  icon: string
  color: string
  learnMoreUrl?: string
}> = {
  [BadgeType.VERIFIED_PRODUCER]: {
    name: "Verified Producer",
    description: "This producer's identity and location have been verified by our team.",
    icon: "shield-check",
    color: "#10B981",
  },
  [BadgeType.LOCAL_PRODUCER]: {
    name: "Local Producer",
    description: "Located within 100 miles of your delivery area.",
    icon: "map-pin",
    color: "#3B82F6",
  },
  [BadgeType.ORGANIC_CERTIFIED]: {
    name: "Certified Organic",
    description: "USDA Certified Organic - verified by an accredited certifier.",
    icon: "leaf",
    color: "#22C55E",
    learnMoreUrl: "https://www.usda.gov/topics/organic",
  },
  [BadgeType.REGENERATIVE]: {
    name: "Regenerative",
    description: "Uses regenerative agriculture practices that improve soil health.",
    icon: "sparkles",
    color: "#8B5CF6",
  },
  [BadgeType.FAIR_TRADE]: {
    name: "Fair Trade",
    description: "Fair Trade certified - workers receive fair wages and conditions.",
    icon: "scale",
    color: "#F59E0B",
  },
  [BadgeType.WOMAN_OWNED]: {
    name: "Woman-Owned",
    description: "Majority woman-owned business.",
    icon: "user",
    color: "#EC4899",
  },
  [BadgeType.CONSCIOUS]: {
    name: "Conscious",
    description: "Committed to conscious and ethical business practices.",
    icon: "user",
    color: "#1F2937",
  },
  [BadgeType.VETERAN_OWNED]: {
    name: "Veteran-Owned",
    description: "Owned by a U.S. military veteran.",
    icon: "star",
    color: "#DC2626",
  },
  [BadgeType.COOPERATIVE]: {
    name: "Cooperative",
    description: "Democratically-owned cooperative business.",
    icon: "users",
    color: "#0891B2",
  },
  [BadgeType.FAMILY_FARM]: {
    name: "Family Farm",
    description: "Family-owned and operated for at least one generation.",
    icon: "home",
    color: "#78716C",
  },
  [BadgeType.B_CORP]: {
    name: "B Corp Certified",
    description: "Meets the highest standards of social and environmental performance.",
    icon: "badge-check",
    color: "#1D4ED8",
    learnMoreUrl: "https://www.bcorporation.net/",
  },
  [BadgeType.ZERO_WASTE]: {
    name: "Zero Waste",
    description: "Committed to zero waste practices in production and packaging.",
    icon: "recycle",
    color: "#059669",
  },
  [BadgeType.CARBON_NEUTRAL]: {
    name: "Carbon Neutral",
    description: "Operations are carbon neutral or carbon negative.",
    icon: "globe",
    color: "#0D9488",
  },
  [BadgeType.COMMUNITY_SUPPORTED]: {
    name: "Community Supported",
    description: "Offers CSA or community-supported purchasing options.",
    icon: "heart",
    color: "#E11D48",
  },
}

/**
 * Trust Score Weights
 * How much each verification type contributes to the overall score
 */
const TRUST_SCORE_WEIGHTS: Record<VerificationType, number> = {
  [VerificationType.IDENTITY]: 20,
  [VerificationType.LOCATION]: 15,
  [VerificationType.PRODUCTION]: 15,
  [VerificationType.PRACTICES]: 10,
  [VerificationType.CERTIFICATION]: 15,
  [VerificationType.BANK_ACCOUNT]: 15,
  [VerificationType.TAX_INFO]: 10,
}

class VendorVerificationService extends MedusaService({
  VendorVerification,
  VerificationCheck,
  VendorBadge,
}) {
  /**
   * Get or create verification record for a seller
   */
  async getOrCreateVerification(sellerId: string) {
    const existing = await this.listVendorVerifications({
      seller_id: sellerId,
    })
    
    if (existing.length > 0) {
      return existing[0]
    }
    
    const created = await this.createVendorVerifications({
      seller_id: sellerId,
      level: VerificationLevel.UNVERIFIED,
      trust_score: 0,
    })
    
    return created
  }
  
  /**
   * Submit a verification check
   */
  async submitVerificationCheck(
    sellerId: string,
    checkType: VerificationType,
    data: {
      documents?: Record<string, unknown>
      check_data?: Record<string, unknown>
      notes?: string
    }
  ) {
    const verification = await this.getOrCreateVerification(sellerId)
    
    // Check if there's already a pending or passed check of this type
    const existingChecks = await this.listVerificationChecks({
      vendor_verification_id: verification.id,
      check_type: checkType,
      status: [CheckStatus.PENDING, CheckStatus.IN_PROGRESS, CheckStatus.PASSED],
    })
    
    if (existingChecks.length > 0) {
      const existing = existingChecks[0]
      emitMetric("vendor.verification.submitted", {
        seller_id: sellerId,
        check_type: checkType,
        update: true,
      })
      // Update existing check
      return this.updateVerificationChecks({
        id: existing.id,
        documents: data.documents,
        check_data: data.check_data,
        notes: data.notes,
        status: CheckStatus.PENDING,
      })
    }

    emitMetric("vendor.verification.submitted", {
      seller_id: sellerId,
      check_type: checkType,
      update: false,
    })
    // Create new check
    return this.createVerificationChecks({
      vendor_verification_id: verification.id,
      check_type: checkType,
      status: CheckStatus.PENDING,
      documents: data.documents,
      check_data: data.check_data,
      notes: data.notes,
    })
  }
  
  /**
   * Process a verification check (admin action)
   */
  async processVerificationCheck(
    checkId: string,
    result: {
      status: CheckStatus.PASSED | CheckStatus.FAILED | CheckStatus.WAIVED
      verified_by: string
      notes?: string
      expires_at?: Date
      score_contribution?: number
    }
  ) {
    const check = await this.retrieveVerificationCheck(checkId)
    
    const updated = await this.updateVerificationChecks({
      id: checkId,
      status: result.status,
      verified_by: result.verified_by,
      verified_at: new Date(),
      expires_at: result.expires_at,
      notes: result.notes,
      score_contribution: result.status === CheckStatus.PASSED
        ? (result.score_contribution ?? TRUST_SCORE_WEIGHTS[check.check_type as VerificationType] ?? 0)
        : 0,
    })

    emitMetric("vendor.verification.processed", {
      check_id: checkId,
      check_type: check.check_type,
      status: result.status,
      verified_by: result.verified_by,
    })
    if (result.status === CheckStatus.PASSED) {
      emitMetric("vendor.verification.verified", {
        check_id: checkId,
        check_type: check.check_type,
      })
    } else if (result.status === CheckStatus.FAILED) {
      emitMetric("vendor.verification.rejected", {
        check_id: checkId,
        check_type: check.check_type,
      })
    }

    // Recalculate trust score
    await this.recalculateTrustScore(check.vendor_verification_id)

    return updated
  }
  
  /**
   * Recalculate trust score based on passed checks
   */
  async recalculateTrustScore(verificationId: string): Promise<number> {
    const checks = await this.listVerificationChecks({
      vendor_verification_id: verificationId,
      status: CheckStatus.PASSED,
    })
    
    let totalScore = 0
    const passedTypes = new Set<string>()
    
    for (const check of checks) {
      // Only count each type once (use highest score if multiple)
      if (!passedTypes.has(check.check_type)) {
        totalScore += check.score_contribution || 0
        passedTypes.add(check.check_type)
      }
    }
    
    // Determine verification level based on score and passed checks
    let level = VerificationLevel.UNVERIFIED
    
    if (totalScore >= 80 && passedTypes.has(VerificationType.CERTIFICATION)) {
      level = VerificationLevel.CERTIFIED
    } else if (totalScore >= 70) {
      level = VerificationLevel.AUDITED
    } else if (totalScore >= 50) {
      level = VerificationLevel.VERIFIED
    } else if (totalScore >= 20) {
      level = VerificationLevel.SELF_REPORTED
    }
    
    await this.updateVendorVerifications({
      id: verificationId,
      trust_score: totalScore,
      level,
      last_verified_at: new Date(),
    })

    emitMetric("vendor.verification.trust_score", {
      verification_id: verificationId,
      level,
      passed_check_count: passedTypes.size,
    }, totalScore)

    return totalScore
  }

  /**
   * Build the admin verification funnel summary used by the
   * Coalition admin dashboard. Shape: total counts grouped by status,
   * plus median time-to-verify in milliseconds.
   */
  async getVerificationFunnel(): Promise<{
    by_status: Record<string, number>
    by_level: Record<string, number>
    median_time_to_verify_ms: number | null
    total: number
  }> {
    const verifications = await this.listVendorVerifications({})
    const checks = await this.listVerificationChecks({})

    const by_level: Record<string, number> = {}
    for (const v of verifications) {
      by_level[v.level] = (by_level[v.level] ?? 0) + 1
    }

    const by_status: Record<string, number> = {}
    for (const c of checks) {
      by_status[c.status] = (by_status[c.status] ?? 0) + 1
    }

    const verifiedTimes: number[] = []
    for (const c of checks) {
      if (c.status === CheckStatus.PASSED && c.verified_at) {
        const created = new Date(c.created_at as unknown as string).getTime()
        const verified = new Date(c.verified_at as unknown as string).getTime()
        if (Number.isFinite(created) && Number.isFinite(verified) && verified >= created) {
          verifiedTimes.push(verified - created)
        }
      }
    }

    let median: number | null = null
    if (verifiedTimes.length > 0) {
      const sorted = [...verifiedTimes].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      median = sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid]
    }

    return {
      by_status,
      by_level,
      median_time_to_verify_ms: median,
      total: verifications.length,
    }
  }
  
  /**
   * Grant a badge to a seller
   */
  async grantBadge(
    sellerId: string,
    badgeType: BadgeType,
    data: {
      granted_by: string
      description?: string
      documentation_url?: string
      certification_number?: string
      certifying_body?: string
      expires_at?: Date
    }
  ) {
    // Check if badge already exists
    const existing = await this.listVendorBadges({
      seller_id: sellerId,
      badge_type: badgeType,
    })
    
    if (existing.length > 0) {
      // Reactivate if revoked/expired
      return this.updateVendorBadges({
        id: existing[0].id,
        status: BadgeStatus.ACTIVE,
        granted_at: new Date(),
        ...data,
      })
    }
    
    return this.createVendorBadges({
      seller_id: sellerId,
      badge_type: badgeType,
      status: BadgeStatus.ACTIVE,
      granted_at: new Date(),
      ...data,
    })
  }
  
  /**
   * Get all active badges for a seller
   */
  async getActiveBadges(sellerId: string) {
    const badges = await this.listVendorBadges({
      seller_id: sellerId,
      status: BadgeStatus.ACTIVE,
    })
    
    return badges.map(badge => ({
      badge,
      config: BADGE_CONFIG[badge.badge_type as BadgeType],
    }))
  }
  
  /**
   * Get trust summary for consumer display
   */
  async getTrustSummary(sellerId: string): Promise<{
    level: VerificationLevel
    levelLabel: string
    trustScore: number
    yearsActive: number
    productionScale: string
    badges: Array<{
      type: BadgeType
      name: string
      description: string
      icon: string
      color: string
    }>
    verificationStatement?: string
  }> {
    const verification = await this.getOrCreateVerification(sellerId)
    const badges = await this.getActiveBadges(sellerId)
    
    const levelLabels: Record<VerificationLevel, string> = {
      [VerificationLevel.UNVERIFIED]: "New Producer",
      [VerificationLevel.SELF_REPORTED]: "Self-Reported",
      [VerificationLevel.VERIFIED]: "Verified Producer",
      [VerificationLevel.AUDITED]: "Audited Producer",
      [VerificationLevel.CERTIFIED]: "Certified Producer",
    }
    
    return {
      level: verification.level as VerificationLevel,
      levelLabel: levelLabels[verification.level as VerificationLevel],
      trustScore: verification.trust_score,
      yearsActive: verification.years_active,
      productionScale: verification.production_scale,
      badges: badges.map(b => ({
        type: b.badge.badge_type as BadgeType,
        name: b.config.name,
        description: b.config.description,
        icon: b.config.icon,
        color: b.config.color,
      })),
      verificationStatement: verification.verification_statement || undefined,
    }
  }
  
  /**
   * Check and expire old badges/checks
   */
  async processExpirations(): Promise<void> {
    const now = new Date()
    
    // Expire badges
    const expiredBadges = await this.listVendorBadges({
      status: BadgeStatus.ACTIVE,
      // expires_at less than now - would need custom query
    })
    
    for (const badge of expiredBadges) {
      if (badge.expires_at && new Date(badge.expires_at) < now) {
        await this.updateVendorBadges({
          id: badge.id,
          status: BadgeStatus.EXPIRED,
        })
      }
    }
    
    // Expire checks
    const expiredChecks = await this.listVerificationChecks({
      status: CheckStatus.PASSED,
    })
    
    for (const check of expiredChecks) {
      if (check.expires_at && new Date(check.expires_at) < now) {
        await this.updateVerificationChecks({
          id: check.id,
          status: CheckStatus.EXPIRED,
        })
        // Recalculate trust score
        await this.recalculateTrustScore(check.vendor_verification_id)
      }
    }
  }
}

export default VendorVerificationService
