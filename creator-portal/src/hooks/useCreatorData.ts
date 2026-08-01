import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import {
  MOCK_ANALYTICS,
  MOCK_BOOSTS,
  MOCK_COMMUNITY,
  MOCK_CREDIT_BALANCE,
  MOCK_CREDIT_TXNS,
  MOCK_DASHBOARD,
  MOCK_DM,
  MOCK_EMBED,
  MOCK_MEMBER_THREADS,
  MOCK_MEMBERS,
  MOCK_MEMBERSHIP_TIERS,
  MOCK_PAYOUTS,
  MOCK_PROPOSALS,
  MOCK_QUESTS,
  MOCK_SPLITS,
  MOCK_XP_BALANCES,
} from "@/lib/mock/data"
import type {
  AnalyticsData,
  BlackoutMessage,
  Boost,
  CreditBalance,
  CreditTransaction,
  DashboardSummary,
  EmbedConfig,
  GovernanceProposal,
  Member,
  MemberThread,
  MembershipTier,
  OverlayUrlResponse,
  PayoutsData,
  QuestHighlight,
  SplitContract,
  XpBalance,
} from "@/types"

// Surfaces with a real backend route (memberships, members, credits, hub-data)
// are "live-first": they call the FBM API and only fall back to the typed mock
// layer when USE_MOCK_DATA is on AND the request fails (e.g. no dev session).
// Surfaces whose backend module doesn't exist yet (boosts, splits, xp, analytics,
// embed, Blackout feeds, governance) still resolve the mock layer directly.
//
// The two mutations at the bottom call the REAL backend bridge endpoints that
// already exist (stream overlay URL, Blackout membership force-resync).

async function liveFirst<T>(fetcher: () => Promise<T>, mock: T): Promise<T> {
  try {
    return await fetcher()
  } catch (err) {
    if (USE_MOCK_DATA) return mockResolve(mock)
    throw err
  }
}

export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: ["creator", "dashboard"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/hub-data")
        return data as DashboardSummary
      }, MOCK_DASHBOARD),
    staleTime: 30_000,
  })
}

export function usePayouts() {
  return useQuery<PayoutsData>({
    queryKey: ["creator", "payouts"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PAYOUTS)
      const { data } = await api.get("/vendor/hawala/payouts")
      return data
    },
  })
}

export function useMembershipTiers() {
  return useQuery<MembershipTier[]>({
    queryKey: ["creator", "membership-tiers"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/memberships")
        return data.membership_tiers as MembershipTier[]
      }, MOCK_MEMBERSHIP_TIERS),
  })
}

export function useMembers() {
  return useQuery<Member[]>({
    queryKey: ["creator", "members"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/members")
        return data.members as Member[]
      }, MOCK_MEMBERS),
  })
}

export function useCreditBalance() {
  return useQuery<CreditBalance>({
    queryKey: ["creator", "credit-balance"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/credits/balance")
        return data as CreditBalance
      }, MOCK_CREDIT_BALANCE),
  })
}

export function useCreditTransactions() {
  return useQuery<CreditTransaction[]>({
    queryKey: ["creator", "credit-transactions"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/credits/transactions")
        return data.transactions as CreditTransaction[]
      }, MOCK_CREDIT_TXNS),
  })
}

export function useXpBalances() {
  return useQuery<XpBalance[]>({
    queryKey: ["creator", "xp-balances"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/xp-balances")
        return data.balances as XpBalance[]
      }, MOCK_XP_BALANCES),
  })
}

export function useQuests() {
  return useQuery<QuestHighlight[]>({
    queryKey: ["creator", "quests"],
    queryFn: () =>
      liveFirst(async () => {
        const { data } = await api.get("/vendor/creator/quests")
        return data.quests as QuestHighlight[]
      }, MOCK_QUESTS),
  })
}

export function useBoosts() {
  return useQuery<Boost[]>({
    queryKey: ["creator", "boosts"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_BOOSTS)
      const { data } = await api.get("/vendor/creator/boosts")
      return data.boosts
    },
    refetchInterval: 30_000,
  })
}

export function useSplits() {
  return useQuery<SplitContract[]>({
    queryKey: ["creator", "splits"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_SPLITS)
      const { data } = await api.get("/vendor/creator/splits")
      return data.contracts
    },
  })
}

export function useMemberThreads() {
  return useQuery<MemberThread[]>({
    queryKey: ["creator", "member-threads"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_MEMBER_THREADS)
      const { data } = await api.get("/api/blackout/member-dms")
      return data.threads
    },
    refetchInterval: 30_000,
  })
}

export function useMemberDM(roomId?: string) {
  return useQuery<BlackoutMessage[]>({
    queryKey: ["creator", "dm", roomId],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_DM)
      const { data } = await api.get(`/api/blackout/member-dms/${roomId}/messages`)
      return data.messages
    },
    enabled: Boolean(roomId) || USE_MOCK_DATA,
  })
}

export function useCommunityFeed() {
  return useQuery<BlackoutMessage[]>({
    queryKey: ["creator", "community"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_COMMUNITY)
      const { data } = await api.get("/api/blackout/community/messages")
      return data.messages
    },
    refetchInterval: 30_000,
  })
}

