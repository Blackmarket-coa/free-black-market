import { MedusaService } from "@medusajs/framework/utils"

/**
 * Kitchen Ledger Service
 *
 * Manages commercial community kitchen financial accounts using the hawala ledger system.
 * Each kitchen has multiple fund accounts for different purposes.
 */

export interface KitchenAccountConfig {
  kitchen_id: string
  account_type: KitchenAccountType
  name: string
  initial_balance?: number
}

export type KitchenAccountType =
  | "kitchen_operating"      // Day-to-day expenses
  | "kitchen_equipment_fund" // Equipment purchase and repair
  | "kitchen_maintenance"    // Maintenance and cleaning
  | "kitchen_deposit_pool"   // Member deposits held
  | "kitchen_investment_pool" // Member investments

export interface RentalRevenue {
  member_id: string
  hours: number
  rate: number
  space_id?: string
  description?: string
}

export interface KitchenLedgerEntryInput {
  kitchen_id: string
  from_account_type?: KitchenAccountType
  to_account_type?: KitchenAccountType
  amount: number
  entry_type: KitchenLedgerEntryType
  reference_type?: string
  reference_id?: string
  description: string
  metadata?: Record<string, unknown>
}

export type KitchenLedgerEntryType =
  | "member_investment"
  | "membership_fee"
  | "rental_revenue"
  | "equipment_purchase"
  | "equipment_repair"
  | "maintenance_expense"
  | "utility_expense"
  | "supply_expense"
  | "deposit_received"
  | "deposit_returned"
  | "grant_received"
  | "donation_received"
  | "insurance_payment"
  | "license_fee"
  | "transfer"

/**
 * Kitchen Ledger Service
 *
 * Integrates with the hawala ledger to manage kitchen finances.
 * Provides high-level methods for common kitchen financial operations.
 */
export class KitchenLedgerService extends MedusaService({}) {

  /**
   * Generate a standard account ID for a kitchen fund
   */
  static generateAccountId(kitchen_id: string, account_type: KitchenAccountType): string {
    return `kitchen_${kitchen_id}_${account_type}`
  }

  /**
   * Get all account IDs for a kitchen
   */
  static getKitchenAccountIds(kitchen_id: string): Record<KitchenAccountType, string> {
    const types: KitchenAccountType[] = [
      "kitchen_operating",
      "kitchen_equipment_fund",
      "kitchen_maintenance",
      "kitchen_deposit_pool",
      "kitchen_investment_pool"
    ]

    return types.reduce((acc, type) => {
      acc[type] = this.generateAccountId(kitchen_id, type)
      return acc
    }, {} as Record<KitchenAccountType, string>)
  }

  /**
   * Calculate rental revenue
   */
  static calculateRentalRevenue(hours: number, hourlyRate: number): number {
    return hours * hourlyRate
  }

  /**
   * Calculate member voting power based on governance model
   */
  static calculateVotingPower(params: {
    governance_model: "equal_vote" | "usage_weighted" | "investment_weighted" | "hybrid"
    base_votes: number
    usage_hours?: number
    investment_amount?: number
    role_bonus?: number
    weights?: {
      usage_weight?: number
      investment_weight?: number
      base_weight?: number
    }
  }): number {
    const { governance_model, base_votes, usage_hours = 0, investment_amount = 0, role_bonus = 0 } = params
    const weights = params.weights || {}

    switch (governance_model) {
      case "equal_vote":
        return base_votes + role_bonus

      case "usage_weighted": {
        // 1 vote per 20 hours of kitchen usage
        const usageBonus = Math.floor(usage_hours / 20)
        return base_votes + usageBonus + role_bonus
      }

      case "investment_weighted": {
        // 1 vote per $100 invested
        const investmentBonus = Math.floor(investment_amount / 100)
        return base_votes + investmentBonus + role_bonus
      }

      case "hybrid": {
        const baseWeight = weights.base_weight || 0.4
        const usageWeight = weights.usage_weight || 0.3
        const investWeight = weights.investment_weight || 0.3

        const usagePower = Math.floor(usage_hours / 20) * usageWeight
        const investPower = Math.floor(investment_amount / 100) * investWeight
        const basePower = base_votes * baseWeight

        return Math.round(basePower + usagePower + investPower + role_bonus)
      }

      default:
        return base_votes
    }
  }

  /**
   * Calculate monthly membership fee based on usage tier
   */
  static calculateMembershipTier(monthlyHours: number): {
    tier: string
    discount: number
    suggestedRate: number
  } {
    if (monthlyHours >= 80) {
      return { tier: "enterprise", discount: 0.30, suggestedRate: 15 }
    } else if (monthlyHours >= 40) {
      return { tier: "professional", discount: 0.20, suggestedRate: 18 }
    } else if (monthlyHours >= 20) {
      return { tier: "standard", discount: 0.10, suggestedRate: 22 }
    } else {
      return { tier: "hourly", discount: 0, suggestedRate: 25 }
    }
  }

  /**
   * Calculate revenue split for co-op model
   */
  static calculateCoopRevenueSplit(totalRevenue: number): {
    operating: number
    equipment: number
    maintenance: number
    memberDividend: number
    reserve: number
  } {
    return {
      operating: totalRevenue * 0.40,
      equipment: totalRevenue * 0.15,
      maintenance: totalRevenue * 0.15,
      memberDividend: totalRevenue * 0.20,
      reserve: totalRevenue * 0.10
    }
  }
}

export default KitchenLedgerService
