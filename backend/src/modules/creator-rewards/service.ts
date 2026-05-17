import { MedusaService } from "@medusajs/framework/utils"
import ContentPost, {
  ContentPostVerificationStatus,
} from "./models/content-post"
import EngagementSnapshot from "./models/engagement-snapshot"
import RewardPool, {
  RewardPoolKind,
  RewardPoolStatus,
} from "./models/reward-pool"
import RewardPayout, { RewardPayoutStatus } from "./models/reward-payout"

const MIN_QV_THRESHOLD = (() => {
  const v = parseInt(process.env.CREATOR_REWARD_MIN_QV_THRESHOLD || "1000", 10)
  return Number.isFinite(v) && v >= 0 ? v : 1000
})()

const MAX_DAILY_QV_GROWTH = (() => {
  const v = parseInt(process.env.CREATOR_REWARD_MAX_DAILY_QV_GROWTH || "100000", 10)
  return Number.isFinite(v) && v >= 0 ? v : 100000
})()

export interface RegisterPostInput {
  creatorSellerId: string
  platform: string
  externalPostId: string
  externalUrl: string
  caption?: string | null
  thumbnailUrl?: string | null
  affiliateLinkId?: string | null
  dealId?: string | null
  programId?: string | null
}

export interface IngestSnapshotInput {
  views?: number
  qualifiedViews?: number
  likes?: number
  shares?: number
  comments?: number
  saves?: number
  watchTimeSeconds?: number
  raw?: Record<string, unknown>
  capturedAt?: Date
}

export interface OpenPoolInput {
  programId?: string | null
  funderSellerId?: string | null
  kind?: RewardPoolKind
  periodStart: Date
  periodEnd: Date
  totalCents: number
  ratePerKqvCents?: number | null
  currencyCode?: string
  metadata?: Record<string, unknown> | null
}

export interface PoolDistributionResult {
  pool_id: string
  total_qv: number
  total_distributed_cents: number
  per_creator: Array<{
    creator_seller_id: string
    qualified_views: number
    amount_cents: number
  }>
  ineligible_below_threshold: number
}

