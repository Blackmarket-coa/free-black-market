import { MedusaService } from "@medusajs/framework/utils"

/**
 * Garden Ledger Service
 * 
 * Manages garden financial accounts using the hawala ledger system.
 * Each garden has multiple fund accounts for different purposes.
 */

export interface GardenAccountConfig {
  garden_id: string
  account_type: GardenAccountType
  name: string
  initial_balance?: number
}

export type GardenAccountType = 
  | "garden_operating"      // Day-to-day expenses
  | "garden_tool_fund"      // Tools and equipment
  | "garden_seed_fund"      // Seeds and plants
  | "garden_harvest_pool"   // Revenue from harvest sales
  | "garden_volunteer_pool" // Time credits for volunteers
  | "garden_investment_pool" // Member investments

export interface TimeCredit {
  member_id: string
  hours: number
  rate: number  // Default $15/hour
  activity_type: string
  description?: string
}

export interface HarvestValue {
  harvest_id: string
  total_value: number
  allocations: {
    pool_type: string
    percentage: number
    amount: number
  }[]
}

export interface GardenLedgerEntryInput {
  garden_id: string
  from_account_type?: GardenAccountType
  to_account_type?: GardenAccountType
  amount: number
  entry_type: GardenLedgerEntryType
  reference_type?: string
  reference_id?: string
  description: string
  metadata?: Record<string, unknown>
}

export type GardenLedgerEntryType =
  | "member_investment"
  | "member_dues"
  | "harvest_revenue"
  | "tool_purchase"
  | "seed_purchase"
  | "supply_expense"
  | "volunteer_credit"
  | "volunteer_redemption"
  | "plot_rental"
  | "grant_received"
  | "donation_received"
  | "expense_reimbursement"
  | "transfer"

/**
 * Garden Ledger Service
 * 
 * Integrates with the hawala ledger to manage garden finances.
 * Provides high-level methods for common garden financial operations.
 */
export class GardenLedgerService extends MedusaService({}) {
  
  /**
   * Generate a standard account ID for a garden fund
   */
  static generateAccountId(garden_id: string, account_type: GardenAccountType): string {
    return `garden_${garden_id}_${account_type}`
  }

  /**
   * Get all account IDs for a garden
   */
  static getGardenAccountIds(garden_id: string): Record<GardenAccountType, string> {
    const types: GardenAccountType[] = [
      "garden_operating",
      "garden_tool_fund",
      "garden_seed_fund",
      "garden_harvest_pool",
      "garden_volunteer_pool",
      "garden_investment_pool"
    ]
    
    return types.reduce((acc, type) => {
      acc[type] = this.generateAccountId(garden_id, type)
      return acc
    }, {} as Record<GardenAccountType, string>)
  }

  /**
   * Calculate time credit value
   */
  static calculateTimeCreditValue(hours: number, hourlyRate: number = 15): number {
    return hours * hourlyRate
  }

  /**
   * Calculate member voting power based on governance model
   */
  static calculateVotingPower(params: {
    governance_model: "equal_vote" | "labor_weighted" | "investment_weighted" | "hybrid"
    base_votes: number
    labor_hours?: number
    investment_amount?: number
    role_bonus?: number
    weights?: {
      labor_weight?: number
      investment_weight?: number
      base_weight?: number
    }
  }): number {
    const { governance_model, base_votes, labor_hours = 0, investment_amount = 0, role_bonus = 0 } = params
    const weights = params.weights || {}
    
    switch (governance_model) {
      case "equal_vote":
        return base_votes + role_bonus
        
      case "labor_weighted": {
        // 1 vote per 10 hours of labor
        const laborBonus = Math.floor(labor_hours / 10)
        return base_votes + laborBonus + role_bonus
      }
        
      case "investment_weighted": {
        // 1 vote per $100 invested
        const investmentBonus = Math.floor(investment_amount / 100)
        return base_votes + investmentBonus + role_bonus
      }
        
      case "hybrid": {
        const baseWeight = weights.base_weight || 0.4
        const laborWeight = weights.labor_weight || 0.3
        const investWeight = weights.investment_weight || 0.3
        
        const laborPower = Math.floor(labor_hours / 10) * laborWeight
        const investPower = Math.floor(investment_amount / 100) * investWeight
        const basePower = base_votes * baseWeight
        
        return Math.round(basePower + laborPower + investPower + role_bonus)
      }
        
      default:
        return base_votes
    }
  }

  /**
   * Generate allocation percentages based on rules
   */
  static generateDefaultAllocations(): {
    pool_type: string
    percentage: number
  }[] {
    return [
      { pool_type: "investor", percentage: 20 },
      { pool_type: "volunteer", percentage: 20 },
      { pool_type: "plot_holder", percentage: 30 },
      { pool_type: "communal", percentage: 15 },
      { pool_type: "open_market", percentage: 10 },
      { pool_type: "donation", percentage: 5 }
    ]
  }

  /**
   * Calculate harvest value distribution
   */
  static calculateHarvestDistribution(
    totalValue: number,
    allocations: { pool_type: string; percentage: number }[]
  ): { pool_type: string; percentage: number; amount: number }[] {
    return allocations.map(alloc => ({
      pool_type: alloc.pool_type,
      percentage: alloc.percentage,
      amount: Math.round((totalValue * alloc.percentage / 100) * 100) / 100
    }))
  }

  /**
   * Calculate member harvest share based on their contributions
   */
  static calculateMemberHarvestShare(params: {
    pool_type: string
    pool_amount: number
    total_labor_hours: number
    member_labor_hours: number
    total_investment: number
    member_investment: number
    total_plot_area: number
    member_plot_area: number
    total_members: number
  }): number {
    const {
      pool_type,
      pool_amount,
      total_labor_hours,
      member_labor_hours,
      total_investment,
      member_investment,
      total_plot_area,
      member_plot_area,
      total_members
    } = params

    switch (pool_type) {
      case "volunteer":
        if (total_labor_hours === 0) return 0
        return (member_labor_hours / total_labor_hours) * pool_amount

      case "investor":
        if (total_investment === 0) return 0
        return (member_investment / total_investment) * pool_amount

      case "plot_holder":
        if (total_plot_area === 0) return 0
        return (member_plot_area / total_plot_area) * pool_amount

      case "communal":
        if (total_members === 0) return 0
        return pool_amount / total_members

      default:
        return 0
    }
  }
}

export default GardenLedgerService
