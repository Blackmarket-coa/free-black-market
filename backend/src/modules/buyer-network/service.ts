import { MedusaService } from "@medusajs/framework/utils"
import { BuyerNetwork, NetworkMember } from "./models"
import { NetworkMemberRole, NetworkMemberStatus } from "./models/network-member"
import { NetworkStatus, NetworkType } from "./models/buyer-network"

class BuyerNetworkModuleService extends MedusaService({
  BuyerNetwork,
  NetworkMember,
}) {
  // ──────────────────────────────────────────────────────────────────────────
  // Network Operations
  // ──────────────────────────────────────────────────────────────────────────

  async createNetwork(input: {
    name: string
    handle: string
    description?: string
    network_type?: string
    industry?: string
    categories?: string[]
    region?: string
    geo_bounds?: Record<string, unknown>
    admin_id: string
    is_public?: boolean
    requires_approval?: boolean
    min_purchase_commitment?: number
    currency_code?: string
    metadata?: Record<string, unknown>
  }) {
    // Validate handle uniqueness
    const existing = await this.listBuyerNetworks({ handle: input.handle })
    if (existing.length > 0) {
      throw new Error(`Network handle "${input.handle}" already taken`)
    }

    const [network] = await this.createBuyerNetworks([
      {
        ...input,
        network_type: (input.network_type || NetworkType.BUYING_CLUB) as NetworkType,
        categories: (input.categories || null) as Record<string, unknown> | null,
        status: NetworkStatus.ACTIVE,
        member_count: 1,
        total_savings: 0,
        completed_group_buys: 0,
        active_demand_posts: 0,
        trust_score: 0,
        verified: false,
      },
    ])

    // Add admin as first member
    await this.createNetworkMembers([
      {
        network_id: network.id,
        customer_id: input.admin_id,
        role: NetworkMemberRole.ADMIN,
        status: NetworkMemberStatus.ACTIVE,
        group_buys_joined: 0,
        total_savings: 0,
        reputation_score: 0,
        referral_count: 0,
        reward_points: 0,
        joined_at: new Date(),
        approved_at: new Date(),
      },
    ])

    return network
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Membership Operations
  // ──────────────────────────────────────────────────────────────────────────

  async joinNetwork(input: {
    network_id: string
    customer_id: string
    display_name?: string
    business_name?: string
    business_type?: string
    referrer_id?: string
  }) {
    const networks = await this.listBuyerNetworks({ id: input.network_id })
    if (networks.length === 0) {
      throw new Error("Network not found")
    }

    const network = networks[0]
    if (network.status !== NetworkStatus.ACTIVE) {
      throw new Error("Network is not active")
    }

    // Check existing membership
    const existing = await this.listNetworkMembers({
      network_id: input.network_id,
      customer_id: input.customer_id,
    })
    if (
      existing.length > 0 &&
      existing[0].status !== NetworkMemberStatus.LEFT
    ) {
      throw new Error("Already a member of this network")
    }

    const needsApproval = network.requires_approval
    const status = needsApproval
      ? NetworkMemberStatus.PENDING
      : NetworkMemberStatus.ACTIVE

    const [member] = await this.createNetworkMembers([
      {
        network_id: input.network_id,
        customer_id: input.customer_id,
        role: NetworkMemberRole.MEMBER,
        status,
        display_name: input.display_name,
        business_name: input.business_name,
        business_type: input.business_type,
        group_buys_joined: 0,
        total_savings: 0,
        reputation_score: 0,
        referral_count: 0,
        reward_points: 0,
        joined_at: new Date(),
        approved_at: needsApproval ? null : new Date(),
      },
    ])

    if (!needsApproval) {
      await this.updateBuyerNetworks({
        id: input.network_id,
        member_count: Number(network.member_count) + 1,
      })
    }

    // Credit referral
    if (input.referrer_id) {
      const referrer = await this.listNetworkMembers({
        network_id: input.network_id,
        customer_id: input.referrer_id,
      })
      if (referrer.length > 0) {
        await this.updateNetworkMembers({
          id: referrer[0].id,
          referral_count: Number(referrer[0].referral_count) + 1,
          reward_points: Number(referrer[0].reward_points) + 10,
        })
      }
    }

    return member
  }

  async approveMember(networkId: string, memberId: string) {
    const members = await this.listNetworkMembers({ id: memberId })
    if (members.length === 0 || members[0].network_id !== networkId) {
      throw new Error("Member not found in this network")
    }

    if (members[0].status !== NetworkMemberStatus.PENDING) {
      throw new Error("Member is not pending approval")
    }

    await this.updateNetworkMembers({
      id: memberId,
      status: NetworkMemberStatus.ACTIVE,
      approved_at: new Date(),
    })

    const networks = await this.listBuyerNetworks({ id: networkId })
    if (networks.length > 0) {
      await this.updateBuyerNetworks({
        id: networkId,
        member_count: Number(networks[0].member_count) + 1,
      })
    }

    const [updated] = await this.listNetworkMembers({ id: memberId })
    return updated
  }

  async leaveNetwork(networkId: string, customerId: string) {
    const members = await this.listNetworkMembers({
      network_id: networkId,
      customer_id: customerId,
    })
    if (members.length === 0) {
      throw new Error("Not a member of this network")
    }

    const member = members[0]
    if (member.role === NetworkMemberRole.ADMIN) {
      throw new Error("Admin cannot leave. Transfer admin role first.")
    }

    await this.updateNetworkMembers({
      id: member.id,
      status: NetworkMemberStatus.LEFT,
    })

    const networks = await this.listBuyerNetworks({ id: networkId })
    if (networks.length > 0) {
      await this.updateBuyerNetworks({
        id: networkId,
        member_count: Math.max(0, Number(networks[0].member_count) - 1),
      })
    }

    return member
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reward & Reputation
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record one member's participation in a completed group buy: bump their
   * participation counters and add their realized savings to both their own
   * running total and the network's.
   *
   * Called once per participant per pool. The network's completed_group_buys
   * counter deliberately does NOT move here — a pool with N participants is
   * one completed group buy, not N, so that counter lives in
   * `recordCompletedGroupBuy`, called once per pool.
   *
   * Not idempotent: the caller owns replay protection (the savings
   * subscriber marks each participant it has recorded).
   */
  async recordGroupBuyParticipation(
    networkId: string,
    customerId: string,
    savingsAmount: number
  ) {
    const members = await this.listNetworkMembers({
      network_id: networkId,
      customer_id: customerId,
    })
    if (members.length === 0) return

    const member = members[0]
    await this.updateNetworkMembers({
      id: member.id,
      group_buys_joined: Number(member.group_buys_joined) + 1,
      total_savings: Number(member.total_savings) + savingsAmount,
      reputation_score: Math.min(
        100,
        Number(member.reputation_score) + 2
      ),
      reward_points: Number(member.reward_points) + 5,
    })

    // Update network stats
    const networks = await this.listBuyerNetworks({ id: networkId })
    if (networks.length > 0) {
      const network = networks[0]
      await this.updateBuyerNetworks({
        id: networkId,
        total_savings: Number(network.total_savings) + savingsAmount,
      })
    }
  }

  /** Count one completed group buy on the network — once per pool, never per participant. */
  async recordCompletedGroupBuy(networkId: string) {
    const networks = await this.listBuyerNetworks({ id: networkId })
    if (networks.length === 0) return

    await this.updateBuyerNetworks({
      id: networkId,
      completed_group_buys: Number(networks[0].completed_group_buys) + 1,
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Query Helpers
  // ──────────────────────────────────────────────────────────────────────────

  async getNetworkDetails(networkId: string) {
    const networks = await this.listBuyerNetworks({ id: networkId })
    if (networks.length === 0) {
      throw new Error("Network not found")
    }

    const members = await this.listNetworkMembers({
      network_id: networkId,
      status: NetworkMemberStatus.ACTIVE,
    })

    const topMembers = [...members]
      .sort(
        (a, b) =>
          Number(b.reputation_score) - Number(a.reputation_score)
      )
      .slice(0, 10)

    return {
      ...networks[0],
      members: {
        total: members.length,
        top: topMembers,
      },
    }
  }

  async discoverNetworks(filters?: {
    industry?: string
    region?: string
    network_type?: string
    is_public?: boolean
    limit?: number
    offset?: number
  }) {
    const queryFilters: Record<string, unknown> = {
      status: NetworkStatus.ACTIVE,
    }
    if (filters?.industry) queryFilters.industry = filters.industry
    if (filters?.region) queryFilters.region = filters.region
    if (filters?.network_type)
      queryFilters.network_type = filters.network_type
    if (filters?.is_public !== undefined)
      queryFilters.is_public = filters.is_public

    return this.listBuyerNetworks(queryFilters, {
      skip: filters?.offset || 0,
      take: filters?.limit || 20,
      order: { member_count: "DESC" },
    })
  }

  async getMyNetworks(customerId: string) {
    const memberships = await this.listNetworkMembers({
      customer_id: customerId,
      status: NetworkMemberStatus.ACTIVE,
    })

    if (memberships.length === 0) return []

    const networkIds = memberships.map((m) => m.network_id)
    const networks = await this.listBuyerNetworks({ id: networkIds })

    return networks.map((n) => ({
      ...n,
      my_role: memberships.find((m) => m.network_id === n.id)?.role,
      my_reward_points: memberships.find((m) => m.network_id === n.id)
        ?.reward_points,
    }))
  }

  async getNetworkLeaderboard(networkId: string, limit = 20) {
    const members = await this.listNetworkMembers(
      {
        network_id: networkId,
        status: NetworkMemberStatus.ACTIVE,
      },
      {
        take: limit,
        order: { reputation_score: "DESC" },
      }
    )

    return members.map((m, i) => ({
      rank: i + 1,
      customer_id: m.customer_id,
      display_name: m.display_name,
      business_name: m.business_name,
      reputation_score: Number(m.reputation_score),
      group_buys_joined: Number(m.group_buys_joined),
      total_savings: Number(m.total_savings),
      reward_points: Number(m.reward_points),
    }))
  }
}

export default BuyerNetworkModuleService