export function useProposals() {
  return useQuery<GovernanceProposal[]>({
    queryKey: ["creator", "proposals"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PROPOSALS)
      const { data } = await api.get("/vendor/creator/governance/proposals")
      return data.proposals
    },
  })
}

export function useAnalytics() {
  return useQuery<AnalyticsData>({
    queryKey: ["creator", "analytics"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_ANALYTICS)
      const { data } = await api.get("/vendor/creator/analytics")
      return data
    },
  })
}

export function useEmbedConfig() {
  return useQuery<EmbedConfig>({
    queryKey: ["creator", "embed"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_EMBED)
      const { data } = await api.get("/vendor/creator/embed")
      return data
    },
  })
}

// ─── Live bridge mutations (hit the real FBM backend) ───────────────────────

export interface ForceResyncResult {
  queued: number
  total_active: number
  skipped_no_blackout_account: number
  estimated_seconds: number
}

/**
 * "Force sync all members" → POST /vendor/subscriptions/blackout-resync.
 * Re-emits subscription.activated for every active membership so Blackout
 * reconciles Space room ACLs. Falls back to a simulated result under mock so
 * the UI is exercisable without a live backend session.
 */
export function useForceResync() {
  return useMutation<ForceResyncResult, Error>({
    mutationFn: async () => {
      try {
        const { data } = await api.post("/vendor/subscriptions/blackout-resync")
        return data
      } catch (err) {
        if (USE_MOCK_DATA) {
          const active = MOCK_MEMBERS.filter((m) => m.status === "active")
          const synced = active.filter((m) => m.matrix_id)
          return mockResolve({
            queued: synced.length,
            total_active: active.length,
            skipped_no_blackout_account: active.length - synced.length,
            estimated_seconds: 30,
          })
        }
        throw err
      }
    },
  })
}

/**
 * Generate a signed OBS stream-overlay URL → POST
 * /vendor/creator/stream/overlay-url. Falls back to a simulated URL under mock.
 */
export function useOverlayUrl() {
  return useMutation<OverlayUrlResponse, Error>({
    mutationFn: async () => {
      try {
        const { data } = await api.post("/vendor/creator/stream/overlay-url")
        return data
      } catch (err) {
        if (USE_MOCK_DATA) {
          const base = import.meta.env.VITE_BLACKOUT_URL || "https://theblackout.app"
          const exp = new Date(Date.now() + 24 * 60 * 60 * 1000)
          return mockResolve({
            overlay_url: `${base}/overlay/demo.${Math.random().toString(36).slice(2, 10)}`,
            expires_at: exp.toISOString(),
            instructions:
              "Paste this URL into OBS as a Browser Source at 1920×1080. Expires in 24 hours — regenerate before long streams.",
          })
        }
        throw err
      }
    },
  })
}

// ─── Credit money-movement mutations (dark unless FBM_CREATOR_CREDITS_LIVE) ──

export interface ConvertXpResult {
  converted_xp: number
  credits: number
  balance: number
}

/**
 * Convert spendable XP → Coalition Credits in whole 1,000 XP → 50₡ blocks →
 * POST /vendor/creator/credits/convert-xp. Invalidates the credit + XP reads so
 * the page reflects the new balances. Falls back to a simulated quote under mock.
 */
export function useConvertXp() {
  const qc = useQueryClient()
  return useMutation<ConvertXpResult, Error, { xp?: number }>({
    mutationFn: async (vars) => {
      try {
        const { data } = await api.post("/vendor/creator/credits/convert-xp", vars ?? {})
        return data
      } catch (err) {
        if (USE_MOCK_DATA) {
          const blocks = Math.floor((vars?.xp ?? 1000) / 1000)
          return mockResolve({
            converted_xp: blocks * 1000,
            credits: blocks * 50,
            balance: (MOCK_CREDIT_BALANCE.available_credits ?? 0) + blocks * 50,
          })
        }
        throw err
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["creator", "credit-balance"] })
      qc.invalidateQueries({ queryKey: ["creator", "credit-transactions"] })
      qc.invalidateQueries({ queryKey: ["creator", "xp-balances"] })
    },
  })
}

export interface WithdrawResult {
  request_id: string
  credits: number
  status: string
}

/**
 * Request a closed-loop credit redemption → POST
 * /vendor/creator/credits/withdraw. Posture A: this is NOT a cash-out — it
 * burns ₡ back to the issuer and queues the request for manual settlement.
 * Falls back to a simulated pending request under mock.
 */
export function useWithdrawCredits() {
  const qc = useQueryClient()
  return useMutation<WithdrawResult, Error, { credits: number }>({
    mutationFn: async (vars) => {
      try {
        const { data } = await api.post("/vendor/creator/credits/withdraw", vars)
        return data
      } catch (err) {
        if (USE_MOCK_DATA) {
          return mockResolve({
            request_id: `cwr_demo_${Math.random().toString(36).slice(2, 10)}`,
            credits: vars.credits,
            status: "pending",
          })
        }
        throw err
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["creator", "credit-balance"] })
      qc.invalidateQueries({ queryKey: ["creator", "credit-transactions"] })
      qc.invalidateQueries({ queryKey: ["creator", "xp-balances"] })
    },
  })
}
