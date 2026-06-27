import { useMutation, useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@/lib/api"
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
  SplitContract,
  XpBalance,
} from "@/types"

// Each read hook mirrors a future /vendor/creator/* (or /vendor/hawala/*) route.
// While USE_MOCK_DATA is true it resolves the typed mock layer. The two
// mutations at the bottom call the REAL backend bridge endpoints that already
// exist (stream overlay URL, Blackout membership force-resync).

export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: ["creator", "dashboard"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_DASHBOARD)
      const { data } = await api.get("/vendor/creator/hub-data")
      return data
    },
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
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_MEMBERSHIP_TIERS)
      const { data } = await api.get("/vendor/creator/memberships")
      return data.membership_tiers
    },
  })
}

export function useMembers() {
  return useQuery<Member[]>({
    queryKey: ["creator", "members"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_MEMBERS)
      const { data } = await api.get("/vendor/creator/members")
      return data.members
    },
  })
}

export function useCreditBalance() {
  return useQuery<CreditBalance>({
    queryKey: ["creator", "credit-balance"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_CREDIT_BALANCE)
      const { data } = await api.get("/vendor/creator/credits/balance")
      return data
    },
  })
}

export function useCreditTransactions() {
  return useQuery<CreditTransaction[]>({
    queryKey: ["creator", "credit-transactions"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_CREDIT_TXNS)
      const { data } = await api.get("/vendor/creator/credits/transactions")
      return data.transactions
    },
  })
}

export function useXpBalances() {
  return useQuery<XpBalance[]>({
    queryKey: ["creator", "xp-balances"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_XP_BALANCES)
      const { data } = await api.get("/vendor/creator/xp-balances")
      return data.balances
    },
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
