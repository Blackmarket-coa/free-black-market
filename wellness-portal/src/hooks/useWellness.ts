import { useQuery } from "@tanstack/react-query"
import { USE_MOCK_DATA, mockResolve, api } from "@bmc/portal-kit"
import {
  MOCK_ANALYTICS,
  MOCK_ATTENDEES,
  MOCK_AUTOMATIONS,
  MOCK_BLACKOUT_DM,
  MOCK_CLASSES,
  MOCK_CLIENT_THREADS,
  MOCK_CLIENTS,
  MOCK_COMMUNITY,
  MOCK_DASHBOARD,
  MOCK_DIGITAL,
  MOCK_EMBED,
  MOCK_MEMBERS,
  MOCK_MEMBERSHIP_TIERS,
  MOCK_PAYOUTS,
  MOCK_PHYSICAL,
  MOCK_SESSION_TYPES,
} from "@/lib/mock/data"
import type {
  AnalyticsData,
  AutomationTemplate,
  BlackoutMessage,
  ClassAttendee,
  ClassEvent,
  ClientProfile,
  ClientThread,
  DashboardSummary,
  DigitalProduct,
  EmbedConfig,
  Member,
  MembershipTier,
  PayoutsData,
  PhysicalProduct,
  SessionType,
} from "@/types"

// Each hook mirrors a /vendor/wellness/* route. While USE_MOCK_DATA is true it
// resolves the typed mock layer; flip the flag (or per hook) to hit the backend.

export function useDashboard() {
  return useQuery<DashboardSummary>({
    queryKey: ["wellness", "dashboard"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_DASHBOARD)
      const { data } = await api.get("/vendor/wellness/dashboard-summary")
      return data.summary
    },
    staleTime: 60_000,
  })
}

export function usePayouts() {
  return useQuery<PayoutsData>({
    queryKey: ["wellness", "payouts"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PAYOUTS)
      const { data } = await api.get("/vendor/wellness/payouts/current-period")
      return data
    },
  })
}

export function useSessionTypes() {
  return useQuery<SessionType[]>({
    queryKey: ["wellness", "session-types"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_SESSION_TYPES)
      const { data } = await api.get("/vendor/wellness/session-types")
      return data.session_types
    },
  })
}

export function useClasses() {
  return useQuery<ClassEvent[]>({
    queryKey: ["wellness", "classes"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_CLASSES)
      const { data } = await api.get("/vendor/wellness/classes")
      return data.classes
    },
  })
}

export function useClassAttendees(classId?: string) {
  return useQuery<ClassAttendee[]>({
    queryKey: ["wellness", "attendees", classId],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_ATTENDEES)
      const { data } = await api.get(`/vendor/wellness/classes/${classId}/attendees`)
      return data.attendees
    },
    enabled: Boolean(classId) || USE_MOCK_DATA,
  })
}

export function useDigitalProducts() {
  return useQuery<DigitalProduct[]>({
    queryKey: ["wellness", "digital"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_DIGITAL)
      const { data } = await api.get("/vendor/wellness/digital-products")
      return data.digital_products
    },
  })
}

export function usePhysicalProducts() {
  return useQuery<PhysicalProduct[]>({
    queryKey: ["wellness", "physical"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_PHYSICAL)
      const { data } = await api.get("/vendor/wellness/physical-products")
      return data.physical_products
    },
  })
}

export function useMembershipTiers() {
  return useQuery<MembershipTier[]>({
    queryKey: ["wellness", "membership-tiers"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_MEMBERSHIP_TIERS)
      const { data } = await api.get("/vendor/wellness/memberships")
      return data.membership_tiers
    },
  })
}

export function useMembers() {
  return useQuery<Member[]>({
    queryKey: ["wellness", "members"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_MEMBERS)
      const { data } = await api.get("/vendor/wellness/members")
      return data.members
    },
  })
}

export function useClients() {
  return useQuery<ClientProfile[]>({
    queryKey: ["wellness", "clients"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_CLIENTS)
      const { data } = await api.get("/vendor/wellness/clients")
      return data.clients
    },
  })
}

export function useClientThreads() {
  return useQuery<ClientThread[]>({
    queryKey: ["wellness", "client-threads"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_CLIENT_THREADS)
      const { data } = await api.get("/api/blackout/client-dms")
      return data.threads
    },
    refetchInterval: 30_000,
  })
}

export function useClientDM(roomId?: string) {
  return useQuery<BlackoutMessage[]>({
    queryKey: ["wellness", "dm", roomId],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_BLACKOUT_DM)
      const { data } = await api.get(`/api/blackout/client-dms/${roomId}/messages`)
      return data.messages
    },
    enabled: Boolean(roomId) || USE_MOCK_DATA,
  })
}

export function useCommunityFeed() {
  return useQuery<BlackoutMessage[]>({
    queryKey: ["wellness", "community"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_COMMUNITY)
      const { data } = await api.get("/api/blackout/community/messages")
      return data.messages
    },
    refetchInterval: 30_000,
  })
}

export function useAutomations() {
  return useQuery<AutomationTemplate[]>({
    queryKey: ["wellness", "automations"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_AUTOMATIONS)
      const { data } = await api.get("/vendor/wellness/automations")
      return data.automations
    },
  })
}

export function useAnalytics() {
  return useQuery<AnalyticsData>({
    queryKey: ["wellness", "analytics"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_ANALYTICS)
      const { data } = await api.get("/vendor/wellness/analytics/insights")
      return data
    },
  })
}

export function useEmbedConfig() {
  return useQuery<EmbedConfig>({
    queryKey: ["wellness", "embed"],
    queryFn: async () => {
      if (USE_MOCK_DATA) return mockResolve(MOCK_EMBED)
      const { data } = await api.get("/vendor/wellness/embed")
      return data
    },
  })
}
