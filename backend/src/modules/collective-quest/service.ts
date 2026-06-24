import { MedusaService } from "@medusajs/framework/utils"
import {
  CollectiveGoal,
  CollectiveQuest,
  QuestContribution,
  QuestRewardGrant,
} from "./models"
import { GoalScopeType, GoalStatus } from "./models/collective-goal"
import { QuestStatus } from "./models/collective-quest"

type QueryLike = {
  graph: (args: Record<string, unknown>) => Promise<{ data: any[] }>
}

/** Self-relative contribution bands (no cross-member ranking). */
export function contributionBand(total: number): "seedling" | "sprout" | "grove" {
  if (total >= 500) return "grove"
  if (total >= 100) return "sprout"
  return "seedling"
}

/**
 * Cooperative gamification service.
 *
 * Owns only genuinely-new facts (quests, contributions, reward grants); goal
 * "thermometer" progress is snapshotted from the owning module via `query.graph`
 * (`recomputeGoal`), never independently re-summed. Boss HP only drops for
 * **verified** contributions, and leaderboards are opt-in & relative-to-self
 * (ADR-0004).
 */
class CollectiveQuestModuleService extends MedusaService({
  CollectiveGoal,
  CollectiveQuest,
  QuestContribution,
  QuestRewardGrant,
}) {
  /**
   * Refresh a goal's cached `current_value` from its source-of-truth module.
   * TREASURY ← collective_campaign.total_backed_amount; QUORUM ← a governance
   * proposal's votes. CUSTOM/FOOD_FOREST are updated manually. Best-effort: a
   * missing source leaves the snapshot unchanged.
   */
  async recomputeGoal(goalId: string, query: QueryLike) {
    const goal = await this.retrieveCollectiveGoal(goalId)
    if (!goal.scope_id) return goal

    let current: number | undefined

    if (goal.scope_type === GoalScopeType.TREASURY) {
      try {
        const { data } = await query.graph({
          entity: "collective_campaign",
          fields: ["total_backed_amount"],
          filters: { id: goal.scope_id },
        })
        if (data?.[0]) current = Number(data[0].total_backed_amount ?? 0)
      } catch {
        /* source absent — leave snapshot */
      }
    } else if (goal.scope_type === GoalScopeType.QUORUM) {
      try {
        const { data } = await query.graph({
          entity: "proposal",
          fields: ["votes_for"],
          filters: { id: goal.scope_id },
        })
        if (data?.[0]) current = Number(data[0].votes_for ?? 0)
      } catch {
        /* governance module absent — leave snapshot */
      }
    }

    if (current === undefined) return goal

    const status =
      current >= Number(goal.target_value)
        ? GoalStatus.COMPLETE
        : GoalStatus.ACTIVE

    await this.updateCollectiveGoals({ id: goalId, current_value: current, status })
    return this.retrieveCollectiveGoal(goalId)
  }

  /**
   * Record a contribution toward a quest boss. HP only drops when `verified` is
   * true. When HP reaches 0 the quest is auto-completed and the reward pool is
   * distributed via the optional `awardXp` callback (kept out of this module so
   * it stays decoupled from progression).
   */
  async contributeToQuest(
    input: {
      quest_id: string
      customer_id: string
      hp_reduction: number
      verified?: boolean
      source_module?: string
      source_id?: string
      metadata?: Record<string, unknown>
    },
    opts?: { awardXp?: (customerId: string, amount: number) => Promise<void> }
  ) {
    const quest = await this.retrieveCollectiveQuest(input.quest_id)
    if (quest.status !== QuestStatus.ACTIVE) {
      throw new Error(`Quest ${input.quest_id} is not active`)
    }

    const verified = input.verified ?? false
    const reduction = Math.max(0, Math.round(input.hp_reduction))

    await this.createQuestContributions({
      quest_id: input.quest_id,
      customer_id: input.customer_id,
      source_module: input.source_module ?? null,
      source_id: input.source_id ?? null,
      hp_reduction: reduction,
      verified,
      metadata: input.metadata ?? null,
    })

    if (!verified || reduction === 0) {
      return this.retrieveCollectiveQuest(input.quest_id)
    }

    const newHp = Math.max(0, Number(quest.hp_remaining) - reduction)
    await this.updateCollectiveQuests({ id: input.quest_id, hp_remaining: newHp })

    if (newHp === 0) {
      await this.completeQuest(input.quest_id, opts)
    }

    return this.retrieveCollectiveQuest(input.quest_id)
  }

  /**
   * Complete a quest and split `reward_pool_xp` evenly across its **distinct
   * verified contributors**. Writes an auditable `quest_reward_grant` per member
   * and, when an `awardXp` callback is provided, credits the XP. Idempotent: a
   * non-ACTIVE quest is a no-op.
   */
  async completeQuest(
    questId: string,
    opts?: { awardXp?: (customerId: string, amount: number) => Promise<void> }
  ) {
    const quest = await this.retrieveCollectiveQuest(questId)
    if (quest.status !== QuestStatus.ACTIVE) return quest

    const contributions = await this.listQuestContributions({
      quest_id: questId,
      verified: true,
    })
    const contributors = [...new Set(contributions.map((c) => c.customer_id as string))]

    await this.updateCollectiveQuests({ id: questId, status: QuestStatus.COMPLETE })

    const pool = Number(quest.reward_pool_xp ?? 0)
    if (contributors.length === 0 || pool === 0) return this.retrieveCollectiveQuest(questId)

    const share = Math.floor(pool / contributors.length)
    if (share <= 0) return this.retrieveCollectiveQuest(questId)

    for (const customerId of contributors) {
      await this.createQuestRewardGrants({
        quest_id: questId,
        customer_id: customerId,
        xp_amount: share,
      })
      if (opts?.awardXp) {
        try {
          await opts.awardXp(customerId, share)
        } catch {
          /* XP award is best-effort; the grant row is the source of record */
        }
      }
    }

    return this.retrieveCollectiveQuest(questId)
  }

  /**
   * Opt-in, relative-to-self den activity view (NOT a competitive ranking).
   *
   * Returns each opted-in member's own total verified contribution and a
   * self-relative band. Members are included only when they have opted in (a
   * contribution flagged `leaderboard_opt_in`). There is intentionally no rank
   * index and the result is not ordered by performance (ADR-0004).
   */
  async getDenLeaderboard(denId: string, opts?: { optInOnly?: boolean }) {
    const optInOnly = opts?.optInOnly ?? true

    const quests = await this.listCollectiveQuests({ den_id: denId })
    const questIds = quests.map((q) => q.id as string)
    if (questIds.length === 0) return []

    const contributions = await this.listQuestContributions({
      quest_id: questIds,
      verified: true,
    })

    const byMember = new Map<string, { total: number; optedIn: boolean }>()
    for (const c of contributions) {
      const id = c.customer_id as string
      const optedIn = !!(c.metadata as Record<string, unknown> | null)?.leaderboard_opt_in
      const cur = byMember.get(id) ?? { total: 0, optedIn: false }
      cur.total += Number(c.hp_reduction ?? 0)
      cur.optedIn = cur.optedIn || optedIn
      byMember.set(id, cur)
    }

    return [...byMember.entries()]
      .filter(([, v]) => !optInOnly || v.optedIn)
      .map(([customer_id, v]) => ({
        customer_id,
        contribution: v.total,
        band: contributionBand(v.total),
      }))
  }
}

export default CollectiveQuestModuleService
