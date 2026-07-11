import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireSellerId } from "../../../../shared/auth-helpers"
import { HAWALA_LEDGER_MODULE } from "../../../../modules/hawala-ledger"
import type HawalaLedgerModuleService from "../../../../modules/hawala-ledger/service"
import {
  listCreatorMembers,
  listCreatorCreditTransactions,
  getCreatorMrrChangeThisWeekCents,
} from "../../../../lib/creator-hub"
import { getSellerQuestHighlights } from "../../../../shared/seller-quests"

/**
 * GET /vendor/creator/hub-data
 * The dashboard "today's pulse" for the authenticated creator. Aggregates real
 * data the FBM side owns (credits earned today, new members today, member
 * health, sync/payment urgencies). Surfaces that Blackout owns (unread DMs,
 * live boost momentum, chat activity) are reported as empty/zero here rather
 * than fabricated — the Blackout CreatorHubPanel fills those in.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sellerId = await requireSellerId(req, res)
  if (!sellerId) return

  const hawala = req.scope.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const [members, txns, questHighlights, mrrChangeCents] = await Promise.all([
    listCreatorMembers(req.scope, sellerId),
    listCreatorCreditTransactions(hawala, sellerId, 200),
    getSellerQuestHighlights(req.scope, sellerId),
    getCreatorMrrChangeThisWeekCents(req.scope, sellerId),
  ])

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const isToday = (iso: string) => new Date(iso) >= startOfToday

  const credits_earned_today = txns
    .filter((t) => t.amount_credits > 0 && isToday(t.created_at))
    .reduce((s, t) => s + t.amount_credits, 0)

  const new_members_today = members.filter((m) => isToday(m.started_at)).length

  const total = members.length || 1
  const activeCount = members.filter((m) => m.status === "active").length
  const noMxidCount = members.filter((m) => m.sync_status === "no_mxid").length
  const pastDueCount = members.filter((m) => m.status === "past_due").length

  const urgent_actions: Array<{ type: string; message: string; count?: number; link: string }> = []
  if (noMxidCount > 0) {
    urgent_actions.push({
      type: "membership",
      message: `${noMxidCount} member${noMxidCount === 1 ? "" : "s"} haven't linked a Blackout account`,
      count: noMxidCount,
      link: "/memberships",
    })
  }
  if (pastDueCount > 0) {
    urgent_actions.push({
      type: "payout",
      message: `${pastDueCount} membership${pastDueCount === 1 ? "" : "s"} past due`,
      count: pastDueCount,
      link: "/memberships",
    })
  }

  return res.json({
    credits_earned_today,
    new_members_today,
    unread_dms: 0,
    mrr_change_this_week_cents: mrrChangeCents,
    active_boost: null,
    refrain_queue: { pending_review: 0, awaiting_delivery: 0, in_revision: 0 },
    space_health: {
      weekly_active_members_pct: Math.round((activeCount / total) * 100),
      governance_participation_pct: 0,
      messages_per_room_avg: 0,
      retention_30d_pct: Math.round((activeCount / total) * 100),
    },
    urgent_actions,
    recent_activity: [],
    quest_highlights: questHighlights,
  })
}