class CreatorRewardsService extends MedusaService({
  ContentPost,
  EngagementSnapshot,
  RewardPool,
  RewardPayout,
}) {
  async registerPost(input: RegisterPostInput): Promise<any> {
    const existing = await this.listContentPosts({
      platform: input.platform,
      external_post_id: input.externalPostId,
    })
    if (existing.length > 0) return existing[0]

    return (this as any).createContentPosts({
      creator_seller_id: input.creatorSellerId,
      platform: input.platform,
      external_post_id: input.externalPostId,
      external_url: input.externalUrl,
      caption: input.caption ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      affiliate_link_id: input.affiliateLinkId ?? null,
      deal_id: input.dealId ?? null,
      program_id: input.programId ?? null,
    })
  }

  async verifyPost(
    postId: string,
    via: "oauth" | "webhook" | "manual_admin"
  ): Promise<any> {
    return (this as any).updateContentPosts({
      id: postId,
      verification_status: ContentPostVerificationStatus.VERIFIED,
      verified_at: new Date(),
      verified_via: via,
      qualified: true,
    })
  }

  async rejectPost(postId: string, reason: string): Promise<any> {
    return (this as any).updateContentPosts({
      id: postId,
      verification_status: ContentPostVerificationStatus.REJECTED,
      qualified: false,
      disqualified_reason: reason,
    })
  }

  async disqualifyPost(postId: string, reason: string): Promise<any> {
    return (this as any).updateContentPosts({
      id: postId,
      qualified: false,
      disqualified_reason: reason,
    })
  }

  async ingestSnapshot(
    contentPostId: string,
    input: IngestSnapshotInput
  ): Promise<any> {
    const views = Math.max(0, Math.floor(input.views ?? 0))
    const qualifiedViews = Math.max(
      0,
      Math.floor(input.qualifiedViews ?? input.views ?? 0)
    )
    return (this as any).createEngagementSnapshots({
      content_post_id: contentPostId,
      captured_at: input.capturedAt ?? new Date(),
      views,
      qualified_views: qualifiedViews,
      likes: Math.max(0, Math.floor(input.likes ?? 0)),
      shares: Math.max(0, Math.floor(input.shares ?? 0)),
      comments: Math.max(0, Math.floor(input.comments ?? 0)),
      saves: Math.max(0, Math.floor(input.saves ?? 0)),
      watch_time_seconds: Math.max(0, Math.floor(input.watchTimeSeconds ?? 0)),
      raw: input.raw ?? null,
    })
  }

  async openPool(input: OpenPoolInput): Promise<any> {
    if (input.totalCents <= 0) throw new Error("totalCents must be > 0")
    if (input.periodEnd <= input.periodStart)
      throw new Error("periodEnd must be after periodStart")
    return (this as any).createRewardPools({
      program_id: input.programId ?? null,
      funder_seller_id: input.funderSellerId ?? null,
      kind: input.kind ?? RewardPoolKind.ENGAGEMENT,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      total_cents: input.totalCents,
      rate_per_kqv_cents: input.ratePerKqvCents ?? null,
      currency_code: input.currencyCode ?? "usd",
      status:
        input.periodStart <= new Date()
          ? RewardPoolStatus.ACCRUING
          : RewardPoolStatus.SCHEDULED,
      metadata: input.metadata ?? null,
    })
  }

  /**
   * Compute how the pool would be split across qualifying creators based
   * on cumulative qualified-view counts in the period. Pure read-only
   * preview — no ledger writes, no payout rows.
   */
  async calculatePoolDistribution(poolId: string): Promise<PoolDistributionResult> {
    const pools = await this.listRewardPools({ id: poolId })
    const pool = pools[0]
    if (!pool) throw new Error("Pool not found")

    // Find content posts that count for this pool: program-scoped if the
    // pool is program-scoped, otherwise platform-wide.
    const postFilter: Record<string, unknown> = {
      verification_status: ContentPostVerificationStatus.VERIFIED,
      qualified: true,
    }
    if (pool.program_id) postFilter.program_id = pool.program_id
    const posts = await this.listContentPosts(postFilter)

    if (posts.length === 0) {
      return {
        pool_id: poolId,
        total_qv: 0,
        total_distributed_cents: 0,
        per_creator: [],
        ineligible_below_threshold: 0,
      }
    }

    // Collect engagement snapshots within the period and pick the latest
    // per post (snapshots are cumulative — TikTok-style monotonic counters).
    const periodStart = new Date(pool.period_start as any)
    const periodEnd = new Date(pool.period_end as any)
    const postIds = posts.map((p: any) => p.id)
    const allSnapshots = await this.listEngagementSnapshots({
      content_post_id: postIds,
    })
    const inPeriod = allSnapshots.filter((s: any) => {
      const t = new Date(s.captured_at as any)
      return t >= periodStart && t <= periodEnd
    })

    const latestPerPost = new Map<string, any>()
    for (const s of inPeriod) {
      const prev = latestPerPost.get(s.content_post_id)
      if (
        !prev ||
        new Date(s.captured_at as any) > new Date(prev.captured_at as any)
      ) {
        latestPerPost.set(s.content_post_id, s)
      }
    }

    // Aggregate qualified views per creator.
    const qvByCreator = new Map<string, number>()
    for (const post of posts as any[]) {
      const snap = latestPerPost.get(post.id)
      if (!snap) continue
      const qv = Math.max(0, Number(snap.qualified_views) || 0)
      qvByCreator.set(
        post.creator_seller_id,
        (qvByCreator.get(post.creator_seller_id) ?? 0) + qv
      )
    }

    // Apply threshold + daily-growth cap.
    const eligibleEntries: Array<[string, number]> = []
    let ineligibleBelowThreshold = 0
    for (const [creatorId, qv] of qvByCreator.entries()) {
      const cap = MAX_DAILY_QV_GROWTH * Math.max(1, daysBetween(periodStart, periodEnd))
      const capped = Math.min(qv, cap)
      if (capped < MIN_QV_THRESHOLD) {
        ineligibleBelowThreshold++
        continue
      }
      eligibleEntries.push([creatorId, capped])
    }

    const totalQv = eligibleEntries.reduce((s, [, v]) => s + v, 0)
    if (totalQv === 0) {
      return {
        pool_id: poolId,
        total_qv: 0,
        total_distributed_cents: 0,
        per_creator: [],
        ineligible_below_threshold: ineligibleBelowThreshold,
      }
    }

    const totalCents = Number(pool.total_cents)
    const allocated = eligibleEntries
      .map(([creatorId, qv]): {
        creator_seller_id: string
        qualified_views: number
        amount_cents: number
      } => ({
        creator_seller_id: creatorId,
        qualified_views: qv,
        amount_cents: Math.floor((qv / totalQv) * totalCents),
      }))
      .sort((a, b) => b.amount_cents - a.amount_cents)

    const distributed = allocated.reduce((s, a) => s + a.amount_cents, 0)

    return {
      pool_id: poolId,
      total_qv: totalQv,
      total_distributed_cents: distributed,
      per_creator: allocated,
      ineligible_below_threshold: ineligibleBelowThreshold,
    }
  }

  /**
   * Persist the distribution as `RewardPayout` rows in `pending` status.
   * Caller is responsible for then crediting each row via
   * `hawala-ledger.creditCreatorReward` and updating to `paid`.
   */
  async persistDistribution(
    poolId: string,
    result: PoolDistributionResult
  ): Promise<any[]> {
    const created: any[] = []
    for (const entry of result.per_creator) {
      const payout = await (this as any).createRewardPayouts({
        pool_id: poolId,
        creator_seller_id: entry.creator_seller_id,
        qualified_views: entry.qualified_views,
        amount_cents: entry.amount_cents,
        status: RewardPayoutStatus.PENDING,
      })
      created.push(payout)
    }
    await (this as any).updateRewardPools({
      id: poolId,
      status: RewardPoolStatus.CALCULATING,
    })
    return created
  }

  async markPoolDistributed(poolId: string): Promise<any> {
    return (this as any).updateRewardPools({
      id: poolId,
      status: RewardPoolStatus.DISTRIBUTED,
      distributed_at: new Date(),
    })
  }

  async markPayoutPaid(payoutId: string, ledgerEntryId: string): Promise<any> {
    return (this as any).updateRewardPayouts({
      id: payoutId,
      status: RewardPayoutStatus.PAID,
      ledger_entry_id: ledgerEntryId,
    })
  }

  async listPoolsDueForDistribution(now: Date = new Date()): Promise<any[]> {
    const pools = await this.listRewardPools({
      status: [RewardPoolStatus.SCHEDULED, RewardPoolStatus.ACCRUING] as any,
    })
    return pools.filter((p: any) => new Date(p.period_end as any) <= now)
  }
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(1, Math.ceil((b.getTime() - a.getTime()) / 86_400_000))
}

export default CreatorRewardsService
